// Effects on actions and exits: changes to a stat of the agent, the Event or the timeline, such
// as injuries on the way through an exit or healing from a rest.
import {test, expect} from '@playwright/test';
import {startGame, readJson, dialogTitle, dismissAgentDossier, btnTooltip} from './helpers.mjs';

const INJURY = {difficulty:300, actionType:'athletic', onFailure:'-(d(6)+4)'},
    HEALTH = 'agent.health',

    /*  Serves the Titanic scenario with effects added to some exits, as if they were in the
        data: a good injury from the collision to the casualties, and one with no amount from
        the ice warnings to the wireless backlog. */
    routeScenarioWithInjuries = page => page.route('**/data/titanic_scenario.json5', route => {
        const json = readJson('data/titanic_scenario.json5'),
            exitTo = (eventId, toId) => json.events[eventId].exits.find(exit => exit.to === toId);
        exitTo('collision', 'casualties').effects = {[HEALTH]:INJURY};
        exitTo('ice_warnings', 'wireless_priority').effects = {[HEALTH]:{actionType:'athletic'}};
        // And a bad action skill check, to show its warning names the Event too.
        json.events.lifeboat_capacity.actions.argueFor.skillCheck.difficulty = 'hard';
        return route.fulfill({json});
    }),

    /*  Takes VQ's exit from the collision to the casualties with the rolls queued, and returns
        what happened. */
    takeInjuryExit = (page, ...rolls) => page.evaluate(rolls => {
        const vq = tc.model.getAgentModel('VQ'),
            exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties'),
            before = vq.health.value;
        tc.rng.queueRolls(...rolls);
        vq.doFollowExit(exitModel);
        const log = vq.getLog();
        return {
            damage:before - vq.health.value,
            event:vq.event,
            logged:log[log.length - 1].effects?.['agent.health'],
            queued:tc.rng.getQueuedRollCount()
        };
    }, rolls),

    // VQ's athletic check, so tests can pick rolls that pass or fail it.
    vqSkills = readJson('data/agents.json5').agents.VQ.skills,
    vqAthleticEase = 0.5*vqSkills.str + 0.5*vqSkills.agl - INJURY.difficulty,
    PASS_ROLL = 999,
    FAIL_ROLL = 0,

    // The text of the floating texts showing.
    floatingTexts = page => page.evaluate(() => tc.app.getSubviews()
        .filter(sv => sv.isA(tc.FloatingText) && sv.visible)
        .map(floatingText => floatingText.text.replace(/\u00A0/g, ' ')));

test('an exit\'s effect comes from the data, and one without an amount is ignored with a warning naming it', async ({page}) => {
    await routeScenarioWithInjuries(page);
    const problems = await startGame(page),
        checks = await page.evaluate(() => {
            const describe = (eventId, toId) => {
                const exitModel = tc.model.getEventModel(eventId).getExitModels().find(exit => exit.to === toId);
                return exitModel.getEffects().map(effect => ({
                    key:effect.key,
                    onSuccess:effect.getAmountExpr(true) ?? null,
                    onFailure:effect.getAmountExpr(false) ?? null,
                    ownCheck:effect.hasOwnCheck(),
                    difficulty:effect.getActionSkillDifficulty(),
                    name:effect.getActionSkillName()
                }));
            };
            return {
                good:describe('collision', 'casualties'),
                noAmount:describe('ice_warnings', 'wireless_priority'),
                none:describe('roster_reshuffle', 'titanic_departs')
            };
        });
    expect(checks.good).toEqual([{key:HEALTH, onSuccess:null, onFailure:'-(d(6)+4)', ownCheck:true, difficulty:300, name:'Athletic'}]);
    expect(checks.noAmount).toEqual([]);
    expect(checks.none).toEqual([]);

    expect(problems.warnings).toHaveLength(2);
    expect(problems.warnings[0]).toMatch(/^Event lifeboat_capacity action argueFor skill check difficulty must be/);
    expect(problems.warnings[1]).toMatch(/^Event ice_warnings exit to wireless_priority effect agent\.health needs an onSuccess or onFailure amount/);
    expect(problems.pageErrors).toEqual([]);
});

test('a failed injury check costs health but the exit is still taken; a passed one costs nothing', async ({page}) => {
    expect(FAIL_ROLL + vqAthleticEase).toBeLessThan(0);
    expect(PASS_ROLL + vqAthleticEase).toBeGreaterThanOrEqual(0);

    await routeScenarioWithInjuries(page);
    const problems = await startGame(page);

    // The check rolls first, then the damage die: a 3 on the d(6), plus 4.
    expect(await takeInjuryExit(page, FAIL_ROLL, 2)).toEqual({damage:7, event:'casualties', logged:-7, queued:0});

    // Back again, and this time the check passes, so the damage die isn't rolled. The check
    // was still made, so the effect is logged as nothing.
    await page.evaluate(() => tc.model.getAgentModel('VQ').setEvent('collision'));
    expect(await takeInjuryExit(page, PASS_ROLL, 2)).toEqual({damage:0, event:'casualties', logged:0, queued:1});
    await page.evaluate(() => tc.rng.clearQueuedRolls());

    expect(problems.pageErrors).toEqual([]);
});

