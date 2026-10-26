// Adjustments on actions and exits: changes to a stat of the agent, the Event or the timeline, such
// as injuries on the way through an exit or healing from a rest.
import {test, expect} from '@playwright/test';
import {startGame, dialogTitle, dismissAgentDossier, btnTooltip, readTestData} from './helpers.mjs';

const INJURY = {difficulty:300, actionType:'athletic', onFailure:'-(d(6)+4)'},
    HEALTH = 'agent.health',

    /*  Serves the test scenario with adjustments added to some exits, as if they were in the
        data: a good injury from the origin to the aftermath, and one with no amount from
        the warnings to the backlog. */
    routeScenarioWithInjuries = page => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5'),
            exitTo = (eventId, toId) => json.events[eventId].exits.find(exit => exit.to === toId);
        exitTo('origin', 'aftermath').adj = {[HEALTH]:INJURY};
        exitTo('warnings', 'backlog').adj = {[HEALTH]:{actionType:'athletic'}};
        // And a bad action skill check, to show its warning names the Event too.
        json.events.plan.actions.prepare.skillCheck.difficulty = 'hard';
        return route.fulfill({json});
    }),

    /*  Takes Alpha's exit from the origin to the aftermath with the rolls queued, and returns
        what happened. */
    takeInjuryExit = (page, ...rolls) => page.evaluate(rolls => {
        const alpha = tc.model.getAgentModel('AL'),
            exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'),
            before = alpha.health.value;
        tc.rng.queueRolls(...rolls);
        alpha.doFollowExit(exitModel);
        const log = alpha.getLog();
        return {
            damage:before - alpha.health.value,
            event:alpha.event,
            logged:log[log.length - 1].adj?.['agent.health'],
            queued:tc.rng.getQueuedRollCount()
        };
    }, rolls),

    // Alpha's athletic check, so tests can pick rolls that pass or fail it.
    alphaSkills = readTestData('agents.json5').agents.AL.skills,
    alphaAthleticEase = 0.5*alphaSkills.str + 0.5*alphaSkills.agl - INJURY.difficulty,
    PASS_ROLL = 999,
    FAIL_ROLL = 0,

    // The text of the floating texts showing.
    floatingTexts = page => page.evaluate(() => tc.app.getSubviews()
        .filter(sv => sv.isA(tc.FloatingText) && sv.visible)
        .map(floatingText => floatingText.text.replace(/\u00A0/g, ' ')));

test('an exit\'s adjustment comes from the data, and one without an amount is ignored with a warning naming it', async ({page}) => {
    await routeScenarioWithInjuries(page);
    const problems = await startGame(page),
        checks = await page.evaluate(() => {
            const describe = (eventId, toId) => {
                const exitModel = tc.model.getEventModel(eventId).getExitModels().find(exit => exit.to === toId);
                return exitModel.getAdjustments().map(adjustment => ({
                    key:adjustment.key,
                    onSuccess:adjustment.getAmountExpr(true) ?? null,
                    onFailure:adjustment.getAmountExpr(false) ?? null,
                    ownCheck:adjustment.hasOwnCheck(),
                    difficulty:adjustment.getActionSkillDifficulty(),
                    name:adjustment.getActionSkillName()
                }));
            };
            return {
                good:describe('origin', 'aftermath'),
                noAmount:describe('warnings', 'backlog'),
                none:describe('plan', 'supply')
            };
        });
    expect(checks.good).toEqual([{key:HEALTH, onSuccess:null, onFailure:'-(d(6)+4)', ownCheck:true, difficulty:300, name:'Athletic'}]);
    expect(checks.noAmount).toEqual([]);
    expect(checks.none).toEqual([]);

    expect(problems.warnings).toHaveLength(2);
    expect(problems.warnings[0]).toMatch(/^Event plan action prepare skill check difficulty must be/);
    expect(problems.warnings[1]).toMatch(/^Event warnings exit to backlog adj agent\.health needs an onSuccess, onFailure or onBoth/);
    expect(problems.pageErrors).toEqual([]);
});

test('a failed injury check costs health but the exit is still taken; a passed one costs nothing', async ({page}) => {
    expect(FAIL_ROLL + alphaAthleticEase).toBeLessThan(0);
    expect(PASS_ROLL + alphaAthleticEase).toBeGreaterThanOrEqual(0);

    await routeScenarioWithInjuries(page);
    const problems = await startGame(page);

    // The check rolls first, then the damage die: a 3 on the d(6), plus 4.
    expect(await takeInjuryExit(page, FAIL_ROLL, 2)).toEqual({damage:7, event:'aftermath', logged:-7, queued:0});

    // Back again, and this time the check passes, so the damage die isn't rolled. The check
    // was still made, so the adjustment is logged as nothing.
    await page.evaluate(() => tc.model.getAgentModel('AL').setEvent('origin'));
    expect(await takeInjuryExit(page, PASS_ROLL, 2)).toEqual({damage:0, event:'aftermath', logged:0, queued:1});
    await page.evaluate(() => tc.rng.clearQueuedRolls());

    expect(problems.pageErrors).toEqual([]);
});

test('an exit without adjustments rolls nothing and logs none', async ({page}) => {
    const problems = await startGame(page);
    expect(await takeInjuryExit(page, FAIL_ROLL)).toEqual({damage:0, event:'aftermath', logged:undefined, queued:1});
    await page.evaluate(() => tc.rng.clearQueuedRolls());
    expect(problems.pageErrors).toEqual([]);
});

