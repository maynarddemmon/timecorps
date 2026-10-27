// The Missions tab: a grid of the revealed missions, whose selection is the current mission.
// A mission is revealed when the one before it completes, or when its "hidden" expression 
// says so, and is available until the player starts it.
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
    readStates = async page => (await readRows(page)).map(row => [row.id, row.state]),
    
    visibleButton = (page, name) => page.getByRole('button', {name, exact:true}).filter({visible:true}),
    acceptBtn = page => visibleButton(page, 'Accept Mission'),
    startBtn = page => visibleButton(page, 'Start Mission ➜'),
    isPlayerControlled = (page, agentId) => page.evaluate(agentId => tc.model.getAgentModel(agentId).playerControlled, agentId),

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
    // Second and third are hidden until first completes.
    await expect.poll(() => readRows(page)).toEqual([{id:'first', name:'First Mission', state:'current', progress:'0 / 1'}]);
    expect(await selectedId(page)).toBe('first');

    // Completing first makes second available, and first sorts after it.
    await completeFirst(page);
    await expect.poll(() => readRows(page)).toEqual([
        {id:'second', name:'Second Mission', state:'available', progress:'1 / 2'},
        {id:'first', name:'First Mission', state:'completed', progress:'1 / 1'}
    ]);

    // The debrief's Next Mission offers second with its brief, and closing the brief 
    // declines it for now.
    await visibleButton(page, 'Next Mission ➜').click();
    await expect(dialogTitle(page, 'Mission Brief')).toHaveText('Mission Brief : Second Mission');
    await expect(acceptBtn(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Mission Brief')).toHaveCount(0);
    expect(await getCurrentOperationId(page)).toBe('first');
    expect(await readStates(page)).toEqual([['second', 'available'], ['first', 'completed']]);

    // Selecting it makes it current, but it stays available until the Mission panel's 
    // Start Mission starts it, which opens its brief to acknowledge.
    await expect(startBtn(page)).toHaveCount(0);
    await grid(page).getByText('Second Mission', {exact:true}).click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('second');
    expect(await readStates(page)).toEqual([['second', 'available'], ['first', 'completed']]);
    await startBtn(page).click();
    await dismissMissionBrief(page);
    await expect(startBtn(page)).toHaveCount(0);
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

test('a hidden expression offers a mission, which is only set up, and completes, once accepted', async ({page}) => {
    await routeThirdRevealedByFirst(page);
    const problems = await startGame(page);
    await showTab(page, 'Missions');
    await expect.poll(async () => (await readRows(page)).map(row => row.id)).toEqual(['first']);

    // Completing first reveals third, which offers it with its brief. Declining leaves it 
    // available, without its setup's award.
    await completeFirst(page);
    await expect(dialogTitle(page, 'Mission Brief')).toHaveText('Mission Brief : Third Mission');
    await expect(acceptBtn(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Mission Complete')).toHaveText('Mission Complete : First Mission');
    await page.getByRole('button', {name:/Close$/}).filter({visible:true}).click();
    expect(await isPlayerControlled(page, 'EC')).toBe(false);
    await expect.poll(() => readRows(page)).toEqual([
        {id:'second', name:'Second Mission', state:'available', progress:'1 / 2'},
        {id:'third', name:'Third Mission', state:'available', progress:'0 / 1'},
        {id:'first', name:'First Mission', state:'completed', progress:'1 / 1'}
    ]);
    expect(await getCurrentOperationId(page)).toBe('first');

    // Third is revealed for good, and isn't offered again after a reload.
    await reloadGame(page);
    await page.waitForTimeout(250);
    await expect(dialogTitle(page, 'Mission Brief')).toHaveCount(0);
    await showTab(page, 'Missions');
    await expect.poll(() => readStates(page)).toEqual([['second', 'available'], ['third', 'available'], ['first', 'completed']]);

    // Meeting third's objectives doesn't complete it while it's available.
    await setCausator(page, 'backlog', 'cleared', true);
    await page.waitForTimeout(250);
    await expect(dialogTitle(page, 'Mission Complete')).toHaveCount(0);

    // Starting it awards its agent, and it completes at once, since its objectives are met.
    await grid(page).getByText('Third Mission', {exact:true}).click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('third');
    await startBtn(page).click();
    await dismissMissionBrief(page);
    expect(await isPlayerControlled(page, 'EC')).toBe(true);
    await expect(dialogTitle(page, 'Mission Complete')).toHaveText('Mission Complete : Third Mission');
    await expect.poll(() => readStates(page)).toEqual([['second', 'available'], ['first', 'completed'], ['third', 'completed']]);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('clicking the current mission opens its brief, and deselecting it leaves none current, which a reload keeps', async ({page}) => {
    const problems = await startGame(page);
    const noMissionText = page.getByText('Select a mission in the Missions tab to see more about it here.', {exact:true});
    const currentId = () => page.evaluate(() => tc.model.getCurrentOperation()?.id ?? null);
    await showTab(page, 'Missions');
    await expect(noMissionText).toBeHidden();

    // Clicking the selected row opens its brief, and once that's closed, Escape deselects 
    // the row.
    await grid(page).getByText('First Mission', {exact:true}).click();
    await expect(dialogTitle(page, 'Mission Brief')).toHaveText('Mission Brief : First Mission');
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Mission Brief')).toHaveCount(0);
    expect(await currentId()).toBe('first');
    await page.keyboard.press('Escape');
    await expect.poll(currentId).toBeNull();
    await expect(noMissionText).toBeVisible();
    await expect.poll(async () => (await readRows(page)).map(row => row.state)).toEqual(['active']);
    expect(await selectedId(page)).toBeNull();

    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await currentId()).toBeNull();
    await expect(noMissionText).toBeVisible();

    // Selecting it again makes it current.
    await showTab(page, 'Missions');
    await grid(page).getByText('First Mission', {exact:true}).click();
    await expect.poll(currentId).toBe('first');
    await expect(noMissionText).toBeHidden();

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
