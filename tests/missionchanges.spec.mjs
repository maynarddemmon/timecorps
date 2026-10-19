// set and adj on missions (onSetup and onSuccess), and set and adj keys that name another
// Event, e.g. "events.aftermath.attestation", which actions and exits can use too.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const readStats = page => page.evaluate(() => {
    const m = tc.model;
    return {
        originHistoricity:m.getEventModel('origin').historicity.value,
        aftermathHistoricity:m.getEventModel('aftermath').historicity.value,
        chronal:m.chronal.value, score:m.getScore()
    };
});

test('a mission\'s setup sets, and its success adjusts, as the data says', async ({page}) => {
    const problems = await startGame(page);
    const before = await readStats(page);
    expect(before).toMatchObject({originHistoricity:75, aftermathHistoricity:65, score:0});
    
    await page.evaluate(() => tc.model.getOperationModel('first').doOnSuccess());
    expect(await readStats(page)).toEqual({...before, chronal:before.chronal + 15, score:5000});
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a mission\'s old award keys, and an onFailure it never uses, are warned about', async ({page}) => {
    await page.route('**/tests/data/operations.json5', route => {
        const json = readTestData('operations.json5'),
            first = json.operations.first;
        first.onSetup.awardCredits = 5;
        first.onSuccess.awardScore = 100;
        first.onSuccess.adj['timeline.paradox'] = {onFailure:'1'};
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    expect(problems.warnings).toEqual([
        'Operation first onSetup awardCredits is replaced by set and adj (ignoring it)',
        'Operation first onSuccess awardScore is replaced by set and adj (ignoring it)',
        'Operation first onSuccess adj timeline.paradox has onFailure, which an Operation never uses'
    ]);
    expect(await page.evaluate(() => tc.model.getCredits())).toBe(0);
    expect(problems.pageErrors).toEqual([]);
});

test('an action or exit can change another Event\'s stats and Values', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5'),
            origin = json.events.origin;
        origin.actions.warn = {
            label:'Warn', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null},
            set:{'events.aftermath.values.lost':{onSuccess:'false'}},
            adj:{'events.plan.historicity':'10'}
        };
        // Arriving changes the Event the exit leads to.
        origin.exits.find(exit => exit.to === 'aftermath').adj = {'events.aftermath.attestation':'7'};
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            origin = m.getEventModel('origin'),
            aftermath = m.getEventModel('aftermath'),
            exitModel = origin.getExitModels().find(exit => exit.to === 'aftermath');
        const retval = {
            phrase:alpha.getAdjustmentsPhrase(exitModel),
            planBefore:m.getEventModel('plan').historicity.value,
            scoreBefore:m.getScore()
        };
        alpha.doAction(origin.getActionModels().warn);
        retval.planAfter = m.getEventModel('plan').historicity.value;
        retval.lost = aftermath.values.lost.value;
        alpha.doFollowExit(exitModel);
        retval.attestation = aftermath.attestation.value;
        retval.scoreGained = m.getScore() - retval.scoreBefore;
        retval.at = alpha.event;
        return retval;
    });
    expect(out).toMatchObject({
        phrase:'Aftermath Attestation: ~+7 if passed',
        planAfter:out.planBefore + 10,
        lost:false,
        attestation:7,
        // Attestation scores however it's gained.
        scoreGained:21,
        at:'aftermath'
    });
    expect(problems.pageErrors).toEqual([]);
});

test('set and adj can change any agent\'s stats and skills, from a mission or an action', async ({page}) => {
    await Promise.all([
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5');
            json.operations.first.onSuccess.adj['agents.BR.skills.chronogation'] = '100';
            json.operations.first.onSuccess.set = {'agents.BR.chronal':'10'};
            return route.fulfill({json});
        }),
        page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5');
            json.events.origin.actions.patch = {
                label:'Patch Up Bravo', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null},
                adj:{'agents.BR.health':'-5', 'agents.BR.skills.agl':'25'}
            };
            return route.fulfill({json});
        })
    ]);
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            bravo = m.getAgentModel('BR'),
            action = m.getEventModel('origin').getActionModels().patch,
            read = () => ({chronogation:bravo.getSkill('chronogation'), agl:bravo.getSkill('agl'), chronal:bravo.chronal.value, health:bravo.health.value}),
            before = read(),
            phrase = alpha.getAdjustmentsPhrase(action);
        m.getOperationModel('first').doOnSuccess();
        alpha.doAction(action);
        return {before, after:read(), phrase};
    });
    expect(out.after).toEqual({
        chronogation:out.before.chronogation + 100, agl:out.before.agl + 25,
        chronal:10, health:out.before.health - 5
    });
    expect(out.phrase).toMatch(/^Bravo Health: ~-5 if passed.+Bravo Agility: ~\+25 if passed$/);
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('set can put an agent at an Event, as a deploy or jump that pays its way', async ({page}) => {
    await Promise.all([
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5'),
                first = json.operations.first;
            first.onSetup.set['agents.BR.chronal'] = '50';
            first.onSetup.set['agents.BR.event'] = "'origin'";
            // Applied in order, so Charlie has no chronal left when he's sent.
            first.onSetup.set['agents.CH.chronal'] = '0';
            first.onSetup.set['agents.CH.event'] = "'origin'";
            first.onSetup.adj = {'agents.DE.event':"'origin'"};
            return route.fulfill({json});
        }),
        page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5');
            json.events.origin.actions.leave = {
                label:'Leave', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null},
                set:{'agent.event':"'aftermath'"}
            };
            return route.fulfill({json});
        })
    ]);
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            bravo = m.getAgentModel('BR'),
            alphaChronal = alpha.chronal.value;
        const retval = {
            bravoAt:bravo.event,
            bravoArrived:bravo.getLog().at(-1).type,
            bravoChronalUsed:50 - bravo.chronal.value,
            charlieAt:m.getAgentModel('CH').event,
            deltaAt:m.getAgentModel('DE').event
        };
        alpha.doAction(m.getEventModel('origin').getActionModels().leave);
        retval.alphaAt = alpha.event;
        retval.alphaChronalUsed = alphaChronal - alpha.chronal.value;
        return retval;
    });
    expect(out).toMatchObject({bravoAt:'origin', bravoArrived:'deploy', charlieAt:'boats', deltaAt:'time_corps_hq', alphaAt:'aftermath'});
    expect(out.bravoChronalUsed).toBeGreaterThan(0);
    expect(out.alphaChronalUsed).toBeGreaterThan(0);
    expect(problems.warnings).toEqual([
        'Operation first onSetup adj agents.DE.event can only be set, not adjusted (ignoring it): \'origin\'',
        'Cannot time travel CH to origin: Not enough chronal'
    ]);
    expect(problems.pageErrors).toEqual([]);
});