test('amounts are whole points, a positive one heals, and a broken one does nothing', async ({page}) => {
    const problems = await startGame(page),
        changeFor = amount => page.evaluate(amount => {
            const alpha = tc.model.getAgentModel('AL'),
                exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath');
            // Back to the start with no visits, so the trips don't build up paradox.
            alpha.getLog().length = 0;
            alpha.paradox.setValue(0);
            alpha.health.setValue(50);
            alpha.setEvent('origin');
            exitModel.setAdjustments({'agent.health':{difficulty:1000, check:'0', onFailure:amount}});
            tc.rng.queueRolls(0);
            alpha.doFollowExit(exitModel);
            const log = alpha.getLog();
            return [alpha.health.value - 50, log[log.length - 1].adj['agent.health']];
        }, amount);

    // The change, and the same logged.
    expect(await changeFor('-2.6')).toEqual([-3, -3]);
    expect(await changeFor('5')).toEqual([5, 5]);
    
    // An amount sees its own check's difficulty: 1000 here, where the exit's default is 250.
    expect(await changeFor('-difficulty / 250')).toEqual([-4, -4]);
    expect(await changeFor('nope + 1')).toEqual([0, 0]);
    expect(await changeFor('Math.sqrt(-1)')).toEqual([0, 0]);
    
    // Both warned about each time they're evaluated, e.g. for the exit button's tooltip too.
    expect(new Set(problems.warnings)).toEqual(new Set([
        'Check expression threw (nope is not defined): nope + 1',
        'Check expression is not a finite number (NaN): Math.sqrt(-1)'
    ]));
    expect(problems.pageErrors).toEqual([]);
});

test('amounts roll dice and aren\'t clamped, and damage has a phrase', async ({page}) => {
    await startGame(page);
    const out = await page.evaluate(() => {
        tc.rng.queueRolls(5);
        return {
            rolled:tc.checks.rollAmount('d(6) + 2000'),
            average:tc.checks.getAverageAmount('d(6) + 2000'),
            phrases:[0, 0.5, 1, 4, 5, 10, 15, 25, 50, 75, 99, 100, 149, 150, 500].map(tc.checks.toDamagePhrase)
        };
    });
    expect(out).toEqual({
        rolled:2006,
        average:2003.5,
        phrases:[
            'harmless', 'harmless', 'light injury', 'light injury', 'moderate injury', 'serious injury',
            'severe injury', 'grievous injury', 'critical injury', 'crippling injury', 'crippling injury',
            'deadly injury', 'deadly injury', 'certain death', 'certain death'
        ]
    });
});

test('exit buttons flag the injury risk and explain it in the tooltip, and a failure floats the damage', async ({page}) => {
    await routeScenarioWithInjuries(page);
    const problems = await startGame(page),
        // -(d(6)+4) averages -7.5: moderate.
        risk = '♥ Risking: moderate injury\u00A0·\u00A0Athletic / ' + await page.evaluate(ease => tc.checks.toEasePhrase(ease), alphaAthleticEase),
        visibleText = text => page.getByText(text, {exact:true}).filter({visible:true});

    // In the agent's list of exits.
    const exitBtn = visibleText('Walk to Aftermath [♥]');
    await expect(exitBtn).toBeVisible();
    expect(await btnTooltip(page, 'Walk to Aftermath [♥]')).toBe(risk);

    // In the header, when viewing the Event the exit leads to.
    await page.evaluate(() => tc.app.selectEventBox('aftermath'));
    await expect(visibleText('Walk to [♥]')).toBeVisible();
    expect(await btnTooltip(page, 'Walk to [♥]')).toBe(risk);
    await page.evaluate(() => tc.app.selectEventBox('origin'));

    // Exits without adjustments have no flag or tooltip. Both Events are made known so the exit shows.
    await page.evaluate(() => {
        tc.model.getEventModel('warnings').attestation.setValue(10);
        tc.model.getEventModel('backlog').attestation.setValue(10);
        tc.model.getAgentModel('AL').setEvent('warnings');
        tc.app.selectEventBox('warnings');
    });
    await expect(visibleText('Wait til Message Backlog')).toBeVisible();
    expect(await btnTooltip(page, 'Wait til Message Backlog')).toBe('');
    await page.evaluate(() => {
        tc.model.getAgentModel('AL').setEvent('origin');
        tc.app.selectEventBox('origin');
    });
    await expect(exitBtn).toBeVisible();

    // Fails, then a 3 on the d(6): 7 damage.
    await page.evaluate(([fail, die]) => tc.rng.queueRolls(fail, die), [FAIL_ROLL, 2]);
    await exitBtn.click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Failed by [\d.]+ · -7♥$/)]);
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('aftermath');

    expect(problems.pageErrors).toEqual([]);
});


/*  Kills Alpha on the exit from the origin: a check Alpha can't pass, and more damage than Alpha has. */
const killALOnExit = page => page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath');
        exitModel.setAdjustments({'agent.health':{difficulty:1000, check:'0', onFailure:'-500'}});
        tc.rng.queueRolls(0);
        alpha.doFollowExit(exitModel);
        return {dead:alpha.isDead(), health:alpha.health.value};
    }),

    // Bravo joins the team, with no chronal.
    giveBravo = page => page.evaluate(() => {
        tc.model.revealAgents(['BR']);
        tc.model.awardAgents(['BR']);
    }),

    acknowledge = page => page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();

test('a death is announced, then the dossier, and losing the last agent ends the campaign', async ({page}) => {
    const problems = await startGame(page);
    expect(await killALOnExit(page)).toEqual({dead:true, health:0});

    await expect(dialogTitle(page, 'Agent Death')).toHaveText('Agent Death : Alpha');
    await expect(page.getByText(/^At the Nexus, Alpha’s telemetry goes flat/).filter({visible:true})).toBeVisible();
    await acknowledge(page);
    await dismissAgentDossier(page, 'Alpha');
    await expect(dialogTitle(page, 'Agent Roster Depleted')).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
});

