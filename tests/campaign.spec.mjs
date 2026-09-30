import {test, expect} from '@playwright/test';
import {startGame, setCausator, getCurrentOperationId} from './helpers.mjs';

/*  Plays the whole campaign by setting the Causators each mission needs, and checks that every 
    mission completes, shows its debrief and advances. */
test('plays through all three missions', async ({page}) => {
    // The Confirm and Ack dialogs are shared and stay in the page once created, so only
    // match what is currently visible. The Mission panel header also has its own "Next Mission"
    // link, which comes before the dialog's in the page.
    const problems = await startGame(page),
        visibleButton = name => page.getByRole('button', {name}).filter({visible:true}),
        missionComplete = page.getByText('Mission Complete', {exact:true}).filter({visible:true}),
        dialogNextMission = visibleButton('Next Mission ➜').last(),
        headerNextMission = visibleButton('Next Mission ➜').first(),
        dialogClose = visibleButton('X Close');
    
    // Mission 1: Titanic avoids the iceberg. Keep the locker key aboard and don't reverse.
    expect(await getCurrentOperationId(page)).toBe('titanic_noCollision');
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
    
    // Mission 2: Titanic still sinks, but everyone is saved.
    await setCausator(page, 'engine_order', 'countermandAstern', false);
    await setCausator(page, 'lifeboat_capacity', 'fullDavits', true);
    await setCausator(page, 'wireless_priority', 'clearBacklogEarlier', true);
    await expect(missionComplete).toBeVisible();
    await expect(page.getByText('almost everyone she carried lived', {exact:false})).toBeVisible();
    await dialogNextMission.click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('lusitania_nosink');
    
    // Mission 3: Lusitania escorted to safety. The last mission has no Next Mission button.
    await setCausator(page, 'admiralty_warnings', 'escortDispatched', true);
    await expect(missionComplete).toBeVisible();
    await expect(page.getByText('This concludes the current campaign.', {exact:false})).toBeVisible();
    await dialogClose.click();
    await expect(missionComplete).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});
