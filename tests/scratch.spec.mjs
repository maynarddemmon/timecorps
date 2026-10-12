// The scratch space: entries the data declares at the top of a data file, read anywhere as
// "scratch.<name>" and set by an action's set.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData} from './helpers.mjs';

const NO_ROLL = {difficulty:'no-roll'},
    
    /*  Serves the test scenario with more scratch entries, and actions at the origin, where 
        Alpha starts, that use them. */
    routeScenarioWithScratch = page => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        Object.assign(json.scratch, {
            origin_knocks:0, origin_door:'shut', origin_alarm:false,
            bad:{}, set:1
        });
        Object.assign(json.events.origin.actions, {
            // Three knocks at most, hidden by a constraint on the count.
            knock:{
                label:'Knock', skillCheck:NO_ROLL,
                set:{'scratch.origin_knocks':'scratch.origin_knocks + 1'},
                hidden:'scratch.origin_knocks >= 3'
            },
            // Sets in order, so a later one sees an earlier one. An effect sees the count 
            // before the action's sets.
            open:{
                label:'Open', skillCheck:{difficulty:250},
                set:{
                    'scratch.origin_knocks':'scratch.origin_knocks + 10',
                    'scratch.origin_door':"'open after ' + scratch.origin_knocks",
                    'scratch.origin_alarm':'true'
                },
                effects:{'agent.paradox':{onSuccess:'scratch.origin_knocks - 2'}}
            },
            bad:{
                label:'Bad', skillCheck:NO_ROLL,
                set:{'scratch.origin_missing':'1', 'scratch.origin_knocks':'nope', 'scratch.origin_door':'({})'}
            }
        });
        return route.fulfill({json});
    }),
    
    /*  Alpha takes an origin action with the rolls queued, and gets its actions back. */
    takeAction = (page, actionId, ...rolls) => page.evaluate(([actionId, rolls]) => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.setActionExecCount(0);
        tc.rng.queueRolls(...rolls);
        alpha.doAction(tc.model.getEventModel('origin').getActionModels()[actionId]);
        tc.rng.clearQueuedRolls();
    }, [actionId, rolls]),
    
    readScratch = page => page.evaluate(() => {
        const {origin_knocks, origin_door, origin_alarm, plan_noteCount} = tc.model.scratch;
        return {origin_knocks, origin_door, origin_alarm, plan_noteCount};
    }),
    
    FRESH = {origin_knocks:0, origin_door:'shut', origin_alarm:false, plan_noteCount:0};

test('scratch entries come from the data, and bad ones are left out with a warning', async ({page}) => {
    await routeScenarioWithScratch(page);
    const problems = await startGame(page);
    expect(await readScratch(page)).toEqual(FRESH);
    expect(problems.warnings).toEqual([
        'Scratch entry bad must start as a number, a boolean or a string (ignoring it): {}',
        'Scratch entry name set is already in use (ignoring it)'
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('an action sets scratch entries once, in order, and constraints follow them', async ({page}) => {
    await routeScenarioWithScratch(page);
    const problems = await startGame(page),
        knockHidden = () => page.evaluate(() => tc.model.getEventModel('origin').getActionModels().knock.isHidden());
    problems.warnings.length = 0;
    
    for (let i = 0; i < 3; i++) {
        expect(await knockHidden()).toBe(false);
        await takeAction(page, 'knock');
    }
    expect((await readScratch(page)).origin_knocks).toBe(3);
    expect(await knockHidden()).toBe(true);
    
    // A failed check sets nothing.
    await takeAction(page, 'open', 0);
    expect(await readScratch(page)).toEqual({...FRESH, origin_knocks:3});
    
    await page.evaluate(() => tc.model.getAgentModel('AL').paradox.setValue(0));
    await takeAction(page, 'open', 999);
    expect(await readScratch(page)).toEqual({...FRESH, origin_knocks:13, origin_door:'open after 13', origin_alarm:true});
    // The effect saw 3, the count before the sets: 3 - 2.
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').paradox.value)).toBe(1);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a bad scratch set warns and sets nothing', async ({page}) => {
    await routeScenarioWithScratch(page);
    const problems = await startGame(page);
    problems.warnings.length = 0;
    
    await takeAction(page, 'bad');
    expect(await readScratch(page)).toEqual(FRESH);
    expect(problems.warnings).toEqual([
        'No scratch entry origin_missing is declared (ignoring the set): 1',
        'Check expression threw (nope is not defined): nope',
        expect.stringMatching(/^Scratch entry origin_door must be a number, a boolean or a string \(ignoring the set\)/)
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('scratch entries survive a save and reload, and only changed ones are saved', async ({page}) => {
    await routeScenarioWithScratch(page);
    const problems = await startGame(page);
    await takeAction(page, 'knock');
    await takeAction(page, 'knock');
    expect((await page.evaluate(() => tc.persistence.exportDiff())).scratch).toEqual({origin_knocks:2});
    
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await readScratch(page)).toEqual({...FRESH, origin_knocks:2});
    
    // And constraints see the restored value.
    await takeAction(page, 'knock');
    expect(await page.evaluate(() => tc.model.getEventModel('origin').getActionModels().knock.isHidden())).toBe(true);
    expect(problems.pageErrors).toEqual([]);
});