test('an exit without effects rolls nothing and logs none', async ({page}) => {
    const problems = await startGame(page);
    expect(await takeInjuryExit(page, FAIL_ROLL)).toEqual({damage:0, event:'casualties', logged:undefined, queued:1});
    await page.evaluate(() => tc.rng.clearQueuedRolls());
    expect(problems.pageErrors).toEqual([]);
});

test('amounts are whole points, a positive one heals, and a broken one does nothing', async ({page}) => {
    const problems = await startGame(page),
        changeFor = amount => page.evaluate(amount => {
            const vq = tc.model.getAgentModel('VQ'),
                exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
            // Back to the start with no visits, so the trips don't build up paradox.
            vq.getLog().length = 0;
            vq.paradox.setValue(0);
            vq.health.setValue(50);
            vq.setEvent('collision');
            exitModel.setEffects({'agent.health':{difficulty:1000, check:'0', onFailure:amount}});
            tc.rng.queueRolls(0);
            vq.doFollowExit(exitModel);
            const log = vq.getLog();
            return [vq.health.value - 50, log[log.length - 1].effects['agent.health']];
        }, amount);

    // The change, and the same logged.
    expect(await changeFor('-2.6')).toEqual([-3, -3]);
    expect(await changeFor('5')).toEqual([5, 5]);
    
    // An amount sees its own check's difficulty: 1000 here, where the exit's default is 250.
    expect(await changeFor('-difficulty / 250')).toEqual([-4, -4]);
    expect(await changeFor('nope + 1')).toEqual([0, 0]);
    expect(await changeFor('Math.sqrt(-1)')).toEqual([0, 0]);
    
    // Warned about each time it's evaluated, e.g. for the exit button's tooltip too.
    expect(problems.warnings.length).toBeGreaterThan(0);
    for (const warning of problems.warnings) expect(warning).toBe('Check expression threw (nope is not defined): nope + 1');
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
        risk = '♥ Risking: moderate injury\u00A0·\u00A0Athletic / ' + await page.evaluate(ease => tc.checks.toEasePhrase(ease), vqAthleticEase),
        visibleText = text => page.getByText(text, {exact:true}).filter({visible:true});

    // In the agent's list of exits.
    const exitBtn = visibleText('Walk to Loss of Life [♥]');
    await expect(exitBtn).toBeVisible();
    expect(await btnTooltip(page, 'Walk to Loss of Life [♥]')).toBe(risk);

    // In the header, when viewing the Event the exit leads to.
    await page.evaluate(() => tc.app.selectEventBox('casualties'));
    await expect(visibleText('Walk to [♥]')).toBeVisible();
    expect(await btnTooltip(page, 'Walk to [♥]')).toBe(risk);
    await page.evaluate(() => tc.app.selectEventBox('collision'));

    // Exits without effects have no flag or tooltip. Both Events are made known so the exit shows.
    await page.evaluate(() => {
        tc.model.getEventModel('ice_warnings').attestation.setValue(10);
        tc.model.getEventModel('wireless_priority').attestation.setValue(10);
        tc.model.getAgentModel('VQ').setEvent('ice_warnings');
        tc.app.selectEventBox('ice_warnings');
    });
    await expect(visibleText('Wait til Marconi Traffic Backlog')).toBeVisible();
    expect(await btnTooltip(page, 'Wait til Marconi Traffic Backlog')).toBe('');
    await page.evaluate(() => {
        tc.model.getAgentModel('VQ').setEvent('collision');
        tc.app.selectEventBox('collision');
    });
    await expect(exitBtn).toBeVisible();

    // Fails, then a 3 on the d(6): 7 damage.
    await page.evaluate(([fail, die]) => tc.rng.queueRolls(fail, die), [FAIL_ROLL, 2]);
    await exitBtn.click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Failed by [\d.]+ · -7♥$/)]);
    expect(await page.evaluate(() => tc.model.getAgentModel('VQ').event)).toBe('casualties');

    expect(problems.pageErrors).toEqual([]);
});


/*  Kills VQ on his exit from the collision: a check he can't pass, and more damage than he has. */
const killVQOnExit = page => page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
        exitModel.setEffects({'agent.health':{difficulty:1000, check:'0', onFailure:'-500'}});
        tc.rng.queueRolls(0);
        vq.doFollowExit(exitModel);
        return {dead:vq.isDead(), health:vq.health.value};
    }),

    // Okonjo joins the team. He starts with no chronal.
    giveOkonjo = page => page.evaluate(() => {
        tc.model.revealAgents(['OK']);
        tc.model.awardAgents(['OK']);
    }),

    acknowledge = page => page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();

test('a death is announced, then the dossier, and losing the last agent ends the campaign', async ({page}) => {
    const problems = await startGame(page);
    expect(await killVQOnExit(page)).toEqual({dead:true, health:0});

    await expect(dialogTitle(page, 'Agent Death')).toHaveText('Agent Death : Vasquez');
    await expect(page.getByText(/^At the Nexus, Vasquez’s telemetry goes flat/).filter({visible:true})).toBeVisible();
    await acknowledge(page);
    await dismissAgentDossier(page, 'Vasquez');
    await expect(dialogTitle(page, 'Agent Roster Depleted')).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
});

