// Injury checks on exits: taking an exit always succeeds, but a failed check costs health.
import {test, expect} from '@playwright/test';
import {startGame, readJson, dialogTitle, dismissAgentDossier, btnTooltip} from './helpers.mjs';

const INJURY = {difficulty:300, actionType:'athletic', damageOnFailure:'d(6)+4'},

    /*  Serves the Titanic scenario with injury checks added to some exits, as if they were in the
        data: a good one from the collision to the casualties, and one with no damage from the
        ice warnings to the wireless backlog. */
    routeScenarioWithInjuries = page => page.route('**/data/titanic_scenario.json', route => {
        const json = readJson('data/titanic_scenario.json'),
            exitTo = (eventId, toId) => json.events[eventId].exits.find(exit => exit.to === toId);
        exitTo('collision', 'casualties').injurySkillCheck = INJURY;
        exitTo('ice_warnings', 'wireless_priority').injurySkillCheck = {actionType:'athletic'};
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
            logged:log[log.length - 1].damage,
            queued:tc.rng.getQueuedRollCount()
        };
    }, rolls),

    // VQ's athletic check, so tests can pick rolls that pass or fail it.
    vqSkills = readJson('data/agents.json').agents.VQ.skills,
    vqAthleticEase = 0.5*vqSkills.str + 0.5*vqSkills.agl - INJURY.difficulty,
    PASS_ROLL = 999,
    FAIL_ROLL = 0;

test('an exit\'s injury check comes from the data, and one without damage is ignored with a warning naming it', async ({page}) => {
    await routeScenarioWithInjuries(page);
    const problems = await startGame(page),
        checks = await page.evaluate(() => {
            const describe = (eventId, toId) => {
                const exitModel = tc.model.getEventModel(eventId).getExitModels().find(exit => exit.to === toId);
                return {
                    has:exitModel.hasInjuryCheck(),
                    damageOnSuccess:exitModel.getInjuryDamage(true) ?? null,
                    damageOnFailure:exitModel.getInjuryDamage(false) ?? null,
                    difficulty:exitModel.getActionSkillDifficulty(tc.ACTION_INJURY),
                    name:exitModel.getActionSkillName(tc.ACTION_INJURY)
                };
            };
            return {
                good:describe('collision', 'casualties'),
                noDamage:describe('ice_warnings', 'wireless_priority'),
                none:describe('roster_reshuffle', 'titanic_departs')
            };
        });
    expect(checks.good).toEqual({has:true, damageOnSuccess:null, damageOnFailure:'d(6)+4', difficulty:300, name:'Athletic'});
    expect(checks.noDamage.has).toBe(false);
    expect(checks.none.has).toBe(false);

    expect(problems.warnings).toHaveLength(2);
    expect(problems.warnings[0]).toMatch(/^Event lifeboat_capacity action argueFor skill check difficulty must be/);
    expect(problems.warnings[1]).toMatch(/^Event ice_warnings exit to wireless_priority injury skill check needs a damageOnSuccess or damageOnFailure expression/);
    expect(problems.pageErrors).toEqual([]);
});

test('a failed injury check costs health but the exit is still taken; a passed one costs nothing', async ({page}) => {
    expect(FAIL_ROLL + vqAthleticEase).toBeLessThan(0);
    expect(PASS_ROLL + vqAthleticEase).toBeGreaterThanOrEqual(0);

    await routeScenarioWithInjuries(page);
    const problems = await startGame(page);

    // The check rolls first, then the damage die: a 3 on the d(6), plus 4.
    expect(await takeInjuryExit(page, FAIL_ROLL, 2)).toEqual({damage:7, event:'casualties', logged:7, queued:0});

    // Back again, and this time the check passes, so the damage die isn't rolled.
    await page.evaluate(() => tc.model.getAgentModel('VQ').setEvent('collision'));
    expect(await takeInjuryExit(page, PASS_ROLL, 2)).toEqual({damage:0, event:'casualties', logged:0, queued:1});
    await page.evaluate(() => tc.rng.clearQueuedRolls());

    expect(problems.pageErrors).toEqual([]);
});

test('an exit without an injury check rolls nothing and logs no damage', async ({page}) => {
    const problems = await startGame(page);
    expect(await takeInjuryExit(page, FAIL_ROLL)).toEqual({damage:0, event:'casualties', logged:undefined, queued:1});
    await page.evaluate(() => tc.rng.clearQueuedRolls());
    expect(problems.pageErrors).toEqual([]);
});

