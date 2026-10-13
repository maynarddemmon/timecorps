// Costs on actions: what an agent must pay to take one. One action by default, or what the
// action's costs say: more actions, score, or a stat of the agent, the Event or the timeline.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const NO_ROLL = {difficulty:'no-roll'},

    /*  Serves the test scenario with actions that have costs added to the origin, where Alpha
        starts, as if they were in the data. Their checks don't roll, so only costs matter. */
    routeScenarioWithCosts = page => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        Object.assign(json.events.origin.actions, {
            bribe:{label:'Bribe', skillCheck:NO_ROLL, costs:{'agent.action':'2', 'timeline.score':'100 + 100 * event.paradox.value'}},
            ponder:{label:'Ponder', skillCheck:NO_ROLL, costs:{'agent.action':'agent.paradox.value'}},
            glance:{label:'Glance', skillCheck:NO_ROLL, costs:{'agent.action':null}},
            nothing:{label:'Nothing', skillCheck:NO_ROLL, costs:null},
            scoreOnly:{label:'Tip', skillCheck:NO_ROLL, costs:{'timeline.score':'10'}},
            spend:{label:'Spend', skillCheck:NO_ROLL, costs:{
                'agent.action':'0', 'agent.chronal':'10', 'agent.health':'10', 'agent.paradox':'1', 'event.attestation':'5'
            }},
            bad:{label:'Bad', skillCheck:NO_ROLL, costs:{'agent.mood':'1', 'timeline.chronal':5}},
            broken:{label:'Broken', skillCheck:NO_ROLL, costs:{'timeline.score':'nope'}},
            negative:{label:'Negative', skillCheck:NO_ROLL, costs:{'timeline.score':'-5'}}
        });
        return route.fulfill({json});
    }),

    /*  Sets up Alpha at the origin with fresh actions, then takes an action and returns what
        changed. */
    takeAction = (page, actionId, setup={}) => page.evaluate(([actionId, setup]) => {
        const alpha = tc.model.getAgentModel('AL'),
            origin = tc.model.getEventModel('origin'),
            action = origin.getActionModels()[actionId];
        alpha.setActionExecCount(setup.used ?? 0);
        if (setup.score != null) tc.model.setScore(setup.score);
        if (setup.paradox != null) alpha.paradox.setValue(setup.paradox);
        if (setup.eventParadox != null) origin.paradox.setValue(setup.eventParadox);
        const before = {score:tc.model.getScore(), logLength:alpha.getLog().length},
            canPay = alpha.canPayCostsFor(action);
        alpha.doAction(action);
        const log = alpha.getLog(),
            entry = log.length > before.logLength ? log[log.length - 1] : null;
        return {
            canPay,
            taken:entry != null,
            used:alpha.getActionExecCount(),
            scorePaid:before.score - tc.model.getScore(),
            costs:entry?.costs
        };
    }, [actionId, setup]);

