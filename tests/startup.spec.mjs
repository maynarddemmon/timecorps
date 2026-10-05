import {test, expect} from '@playwright/test';
import {startGame, dismissMissionBrief, dismissAgentDossier, reloadGame, dialogTitle} from './helpers.mjs';

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

/*  On a first visit the Field Manual opens before the first Mission Brief, which waits behind 
    it. Later visits go straight to the brief. */
test('shows the Field Manual on the first visit only, before the Mission Brief', async ({page}) => {
    const manualTitle = page.getByText('Time Corps Field Manual', {exact:true}).filter({visible:true});
    
    await startGame(page, {skipHelp:false, dismissBrief:false});
    await expect(manualTitle).toBeVisible();
    await expect(dialogTitle(page, 'Mission Brief')).toHaveCount(0);
    
    await page.getByRole('button', {name:'X Close'}).filter({visible:true}).click();
    await expect(manualTitle).toHaveCount(0);
    await dismissMissionBrief(page);
    await dismissAgentDossier(page, 'Vasquez');
    
    await reloadGame(page, {briefExpected:true});
    await expect(manualTitle).toHaveCount(0);
});

/*  The timeline lays out on a debounce, so the operation's initial selection can be requested 
    before its EventBox exists. It must still end up selected. */
test('selects the initial operation event', async ({page}) => {
    const problems = await startGame(page);
    await expect.poll(() => page.evaluate(() => tc.app.getTimelineView().getSelectedEventBox()?.model.id ?? null)).toBe('collision');
    expect(problems.pageErrors).toEqual([]);
});