test('a dead agent can\'t act or travel, and an agent with no chronal still counts toward the plan', async ({page}) => {
    const problems = await startGame(page);
    await giveBravo(page);
    await dismissAgentDossier(page, 'Bravo');
    expect(await page.evaluate(() => tc.model.getAgentModel('BR').isDevoured())).toBe(false);

    await killALOnExit(page);
    await acknowledge(page);
    await dismissAgentDossier(page, 'Alpha');

    // Bravo is still on the team, so the campaign goes on.
    await page.waitForTimeout(300);
    await expect(dialogTitle(page, 'Agent Roster Depleted')).toHaveCount(0);

    // Nothing moves the dead.
    const moves = await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            aftermath = tc.model.getEventModel('aftermath'),
            exitModel = aftermath.getExitModels()[0],
            before = alpha.event;
        alpha.doRecallToHQ();
        alpha.doDeployToEvent(tc.model.getEventModel('origin'));
        alpha.doFollowExit(exitModel);
        return {before, after:alpha.event, canAct:alpha.canAct(), canPay:alpha.canPayCostsFor(aftermath.getActionModels()._investigate)};
    });
    expect(moves).toEqual({before:'aftermath', after:'aftermath', canAct:false, canPay:false});

    // The agent's row says so, with no actions or exits, and the header offers no travel.
    await page.evaluate(() => {
        tc.app.selectAgentRow('AL');
        tc.app.selectEventBox('aftermath');
    });
    await expect(page.getByText('Deceased', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(page.getByText(/^Investigate/).filter({visible:true})).toHaveCount(0);
    await expect(page.getByText(/^(Loop back|Jump to|Recall to|Deploy to)/).filter({visible:true})).toHaveCount(0);

    // Nor does the header offer an exit to the finale, though the lifeboats lead there.
    await page.evaluate(() => {
        tc.model.getEventModel('finale').attestation.setValue(10);
        tc.app.selectEventBox('finale');
    });
    await expect(page.getByText('Arrivals', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(page.getByText(/^Lifeboat to/).filter({visible:true})).toHaveCount(0);
    await page.evaluate(() => tc.model.getAgentModel('BR').setEvent('aftermath'));
    await page.evaluate(() => tc.app.selectAgentRow('BR'));
    await expect(page.getByText(/^Lifeboat to/).filter({visible:true})).toHaveCount(1);

    expect(problems.pageErrors).toEqual([]);
});


/*  Takes Alpha's exit from the origin with this health adjustment and the rolls queued: its check
    passes on a roll of 999 and fails on 0. Returns the damage, what was logged and the rolls
    left over. */
const damageWith = (page, adjustmentCfg, ...rolls) => page.evaluate(([adjustmentCfg, rolls]) => {
        const alpha = tc.model.getAgentModel('AL'),
            exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath');
        // Back to the start with full health and no visits, so the trips don't build up paradox.
        alpha.getLog().length = 0;
        alpha.paradox.setValue(0);
        alpha.health.setValue(alpha.health.max);
        alpha.setEvent('origin');
        exitModel.setAdjustments({'agent.health':{difficulty:0, check:'0', ...adjustmentCfg}});
        const before = alpha.health.value;
        tc.rng.queueRolls(...rolls);
        alpha.doFollowExit(exitModel);
        const log = alpha.getLog(),
            queued = tc.rng.getQueuedRollCount();
        tc.rng.clearQueuedRolls();
        return {damage:before - alpha.health.value, logged:log[log.length - 1].adj?.['agent.health'], queued};
    }, [adjustmentCfg, rolls]),
    PASS = 999,
    FAIL = 0;

test('an adjustment uses onSuccess when its check passes and onFailure when it fails', async ({page}) => {
    const problems = await startGame(page);

    // Only on a failure. A pass rolls nothing more.
    expect(await damageWith(page, {onFailure:'-(d(6)+4)'}, PASS, 2)).toEqual({damage:0, logged:0, queued:1});
    expect(await damageWith(page, {onFailure:'-(d(6)+4)'}, FAIL, 2)).toEqual({damage:7, logged:-7, queued:0});

    // Only on a pass.
    expect(await damageWith(page, {onSuccess:'-3'}, PASS)).toEqual({damage:3, logged:-3, queued:0});
    expect(await damageWith(page, {onSuccess:'-3'}, FAIL)).toEqual({damage:0, logged:0, queued:0});

    // Light on a pass, heavy on a failure. Each case rolls only its own dice, after the check.
    const both = {onSuccess:'-d(10)', onFailure:'-50'};
    expect(await damageWith(page, both, PASS, 3)).toEqual({damage:4, logged:-4, queued:0});
    expect(await damageWith(page, both, FAIL, 3)).toEqual({damage:50, logged:-50, queued:1});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an amount that isn\'t a non-empty string is ignored with a warning, and unknown keys are warned about', async ({page}) => {
    const problems = await startGame(page),
        result = await page.evaluate(() => {
            const exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'),
                read = () => exitModel.getAdjustments().map(adjustment => [adjustment.getAmountExpr(true) ?? null, adjustment.getAmountExpr(false) ?? null]);
            exitModel.setAdjustments({'agent.health':{onSuccess:'', onFailure:'-9'}});
            const oneBad = read();
            exitModel.setAdjustments({'agent.health':{damage:'-150'}});
            return {oneBad, oldKey:read()};
        });
    expect(result).toEqual({oneBad:[[null, '-9']], oldKey:[]});
    expect(problems.warnings).toEqual([
        'Event origin exit to aftermath adj agent.health onSuccess must be a non-empty string (ignoring it): {onSuccess: , onFailure: -9}',
        'Event origin exit to aftermath adj agent.health skill check has unknown keys damage: {damage: -150}',
        'Event origin exit to aftermath adj agent.health needs an onSuccess, onFailure or onBoth (ignoring it): {damage: -150}'
    ]);
});

test('adj must be keyed by a stat, a skill, a Value or scratch, and the old injurySkillCheck is ignored with a warning', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const origin = tc.model.getEventModel('origin'),
                exitModel = origin.getExitModels().find(exit => exit.to === 'aftermath'),
                keys = () => exitModel.getAdjustments().map(adjustment => adjustment.key + ' ' + adjustment.enabledForActionSkillCheck);
            exitModel.setAdjustments({
                'agent.luck':{onSuccess:'1'},
                'health':{onSuccess:'1'},
                'event.health':{onSuccess:'1'},
                'agent.health.value':{onSuccess:'1'},
                'toString.health':{onSuccess:'1'},
                'agent.skills':{onSuccess:'1'},
                'agent.skills.agl.max':{onSuccess:'1'},
                'event.skills.agl':{onSuccess:'1'},
                'agent.health':-5,
                // An exit has no check of its own to follow, so this is ignored.
                'timeline.paradox':{onSuccess:'1', enabledForActionSkillCheck:'success'}
            });
            const valid = keys();
            exitModel.setAdjustments([{onSuccess:'1'}]);
            const notAnObject = keys();
            delete origin.getActionModels().old;
            origin.setActions({old:{label:'Old', set:{}, injurySkillCheck:{damageOnFailure:'5'}}});
            return {
                valid, notAnObject, 
                oldAdjustments:origin.getActionModels().old.getAdjustments().length
            };
        });
    // A key without a dot names a Value of the Event, which is only looked up when it applies.
    expect(out).toEqual({valid:['health both', 'timeline.paradox both'], notAnObject:[], oldAdjustments:0});
    const named = 'must be named for a stat of the agent, event or timeline, e.g. "agent.health", a skill of the agent, e.g. "agent.skills.agl", a Value of the Event, a stat or Value of another Event, e.g. "events.collision.historicity" or "events.collision.values.struck", a stat, skill, Event or Faction of another agent, e.g. "agents.ME.chronal", "agents.ME.skills.agl", "agents.ME.event" or "agents.ME.faction", or "scratch.<name>" (ignoring it): {onSuccess: 1}';
    expect(problems.warnings).toEqual([
        'Event origin exit to aftermath adj agent.luck ' + named,
        'Event origin exit to aftermath adj event.health ' + named,
        'Event origin exit to aftermath adj agent.health.value ' + named,
        'Event origin exit to aftermath adj toString.health ' + named,
        'Event origin exit to aftermath adj agent.skills ' + named,
        'Event origin exit to aftermath adj agent.skills.agl.max ' + named,
        'Event origin exit to aftermath adj event.skills.agl ' + named,
        'Event origin exit to aftermath adj agent.health must be a string or an object (ignoring it): -5',
        'Event origin exit to aftermath adj timeline.paradox enabledForActionSkillCheck only applies to actions (ignoring it): {onSuccess: 1, enabledForActionSkillCheck: success}',
        'Event origin exit to aftermath adj must be an object of adjustments by stat, e.g. "agent.health" (ignoring them): [Object]',
        'Event origin action old injurySkillCheck is replaced by adj, e.g. {"agent.health":{"onFailure":"-5"}} (ignoring it)'
    ]);
});