test('damage is whole points, never heals, and a broken damage expression does none', async ({page}) => {
    const problems = await startGame(page),
        damageFor = damage => page.evaluate(damage => {
            const vq = tc.model.getAgentModel('VQ'),
                exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
            // Back to the start with no visits, so the trips don't build up paradox.
            vq.getLog().length = 0;
            vq.paradox.setValue(0);
            vq.setEvent('collision');
            exitModel.setInjurySkillCheck({difficulty:1000, check:'0', damageOnFailure:damage});
            const before = vq.health.value;
            tc.rng.queueRolls(0);
            vq.doFollowExit(exitModel);
            const log = vq.getLog();
            return [before - vq.health.value, log[log.length - 1].damage];
        }, damage);

    // Health lost, and the damage logged.
    expect(await damageFor('2.6')).toEqual([3, 3]);
    expect(await damageFor('-5')).toEqual([0, 0]);
    expect(await damageFor('nope + 1')).toEqual([0, 0]);
    expect(problems.warnings).toHaveLength(1);
    expect(problems.warnings[0]).toContain('threw');
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
        // d(6)+4 averages 7.5: moderate.
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
    
    // Exits without a check have no flag or tooltip. Both Events are made known so the exit shows.
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
    await expect.poll(() => page.evaluate(() => tc.app.getSubviews()
        .filter(sv => sv.isA(tc.FloatingText) && sv.visible)
        .map(floatingText => floatingText.text.replace(/\u00A0/g, ' ')))).toEqual([expect.stringMatching(/^Failed by [\d.]+ · -7♥$/)]);
    expect(await page.evaluate(() => tc.model.getAgentModel('VQ').event)).toBe('casualties');

    expect(problems.pageErrors).toEqual([]);
});


/*  Kills VQ on his exit from the collision: a check he can't pass, and more damage than he has. */
const killVQOnExit = page => page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
        exitModel.setInjurySkillCheck({difficulty:1000, check:'0', damageOnFailure:'500'});
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


/*  Takes VQ's exit from the collision with this injury check's damage and the rolls queued: 
    the check passes on a roll of 999 and fails on 0. Returns the damage, what was logged and 
    the rolls left over. */
const damageWith = (page, damages, ...rolls) => page.evaluate(([damages, rolls]) => {
        const vq = tc.model.getAgentModel('VQ'),
            exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
        // Back to the start with full health and no visits, so the trips don't build up paradox.
        vq.getLog().length = 0;
        vq.paradox.setValue(0);
        vq.health.setValue(vq.health.max);
        vq.setEvent('collision');
        exitModel.setInjurySkillCheck({difficulty:0, check:'0', ...damages});
        const before = vq.health.value;
        tc.rng.queueRolls(...rolls);
        vq.doFollowExit(exitModel);
        const log = vq.getLog(),
            queued = tc.rng.getQueuedRollCount();
        tc.rng.clearQueuedRolls();
        return {damage:before - vq.health.value, logged:log[log.length - 1].damage, queued};
    }, [damages, rolls]),
    PASS = 999,
    FAIL = 0;

