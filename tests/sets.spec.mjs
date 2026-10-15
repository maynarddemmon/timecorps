// An action's set: what it changes in its Event's Values and in scratch. A string sets when
// the check passes; {onSuccess, onFailure} sets for either result, worked out once.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData} from './helpers.mjs';

/*  Serves the test scenario with a Value and actions at the origin, where Alpha starts, that
    set it per result. The toss's check is roll - 500, so a roll of 900 passes by 400 and a 
    roll of 100 fails by 400. */
const routeScenarioWithSets = page => page.route('**/tests/data/test_scenario.json5', route => {
    const json = readTestData('test_scenario.json5'),
        origin = json.events.origin;
    Object.assign(json.scratch, {origin_margin:0, origin_wins:0});
    origin.values.outcome = {name:'Outcome', value:'0'};
    Object.assign(origin.actions, {
        toss:{
            label:'Toss', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
            set:{
                outcome:{onSuccess:'1', onFailure:'-1'},
                'scratch.origin_margin':{onSuccess:'margin', onFailure:'margin'},
                // A string still sets only on success.
                'scratch.origin_wins':'scratch.origin_wins + 1'
            }
        },
        // Only on failure, so a pass leaves the Value alone.
        fumble:{
            label:'Fumble', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
            set:{outcome:{onFailure:'event.values.outcome.value - 10'}}
        },
        bad:{
            label:'Bad', skillCheck:{difficulty:'no-roll'},
            set:{outcome:{onSucces:'1'}, struck:{onSuccess:1}, noted:5, empty:{}}
        }
    });
    return route.fulfill({json});
});

const act = (page, actionId, roll) => page.evaluate(([actionId, roll]) => {
    const alpha = tc.model.getAgentModel('AL'),
        origin = tc.model.getEventModel('origin'),
        action = origin.getActionModels()[actionId],
        outcome = origin.getValueModels().outcome;
    tc.rng.queueRolls(roll);
    alpha.doAction(action);
    return {
        outcome:outcome.value, flipCount:outcome.flipCount,
        margin:tc.model.scratch.origin_margin, wins:tc.model.scratch.origin_wins,
        attempts:action.attemptCount, done:action.doneCount
    };
}, [actionId, roll]);

test('a set can give each result its own value, worked out once with margin, and a string still sets only on a pass', async ({page}) => {
    await routeScenarioWithSets(page);
    const problems = await startGame(page);
    
    expect(await act(page, 'toss', 100)).toEqual({outcome:-1, flipCount:1, margin:-400, wins:0, attempts:1, done:0});
    expect(await act(page, 'toss', 900)).toEqual({outcome:1, flipCount:2, margin:400, wins:1, attempts:2, done:1});
    // Worked out once: -10 from the outcome as it was, then left alone.
    expect(await act(page, 'fumble', 100)).toMatchObject({outcome:-9, flipCount:3});
    // Nothing to set on a pass.
    expect(await act(page, 'fumble', 900)).toMatchObject({outcome:-9, flipCount:3, done:1});
    
    // Per result sets are literals, so the Value survives a reload as it was.
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await page.evaluate(() => tc.model.getEventModel('origin').getValueModels().outcome.value)).toBe(-9);
    
    expect(problems.pageErrors).toEqual([]);
});

test('a set that is neither a string nor {onSuccess, onFailure} is left out, with a warning', async ({page}) => {
    await routeScenarioWithSets(page);
    const problems = await startGame(page),
        setKeys = await page.evaluate(() => Object.keys(tc.model.getEventModel('origin').getActionModels().bad.setObj));
    expect(setKeys).toEqual([]);
    expect(problems.warnings.filter(warning => warning.startsWith('Event origin action bad set '))).toEqual([
        expect.stringMatching(/^Event origin action bad set outcome has keys other than onSuccess and onFailure \(ignoring it\)/),
        expect.stringMatching(/^Event origin action bad set struck onSuccess and onFailure must be non-empty strings \(ignoring it\)/),
        expect.stringMatching(/^Event origin action bad set noted must be a string, or \{onSuccess, onFailure\} \(ignoring it\)/),
        expect.stringMatching(/^Event origin action bad set empty needs an onSuccess or onFailure \(ignoring it\)/)
    ]);
    expect(problems.pageErrors).toEqual([]);
});