test('a pass that still hurts floats its damage, and the risk tooltip gives both cases', async ({page}) => {
    const problems = await startGame(page),
        riskFor = adjustmentCfg => page.evaluate(adjustmentCfg => {
            const alpha = tc.model.getAgentModel('AL'),
                exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath');
            exitModel.setAdjustments({'agent.health':{difficulty:0, check:'0', ...adjustmentCfg}});
            return alpha.getAdjustmentsPhrase(exitModel).replace(/\u00A0/g, ' ');
        }, adjustmentCfg);

    // A failure's damage first, then a pass's when it hurts and reads differently.
    expect(await riskFor({onFailure:'-150'})).toBe('♥ Risking: certain death · ensured');
    expect(await riskFor({onSuccess:'-d(10)', onFailure:'-150'})).toBe('♥ Risking: certain death (moderate injury if passed) · ensured');
    expect(await riskFor({onSuccess:'-150', onFailure:'-150'})).toBe('♥ Risking: certain death · ensured');
    expect(await riskFor({onSuccess:'-0.5', onFailure:'-20'})).toBe('♥ Risking: severe injury · ensured');
    expect(await riskFor({onSuccess:'-d(10)'})).toBe('♥ Risking: harmless (moderate injury if passed) · ensured');

    // Healing isn't a risk: it reads as an amount.
    expect(await riskFor({onSuccess:'d(10)', onFailure:'-0'})).toBe('Health: ~+6 if passed, ~+0 if failed · ensured');

    // Passing, but still hurt by the d(10): 4.
    await page.evaluate(() => {
        const exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath');
        exitModel.setAdjustments({'agent.health':{difficulty:0, check:'1000', onSuccess:'-d(10)', onFailure:'-150'}});
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
        tc.rng.queueRolls(500, 3);
    });
    await page.getByText('Walk to Aftermath [♥]', {exact:true}).filter({visible:true}).click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Succeeded by [\d.]+ · -4♥$/)]);

    expect(problems.pageErrors).toEqual([]);
});

test('an adjustment\'s own check rolls and is described by its own settings, not the exit\'s default skill check', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'),
                read = () => {
                    const adjustment = exitModel.getAdjustments()[0];
                    return {
                        difficulty:adjustment.getActionSkillDifficulty(),
                        expr:adjustment.getActionSkillExpr(),
                        phrase:alpha.getAdjustmentsPhrase(exitModel).replace(/\u00A0/g, ' ')
                    };
                };

            // Its own difficulty and check: as sure as a skill check gets, so a roll of 1 passes,
            // where it would fail the default check.
            exitModel.setAdjustments({'agent.health':{difficulty:0, check:'1000', actionType:'athletic', onFailure:'-5'}});
            const own = read();
            tc.rng.queueRolls(1);
            const ownCheck = exitModel.rollAdjustments(alpha)[0].check.success;

            // No actionType: no name.
            exitModel.setAdjustments({'agent.health':{difficulty:0, check:'1000', onFailure:'-5'}});
            const untyped = read();

            return {own, ownCheck, untyped};
        });

    expect(out.own).toEqual({difficulty:0, expr:'1000', phrase:'♥ Risking: moderate injury · Athletic / ensured'});
    expect(out.ownCheck).toBe(true);
    expect(out.untyped.phrase).toBe('♥ Risking: moderate injury · ensured');
    expect(problems.warnings).toEqual([]);
});

