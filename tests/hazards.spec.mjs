// Time travel hazards: init.json5's "timeTravelAdj", rolled whenever an agent pays chronal to
// time travel, with amounts that see the chronal paid as "chronal".
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const HAZARDS = {
        // Hurts by up to the chronal paid, and ages by up to as many years.
        'agent.health':{actionType:'time_travel', difficulty:300, onFailure:'-d(chronal)'},
        'agent.effectiveAge':{actionType:'time_travel', difficulty:150, onFailure:'d(chronal)'}
    },

    routeHazards = page => page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.skillChecks.time_travel = {name:'Time Travel', check:'0.75*agent.skills.chronogation + 0.25*agent.skills.luck'};
        json.timeTravelAdj = HAZARDS;
        return route.fulfill({json});
    }),

    // Alpha's health, effective age, the last log entry's adjustments and how many forced rolls
    // are left, after doing something.
    alphaAfter = (page, func, rolls=[]) => page.evaluate(([funcSrc, rolls]) => {
        const alpha = tc.model.getAgentModel('AL'),
            before = {health:alpha.health.value, age:alpha.getEffectiveAge()};
        tc.rng.queueRolls(...rolls);
        new Function('alpha', funcSrc)(alpha);
        const log = alpha.getLog(),
            queued = tc.rng.getQueuedRollCount();
        tc.rng.clearQueuedRolls();
        return {
            damage:before.health - alpha.health.value,
            // Whole years, leaving out the time lived on the way.
            aged:Math.round(alpha.getEffectiveAge() - before.age),
            event:alpha.event,
            logged:log[log.length - 1].adj ?? null,
            queued
        };
    }, [func, rolls]);

test('paying chronal to time travel risks hurting and aging, by up to the chronal paid', async ({page}) => {
    await routeHazards(page);
    const problems = await startGame(page);

    // Recalling from origin costs Alpha 1 chronal. Each hazard rolls its check, then its die.
    // Failing both: a 1 on each d(1).
    expect(await alphaAfter(page, 'alpha.doRecallToHQ();', [0, 0, 0, 0])).toEqual({
        damage:1, aged:1, event:'time_corps_hq', logged:{'agent.health':-1, 'agent.effectiveAge':1}, queued:0
    });

    // Passing both: no dice, and nothing changes.
    expect(await alphaAfter(page, 'alpha.doDeployToEvent(tc.model.getEventModel("origin"));', [999, 999])).toEqual({
        damage:0, aged:0, event:'origin', logged:{'agent.health':0, 'agent.effectiveAge':0}, queued:0
    });

    // Looping back is time travel too, and a jump to another Event, with a die as big as its
    // cost: 2 chronal to Aftermath, so a 2.
    const jumpCost = await page.evaluate(() => tc.getChronalToDeploy(tc.model.getAgentModel('AL'), tc.model.getEventModel('aftermath')));
    expect(jumpCost).toBe(2);
    expect(await alphaAfter(page, 'alpha.doDeployToEvent(tc.model.getEventModel("aftermath"));', [0, 1, 999])).toEqual({
        damage:2, aged:0, event:'aftermath', logged:{'agent.health':-2, 'agent.effectiveAge':0}, queued:0
    });

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('the time travel buttons show the risk, and what happened floats above them', async ({page}) => {
    await routeHazards(page);
    const problems = await startGame(page);

    // Alpha's recall, for 6 chronal, shows the injury risk, and its tooltip names both hazards
    // and how likely Alpha is to avoid them: ease -375 and -225.
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    const recallBtn = page.getByText(/^Recall to/).filter({visible:true});
    await expect(recallBtn).toHaveText(/\[6⏲ \+ ♥\]$/);
    expect(await page.evaluate(() => tc.stripMarkup(tc.model.getAgentModel('AL').getTimeTravelHazardsPhrase(6)))).toBe(
        '♥ Risking: light injury\u00A0·\u00A0Time Travel / fair\u00A0·\u00A0Effective Age: ~+3.5 if failed\u00A0·\u00A0Time Travel / easy'
    );

    // Failing the first shows its result and both changes.
    await page.evaluate(() => tc.rng.queueRolls(0, 0, 0, 0));
    await recallBtn.click();
    const floating = await page.evaluate(() => tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText)).map(sv => tc.stripMarkup(sv.text)));
    expect(floating).toEqual(['Failed by 375\u00A0·\u00A0-1♥\u00A0·\u00A0+1 Effective Age']);

    expect(problems.pageErrors).toEqual([]);
});