test('an action costs one action unless its costs say otherwise, merged over that default', async ({page}) => {
    await routeScenarioWithCosts(page);
    const problems = await startGame(page),
        costs = await page.evaluate(() => {
            const actions = tc.model.getEventModel('origin').getActionModels(),
                describe = actionId => actions[actionId].getCosts().map(cost => cost.key + '=' + cost.getExpr());
            return {
                investigate:describe('_investigate'),
                bribe:describe('bribe'),
                ponder:describe('ponder'),
                glance:describe('glance'),
                nothing:describe('nothing'),
                scoreOnly:describe('scoreOnly'),
                bad:describe('bad')
            };
        });
    expect(costs.investigate).toEqual(['agent.action=1']);
    expect(costs.bribe).toEqual(['agent.action=2', 'timeline.score=100 + 100 * event.paradox.value']);
    expect(costs.ponder).toEqual(['agent.action=agent.paradox.value']);
    // null leaves a cost out, and "costs":null leaves them all out.
    expect(costs.glance).toEqual([]);
    expect(costs.nothing).toEqual([]);
    // Giving only other costs keeps the default action.
    expect(costs.scoreOnly).toEqual(['agent.action=1', 'timeline.score=10']);
    // Unknown keys and amounts that aren't strings are ignored, with warnings naming them.
    expect(costs.bad).toEqual(['agent.action=1']);
    // (The broken and negative amounts also warn, once the buttons show them.)
    expect(problems.warnings.filter(warning => warning.includes(' action bad '))).toEqual([
        expect.stringMatching(/^Event origin action bad cost agent\.mood must be one of agent\.action, /),
        expect.stringMatching(/^Event origin action bad cost timeline\.chronal must be a non-empty string/)
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('costs are worked out when the action is taken, and an action that can\'t be paid for isn\'t taken', async ({page}) => {
    await routeScenarioWithCosts(page);
    const problems = await startGame(page);

    // Two actions and 100 score, or 200 with a point of Event paradox. A failed check would
    // still pay, but these don't roll.
    expect(await takeAction(page, 'bribe', {score:150, eventParadox:0})).toEqual({
        canPay:true, taken:true, used:2, scorePaid:100, costs:{'agent.action':2, 'timeline.score':100}
    });
    expect(await takeAction(page, 'bribe', {score:150, eventParadox:1})).toEqual({
        canPay:false, taken:false, used:0, scorePaid:0, costs:undefined
    });
    // Not enough actions left, though there's score enough.
    expect(await takeAction(page, 'bribe', {score:500, eventParadox:0, used:2})).toMatchObject({canPay:false, taken:false, used:2, scorePaid:0});

    // As many actions as the agent has paradox: none is free.
    expect(await takeAction(page, 'ponder', {paradox:0, used:3})).toEqual({canPay:true, taken:true, used:3, scorePaid:0, costs:{'agent.action':0}});
    expect(await takeAction(page, 'ponder', {paradox:2, used:2})).toMatchObject({canPay:false, taken:false});
    expect(await takeAction(page, 'ponder', {paradox:2, used:1})).toMatchObject({canPay:true, taken:true, used:3});

    // With no costs at all, even an agent out of actions can act.
    expect(await takeAction(page, 'glance', {used:3})).toEqual({canPay:true, taken:true, used:3, scorePaid:0, costs:{}});

    // The default is still one action.
    expect(await takeAction(page, 'scoreOnly', {score:10, used:2})).toMatchObject({canPay:true, taken:true, used:3, scorePaid:10});
    expect(await takeAction(page, 'scoreOnly', {score:9, used:0})).toMatchObject({canPay:false, taken:false});

    expect(problems.pageErrors).toEqual([]);
});

test('stat costs are paid within the stat\'s limits, and a broken or negative cost warns', async ({page}) => {
    await routeScenarioWithCosts(page);
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                origin = tc.model.getEventModel('origin'),
                actions = origin.getActionModels(),
                spend = actions.spend,
                set = ({chronal=50, health=50, paradox=0, attestation=20}) => {
                    alpha.chronal.setValue(chronal);
                    alpha.health.setValue(health);
                    alpha.paradox.setValue(paradox);
                    origin.attestation.setValue(attestation);
                    tc.model.setScore(1000);
                },
                canSpendWith = stats => (set(stats), alpha.canPayCostsFor(spend));

            set({});
            alpha.doAction(spend);
            const paid = {
                chronal:alpha.chronal.value, health:alpha.health.value, paradox:alpha.paradox.value,
                attestation:origin.attestation.value, score:tc.model.getScore()
            };
            return {
                paid,
                // Just enough of each, and just short. Health can't be spent to death, and a
                // paradox cost can't reach the agent's limit, which would devour them.
                enough:canSpendWith({chronal:10, health:11, paradox:alpha.paradox.max - 2, attestation:5}),
                shortChronal:canSpendWith({chronal:9}),
                shortHealth:canSpendWith({health:10}),
                noParadoxRoom:canSpendWith({paradox:alpha.paradox.max - 1}),
                shortAttestation:canSpendWith({attestation:4}),

                broken:alpha.canPayCostsFor(actions.broken),
                negative:alpha.getCostsFor(actions.negative).map(cost => cost.amount),
                negativeAgain:alpha.getCostsFor(actions.negative).map(cost => cost.amount)
            };
        });
    // Attestation scores 3 a point, lost or gained.
    expect(out.paid).toEqual({chronal:40, health:40, paradox:1, attestation:15, score:985});
    expect(out.enough).toBe(true);
    expect(out.shortChronal).toBe(false);
    expect(out.shortHealth).toBe(false);
    expect(out.noParadoxRoom).toBe(false);
    expect(out.shortAttestation).toBe(false);
    expect(out.broken).toBe(false);
    expect(out.negative).toEqual([1, 0]);
    expect(out.negativeAgain).toEqual([1, 0]);
    // A broken amount warns each time it's worked out, and a negative one only the first time.
    const warnings = problems.warnings.filter(warning => !warning.includes(' action bad '));
    expect(new Set(warnings)).toEqual(new Set([
        'Check expression threw (nope is not defined): nope',
        'Event origin action negative cost timeline.score is negative (paying nothing): -5'
    ]));
    expect(warnings.filter(warning => warning.includes(' is negative '))).toHaveLength(1);
    expect(problems.pageErrors).toEqual([]);
});

test('an action\'s button shows its costs, flags stat costs and is disabled when they can\'t be paid', async ({page}) => {
    await routeScenarioWithCosts(page);
    const problems = await startGame(page),
        info = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                actions = tc.model.getEventModel('origin').getActionModels();
            tc.model.setScore(150);
            alpha.paradox.setValue(0);
            tc.model.getEventModel('origin').attestation.setValue(20);
            alpha.setActionExecCount(2);
            const phrase = actionId => alpha.getCostsPhrase(actions[actionId]);
            return {
                investigate:phrase('_investigate'),
                bribe:phrase('bribe'),
                ponder:phrase('ponder'),
                scoreOnly:phrase('scoreOnly'),
                spend:phrase('spend'),
                broken:phrase('broken')
            };
        });
    // The usual single action goes without saying, unless it can't be paid.
    expect(info.investigate).toBe('');
    expect(info.bribe).toBe("Costs: 2 Actions (can't pay), 100 Score");
    expect(info.ponder).toBe('Uses no action');
    expect(info.scoreOnly).toBe('Costs: 10 Score');
    expect(info.spend).toBe('Uses no action · Costs: 10 Chr⏲nal, 10 Health, 1 Parad⥁x, 5 Event Attestation'.replace(/ · /g, ' · '));
    expect(info.broken).toBe("Costs: ? Score (can't pay)");

    await page.evaluate(() => {
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
    });
    const btn = label => page.getByText(new RegExp('^' + label + '( \\[.*\\])?$')).filter({visible:true});
    await expect(btn('Bribe')).toHaveCount(1);
    await expect(btn('Bribe')).toHaveClass(/disabled/);
    await expect(btn('Tip')).not.toHaveClass(/disabled/);
    // An agent out of actions can still take an action that uses none.
    await page.evaluate(() => tc.model.getAgentModel('AL').setActionExecCount(3));
    await expect(btn('Tip')).toHaveClass(/disabled/);
    await expect(btn('Glance')).not.toHaveClass(/disabled/);
    // Stat costs flag the button as an effect would.
    await expect(btn('Spend')).toHaveText('Spend [⏲ + ⥁ + ♥]');
    await expect(btn('Bribe')).toHaveText('Bribe');

    // The model agrees with the buttons.
    expect(await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            actions = tc.model.getEventModel('origin').getActionModels();
        return ['bribe', 'ponder', 'glance', 'scoreOnly'].map(id => alpha.canPayCostsFor(actions[id]));
    })).toEqual([false, true, true, false]);
    expect(problems.pageErrors).toEqual([]);
});