test('a dead agent can\'t act or travel, and an agent with no chronal still counts toward the roster', async ({page}) => {
    const problems = await startGame(page);
    await giveOkonjo(page);
    await dismissAgentDossier(page, 'Okonjo');
    expect(await page.evaluate(() => tc.model.getAgentModel('OK').isDevoured())).toBe(false);

    await killVQOnExit(page);
    await acknowledge(page);
    await dismissAgentDossier(page, 'Vasquez');

    // Okonjo is still on the team, so the campaign goes on.
    await page.waitForTimeout(300);
    await expect(dialogTitle(page, 'Agent Roster Depleted')).toHaveCount(0);

    // Nothing moves the dead.
    const moves = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            casualties = tc.model.getEventModel('casualties'),
            exitModel = casualties.getExitModels()[0],
            before = vq.event;
        vq.doRecallToHQ();
        vq.doDeployToEvent(tc.model.getEventModel('collision'));
        vq.doFollowExit(exitModel);
        return {before, after:vq.event, canAct:vq.canAct(), canReload:vq.canReloadChronal()};
    });
    expect(moves).toEqual({before:'casualties', after:'casualties', canAct:false, canReload:false});

    // The agent's row says so, with no actions or exits, and the header offers no travel.
    await page.evaluate(() => {
        tc.app.selectAgentRow('VQ');
        tc.app.selectEventBox('casualties');
    });
    await expect(page.getByText('Deceased', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(page.getByText(/^Investigate/).filter({visible:true})).toHaveCount(0);
    await expect(page.getByText(/^(Loop back|Jump to|Recall to|Deploy to)/).filter({visible:true})).toHaveCount(0);

    // Nor does the header offer an exit to New York, though the lifeboats lead there.
    await page.evaluate(() => {
        tc.model.getEventModel('arrival_new_york').attestation.setValue(10);
        tc.app.selectEventBox('arrival_new_york');
    });
    await expect(page.getByText('Ship Arriving', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(page.getByText(/^Lifeboat to/).filter({visible:true})).toHaveCount(0);
    await page.evaluate(() => tc.model.getAgentModel('OK').setEvent('casualties'));
    await page.evaluate(() => tc.app.selectAgentRow('OK'));
    await expect(page.getByText(/^Lifeboat to/).filter({visible:true})).toHaveCount(1);

    expect(problems.pageErrors).toEqual([]);
});


/*  Takes VQ's exit from the collision with this health effect and the rolls queued: its check
    passes on a roll of 999 and fails on 0. Returns the damage, what was logged and the rolls
    left over. */
const damageWith = (page, effectCfg, ...rolls) => page.evaluate(([effectCfg, rolls]) => {
        const vq = tc.model.getAgentModel('VQ'),
            exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
        // Back to the start with full health and no visits, so the trips don't build up paradox.
        vq.getLog().length = 0;
        vq.paradox.setValue(0);
        vq.health.setValue(vq.health.max);
        vq.setEvent('collision');
        exitModel.setEffects({'agent.health':{difficulty:0, check:'0', ...effectCfg}});
        const before = vq.health.value;
        tc.rng.queueRolls(...rolls);
        vq.doFollowExit(exitModel);
        const log = vq.getLog(),
            queued = tc.rng.getQueuedRollCount();
        tc.rng.clearQueuedRolls();
        return {damage:before - vq.health.value, logged:log[log.length - 1].effects?.['agent.health'], queued};
    }, [effectCfg, rolls]),
    PASS = 999,
    FAIL = 0;

test('an effect uses onSuccess when its check passes and onFailure when it fails', async ({page}) => {
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
            const exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties'),
                read = () => exitModel.getEffects().map(effect => [effect.getAmountExpr(true) ?? null, effect.getAmountExpr(false) ?? null]);
            exitModel.setEffects({'agent.health':{onSuccess:'', onFailure:'-9'}});
            const oneBad = read();
            exitModel.setEffects({'agent.health':{damage:'-150'}});
            return {oneBad, oldKey:read()};
        });
    expect(result).toEqual({oneBad:[[null, '-9']], oldKey:[]});
    expect(problems.warnings).toEqual([
        'Event collision exit to casualties effect agent.health onSuccess must be a non-empty string (ignoring it): {onSuccess: , onFailure: -9}',
        'Event collision exit to casualties effect agent.health skill check has unknown keys damage: {damage: -150}',
        'Event collision exit to casualties effect agent.health needs an onSuccess or onFailure amount (ignoring it): {damage: -150}'
    ]);
});