test('the lifeboats\' adjustments use their own difficulties', async ({page}) => {
    await startGame(page);
    const difficulties = await page.evaluate(() => tc.model.getEventModel('aftermath').getExitModels()
        .filter(exitModel => exitModel.mode === 'lifeboat')
        .map(exitModel => exitModel.getAdjustments()[0].getActionSkillDifficulty()));
    expect(difficulties).toEqual([500, 50]);
});


/*  Gives the origin a test action Alpha can take. Its own check passes on a roll of 999 and
    fails on 0, and so does its health adjustment's check, which does d(6)+2 damage on a failure
    and 1 on a pass. Replaces any earlier one, since adding an action never replaces one with
    the same ID. */
const addRiskyAction = (page, adjustmentCfg) => page.evaluate(adjustmentCfg => {
        const origin = tc.model.getEventModel('origin');
        delete origin.getActionModels().risky;
        origin.setActions({risky:{
            label:'Risky', skillCheck:{difficulty:0, check:'0'}, set:{},
            ...(adjustmentCfg === null ? {} : {adj:{'agent.health':{difficulty:1000, check:'0', onFailure:'-(d(6)+2)', onSuccess:'-1', ...adjustmentCfg}}})
        }});
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
    }, adjustmentCfg),

    // Has Alpha take the risky action with the rolls queued, and returns what happened.
    takeRiskyAction = (page, ...rolls) => page.evaluate(rolls => {
        const alpha = tc.model.getAgentModel('AL'),
            actionModel = tc.model.getEventModel('origin').getActionModels().risky,
            before = alpha.health.value;
        alpha.setActionExecCount(0);
        tc.rng.queueRolls(...rolls);
        alpha.doAction(actionModel);
        const entry = alpha.getLog()[alpha.getLog().length - 1],
            queued = tc.rng.getQueuedRollCount();
        tc.rng.clearQueuedRolls();
        return {success:entry.success, damage:before - alpha.health.value, logged:entry.adj?.['agent.health'], queued};
    }, rolls),
    ACTION_PASS = 999,
    ACTION_FAIL = 0;

test('actions get adjustments from the data, including when they apply', async ({page}) => {
    const problems = await startGame(page),
        checks = await page.evaluate(() => {
            const {pull, release} = tc.model.getEventModel('lever').getActionModels(),
                describe = actionModel => {
                    const [adjustment] = actionModel.getAdjustments();
                    return {
                        key:adjustment.key,
                        when:adjustment.enabledForActionSkillCheck,
                        difficulty:adjustment.getActionSkillDifficulty(),
                        name:adjustment.getActionSkillName(),
                        amounts:[adjustment.getAmountExpr(true), adjustment.getAmountExpr(false)],
                        // The action's own check is separate.
                        actionName:actionModel.getActionSkillName()
                    };
                };
            return {pull:describe(pull), release:describe(release)};
        });
    expect(checks.pull).toEqual({key:HEALTH, when:'both', difficulty:250, name:'Athletic', amounts:['-d(4)', '-d(6,5)'], actionName:'Charisma'});
    expect(checks.release).toEqual({key:HEALTH, when:'failure', difficulty:250, name:'Athletic', amounts:['-1', '-5'], actionName:'Social'});
    expect(problems.warnings).toEqual([]);
});

test('an action\'s adjustment rolls its own check after the action\'s, when the action\'s result calls for it', async ({page}) => {
    const problems = await startGame(page);

    // Both: whatever the action's result. Fails its own check: a 4 on the d(6), plus 2.
    await addRiskyAction(page, {});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:6, logged:-6, queued:0});
    expect(await takeRiskyAction(page, ACTION_FAIL, 999)).toEqual({success:false, damage:1, logged:-1, queued:0});

    // Only when the action fails. A success rolls nothing more and logs no adjustment.
    await addRiskyAction(page, {enabledForActionSkillCheck:'failure'});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:0, logged:undefined, queued:2});
    expect(await takeRiskyAction(page, ACTION_FAIL, 0, 3)).toEqual({success:false, damage:6, logged:-6, queued:0});

    // Only when the action succeeds.
    await addRiskyAction(page, {enabledForActionSkillCheck:'success'});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:6, logged:-6, queued:0});
    expect(await takeRiskyAction(page, ACTION_FAIL, 0, 3)).toEqual({success:false, damage:0, logged:undefined, queued:2});

    // No adjustments at all.
    await addRiskyAction(page, null);
    expect(await takeRiskyAction(page, ACTION_PASS, 0)).toEqual({success:true, damage:0, logged:undefined, queued:1});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an adjustment without its own check follows the action\'s check and rolls nothing more', async ({page}) => {
    const problems = await startGame(page);

    // A pass hurts by 1, and a failure rolls the d(6)+2: a 4, plus 2.
    await addRiskyAction(page, {});
    await page.evaluate(() => {
        const origin = tc.model.getEventModel('origin');
        origin.getActionModels().risky.setAdjustments({'agent.health':{onFailure:'-(d(6)+2)', onSuccess:'-1'}});
    });
    expect(await page.evaluate(() => tc.model.getEventModel('origin').getActionModels().risky.getAdjustments()[0].hasOwnCheck())).toBe(false);
    expect(await takeRiskyAction(page, ACTION_PASS, 3)).toEqual({success:true, damage:1, logged:-1, queued:1});
    expect(await takeRiskyAction(page, ACTION_FAIL, 3)).toEqual({success:false, damage:6, logged:-6, queued:0});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a bad enabledForActionSkillCheck warns and applies either way, and an adjustment without an amount never applies', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const origin = tc.model.getEventModel('origin'),
                make = adjustmentCfg => {
                    delete origin.getActionModels().risky;
                    origin.setActions({risky:{label:'Risky', set:{}, adj:{'agent.health':adjustmentCfg}}});
                    const [adjustment] = origin.getActionModels().risky.getAdjustments();
                    return {
                        when:adjustment?.enabledForActionSkillCheck ?? null,
                        onFail:adjustment?.appliesFor({success:false}) ?? false,
                        onPass:adjustment?.appliesFor({success:true}) ?? false
                    };
                };
            return {
                typo:make({enabledForActionSkillCheck:'fail', onFailure:'-5'}),
                noAmount:make({enabledForActionSkillCheck:'failure'})
            };
        });
    expect(out).toEqual({
        typo:{when:'both', onFail:true, onPass:true},
        noAmount:{when:null, onFail:false, onPass:false}
    });
    expect(problems.warnings).toEqual([
        'Event origin action risky adj agent.health enabledForActionSkillCheck must be "success", "failure" or "both" (using "both"): {enabledForActionSkillCheck: fail, onFailure: -5}',
        'Event origin action risky adj agent.health needs an onSuccess, onFailure or onBoth (ignoring it): {enabledForActionSkillCheck: failure}'
    ]);
});

