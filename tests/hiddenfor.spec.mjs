// An action's hiddenFor is a check expression on the agent: true hides the action from that
// agent only. Like available, it's worked out when Event Details is redrawn.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const routeOriginActions = page => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5'),
            origin = json.events.origin;
        origin.actions ??= {};
        Object.assign(origin.actions, {
            corpsOnly:{label:'Corps Only', skillCheck:{difficulty:'no-roll'}, hiddenFor:"agent.faction !== 'timecorps'"},
            // hidden still hides it from everyone.
            lockedOut:{label:'Locked Out', skillCheck:{difficulty:'no-roll'}, hidden:'true', hiddenFor:'false'}
        });
        return route.fulfill({json});
    }),

    readHidden = page => page.evaluate(() => {
        const actions = tc.model.getEventModel('origin').getActionModels(),
            result = {};
        for (const agentId of ['AL', 'BR']) {
            const agentModel = tc.model.getAgentModel(agentId);
            result[agentId] = ['corpsOnly', 'lockedOut'].filter(id => actions[id].isHiddenFor(agentModel));
        }
        return result;
    }),

    actionBtn = (page, label) => page.getByText(label, {exact:true}).filter({visible:true});

test('hiddenFor hides an action from one agent and not another', async ({page}) => {
    await routeOriginActions(page);
    const problems = await startGame(page);

    // Alpha is Time Corps; Bravo is unaligned.
    expect(await readHidden(page)).toEqual({AL:['lockedOut'], BR:['corpsOnly', 'lockedOut']});

    await page.evaluate(() => tc.model.getAgentModel('BR').setFaction('timecorps'));
    expect(await readHidden(page)).toEqual({AL:['lockedOut'], BR:['lockedOut']});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('Event Details leaves the action out for the agent it is hidden for', async ({page}) => {
    await routeOriginActions(page);
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.selectEventBox('origin'));

    await expect(actionBtn(page, 'Corps Only')).toBeVisible();
    await expect(actionBtn(page, 'Locked Out')).toHaveCount(0);

    // A change to the agent redraws Event Details.
    await page.evaluate(() => tc.model.getAgentModel('AL').setFaction('unaligned'));
    await expect(actionBtn(page, 'Corps Only')).toHaveCount(0);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a hiddenFor that is not a non-empty string is ignored, with a warning', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        (json.events.origin.actions ??= {}).bad = {label:'Bad', skillCheck:{difficulty:'no-roll'}, hiddenFor:true};
        return route.fulfill({json});
    });
    const problems = await startGame(page);

    expect(await page.evaluate(() => tc.model.getEventModel('origin').getActionModels().bad.getHiddenFor())).toBe(null);
    expect(problems.warnings.some(w => w.includes('action bad: hiddenFor must be a non-empty string'))).toBe(true);
});