test('effects must be keyed by a stat of the agent, event or timeline, and the old injurySkillCheck is ignored with a warning', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const collision = tc.model.getEventModel('collision'),
                exitModel = collision.getExitModels().find(exit => exit.to === 'casualties'),
                keys = () => exitModel.getEffects().map(effect => effect.key + ' ' + effect.enabledForActionSkillCheck);
            exitModel.setEffects({
                'agent.luck':{onSuccess:'1'},
                'health':{onSuccess:'1'},
                'event.health':{onSuccess:'1'},
                'agent.health.value':{onSuccess:'1'},
                'toString.health':{onSuccess:'1'},
                'agent.health':'-5',
                // An exit has no check of its own to follow, so this is ignored.
                'timeline.paradox':{onSuccess:'1', enabledForActionSkillCheck:'success'}
            });
            const valid = keys();
            exitModel.setEffects([{onSuccess:'1'}]);
            const notAnObject = keys();
            delete collision.getActionModels().old;
            collision.setActions({old:{label:'Old', set:{}, injurySkillCheck:{damageOnFailure:'5'}}});
            return {valid, notAnObject, oldEffects:collision.getActionModels().old.getEffects().length};
        });
    expect(out).toEqual({valid:['timeline.paradox both'], notAnObject:[], oldEffects:0});
    const named = 'must be named for a stat of the agent, event or timeline, e.g. "agent.health" (ignoring it): {onSuccess: 1}';
    expect(problems.warnings).toEqual([
        'Event collision exit to casualties effect agent.luck ' + named,
        'Event collision exit to casualties effect health ' + named,
        'Event collision exit to casualties effect event.health ' + named,
        'Event collision exit to casualties effect agent.health.value ' + named,
        'Event collision exit to casualties effect toString.health ' + named,
        'Event collision exit to casualties effect agent.health must be an object (ignoring it): -5',
        'Event collision exit to casualties effect timeline.paradox enabledForActionSkillCheck only applies to actions (ignoring it): {onSuccess: 1, enabledForActionSkillCheck: success}',
        'Event collision exit to casualties effects must be an object of effects by stat, e.g. "agent.health" (ignoring them): [Object]',
        'Event collision action old injurySkillCheck is replaced by effects, e.g. {"agent.health":{"onFailure":"-5"}} (ignoring it)'
    ]);
});

test('a pass that still hurts floats its damage, and the risk tooltip gives both cases', async ({page}) => {
    const problems = await startGame(page),
        riskFor = effectCfg => page.evaluate(effectCfg => {
            const vq = tc.model.getAgentModel('VQ'),
                exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
            exitModel.setEffects({'agent.health':{difficulty:0, check:'0', ...effectCfg}});
            return vq.getEffectsPhrase(exitModel).replace(/\u00A0/g, ' ');
        }, effectCfg);

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
        const exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
        exitModel.setEffects({'agent.health':{difficulty:0, check:'1000', onSuccess:'-d(10)', onFailure:'-150'}});
        tc.app.selectEventBox('casualties');
        tc.app.selectEventBox('collision');
        tc.rng.queueRolls(500, 3);
    });
    await page.getByText('Walk to Loss of Life [♥]', {exact:true}).filter({visible:true}).click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Succeeded by [\d.]+ · -4♥$/)]);

    expect(problems.pageErrors).toEqual([]);
});

test('the lifeboats are fatal on a failed check, and the crowded one hurts even on a pass', () => {
    const lifeboats = readJson('data/titanic_scenario.json5').events.casualties.exits.filter(exit => exit.mode === 'lifeboat');
    expect(lifeboats.map(exit => exit.effects)).toEqual([
        // When there aren't enough boats.
        {[HEALTH]:{difficulty:500, check:'agent.skills.str', onFailure:'-150', onSuccess:'-d(4,2)'}},
        // When there are.
        {[HEALTH]:{difficulty:50, actionType:'athletic', onFailure:'-150'}}
    ]);
});

test('an effect\'s own check rolls and is described by its own settings, not the exit\'s default skill check', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const vq = tc.model.getAgentModel('VQ'),
                exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties'),
                read = () => {
                    const effect = exitModel.getEffects()[0];
                    return {
                        difficulty:effect.getActionSkillDifficulty(),
                        expr:effect.getActionSkillExpr(),
                        phrase:vq.getEffectsPhrase(exitModel).replace(/\u00A0/g, ' ')
                    };
                };

            // Its own difficulty and check: as sure as a skill check gets, so a roll of 1 passes,
            // where it would fail the default check.
            exitModel.setEffects({'agent.health':{difficulty:0, check:'1000', actionType:'athletic', onFailure:'-5'}});
            const own = read();
            tc.rng.queueRolls(1);
            const ownCheck = vq.rollEffectsFor(exitModel)[0].check.success;

            // No actionType: no name.
            exitModel.setEffects({'agent.health':{difficulty:0, check:'1000', onFailure:'-5'}});
            const untyped = read();

            return {own, ownCheck, untyped};
        });

    expect(out.own).toEqual({difficulty:0, expr:'1000', phrase:'♥ Risking: moderate injury · Athletic / ensured'});
    expect(out.ownCheck).toBe(true);
    expect(out.untyped.phrase).toBe('♥ Risking: moderate injury · ensured');
    expect(problems.warnings).toEqual([]);
});

test('the lifeboats\' effects use their own difficulties', async ({page}) => {
    await startGame(page);
    const difficulties = await page.evaluate(() => tc.model.getEventModel('casualties').getExitModels()
        .filter(exitModel => exitModel.mode === 'lifeboat')
        .map(exitModel => exitModel.getEffects()[0].getActionSkillDifficulty()));
    expect(difficulties).toEqual([500, 50]);
});