test('action buttons flag the injury risk, and the action\'s result floats with its damage', async ({page}) => {
    const problems = await startGame(page);
    await addRiskyAction(page, {});

    const btn = page.getByText('Risky [♥]', {exact:true}).filter({visible:true});
    await expect(btn).toBeVisible();
    expect(await btnTooltip(page, 'Risky [♥]')).toMatch(/^Risky\u00A0·\u00A0[a-z ]+\u00A0·\u00A0♥ Risking: moderate injury \(light injury if passed\)\u00A0·\u00A0hopeless$/);

    await page.evaluate(() => tc.rng.queueRolls(999, 0, 3));
    await btn.click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Succeeded by [\d.]+ · -6♥$/)]);

    expect(problems.pageErrors).toEqual([]);
});

test('adjustments can change the event and the timeline too, each within its stat\'s limits', async ({page}) => {
    const problems = await startGame(page),
        // The action's own check passes on a roll of 1 or more and fails on 0. None of the
        // adjustments has a check of its own, so they follow it.
        adjustments = {
            'event.attestation':{onSuccess:'5'},
            // An Event's paradox also adds to the timeline's.
            'event.paradox':{onSuccess:'1'},
            'timeline.paradox':{onSuccess:'2'},
            'agent.chronal':{onSuccess:'-3', onFailure:'-1'}
        },
        take = roll => page.evaluate(roll => {
            const alpha = tc.model.getAgentModel('AL'),
                origin = tc.model.getEventModel('origin'),
                read = () => [origin.attestation.value, origin.paradox.value, tc.model.paradox.value, alpha.chronal.value],
                before = read();
            alpha.setActionExecCount(0);
            tc.rng.queueRolls(roll);
            alpha.doAction(origin.getActionModels().multi);
            const after = read(),
                entry = alpha.getLog()[alpha.getLog().length - 1];
            return {change:after.map((value, i) => value - before[i]), logged:entry.adj};
        }, roll);

    await page.evaluate(adjustments => {
        const origin = tc.model.getEventModel('origin');
        origin.setActions({multi:{label:'Multi', skillCheck:{difficulty:0, check:'1000'}, set:{}, adj:adjustments}});
        // Close to its max, so the attestation is clamped.
        origin.attestation.setValue(98);
        tc.model.getAgentModel('AL').chronal.setValue(50);
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
    }, adjustments);

    // Flagged for the chronal and paradox it changes, and the tooltip gives each adjustment's 
    // amounts in order.
    const btnText = 'Multi [⏲ + ⥁]';
    await expect(page.getByText(btnText, {exact:true}).filter({visible:true})).toBeVisible();
    expect((await btnTooltip(page, btnText)).replace(/\u00A0/g, ' ')).toMatch(
        /^Multi · [a-z ]+ · Event Attestation: ~\+5 if passed · Event Parad⥁x: ~\+1 if passed · Timeline Parad⥁x: ~\+2 if passed · Chr⏲nal: ~-3 if passed, ~-1 if failed$/
    );

    // A pass applies them all, the attestation only as far as its max. Columns: attestation,
    // the Event's paradox, the timeline's paradox, Alpha's chronal.
    expect(await take(1)).toEqual({
        change:[2, 1, 3, -3],
        logged:{'event.attestation':2, 'event.paradox':1, 'timeline.paradox':2, 'agent.chronal':-3}
    });

    // A failure applies only what has an onFailure.
    expect(await take(0)).toEqual({change:[0, 0, 0, -1], logged:{'agent.chronal':-1}});

    // The button floats every change.
    await page.evaluate(() => tc.model.getEventModel('origin').attestation.setValue(50));
    await page.evaluate(() => tc.model.getAgentModel('AL').setActionExecCount(0));
    await page.evaluate(() => tc.rng.queueRolls(999));
    await page.getByText(btnText, {exact:true}).filter({visible:true}).click();
    await expect.poll(() => floatingTexts(page)).toEqual([
        expect.stringMatching(/^Succeeded by [\d.]+ · \+5 Attestation · \+1⥁ · \+2⥁ · -3⏲$/)
    ]);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});


test('every non-hub event offers Rest, hidden when the event is under an hour', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const out = {missing:[], wrongHidden:[]};
            for (const eventModel of tc.model.getEventModelsAsList(eventModel => eventModel.isNotHub())) {
                const rest = eventModel.getActionModels()._rest;
                if (!rest) {
                    out.missing.push(eventModel.id);
                } else if (rest.isHidden() !== eventModel.duration < 60 * 60 * 1000) {
                    out.wrongHidden.push(eventModel.id);
                }
            }
            out.originHidden = tc.model.getEventModel('origin').getActionModels()._rest.isHidden();
            out.boatsHidden = tc.model.getEventModel('boats').getActionModels()._rest.isHidden();
            return out;
        });
    expect(out).toEqual({missing:[], wrongHidden:[], originHidden:true, boatsHidden:false});
    expect(problems.warnings).toEqual([]);
});

