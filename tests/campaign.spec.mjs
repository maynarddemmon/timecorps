import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {startGame, setCausator, getCurrentOperationId, dismissMissionBrief, acceptMission, dismissAgentDossier, dialogTitle, showTab, ROOT, TEST_DATA_DIR, briefTitle} from './helpers.mjs';

/*  Plays the whole campaign by setting the Causators each mission needs, and checks that every
    mission opens with its brief, completes, shows its debrief and advances, from the Missions 
    tab or from the debrief. */
test('plays through all three missions', async ({page}) => {
    // The Confirm and Ack dialogs are shared and stay in the page once created, so only
    // match what is currently visible.
    const problems = await startGame(page, {dismissBrief:false}),
        visibleButton = name => page.getByRole('button', {name}).filter({visible:true}),
        missionComplete = dialogTitle(page, 'Mission Complete'),
        dialogNextMission = visibleButton('Next Mission ➜'),
        startMission = visibleButton('Start Mission ➜'),
        dialogClose = visibleButton('X Close'),

        // The first line of a mission's briefing file, shown in its Mission Brief.
        briefHeading = operationId => page.locator('.myt-MissionBrief').getByText(
            fs.readFileSync(path.join(ROOT, TEST_DATA_DIR, 'mission', operationId + '.txt'), 'utf8').split(/\r?\n/)[0], {exact:false}
        );

    // Mission 1: origin not struck. Prepare the plan, which reaches the signal, and pull the lever.
    expect(await getCurrentOperationId(page)).toBe('first');
    await expect(briefHeading('first')).toBeVisible();
    await dismissMissionBrief(page);
    await dismissAgentDossier(page, 'Alpha'); // Given to the player by the mission's setup.
    await setCausator(page, 'plan', 'prepared', true);
    await setCausator(page, 'lever', 'pulled', true);
    await expect(missionComplete).toBeVisible();

    // The debrief includes the phrase that's shown because the plan was prepared.
    await expect(page.getByText('The plan was prepared.', {exact:false})).toBeVisible();

    // Closing the dialog leaves the next mission available in the Missions tab, where
    // selecting it shows the Mission panel's link that starts it.
    await dialogClose.click();
    await expect(missionComplete).toHaveCount(0);
    expect(await getCurrentOperationId(page)).toBe('first');
    await showTab(page, 'Missions');
    await page.locator('.myt-Missions').getByText('Second Mission', {exact:true}).click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('second');
    await startMission.click();
    await expect(briefHeading('second')).toBeVisible();
    await dismissMissionBrief(page);
    await expect(startMission).toHaveCount(0);

    // Mission 2: struck, but nobody lost.
    await setCausator(page, 'lever', 'pulled', false);
    await setCausator(page, 'boats', 'enough', true);

    // Delta and Echo are revealed by completing mission 2. Their dossiers open at once, while
    // Mission Complete waits for the timeline to finish animating.
    await dismissAgentDossier(page, 'Delta');
    await dismissAgentDossier(page, 'Echo');
    await expect(missionComplete).toBeVisible();
    await expect(page.getByText('The second mission is complete.', {exact:false})).toBeVisible();
    // The debrief's link offers mission 3 with its brief, which accepting starts.
    await dialogNextMission.click();
    await expect(briefHeading('third')).toBeVisible();
    await acceptMission(page);
    await expect.poll(() => getCurrentOperationId(page)).toBe('third');

    // Mission 3's setup gives the player Echo, who is already visible, so no dossier, and
    // its brief isn't opened again.
    await page.waitForTimeout(300);
    await expect(briefTitle(page, 'dossier')).toHaveCount(0);
    await expect(briefTitle(page, 'mission')).toHaveCount(0);
    expect(await page.evaluate(() => tc.model.getAgentModel('EC').isPlayerControlled())).toBe(true);

    // Mission 3: the last mission has no Next Mission button.
    await setCausator(page, 'backlog', 'cleared', true);
    await expect(missionComplete).toBeVisible();
    await expect(page.getByText('This concludes the current campaign.', {exact:false})).toBeVisible();
    await expect(dialogNextMission).toHaveCount(0);
    await dialogClose.click();
    await expect(missionComplete).toHaveCount(0);

    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});
