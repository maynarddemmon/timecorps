import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

test('loads with no errors or warnings', async ({page}) => {
    const problems = await startGame(page);
    
    // Give debounced work (constraint settling, layout) a moment to finish.
    await page.waitForTimeout(500);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('passes the startup data validation', async ({page}) => {
    await startGame(page);
    const valid = await page.evaluate(() => 
        tc.model.validateAllEventDependencies() && tc.model.validateNoLocationOverlaps()
    );
    expect(valid).toBe(true);
});

test('shows the Field Manual on the first visit only', async ({page}) => {
    await startGame(page, {skipHelp:false});
    await expect(page.getByText('Time Corps Field Manual')).toBeVisible();
    
    await page.reload();
    await page.waitForFunction(() => window.tc?.app?.getTimelineView?.()?.timelineReady === true);
    await page.waitForTimeout(500);
    await expect(page.getByText('Time Corps Field Manual')).toBeHidden();
});