test('exits and moves the data makes risk nothing, even time travel that costs chronal', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5'),
            {origin, aftermath} = json.events;
        origin.actions.moveAway = {label:'Move Away', skillCheck:{difficulty:'no-roll'}, set:{'agent.event':"'aftermath'"}};
        // A pull that hurts by its own adj instead.
        aftermath.exits.push({mode:'pulled', to:'finale', toHidden:true, costs:{'agent.chronal':'3'}, adj:{'agent.health':'-d(4)'}});
        return route.fulfill({json});
    });
    await routeHazards(page);
    const problems = await startGame(page);
    
    // A move the data makes pays the chronal but risks nothing.
    const moved = await alphaAfter(page, `
        alpha.doAction(tc.model.getEventModel('origin').getActionModels().moveAway);
    `, [0, 0, 0, 0]);
    expect([moved.event, moved.damage, moved.aged, moved.queued]).toEqual(['aftermath', 0, 0, 4]);
    
    // The pull rolls only its own die: 3 on a d(4). The rest of the forced rolls are left.
    expect(await alphaAfter(page, `
        alpha.doFollowExit(tc.model.getEventModel('aftermath').getExitModels().find(exit => exit.mode === 'pulled'));
    `, [2, 0, 0, 0])).toEqual({
        damage:3, aged:0, event:'finale', logged:{'agent.health':-3}, queued:3
    });
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('without timeTravelAdj, time travel risks nothing', async ({page}) => {
    const problems = await startGame(page);
    expect(await alphaAfter(page, 'alpha.doRecallToHQ();', [0, 0, 0, 0])).toEqual({
        damage:0, aged:0, event:'time_corps_hq', logged:null, queued:4
    });
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').getTimeTravelHazardsPhrase(5))).toBe('');
    expect(problems.pageErrors).toEqual([]);
});

test('aging takes fractions of a year, and shows them to 2 decimal places', async ({page}) => {
    await page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.skillChecks.time_travel = {name:'Time Travel', check:'0.75*agent.skills.chronogation + 0.25*agent.skills.luck'};
        // In months, as the game's own data has it.
        json.timeTravelAdj = {...HAZARDS, 'agent.effectiveAge':{...HAZARDS['agent.effectiveAge'], onFailure:'d(chronal)/12'}};
        return route.fulfill({json});
    });
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.origin.actions.treat = {label:'Treat', skillCheck:{difficulty:'no-roll'}, adj:{'agent.effectiveAge':'-0.5', 'agent.health':'-2.6'}};
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    
    // Averaging 3.5 months on a d(6) in the tooltip.
    expect(await page.evaluate(() => tc.stripMarkup(tc.model.getAgentModel('AL').getTimeTravelHazardsPhrase(6)))).toContain('Effective Age: ~+0.29 if failed');
    
    // Failing both on the way home: 1 health, and 3 months.
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await page.evaluate(() => tc.rng.queueRolls(0, 0, 0, 2));
    await page.getByText(/^Recall to/).filter({visible:true}).click();
    expect(await page.evaluate(() => tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText)).map(sv => tc.stripMarkup(sv.text)))).toEqual(
        ['Failed by 375 · -1♥ · +0.25 Effective Age']
    );
    expect(await page.evaluate(() => {
        const log = tc.model.getAgentModel('AL').getLog();
        return log[log.length - 1].adj;
    })).toEqual({'agent.health':-1, 'agent.effectiveAge':0.25});
    
    // An action's adjustment isn't rounded either, though health still is. Taking it lives
    // through a little time too.
    expect(await alphaAfter(page, `
        alpha.setEvent('origin');
        const before = alpha.getEffectiveAge();
        alpha.doAction(tc.model.getEventModel('origin').getActionModels().treat);
        window._treated = alpha.getEffectiveAge() - before;
    `)).toMatchObject({damage:3, logged:{'agent.effectiveAge':-0.5, 'agent.health':-3}});
    expect(await page.evaluate(() => window._treated)).toBeCloseTo(-0.5, 3);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
