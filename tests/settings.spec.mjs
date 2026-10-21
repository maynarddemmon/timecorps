import {test, expect} from '@playwright/test';
import {startGame, getCurrentOperationId, reloadGame, clickAndReload, dialogTitle} from './helpers.mjs';

const LABEL = 'Save on mission completion',
    
    visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true}),
    visibleText = (page, text) => page.getByText(text, {exact:false}).filter({visible:true}),
    readSave = page => page.evaluate(() => JSON.parse(localStorage.getItem('tc.save'))),
    getSetting = page => page.evaluate(() => tc.settings.get(tc.SETTING_SAVE_ON_OPERATION_COMPLETION)),
    
    // Completes the first mission by setting its Causators the way Actions do.
    completeFirstMission = page => page.evaluate(() => {
        const m = tc.model;
        m.getEventModel('plan').getValueModels().prepared.setValue('true', false);
        m.getEventModel('lever').getValueModels().pulled.setValue('true', false);
    }),
    
    turnSettingOff = async page => {
        await visibleButton(page, '⚙').click();
        await expect(visibleText(page, 'Settings')).toBeVisible();
        await visibleText(page, LABEL).click();
        await page.keyboard.press('Escape');
        await expect(visibleText(page, LABEL)).toHaveCount(0);
    };

test('completing a mission saves by default', async ({page}) => {
    const problems = await startGame(page);
    expect(await getSetting(page)).toBe(true);
    expect(await readSave(page)).toBeNull();
    
    await completeFirstMission(page);
    await expect(visibleText(page, 'Your progress has been saved.')).toBeVisible();
    expect((await readSave(page)).data.operations.first.successGranted).toBe(true);
    await expect(page.getByTitle(/^Last saved /)).toBeVisible();
    
    // The save restores to the completed mission without completing it again.
    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('first');
    await page.waitForTimeout(250);
    await expect(dialogTitle(page, 'Mission Complete')).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('turning the setting off stops the save and is remembered', async ({page}) => {
    const problems = await startGame(page);
    
    await turnSettingOff(page);
    expect(await getSetting(page)).toBe(false);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tc.settings')))).toMatchObject({saveOnOperationCompletion:false});
    
    await completeFirstMission(page);
    await expect(dialogTitle(page, 'Mission Complete')).toBeVisible();
    await expect(visibleText(page, 'Your progress has been saved.')).toHaveCount(0);
    expect(await readSave(page)).toBeNull();
    
    // Nothing was saved, so the reload starts a fresh campaign.
    await reloadGame(page, {briefExpected:true});
    expect(await getSetting(page)).toBe(false);
    
    // Turning it back on stores nothing for it, since on is the default.
    await visibleButton(page, '⚙').click();
    await visibleText(page, LABEL).click();
    expect(await getSetting(page)).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tc.settings'))?.saveOnOperationCompletion)).toBeUndefined();
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('restarting the campaign keeps settings', async ({page}) => {
    const problems = await startGame(page);
    
    await turnSettingOff(page);
    await visibleButton(page, '⌫').click();
    await clickAndReload(page, visibleButton(page, /Confirm/), {briefExpected:true});
    expect(await getSetting(page)).toBe(false);
    
    expect(problems.pageErrors).toEqual([]);
});

test('the selected agent\'s visited borders and history can each be turned off, and back on, at once', async ({page}) => {
    const problems = await startGame(page);
    const readTimeline = () => page.evaluate(() => {
            const timeline = tc.app.getTimelineView();
            return {
                borders:Object.values(timeline.boxesByEventId).filter(box => box.visited).length,
                arrows:timeline.flowLayer.getSplines().filter(spline => spline.splineId.startsWith('visit-')).length
            };
        }),
        toggle = async label => {
            await visibleButton(page, '⚙').click();
            await visibleText(page, label).click();
            await page.keyboard.press('Escape');
            await expect(visibleText(page, label)).toHaveCount(0);
        };
    
    expect(await page.evaluate(() => [tc.SETTING_SHOW_VISITED_BORDERS, tc.SETTING_SHOW_AGENT_HISTORY].map(id => tc.settings.get(id)))).toEqual([true, true]);
    await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL');
        tc.app.selectAgentRow('AL');
        alpha.doFollowExit(m.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'));
    });
    await expect.poll(readTimeline).toEqual({borders:2, arrows:1});
    
    await toggle('Show visited borders');
    await expect.poll(readTimeline).toEqual({borders:0, arrows:1});
    await toggle('Show agent history');
    await expect.poll(readTimeline).toEqual({borders:0, arrows:0});
    
    // Both stay off after a reload, which starts a fresh campaign, and come back when turned on.
    await reloadGame(page, {briefExpected:true});
    await page.evaluate(() => tc.app.selectAgentRow('AL'));
    await page.waitForTimeout(300);
    expect(await readTimeline()).toEqual({borders:0, arrows:0});
    await toggle('Show visited borders');
    await toggle('Show agent history');
    await expect.poll(readTimeline).toEqual({borders:1, arrows:0});
    
    expect(problems.pageErrors).toEqual([]);
});