test('an injury check does its success damage on a pass and its failure damage on a failure', async ({page}) => {
    const problems = await startGame(page);
    
    // Only on a failure. A pass rolls nothing more.
    expect(await damageWith(page, {damageOnFailure:'d(6)+4'}, PASS, 2)).toEqual({damage:0, logged:0, queued:1});
    expect(await damageWith(page, {damageOnFailure:'d(6)+4'}, FAIL, 2)).toEqual({damage:7, logged:7, queued:0});
    
    // Only on a pass.
    expect(await damageWith(page, {damageOnSuccess:'3'}, PASS)).toEqual({damage:3, logged:3, queued:0});
    expect(await damageWith(page, {damageOnSuccess:'3'}, FAIL)).toEqual({damage:0, logged:0, queued:0});
    
    // Light on a pass, heavy on a failure. Each case rolls only its own dice, after the check.
    const both = {damageOnSuccess:'d(10)', damageOnFailure:'50'};
    expect(await damageWith(page, both, PASS, 3)).toEqual({damage:4, logged:4, queued:0});
    expect(await damageWith(page, both, FAIL, 3)).toEqual({damage:50, logged:50, queued:1});
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a damage that isn\'t a non-empty string is ignored with a warning, and the old damage key is unknown', async ({page}) => {
    const problems = await startGame(page),
        result = await page.evaluate(() => {
            const exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties'),
                read = () => [exitModel.hasInjuryCheck(), exitModel.getInjuryDamage(true) ?? null, exitModel.getInjuryDamage(false) ?? null];
            exitModel.setInjurySkillCheck({damageOnSuccess:'', damageOnFailure:'9'});
            const oneBad = read();
            exitModel.setInjurySkillCheck({damage:'150'});
            return {oneBad, oldKey:read()};
        });
    expect(result).toEqual({oneBad:[true, null, '9'], oldKey:[false, null, null]});
    expect(problems.warnings).toEqual([
        'Event collision exit to casualties injury skill check damageOnSuccess must be a non-empty string (ignoring it): {damageOnSuccess: , damageOnFailure: 9}',
        'Event collision exit to casualties injury skill check has unknown keys damage: {damage: 150}',
        'Event collision exit to casualties injury skill check needs a damageOnSuccess or damageOnFailure expression (ignoring the check): {damage: 150}'
    ]);
});

test('a pass that still hurts floats its damage, and the risk tooltip gives both cases', async ({page}) => {
    const problems = await startGame(page),
        riskFor = damages => page.evaluate(damages => {
            const vq = tc.model.getAgentModel('VQ'),
                exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
            exitModel.setInjurySkillCheck({difficulty:0, check:'0', ...damages});
            return vq.getInjuryRiskPhrase(exitModel).replace(/\u00A0/g, ' ');
        }, damages);
    
    // A failure's damage first, then a pass's when it hurts and reads differently.
    expect(await riskFor({damageOnFailure:'150'})).toBe('♥ Risking: certain death · ensured');
    expect(await riskFor({damageOnSuccess:'d(10)', damageOnFailure:'150'})).toBe('♥ Risking: certain death (moderate injury if passed) · ensured');
    expect(await riskFor({damageOnSuccess:'150', damageOnFailure:'150'})).toBe('♥ Risking: certain death · ensured');
    expect(await riskFor({damageOnSuccess:'0.5', damageOnFailure:'20'})).toBe('♥ Risking: severe injury · ensured');
    expect(await riskFor({damageOnSuccess:'d(10)'})).toBe('♥ Risking: harmless (moderate injury if passed) · ensured');
    
    // Passing, but still hurt by the d(10): 4.
    await page.evaluate(() => {
        const exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties');
        exitModel.setInjurySkillCheck({difficulty:0, check:'1000', damageOnSuccess:'d(10)', damageOnFailure:'150'});
        tc.app.selectEventBox('casualties');
        tc.app.selectEventBox('collision');
        tc.rng.queueRolls(500, 3);
    });
    await page.getByText('Walk to Loss of Life [♥]', {exact:true}).filter({visible:true}).click();
    await expect.poll(() => page.evaluate(() => tc.app.getSubviews()
        .filter(sv => sv.isA(tc.FloatingText) && sv.visible)
        .map(floatingText => floatingText.text.replace(/\u00A0/g, ' ')))).toEqual([expect.stringMatching(/^Succeeded by [\d.]+ · -4♥$/)]);
    
    expect(problems.pageErrors).toEqual([]);
});

test('the lifeboats are fatal on a failed injury check, and the crowded one hurts even on a pass', () => {
    const lifeboats = readJson('data/titanic_scenario.json').events.casualties.exits.filter(exit => exit.mode === 'lifeboat');
    expect(lifeboats.map(exit => exit.injurySkillCheck)).toEqual([
        // When there aren't enough boats.
        {difficulty:500, check:'agent.skills.str', damageOnFailure:'150', damageOnSuccess:'d(4,2)'},
        // When there are.
        {difficulty:50, actionType:'athletic', damageOnFailure:'150'}
    ]);
});

test('an injury check rolls and is described by its own settings, not the exit\'s default skill check', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const vq = tc.model.getAgentModel('VQ'),
                exitModel = tc.model.getEventModel('collision').getExitModels().find(exit => exit.to === 'casualties'),
                read = () => ({
                    difficulty:exitModel.getActionSkillDifficulty(tc.ACTION_INJURY),
                    expr:exitModel.getActionSkillExpr(tc.ACTION_INJURY),
                    phrase:vq.getInjuryRiskPhrase(exitModel).replace(/\u00A0/g, ' ')
                });
            
            // Its own difficulty and check: as sure as a skill check gets, so a roll of 1 passes,
            // where it would fail the default check.
            exitModel.setInjurySkillCheck({difficulty:0, check:'1000', actionType:'athletic', damageOnFailure:'5'});
            const own = read();
            tc.rng.queueRolls(1);
            const ownCheck = vq.checkInjuryFor(exitModel).success;
            
            // No actionType: no name, rather than the name of the slot it's stored in.
            exitModel.setInjurySkillCheck({difficulty:0, check:'1000', damageOnFailure:'5'});
            const untyped = read();
            
            return {own, ownCheck, untyped, slot:tc.ACTION_INJURY};
        });
    
    expect(out.own).toEqual({difficulty:0, expr:'1000', phrase:'♥ Risking: moderate injury · Athletic / ensured'});
    expect(out.ownCheck).toBe(true);
    expect(out.untyped.phrase).toBe('♥ Risking: moderate injury · ensured');
    expect(out.untyped.phrase).not.toContain(out.slot + ' /');
    expect(problems.warnings).toEqual([]);
});

