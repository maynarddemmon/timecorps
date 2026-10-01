import {test, expect} from '@playwright/test';
import {startGame, getCurrentOperationId} from './helpers.mjs';

const LABEL = 'Save on mission completion',
    
    visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true}),
    visibleText = (page, text) => page.getByText(text, {exact:false}).filter({visible:true}),
    readSave = page => page.evaluate(() => JSON.parse(localStorage.getItem('tc.save'))),
    getSetting = page => page.evaluate(() => tc.settings.get(tc.SETTING_SAVE_ON_OPERATION_COMPLETION)),
    
    // Completes the first mission by setting its Causators the way Actions do.
    completeFirstMission = page => page.evaluate(() => {
        const m = tc.model;
        m.getEventModel('roster_reshuffle').getValueModels().preventReshuffle.setValue('true', false);
        m.getEventModel('engine_order').getValueModels().countermandAstern.setValue('true', false);
    }),
    
    reloadGame = async page => {
        await page.reload();
        await page.waitForFunction(() =>
            window.tc?.model?.getCurrentOperation?.() != null &&
            window.tc?.app?.getTimelineView?.()?.timelineReady === true
        );
    },
    
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
    expect((await readSave(page)).data.operations.titanic_noCollision.successGranted).toBe(true);
    await expect(page.getByTitle(/^Last saved /)).toBeVisible();
    
    // The save restores to the completed mission without completing it again.
    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('titanic_noCollision');
    await page.waitForTimeout(250);
    await expect(visibleText(page, 'Mission Complete')).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('turning the setting off stops the save and is remembered', async ({page}) => {
    const problems = await startGame(page);
    
    await turnSettingOff(page);
    expect(await getSetting(page)).toBe(false);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tc.settings')))).toEqual({saveOnOperationCompletion:false});
    
    await completeFirstMission(page);
    await expect(visibleText(page, 'Mission Complete')).toBeVisible();
    await expect(visibleText(page, 'Your progress has been saved.')).toHaveCount(0);
    expect(await readSave(page)).toBeNull();
    
    await reloadGame(page);
    expect(await getSetting(page)).toBe(false);
    
    // Turning it back on stores nothing, since on is the default.
    await visibleButton(page, '⚙').click();
    await visibleText(page, LABEL).click();
    expect(await getSetting(page)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('tc.settings'))).toBeNull();
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('restarting the campaign keeps settings', async ({page}) => {
    const problems = await startGame(page);
    
    await turnSettingOff(page);
    await visibleButton(page, '⌫').click();
    await Promise.all([page.waitForEvent('load'), visibleButton(page, /Confirm/).click()]);
    await page.waitForFunction(() => window.tc?.app?.getTimelineView?.()?.timelineReady === true);
    expect(await getSetting(page)).toBe(false);
    
    expect(problems.pageErrors).toEqual([]);
});