/*  Gives the collision a test action VQ can take. Its own check passes on a roll of 999 and
    fails on 0, and so does its health effect's check, which does d(6)+2 damage on a failure
    and 1 on a pass. Replaces any earlier one, since adding an action never replaces one with
    the same ID. */
const addRiskyAction = (page, effectCfg) => page.evaluate(effectCfg => {
        const collision = tc.model.getEventModel('collision');
        delete collision.getActionModels().risky;
        collision.setActions({risky:{
            label:'Risky', skillCheck:{difficulty:0, check:'0'}, set:{},
            ...(effectCfg === null ? {} : {effects:{'agent.health':{difficulty:1000, check:'0', onFailure:'-(d(6)+2)', onSuccess:'-1', ...effectCfg}}})
        }});
        tc.app.selectEventBox('casualties');
        tc.app.selectEventBox('collision');
    }, effectCfg),

    // Has VQ take the risky action with the rolls queued, and returns what happened.
    takeRiskyAction = (page, ...rolls) => page.evaluate(rolls => {
        const vq = tc.model.getAgentModel('VQ'),
            actionModel = tc.model.getEventModel('collision').getActionModels().risky,
            before = vq.health.value;
        vq.setActionExecCount(0);
        tc.rng.queueRolls(...rolls);
        vq.doAction(actionModel);
        const entry = vq.getLog()[vq.getLog().length - 1],
            queued = tc.rng.getQueuedRollCount();
        tc.rng.clearQueuedRolls();
        return {success:entry.success, damage:before - vq.health.value, logged:entry.effects?.['agent.health'], queued};
    }, rolls),
    ACTION_PASS = 999,
    ACTION_FAIL = 0;

test('actions get effects from the data, including when they apply', async ({page}) => {
    const problems = await startGame(page),
        checks = await page.evaluate(() => {
            const {countermand, allow} = tc.model.getEventModel('engine_order').getActionModels(),
                describe = actionModel => {
                    const [effect] = actionModel.getEffects();
                    return {
                        key:effect.key,
                        when:effect.enabledForActionSkillCheck,
                        difficulty:effect.getActionSkillDifficulty(),
                        name:effect.getActionSkillName(),
                        amounts:[effect.getAmountExpr(true), effect.getAmountExpr(false)],
                        // The action's own check is separate.
                        actionName:actionModel.getActionSkillName()
                    };
                };
            return {countermand:describe(countermand), allow:describe(allow)};
        });
    expect(checks.countermand).toEqual({key:HEALTH, when:'both', difficulty:250, name:'Athletic', amounts:['-d(4)', '-d(6,5)'], actionName:'Charisma'});
    expect(checks.allow).toEqual({key:HEALTH, when:'failure', difficulty:250, name:'Athletic', amounts:['-1', '-5'], actionName:'Social'});
    expect(problems.warnings).toEqual([]);
});

