// Injury checks on exits: taking an exit always succeeds, but a failed check costs health.
import {test, expect} from '@playwright/test';
import {startGame, readJson, dialogTitle, dismissAgentDossier, btnTooltip} from './helpers.mjs';

const INJURY = {difficulty:300, actionType:'athletic', damage:'d(6)+4'},

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
                    damage:exitModel.getInjuryDamage() ?? null,
                    difficulty:exitModel.getActionSkillDifficulty(),
                    name:exitModel.getActionSkillName()
                };
            };
            return {
                good:describe('collision', 'casualties'),
                noDamage:describe('ice_warnings', 'wireless_priority'),
                none:describe('roster_reshuffle', 'titanic_departs')
            };
        });
    expect(checks.good).toEqual({has:true, damage:'d(6)+4', difficulty:300, name:'Athletic'});
    expect(checks.noDamage.has).toBe(false);
    expect(checks.none.has).toBe(false);

    expect(problems.warnings).toHaveLength(2);
    expect(problems.warnings[0]).toMatch(/^Event lifeboat_capacity action argueFor skill check difficulty must be/);
    expect(problems.warnings[1]).toMatch(/^Event ice_warnings exit to wireless_priority injury skill check needs a damage expression/);
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
            exitModel.setInjurySkillCheck({difficulty:1000, check:'0', damage});
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
            'harmless', 'harmless', 'light', 'light', 'moderate', 'serious', 'severe', 'grievous',
            'critical', 'crippling', 'crippling', 'deadly', 'deadly', 'certain death', 'certain death'
        ]
    });
});

test('exit buttons flag the injury risk and explain it in the tooltip, and a failure floats the damage', async ({page}) => {
    await routeScenarioWithInjuries(page);
    const problems = await startGame(page),
        // d(6)+4 averages 7.5: moderate.
        risk = '♥ Risking: moderate\u00A0·\u00A0Athletic / ' + await page.evaluate(ease => tc.checks.toEasePhrase(ease), vqAthleticEase),
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
        exitModel.setInjurySkillCheck({difficulty:1000, check:'0', damage:'500'});
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