test('the lifeboats\' injury checks use their own difficulties', async ({page}) => {
    await startGame(page);
    const difficulties = await page.evaluate(() => tc.model.getEventModel('casualties').getExitModels()
        .filter(exitModel => exitModel.mode === 'lifeboat')
        .map(exitModel => exitModel.getActionSkillDifficulty(tc.ACTION_INJURY)));
    expect(difficulties).toEqual([500, 50]);
});


/*  Gives the collision a test action VQ can take. Its own check passes on a roll of 999 and 
    fails on 0, and so does its injury check, which does d(6)+2 on a failure and 1 on a pass. 
    Replaces any earlier one, since adding an action never replaces one with the same ID. */
const addRiskyAction = (page, injuryCfg) => page.evaluate(injuryCfg => {
        const collision = tc.model.getEventModel('collision');
        delete collision.getActionModels().risky;
        collision.setActions({risky:{
            label:'Risky', skillCheck:{difficulty:0, check:'0'}, set:{},
            ...(injuryCfg === null ? {} : {injurySkillCheck:{difficulty:1000, check:'0', damageOnFailure:'d(6)+2', damageOnSuccess:'1', ...injuryCfg}})
        }});
        tc.app.selectEventBox('casualties');
        tc.app.selectEventBox('collision');
    }, injuryCfg),
    
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
        return {success:entry.success, damage:before - vq.health.value, logged:entry.damage, queued};
    }, rolls),
    ACTION_PASS = 999,
    ACTION_FAIL = 0;

test('actions get injury checks from the data, including when they apply', async ({page}) => {
    const problems = await startGame(page),
        checks = await page.evaluate(() => {
            const {countermand, allow} = tc.model.getEventModel('engine_order').getActionModels(),
                describe = actionModel => ({
                    when:actionModel.enabledForActionSkillCheck,
                    difficulty:actionModel.getActionSkillDifficulty(tc.ACTION_INJURY),
                    name:actionModel.getActionSkillName(tc.ACTION_INJURY),
                    damage:[actionModel.getInjuryDamage(true), actionModel.getInjuryDamage(false)],
                    // The action's own check is separate.
                    actionName:actionModel.getActionSkillName()
                });
            return {countermand:describe(countermand), allow:describe(allow)};
        });
    expect(checks.countermand).toEqual({when:'both', difficulty:250, name:'Athletic', damage:['d(4)', 'd(6,5)'], actionName:'Charisma'});
    expect(checks.allow).toEqual({when:'failure', difficulty:250, name:'Athletic', damage:['1', '5'], actionName:'Social'});
    expect(problems.warnings).toEqual([]);
});

