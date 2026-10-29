// IDs are letters, digits and _, not starting with a digit, so expressions can name them,
// e.g. events.<id>.values.<id>. Anything with another ID is warned about and skipped.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

test('anything whose ID isn\'t letters, digits and _, or starts with a digit, is warned about and skipped', async ({page}) => {
    await Promise.all([
        page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5');
            json.locations['dock.east'] = {...json.locations.deck};
            json.events['2nd_plan'] = {...json.events.plan, location:'office', start:'1899-01-01T00:00:00', values:{}, actions:{}, exits:[]};
            json.events.plan.values['bad-value'] = {name:'Bad', value:'true'};
            json.events.plan.actions['bad action'] = {label:'Bad', skillCheck:{difficulty:'no-roll'}};
            return route.fulfill({json});
        }),
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5');
            json.scratch = {...json.scratch, 'bad.entry':0};
            const [objectiveId] = Object.keys(json.operations.first.objectives);
            json.operations.first.objectives['9lives'] = json.operations.first.objectives[objectiveId];
            json.operations.first.onSetup.prompt = 'not-a-prompt';
            return route.fulfill({json});
        }),
        page.route('**/tests/data/agents.json5', route => {
            const json = readTestData('agents.json5');
            json.agents.AL.skills = {...json.agents.AL.skills, 'sneak.y':5};
            return route.fulfill({json});
        })
    ]);
    const problems = await startGame(page);
    
    const RULE = 'id must be letters, digits and _, not starting with a digit (skipping it):';
    expect(problems.warnings).toEqual(expect.arrayContaining([
        'locations ' + RULE + ' dock.east',
        'events ' + RULE + ' 2nd_plan',
        'Event plan value ' + RULE + ' bad-value',
        'Event plan action ' + RULE + ' bad action',
        'Scratch entry ' + RULE + ' bad.entry',
        'Operation first objective ' + RULE + ' 9lives',
        'Agent AL skill ' + RULE + ' sneak.y',
        'Operation first onSetup prompt must be like an ID (ignoring it): not-a-prompt'
    ]));
    
    // None of them were loaded.
    expect(await page.evaluate(() => {
        const m = tc.model,
            plan = m.getEventModel('plan');
        return [
            m.getLocation('dock.east') ?? null,
            m.getEventModel('2nd_plan') ?? null,
            plan.getValueModels()['bad-value'] ?? null,
            plan.getActionModels()['bad action'] ?? null,
            m.isScratchName('bad.entry'),
            m.getOperationModel('first').getObjectiveModels()['9lives'] ?? null,
            'sneak.y' in m.getAgentModel('AL').getSkills()
        ];
    })).toEqual([null, null, null, null, false, null, false]);
    expect(problems.pageErrors).toEqual([]);
});