test('an action\'s effect rolls its own check after the action\'s, when the action\'s result calls for it', async ({page}) => {
    const problems = await startGame(page);

    // Both: whatever the action's result. Fails its own check: a 4 on the d(6), plus 2.
    await addRiskyAction(page, {});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:6, logged:-6, queued:0});
    expect(await takeRiskyAction(page, ACTION_FAIL, 999)).toEqual({success:false, damage:1, logged:-1, queued:0});

    // Only when the action fails. A success rolls nothing more and logs no effect.
    await addRiskyAction(page, {enabledForActionSkillCheck:'failure'});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:0, logged:undefined, queued:2});
    expect(await takeRiskyAction(page, ACTION_FAIL, 0, 3)).toEqual({success:false, damage:6, logged:-6, queued:0});

    // Only when the action succeeds.
    await addRiskyAction(page, {enabledForActionSkillCheck:'success'});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:6, logged:-6, queued:0});
    expect(await takeRiskyAction(page, ACTION_FAIL, 0, 3)).toEqual({success:false, damage:0, logged:undefined, queued:2});

    // No effects at all.
    await addRiskyAction(page, null);
    expect(await takeRiskyAction(page, ACTION_PASS, 0)).toEqual({success:true, damage:0, logged:undefined, queued:1});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an effect without its own check follows the action\'s check and rolls nothing more', async ({page}) => {
    const problems = await startGame(page);

    // A pass hurts by 1, and a failure rolls the d(6)+2: a 4, plus 2.
    await addRiskyAction(page, {});
    await page.evaluate(() => {
        const collision = tc.model.getEventModel('collision');
        collision.getActionModels().risky.setEffects({'agent.health':{onFailure:'-(d(6)+2)', onSuccess:'-1'}});
    });
    expect(await page.evaluate(() => tc.model.getEventModel('collision').getActionModels().risky.getEffects()[0].hasOwnCheck())).toBe(false);
    expect(await takeRiskyAction(page, ACTION_PASS, 3)).toEqual({success:true, damage:1, logged:-1, queued:1});
    expect(await takeRiskyAction(page, ACTION_FAIL, 3)).toEqual({success:false, damage:6, logged:-6, queued:0});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a bad enabledForActionSkillCheck warns and applies either way, and an effect without an amount never applies', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const collision = tc.model.getEventModel('collision'),
                make = effectCfg => {
                    delete collision.getActionModels().risky;
                    collision.setActions({risky:{label:'Risky', set:{}, effects:{'agent.health':effectCfg}}});
                    const [effect] = collision.getActionModels().risky.getEffects();
                    return {
                        when:effect?.enabledForActionSkillCheck ?? null,
                        onFail:effect?.appliesFor({success:false}) ?? false,
                        onPass:effect?.appliesFor({success:true}) ?? false
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
        'Event collision action risky effect agent.health enabledForActionSkillCheck must be "success", "failure" or "both" (using "both"): {enabledForActionSkillCheck: fail, onFailure: -5}',
        'Event collision action risky effect agent.health needs an onSuccess or onFailure amount (ignoring it): {enabledForActionSkillCheck: failure}'
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

test('effects can change the event and the timeline too, each within its stat\'s limits', async ({page}) => {
    const problems = await startGame(page),
        // The action's own check passes on a roll of 1 or more and fails on 0. None of the
        // effects has a check of its own, so they follow it.
        effects = {
            'event.attestation':{onSuccess:'5'},
            // An Event's paradox also adds to the timeline's.
            'event.paradox':{onSuccess:'1'},
            'timeline.paradox':{onSuccess:'2'},
            'agent.chronal':{onSuccess:'-3', onFailure:'-1'}
        },
        take = roll => page.evaluate(roll => {
            const vq = tc.model.getAgentModel('VQ'),
                collision = tc.model.getEventModel('collision'),
                read = () => [collision.attestation.value, collision.paradox.value, tc.model.paradox.value, vq.chronal.value],
                before = read();
            vq.setActionExecCount(0);
            tc.rng.queueRolls(roll);
            vq.doAction(collision.getActionModels().multi);
            const after = read(),
                entry = vq.getLog()[vq.getLog().length - 1];
            return {change:after.map((value, i) => value - before[i]), logged:entry.effects};
        }, roll);

    await page.evaluate(effects => {
        const collision = tc.model.getEventModel('collision');
        collision.setActions({multi:{label:'Multi', skillCheck:{difficulty:0, check:'1000'}, set:{}, effects}});
        // Close to its max, so the attestation is clamped.
        collision.attestation.setValue(98);
        tc.model.getAgentModel('VQ').chronal.setValue(50);
        tc.app.selectEventBox('casualties');
        tc.app.selectEventBox('collision');
    }, effects);

    // Flagged for the chronal and paradox it changes, and the tooltip gives each effect's 
    // amounts in order.
    const btnText = 'Multi [⏲ + ⥁]';
    await expect(page.getByText(btnText, {exact:true}).filter({visible:true})).toBeVisible();
    expect((await btnTooltip(page, btnText)).replace(/\u00A0/g, ' ')).toMatch(
        /^Multi · [a-z ]+ · Event Attestation: ~\+5 if passed · Event Parad⥁x: ~\+1 if passed · Timeline Parad⥁x: ~\+2 if passed · Chr⏲nal: ~-3 if passed, ~-1 if failed$/
    );

    // A pass applies them all, the attestation only as far as its max. Columns: attestation,
    // the Event's paradox, the timeline's paradox, VQ's chronal.
    expect(await take(1)).toEqual({
        change:[2, 1, 3, -3],
        logged:{'event.attestation':2, 'event.paradox':1, 'timeline.paradox':2, 'agent.chronal':-3}
    });

    // A failure applies only what has an onFailure.
    expect(await take(0)).toEqual({change:[0, 0, 0, -1], logged:{'agent.chronal':-1}});

    // The button floats every change.
    await page.evaluate(() => tc.model.getEventModel('collision').attestation.setValue(50));
    await page.evaluate(() => tc.model.getAgentModel('VQ').setActionExecCount(0));
    await page.evaluate(() => tc.rng.queueRolls(999));
    await page.getByText(btnText, {exact:true}).filter({visible:true}).click();
    await expect.poll(() => floatingTexts(page)).toEqual([
        expect.stringMatching(/^Succeeded by [\d.]+ · \+5 Attestation · \+1⥁ · \+2⥁ · -3⏲$/)
    ]);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});


test('every regular event offers Rest, hidden when the event is under an hour', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const out = {missing:[], wrongHidden:[]};
            for (const eventModel of tc.model.getEventModelsAsList(eventModel => eventModel.isRegularEvent())) {
                const rest = eventModel.getActionModels()._rest;
                if (!rest) {
                    out.missing.push(eventModel.id);
                } else if (rest.isHidden() !== eventModel.duration < 60 * 60 * 1000) {
                    out.wrongHidden.push(eventModel.id);
                }
            }
            out.collisionHidden = tc.model.getEventModel('collision').getActionModels()._rest.isHidden();
            out.lifeboatsHidden = tc.model.getEventModel('lifeboat_capacity').getActionModels()._rest.isHidden();
            return out;
        });
    expect(out).toEqual({missing:[], wrongHidden:[], collisionHidden:true, lifeboatsHidden:false});
    expect(problems.warnings).toEqual([]);
});