test('resting is likelier to work the healthier the agent is, never heals past max health, and is unavailable at full health', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                health = alpha.health,
                rest = tc.model.getEventModel('origin').getActionModels()._rest,

                // Rest's own check rolls, then on a pass its health adjustment, which follows that
                // check, heals with a d(4). The origin lasts a minute, which rounds up to
                // one die. A failed rest rolls nothing more.
                restFrom = (value, ...rolls) => {
                    health.setValue(value);
                    alpha.setActionExecCount(0);
                    tc.rng.queueRolls(...rolls);
                    alpha.doAction(rest);
                    const left = tc.rng.getQueuedRollCount(),
                        acted = alpha.getActionExecCount(),
                        entry = acted ? alpha.getLog()[alpha.getLog().length - 1] : null;
                    tc.rng.clearQueuedRolls();
                    return {health:health.value, logged:entry?.adj?.['agent.health'], success:entry?.success, left, acted};
                },
                phraseAt = value => {
                    health.setValue(value);
                    return alpha.getSkillEasePhrase(rest.getActionSkillExpr(), rest.getActionSkillDifficulty());
                };
            return {
                max:health.max,
                ownCheck:rest.getAdjustments()[0].hasOwnCheck(),

                // Healing still changes health. A d(4) averages 2.5, rounded to 3.
                risk:alpha.hasHealthChangeRiskFor(rest),
                adjustmentsPhrase:alpha.getAdjustmentsPhrase(rest),

                // Alpha has 85 max health. At half or less it's hopeless, and at 90% or more
                // it's ensured.
                phrases:[phraseAt(42), phraseAt(60), phraseAt(77)],

                // At 60 of 85 the ease is round(2500 * 60 / 85) - 1250 - 1000 = -485.
                failAt60:restFrom(60, 484, 3),
                passAt60:restFrom(60, 485, 3),

                // Near full health even a roll of 1 passes, and the healing is capped.
                nearFull:restFrom(health.max - 2, 1, 3),
                
                // At full health Rest isn't available, so it's refused without rolling or
                // using an action.
                availableAtFull:(health.setValue(health.max), rest.isAvailableFor(alpha)),
                full:restFrom(health.max, 1, 3)
            };
        });
    expect(out.ownCheck).toBe(false);
    expect(out.risk).toBe(true);
    expect(out.adjustmentsPhrase).toBe('Health: ~+3 if passed');
    expect(out.phrases).toEqual(['hopeless', 'even', 'ensured']);
    expect(out.failAt60).toEqual({health:60, logged:undefined, success:false, left:1, acted:1});
    expect(out.passAt60).toEqual({health:64, logged:4, success:true, left:0, acted:1});
    expect(out.nearFull).toEqual({health:out.max, logged:2, success:true, left:0, acted:1});
    expect(out.availableAtFull).toBe(false);
    expect(out.full).toEqual({health:out.max, logged:undefined, success:undefined, left:2, acted:0});
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('the Rest button is flagged for health, and a rest floats its healing', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            iceWarnings = tc.model.getEventModel('warnings');
        iceWarnings.attestation.setValue(10);
        alpha.setEvent('warnings');
        alpha.health.setValue(alpha.health.max - 10);
        tc.app.selectEventBox('warnings');
    });
    const btn = page.getByText('Rest [♥]', {exact:true}).filter({visible:true});
    await expect(btn).toBeVisible();

    // The rest check passes, then eight d(4)s for the 12 hour Event, capped at 8 hours: all 1s.
    await page.evaluate(() => tc.rng.queueRolls(999, 0, 0, 0, 0, 0, 0, 0, 0));
    await btn.click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Succeeded by [\d.]+ · \+8♥$/)]);
    await expect.poll(() => floatingTexts(page)).toEqual([]);
    
    // At full health there's nothing to heal, so Rest is disabled and a click does nothing.
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.health.setValue(alpha.health.max);
        alpha.setActionExecCount(0);
    });
    await expect(btn).toHaveClass(/disabled/);
    await btn.click({force:true});
    await page.waitForTimeout(200);
    expect(await floatingTexts(page)).toEqual([]);
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').getActionExecCount())).toBe(0);
    
    // Hurt again, it's back.
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.health.setValue(alpha.health.max - 1);
    });
    await expect(btn).not.toHaveClass(/disabled/);
    expect(problems.pageErrors).toEqual([]);
});

test('positive amounts heal and negative ones hurt, and a broken amount does nothing', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                origin = tc.model.getEventModel('origin'),
                healthAfter = (adjustmentCfg, value) => {
                    delete origin.getActionModels().heal;
                    origin.setActions({heal:{label:'Heal', skillCheck:{difficulty:0, check:'1000'}, set:{}, adj:{'agent.health':{difficulty:0, check:'1000', ...adjustmentCfg}}}});
                    alpha.health.setValue(value);
                    alpha.setActionExecCount(0);
                    tc.rng.queueRolls(999, 999);
                    alpha.doAction(origin.getActionModels().heal);
                    tc.rng.clearQueuedRolls();
                    return alpha.health.value;
                };
            return {
                heals:healthAfter({onSuccess:'5'}, 40),
                hurts:healthAfter({onSuccess:'-5'}, 40),
                broken:healthAfter({onSuccess:'-nope'}, 40),
                notANumber:healthAfter({onSuccess:'-Math.sqrt(-1)'}, 40)
            };
        });
    expect(out).toEqual({heals:45, hurts:35, broken:40, notANumber:40});
    expect(new Set(problems.warnings)).toEqual(new Set([
        'Check expression threw (nope is not defined): -nope',
        'Check expression is not a finite number (NaN): -Math.sqrt(-1)'
    ]));
    expect(problems.pageErrors).toEqual([]);
});

