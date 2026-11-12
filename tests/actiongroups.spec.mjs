// Action groups: an action's "group" puts it on a line of its own in an agent's row in 
// Event Details, led by the group's label. Lines go by order: the ungrouped actions, led by 
// the actions the agent has left, are 0, a group with a negative order comes before them, 
// and one with a positive order after.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const noRoll = (label, group) => ({label, group, skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null}}),
    
    routeGroups = (page, actionGroups, actions) => Promise.all([
        page.route('**/tests/data/init.json5', route => {
            const json = readTestData('init.json5');
            json.actionGroups = actionGroups;
            return route.fulfill({json});
        }),
        page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5');
            Object.assign(json.events.origin.actions, actions);
            return route.fulfill({json});
        })
    ]),
    
    // The text of each line of Alpha's actions at origin, in order, then the exits line.
    readLines = page => page.evaluate(() => {
        tc.app.selectEventBox('origin');
        const agentRow = [...document.querySelectorAll('.myt-EventDetails .myt-AgentRow')].find(row => row.textContent.includes('Alpha'));
        // The lines flow as text, each ended by a line break, in the view that holds the 
        // action buttons.
        const linesView = agentRow.querySelector('.action').parentElement;
        return linesView.innerText.replace(/\u00A0/g, ' ').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    });

test('grouped actions go on lines of their own, led by their labels, in order around the ungrouped ones', async ({page}) => {
    await routeGroups(page, {
        early:{label:'Early', order:-1},
        late:{label:'Late', order:2},
        later:{label:'Later', order:5},
        empty:{label:'Empty', order:1}
    }, {
        warmUp:noRoll('Warm Up', 'early'),
        tidy:noRoll('Tidy', 'late'),
        sweep:noRoll('Sweep', 'late'),
        rest:{...noRoll('Wind Down', 'later')},
        ghost:{...noRoll('Ghost', 'empty'), hidden:'true'}
    });
    const problems = await startGame(page);
    
    await expect.poll(() => readLines(page)).toEqual([
        'Early · Warm Up',
        expect.stringMatching(/^Actions: \d+ · Investigate/),
        'Late · Tidy · Sweep',
        'Later · Wind Down',
        expect.stringMatching(/^Exits:/)
    ]);
    
    // A grouped action is taken like any other.
    const before = await page.evaluate(() => tc.model.getEventModel('origin').getActionModels().tidy.attemptCount);
    await page.locator('.myt-EventDetails').getByRole('button', {name:'Tidy', exact:true}).click();
    await expect.poll(() => page.evaluate(() => tc.model.getEventModel('origin').getActionModels().tidy.attemptCount)).toBe(before + 1);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('problems with action groups are warned about, and an action naming no group shows with the ungrouped ones', async ({page}) => {
    await routeGroups(page, {
        zero:{label:'Zero', order:0},
        unlabeled:{order:3, color:'red'},
        unordered:{label:'Unordered'},
        'bad-id':{label:'Bad', order:1},
        notAnObject:5
    }, {
        flat:noRoll('Flat', 'zero'),
        stray:noRoll('Stray', 'nowhere'),
        odd:noRoll('Odd', 7)
    });
    const problems = await startGame(page);
    
    expect(problems.warnings).toEqual(expect.arrayContaining([
        'Action group zero order is 0, the ungrouped actions\' order, so it comes right after them. Use a negative order to come before them or a positive one to come after.',
        'Action group unlabeled has keys other than label and order (ignoring them): color',
        'Action group unlabeled label must be a non-empty string (using its id): undefined',
        'Action group unordered order must be a number (using 0): undefined',
        'Action group id must be letters, digits and _, not starting with a digit (skipping it): bad-id',
        'Action group notAnObject must be an object with a label and an order (ignoring it): 5',
        'Event origin action odd: group must be the id of an action group (ignoring it): 7',
        'Event origin action stray group names no action group (showing it with the ungrouped actions): nowhere'
    ]));
    
    // A group with order 0 comes right after the ungrouped line, and the stray and odd actions 
    // are on it.
    await expect.poll(() => readLines(page)).toEqual([
        expect.stringMatching(/^Actions: \d+ · Investigate · Stray · Odd$/),
        'Zero · Flat',
        expect.stringMatching(/^Exits:/)
    ]);
    expect(problems.pageErrors).toEqual([]);
});