test('resting is likelier to work the healthier the agent is, and never heals past max health', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const vq = tc.model.getAgentModel('VQ'),
                health = vq.health,
                rest = tc.model.getEventModel('collision').getActionModels()._rest,

                // Rest's own check rolls, then on a pass its health effect, which follows that
                // check, heals with a d(4). The collision lasts a minute, which rounds up to
                // one die. A failed rest rolls nothing more.
                restFrom = (value, ...rolls) => {
                    health.setValue(value);
                    vq.setActionExecCount(0);
                    tc.rng.queueRolls(...rolls);
                    vq.doAction(rest);
                    const left = tc.rng.getQueuedRollCount(),
                        entry = vq.getLog()[vq.getLog().length - 1];
                    tc.rng.clearQueuedRolls();
                    return {health:health.value, logged:entry.effects?.['agent.health'], success:entry.success, left};
                },
                phraseAt = value => {
                    health.setValue(value);
                    return vq.getSkillEasePhrase(rest.getActionSkillExpr(), rest.getActionSkillDifficulty());
                };
            return {
                max:health.max,
                ownCheck:rest.getEffects()[0].hasOwnCheck(),

                // Healing still changes health. A d(4) averages 2.5, rounded to 3.
                risk:vq.hasHealthChangeRiskFor(rest),
                effectsPhrase:vq.getEffectsPhrase(rest),

                // VQ has 85 max health. At half or less it's hopeless, and at 90% or more
                // it's ensured.
                phrases:[phraseAt(42), phraseAt(60), phraseAt(77)],

                // At 60 of 85 the ease is round(2500 * 60 / 85) - 1250 - 1000 = -485.
                failAt60:restFrom(60, 484, 3),
                passAt60:restFrom(60, 485, 3),

                // Near full health even a roll of 1 passes, and the healing is capped.
                nearFull:restFrom(health.max - 2, 1, 3),
                full:restFrom(health.max, 1, 3)
            };
        });
    expect(out.ownCheck).toBe(false);
    expect(out.risk).toBe(true);
    expect(out.effectsPhrase).toBe('Health: ~+3 if passed');
    expect(out.phrases).toEqual(['hopeless', 'even', 'ensured']);
    expect(out.failAt60).toEqual({health:60, logged:undefined, success:false, left:1});
    expect(out.passAt60).toEqual({health:64, logged:4, success:true, left:0});
    expect(out.nearFull).toEqual({health:out.max, logged:2, success:true, left:0});
    expect(out.full).toEqual({health:out.max, logged:0, success:true, left:0});
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('the Rest button is flagged for health, and a rest floats its healing', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            iceWarnings = tc.model.getEventModel('ice_warnings');
        iceWarnings.attestation.setValue(10);
        vq.setEvent('ice_warnings');
        vq.health.setValue(vq.health.max - 10);
        tc.app.selectEventBox('ice_warnings');
    });
    const btn = page.getByText('Rest [♥]', {exact:true}).filter({visible:true});
    await expect(btn).toBeVisible();

    // The rest check passes, then eight d(4)s for the 12 hour Event, capped at 8 hours: all 1s.
    await page.evaluate(() => tc.rng.queueRolls(999, 0, 0, 0, 0, 0, 0, 0, 0));
    await btn.click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Succeeded by [\d.]+ · \+8♥$/)]);
    await expect.poll(() => floatingTexts(page)).toEqual([]);
    
    // At full health there's nothing to heal, so no change floats.
    await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ');
        vq.health.setValue(vq.health.max);
        vq.setActionExecCount(0);
        tc.rng.queueRolls(999, 0, 0, 0, 0, 0, 0, 0, 0);
    });
    await btn.click();
    await expect.poll(() => floatingTexts(page)).toEqual([expect.stringMatching(/^Succeeded by [\d.]+$/)]);
    expect(problems.pageErrors).toEqual([]);
});

test('positive amounts heal and negative ones hurt, and a broken amount does nothing', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const vq = tc.model.getAgentModel('VQ'),
                collision = tc.model.getEventModel('collision'),
                healthAfter = (effectCfg, value) => {
                    delete collision.getActionModels().heal;
                    collision.setActions({heal:{label:'Heal', skillCheck:{difficulty:0, check:'1000'}, set:{}, effects:{'agent.health':{difficulty:0, check:'1000', ...effectCfg}}}});
                    vq.health.setValue(value);
                    vq.setActionExecCount(0);
                    tc.rng.queueRolls(999, 999);
                    vq.doAction(collision.getActionModels().heal);
                    tc.rng.clearQueuedRolls();
                    return vq.health.value;
                };
            return {
                heals:healthAfter({onSuccess:'5'}, 40),
                hurts:healthAfter({onSuccess:'-5'}, 40),
                broken:healthAfter({onSuccess:'-nope'}, 40),
                notANumber:healthAfter({onSuccess:'-Math.sqrt(-1)'}, 40)
            };
        });
    expect(out).toEqual({heals:45, hurts:35, broken:40, notANumber:40});
    expect(problems.warnings.length).toBeGreaterThan(0);
    for (const warning of problems.warnings) expect(warning).toContain('nope is not defined');
    expect(problems.pageErrors).toEqual([]);
});

