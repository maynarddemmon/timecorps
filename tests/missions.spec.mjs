// The Missions tab: a grid of the revealed missions, whose selection is the current mission.
// A mission is revealed when it becomes current, or when its "hidden" expression says so.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, showTab, dialogTitle, dismissMissionBrief, setCausator, getCurrentOperationId, reloadGame} from './helpers.mjs';

const grid = page => page.locator('.myt-Missions'),

    // The rows drawn, in order, as {id, name, state, progress}.
    readRows = page => page.evaluate(() => {
        const listView = tc.app.getMissionsView().gridWrapper.getGrid().getListView();
        return listView.getSubviews()
            .filter(row => row.model && row.visible)
            .sort((a, b) => a.y - b.y)
            .map(row => ({
                id:row.model.id,
                name:row.getRef('name').text,
                state:row.getRef('state').text,
                progress:row.getRef('progress').text
            }));
    }),
    selectedId = page => page.evaluate(() => tc.app.getMissionsView().gridWrapper.getGrid().selectedRowModel?.id ?? null),

    completeFirst = async page => {
        await setCausator(page, 'plan', 'prepared', true);
        await setCausator(page, 'lever', 'pulled', true);
    },

    // Third is revealed as soon as first is completed.
    routeThirdRevealedByFirst = page => page.route('**/tests/data/operations.json5', route => {
        const json = readTestData('operations.json5');
        json.operations.third.hidden = '!operations.first.successGranted';
        return route.fulfill({json});
    });

test('the missions tab lists the revealed missions with their state and progress, and the current one selected', async ({page}) => {
    const problems = await startGame(page);
    await showTab(page, 'Missions');
    for (const header of ['Name', 'State', 'Progress']) {
        await expect(grid(page).getByText(header, {exact:true})).toBeVisible();
    }
    // Second and third are hidden until they become current.
    await expect.poll(() => readRows(page)).toEqual([{id:'first', name:'First Mission', state:'current', progress:'0 / 1'}]);
    expect(await selectedId(page)).toBe('first');

    // Completing first and going on to second makes second current, and first sorts after it.
    await completeFirst(page);
    await expect.poll(() => readRows(page)).toEqual([{id:'first', name:'First Mission', state:'completed', progress:'1 / 1'}]);
    await page.getByRole('button', {name:/^Next Mission/}).filter({visible:true}).last().click();
    await dismissMissionBrief(page);
    await expect.poll(() => readRows(page)).toEqual([
        {id:'second', name:'Second Mission', state:'current', progress:'1 / 2'},
        {id:'first', name:'First Mission', state:'completed', progress:'1 / 1'}
    ]);
    expect(await selectedId(page)).toBe('second');

    // Selecting a row makes its mission current.
    await grid(page).getByText('First Mission', {exact:true}).click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('first');
    await expect.poll(async () => (await readRows(page)).map(row => row.state)).toEqual(['active', 'completed']);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a hidden expression reveals a mission, which sets it up, and it completes without being current', async ({page}) => {
    await routeThirdRevealedByFirst(page);
    const problems = await startGame(page);
    await showTab(page, 'Missions');
    await expect.poll(async () => (await readRows(page)).map(row => row.id)).toEqual(['first']);

    // Completing first reveals third, which opens its brief and awards its agent.
    await completeFirst(page);
    await expect(dialogTitle(page, 'Mission Brief')).toHaveText('Mission Brief : Third Mission');
    await dismissMissionBrief(page);
    await expect(dialogTitle(page, 'Mission Complete')).toHaveText('Mission Complete : First Mission');
    await page.getByRole('button', {name:/Close$/}).filter({visible:true}).click();
    expect(await page.evaluate(() => tc.model.getAgentModel('EC').playerControlled)).toBe(true);
    await expect.poll(() => readRows(page)).toEqual([
        {id:'third', name:'Third Mission', state:'active', progress:'0 / 1'},
        {id:'first', name:'First Mission', state:'completed', progress:'1 / 1'}
    ]);
    expect(await getCurrentOperationId(page)).toBe('first');

    // Third is revealed for good, and stays so after a reload.
    await reloadGame(page);
    await showTab(page, 'Missions');
    await expect.poll(async () => (await readRows(page)).map(row => [row.id, row.state])).toEqual([['third', 'active'], ['first', 'completed']]);

    // Meeting third's objectives completes it, though first is still current.
    expect(await getCurrentOperationId(page)).toBe('first');
    await setCausator(page, 'backlog', 'cleared', true);
    await expect(dialogTitle(page, 'Mission Complete')).toHaveText('Mission Complete : Third Mission');
    await expect.poll(async () => (await readRows(page)).map(row => [row.id, row.state])).toEqual([['first', 'completed'], ['third', 'completed']]);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