test('buttons flag each stat an adjustment could change, but not a broken amount', async ({page}) => {
    const problems = await startGame(page),
        // Waits for the exit's button in the agent's list of exits to read as expected, since
        // Event Details redraws after a debounce.
        expectExitTextWith = async (adjustments, expected) => {
            await page.evaluate(adjustments => {
                tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath').setAdjustments(adjustments);
                tc.app.selectEventBox('aftermath');
                tc.app.selectEventBox('origin');
            }, adjustments);
            await expect(page.getByText(/^Walk to Aftermath/).filter({visible:true})).toHaveText(expected);
        };
    
    // Entering the aftermath costs no paradox, so only the adjustments flag anything.
    await expectExitTextWith({}, 'Walk to Aftermath');
    await expectExitTextWith({'timeline.paradox':{onSuccess:'1'}}, 'Walk to Aftermath [⥁]');
    await expectExitTextWith({'agent.chronal':{onSuccess:'-2'}, 'agent.health':{onSuccess:'3'}}, 'Walk to Aftermath [⏲ + ♥]');
    
    // Changes that average to nothing, or can't be worked out, aren't flagged.
    await expectExitTextWith({'agent.health':{onSuccess:'d(3) - 2'}}, 'Walk to Aftermath');
    await expectExitTextWith({'agent.health':{onFailure:'nope'}}, 'Walk to Aftermath');
    for (const warning of problems.warnings) expect(warning).toBe('Check expression threw (nope is not defined): nope');
    expect(problems.pageErrors).toEqual([]);
});

test('an amount\'s margin is how well the check that decided it went', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                origin = tc.model.getEventModel('origin'),
                attestation = origin.attestation,
                
                // Has Alpha take an action with this adjustment on the origin's attestation, and
                // returns how much it changed.
                actWith = (adjustmentCfg, skillCheck, ...rolls) => {
                    delete origin.getActionModels().measured;
                    origin.setActions({measured:{label:'Measured', skillCheck, set:{}, adj:{'event.attestation':adjustmentCfg}}});
                    attestation.setValue(50);
                    alpha.setActionExecCount(0);
                    tc.rng.queueRolls(...rolls);
                    alpha.doAction(origin.getActionModels().measured);
                    tc.rng.clearQueuedRolls();
                    return attestation.value - 50;
                },
                
                // An ease of -500, so a roll of 500 or more passes.
                HARD = {difficulty:500, check:'0'},
                BY_MARGIN = {onSuccess:'Math.floor(margin / 100)', onFailure:'Math.ceil(margin / 100)'};
            
            // An exit without a check of its own has no margin.
            const exitModel = origin.getExitModels().find(exit => exit.to === 'aftermath');
            exitModel.setAdjustments({'event.attestation':{onSuccess:'margin + 3'}});
            attestation.setValue(50);
            alpha.doFollowExit(exitModel);
            const exit = attestation.value - 50;
            alpha.setEvent('origin');
            
            return {
                // Following the action's check: a roll of 799 passes by 299 and 99 fails by 401.
                actionPass:actWith(BY_MARGIN, HARD, 799),
                actionFail:actWith(BY_MARGIN, HARD, 99),
                
                // Its own check decides, not the action's: the action passes by 499, but the
                // adjustment's own check passes by only 150.
                own:actWith({...HARD, ...BY_MARGIN}, HARD, 999, 650),
                
                // A no-roll check has no margin.
                noRoll:actWith({onSuccess:'margin + 3'}, {difficulty:'no-roll'}),
                exit
            };
        });
    expect(out).toEqual({actionPass:2, actionFail:-4, own:1, noRoll:3, exit:3});
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('without rolling, an amount uses the average margin of a pass or a failure', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                origin = tc.model.getEventModel('origin'),
                withAction = (adjustmentCfg, skillCheck) => {
                    delete origin.getActionModels().measured;
                    origin.setActions({measured:{label:'Measured', skillCheck, set:{}, adj:{'event.paradox':adjustmentCfg}}});
                    const actionModel = origin.getActionModels().measured;
                    return {
                        phrase:alpha.getAdjustmentsPhrase(actionModel).replace(/\u00A0/g, ' '),
                        flagged:alpha.hasParadoxChangeRiskFor(actionModel)
                    };
                },
                HARD = {difficulty:500, check:'0'},
                TENTH = {onSuccess:'margin / 10', onFailure:'margin / 10'},
                exitModel = origin.getExitModels().find(exit => exit.to === 'aftermath');
            exitModel.setAdjustments({'event.paradox':{onSuccess:'margin + 3'}});
            
            return {
                // At an ease of -500, passes run from 0 to 499 and failures from -500 to -1.
                averages:[[-500, true], [-500, false], [-1, true], [-1, false]].map(([ease, success]) => tc.checks.getAverageMargin(ease, success)),
                hard:withAction(TENTH, HARD),
                
                // An adjustment's own check is as sure as a check gets, so a pass averages 499.
                own:withAction({difficulty:0, check:'1000', onSuccess:'margin / 10'}, HARD),
                
                // No margin without a roll, so an amount of just the margin is no change.
                noRoll:withAction({onSuccess:'margin'}, {difficulty:'no-roll'}),
                exit:alpha.getAdjustmentsPhrase(exitModel)
            };
        });
    expect(out.averages).toEqual([249.5, -250.5, 499, -1]);
    expect(out.hard).toEqual({phrase:'Event Parad⥁x: ~+25 if passed, ~-25 if failed', flagged:true});
    expect(out.own).toEqual({phrase:'Event Parad⥁x: ~+50 if passed · ensured', flagged:true});
    expect(out.noRoll).toEqual({phrase:'Event Parad⥁x: ~+0 if passed', flagged:false});
    expect(out.exit).toBe('Event Parad⥁x: ~+3 if passed');
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