test('buttons flag each stat an effect could change, but not a broken amount', async ({page}) => {
    const problems = await startGame(page),
        exitTextWith = async effects => {
            await page.evaluate(effects => {
                tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties').setEffects(effects);
                tc.app.selectEventBox('casualties');
                tc.app.selectEventBox('collision');
            }, effects);
            // The exit's button in the agent's list of exits.
            const btn = page.getByText(/^Walk to Loss of Life/).filter({visible:true});
            await expect(btn).toHaveCount(1);
            return btn.textContent();
        };
    
    // Entering the casualties costs no paradox, so only the effects flag anything.
    expect(await exitTextWith({})).toBe('Walk to Loss of Life');
    expect(await exitTextWith({'timeline.paradox':{onSuccess:'1'}})).toBe('Walk to Loss of Life [⥁]');
    expect(await exitTextWith({'agent.chronal':{onSuccess:'-2'}, 'agent.health':{onSuccess:'3'}})).toBe('Walk to Loss of Life [⏲ + ♥]');
    
    // Changes that average to nothing, or can't be worked out, aren't flagged.
    expect(await exitTextWith({'agent.health':{onSuccess:'d(3) - 2'}})).toBe('Walk to Loss of Life');
    expect(await exitTextWith({'agent.health':{onFailure:'nope'}})).toBe('Walk to Loss of Life');
    for (const warning of problems.warnings) expect(warning).toBe('Check expression threw (nope is not defined): nope');
    expect(problems.pageErrors).toEqual([]);
});

test('an amount\'s margin is how well the check that decided it went', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const vq = tc.model.getAgentModel('VQ'),
                collision = tc.model.getEventModel('collision'),
                attestation = collision.attestation,
                
                // Has VQ take an action with this effect on the collision's attestation, and
                // returns how much it changed.
                actWith = (effectCfg, skillCheck, ...rolls) => {
                    delete collision.getActionModels().measured;
                    collision.setActions({measured:{label:'Measured', skillCheck, set:{}, effects:{'event.attestation':effectCfg}}});
                    attestation.setValue(50);
                    vq.setActionExecCount(0);
                    tc.rng.queueRolls(...rolls);
                    vq.doAction(collision.getActionModels().measured);
                    tc.rng.clearQueuedRolls();
                    return attestation.value - 50;
                },
                
                // An ease of -500, so a roll of 500 or more passes.
                HARD = {difficulty:500, check:'0'},
                BY_MARGIN = {onSuccess:'Math.floor(margin / 100)', onFailure:'Math.ceil(margin / 100)'};
            
            // An exit without a check of its own has no margin.
            const exitModel = collision.getExitModels().find(exit => exit.to === 'casualties');
            exitModel.setEffects({'event.attestation':{onSuccess:'margin + 3'}});
            attestation.setValue(50);
            vq.doFollowExit(exitModel);
            const exit = attestation.value - 50;
            vq.setEvent('collision');
            
            return {
                // Following the action's check: a roll of 799 passes by 299 and 99 fails by 401.
                actionPass:actWith(BY_MARGIN, HARD, 799),
                actionFail:actWith(BY_MARGIN, HARD, 99),
                
                // Its own check decides, not the action's: the action passes by 499, but the
                // effect's own check passes by only 150.
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
            const vq = tc.model.getAgentModel('VQ'),
                collision = tc.model.getEventModel('collision'),
                withAction = (effectCfg, skillCheck) => {
                    delete collision.getActionModels().measured;
                    collision.setActions({measured:{label:'Measured', skillCheck, set:{}, effects:{'event.attestation':effectCfg}}});
                    const actionModel = collision.getActionModels().measured;
                    return {
                        phrase:vq.getEffectsPhrase(actionModel).replace(/\u00A0/g, ' '),
                        flagged:vq.hasStatChangeFor(actionModel, 'attestation')
                    };
                },
                HARD = {difficulty:500, check:'0'},
                TENTH = {onSuccess:'margin / 10', onFailure:'margin / 10'},
                exitModel = collision.getExitModels().find(exit => exit.to === 'casualties');
            exitModel.setEffects({'event.attestation':{onSuccess:'margin + 3'}});
            
            return {
                // At an ease of -500, passes run from 0 to 499 and failures from -500 to -1.
                averages:[[-500, true], [-500, false], [-1, true], [-1, false]].map(([ease, success]) => tc.checks.getAverageMargin(ease, success)),
                hard:withAction(TENTH, HARD),
                
                // An effect's own check is as sure as a check gets, so a pass averages 499.
                own:withAction({difficulty:0, check:'1000', onSuccess:'margin / 10'}, HARD),
                
                // No margin without a roll, so an amount of just the margin is no change.
                noRoll:withAction({onSuccess:'margin'}, {difficulty:'no-roll'}),
                exit:vq.getEffectsPhrase(exitModel)
            };
        });
    expect(out.averages).toEqual([249.5, -250.5, 499, -1]);
    expect(out.hard).toEqual({phrase:'Event Attestation: ~+25 if passed, ~-25 if failed', flagged:true});
    expect(out.own).toEqual({phrase:'Event Attestation: ~+50 if passed · ensured', flagged:true});
    expect(out.noRoll).toEqual({phrase:'Event Attestation: ~+0 if passed', flagged:false});
    expect(out.exit).toBe('Event Attestation: ~+3 if passed');
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
