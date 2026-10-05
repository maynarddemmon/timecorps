import {test, expect} from '@playwright/test';
import {startGame, setCausator, getCurrentOperationId, dismissMissionBrief, dialogTitle} from './helpers.mjs';

/*  Plays the whole campaign by setting the Causators each mission needs, and checks that every 
    mission opens with its brief, completes, shows its debrief and advances. */
test('plays through all three missions', async ({page}) => {
    // The Confirm and Ack dialogs are shared and stay in the page once created, so only
    // match what is currently visible. The Mission panel header also has its own "Next Mission"
    // link, which comes before the dialog's in the page.
    const problems = await startGame(page, {dismissBrief:false}),
        visibleButton = name => page.getByRole('button', {name}).filter({visible:true}),
        missionComplete = dialogTitle(page, 'Mission Complete'),
        dialogNextMission = visibleButton('Next Mission ➜').last(),
        headerNextMission = visibleButton('Next Mission ➜').first(),
        dialogClose = visibleButton('X Close'),
        
        // Text in the Mission Brief's field notes.
        briefText = text => page.locator('.myt-MissionBrief').getByText(text, {exact:false});
    
    // Mission 1: Titanic avoids the iceberg. Keep the locker key aboard and don't reverse.
    expect(await getCurrentOperationId(page)).toBe('titanic_noCollision');
    await expect(briefText('Prevent the Titanic from colliding with the iceberg')).toBeVisible();
    await dismissMissionBrief(page);
    await setCausator(page, 'roster_reshuffle', 'preventReshuffle', true);
    await setCausator(page, 'engine_order', 'countermandAstern', true);
    await expect(missionComplete).toBeVisible();
    await expect(page.getByText('The locker key never left the ship', {exact:false})).toBeVisible();
    
    // Closing the dialog leaves the Mission panel's link as the way forward.
    await dialogClose.click();
    await expect(missionComplete).toHaveCount(0);
    expect(await getCurrentOperationId(page)).toBe('titanic_noCollision');
    await headerNextMission.click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('titanic_rescued');
    await expect(briefText('the massive loss of life must be prevented')).toBeVisible();
    await dismissMissionBrief(page);
    
    // Mission 2: Titanic still sinks, but everyone is saved.
    await setCausator(page, 'engine_order', 'countermandAstern', false);
    await setCausator(page, 'lifeboat_capacity', 'fullDavits', true);
    await setCausator(page, 'wireless_priority', 'clearBacklogEarlier', true);
    await expect(missionComplete).toBeVisible();
    await expect(page.getByText('almost everyone she carried lived', {exact:false})).toBeVisible();
    await dialogNextMission.click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('lusitania_nosink');
    await expect(briefText('Prevent the sinking of the Lusitania.')).toBeVisible();
    await dismissMissionBrief(page);
    
    // Mission 3: Lusitania escorted to safety. The last mission has no Next Mission button.
    await setCausator(page, 'admiralty_warnings', 'escortDispatched', true);
    await expect(missionComplete).toBeVisible();
    await expect(page.getByText('This concludes the current campaign.', {exact:false})).toBeVisible();
    await dialogClose.click();
    await expect(missionComplete).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});