test('an action\'s injury check rolls after its own check, when its result calls for one', async ({page}) => {
    const problems = await startGame(page);
    
    // Both: whatever the action's result. Fails the injury check: a 4 on the d(6), plus 2.
    await addRiskyAction(page, {});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:6, logged:6, queued:0});
    expect(await takeRiskyAction(page, ACTION_FAIL, 999)).toEqual({success:false, damage:1, logged:1, queued:0});
    
    // Only when the action fails. A success rolls nothing more and logs no damage.
    await addRiskyAction(page, {enabledForActionSkillCheck:'failure'});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:0, logged:undefined, queued:2});
    expect(await takeRiskyAction(page, ACTION_FAIL, 0, 3)).toEqual({success:false, damage:6, logged:6, queued:0});
    
    // Only when the action succeeds.
    await addRiskyAction(page, {enabledForActionSkillCheck:'success'});
    expect(await takeRiskyAction(page, ACTION_PASS, 0, 3)).toEqual({success:true, damage:6, logged:6, queued:0});
    expect(await takeRiskyAction(page, ACTION_FAIL, 0, 3)).toEqual({success:false, damage:0, logged:undefined, queued:2});
    
    // No injury check at all.
    await addRiskyAction(page, null);
    expect(await takeRiskyAction(page, ACTION_PASS, 0)).toEqual({success:true, damage:0, logged:undefined, queued:1});
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a bad enabledForActionSkillCheck warns and applies either way, and a check without damage never applies', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const collision = tc.model.getEventModel('collision'),
                make = injurySkillCheck => {
                    delete collision.getActionModels().risky;
                    collision.setActions({risky:{label:'Risky', set:{}, injurySkillCheck}});
                    const actionModel = collision.getActionModels().risky;
                    return {
                        when:actionModel.enabledForActionSkillCheck ?? null,
                        onFail:actionModel.hasInjuryCheck({success:false}),
                        onPass:actionModel.hasInjuryCheck({success:true})
                    };
                };
            return {
                typo:make({enabledForActionSkillCheck:'fail', damageOnFailure:'5'}),
                noDamage:make({enabledForActionSkillCheck:'failure'})
            };
        });
    expect(out).toEqual({
        typo:{when:'both', onFail:true, onPass:true},
        noDamage:{when:null, onFail:false, onPass:false}
    });
    expect(problems.warnings).toEqual([
        'Event collision action risky injury skill check enabledForActionSkillCheck must be "success", "failure" or "both" (using "both"): {enabledForActionSkillCheck: fail, damageOnFailure: 5}',
        'Event collision action risky injury skill check needs a damageOnSuccess or damageOnFailure expression (ignoring the check): {}'
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
    await expect.poll(() => page.evaluate(() => tc.app.getSubviews()
        .filter(sv => sv.isA(tc.FloatingText) && sv.visible)
        .map(floatingText => floatingText.text.replace(/\u00A0/g, ' ')))).toEqual([expect.stringMatching(/^Succeeded by [\d.]+ · -6♥$/)]);
    
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

test('resting always succeeds and heals, but never past the agent\'s max health', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const vq = tc.model.getAgentModel('VQ'),
                health = vq.health,
                rest = tc.model.getEventModel('collision').getActionModels()._rest,
                
                // Neither of Rest's checks rolls, so the only roll is a 4 on the d(4). The 
                // collision lasts a minute, which rounds up to one die.
                restFrom = value => {
                    health.setValue(value);
                    vq.setActionExecCount(0);
                    tc.rng.queueRolls(3);
                    vq.doAction(rest);
                    const left = tc.rng.getQueuedRollCount(),
                        entry = vq.getLog()[vq.getLog().length - 1];
                    tc.rng.clearQueuedRolls();
                    return {health:health.value, logged:entry.damage, success:entry.success, left};
                };
            return {
                max:health.max,
                difficulty:rest.getActionSkillDifficulty(),
                injuryDifficulty:rest.getActionSkillDifficulty(tc.ACTION_INJURY),
                hurt:restFrom(40),
                nearFull:restFrom(health.max - 2),
                full:restFrom(health.max)
            };
        });
    const noRoll = await page.evaluate(() => tc.toDifficulty(tc.DIFFICULTY_NO_ROLL));
    expect(out.difficulty).toBe(noRoll);
    expect(out.injuryDifficulty).toBe(noRoll);
    expect(out.hurt).toEqual({health:44, logged:-4, success:true, left:0});
    expect(out.nearFull).toEqual({health:out.max, logged:-2, success:true, left:0});
    expect(out.full).toEqual({health:out.max, logged:0, success:true, left:0});
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('negative damage heals only when allowed, and a broken healing expression does nothing', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const vq = tc.model.getAgentModel('VQ'),
                collision = tc.model.getEventModel('collision'),
                healFrom = (injurySkillCheck, value) => {
                    delete collision.getActionModels().heal;
                    collision.setActions({heal:{label:'Heal', skillCheck:{difficulty:0, check:'1000'}, set:{}, injurySkillCheck:{difficulty:0, check:'1000', ...injurySkillCheck}}});
                    vq.health.setValue(value);
                    vq.setActionExecCount(0);
                    tc.rng.queueRolls(999, 999);
                    vq.doAction(collision.getActionModels().heal);
                    tc.rng.clearQueuedRolls();
                    return vq.health.value;
                };
            return {
                allowed:healFrom({allowHealing:true, damageOnSuccess:'-5'}, 40),
                notAllowed:healFrom({damageOnSuccess:'-5'}, 40),
                broken:healFrom({allowHealing:true, damageOnSuccess:'-nope'}, 40),
                notANumber:healFrom({allowHealing:true, damageOnSuccess:'-Math.sqrt(-1)'}, 40)
            };
        });
    expect(out).toEqual({allowed:45, notAllowed:40, broken:40, notANumber:40});
    expect(problems.warnings.length).toBeGreaterThan(0);
    for (const warning of problems.warnings) expect(warning).toContain('nope is not defined');
    expect(problems.pageErrors).toEqual([]);
});
