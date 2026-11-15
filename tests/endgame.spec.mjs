// When the game has effectively ended, the End Game Brief says why and how the game went, and
// offers a restart, or a reload of the last save when there is one.
import {test, expect} from '@playwright/test';
import {startGame, dialogTitle, dismissAgentDossier, clickAndReload} from './helpers.mjs';

const endGameBrief = page => page.locator('.myt-EndGameBrief'),

    reloadBtn = page => endGameBrief(page).getByRole('button', {name:'Reload Last Save', exact:true}),
    restartBtn = page => endGameBrief(page).getByRole('button', {name:'Restart Campaign', exact:true}),

    /*  Kills Alpha, the only agent, on the exit from the origin, then dismisses the death
        notice and the dossier, which brings up the End Game Brief. */
    loseTheRoster = async page => {
        await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                exitModel = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath');
            exitModel.setAdjustments({'agent.health':{difficulty:1000, check:'0', onFailure:'-500'}});
            tc.rng.queueRolls(0);
            alpha.doFollowExit(exitModel);
        });
        await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
        await dismissAgentDossier(page, 'Alpha');
        await expect(endGameBrief(page)).toBeVisible();
    },

    /*  The metrics as {label:value}. */
    readMetrics = page => page.evaluate(() => {
        const metrics = {};
        for (const row of document.querySelectorAll('.myt-EndGameBrief .myt-MetricRow')) {
            const [label, value] = [...row.children].map(child => child.textContent);
            metrics[label] = value;
        }
        return metrics;
    });

test('says why the game ended and how it went, and without a save only offers a restart', async ({page}) => {
    const problems = await startGame(page);

    // Some of the timeline's state to report: two deploys (time jumps) and some attestation.
    await page.evaluate(() => {
        tc.model.setScore(1234);
        tc.model.getEventModel('origin').attestation.setValue(20);
        const alpha = tc.model.getAgentModel('AL');
        alpha.doDeployToEvent(tc.model.getEventModel('aftermath'));
        alpha.doDeployToEvent(tc.model.getEventModel('origin'));
    });
    const expected = await page.evaluate(() => {
        const shown = tc.model.getEventModelsAsList(eventModel => eventModel.isNotHidden() && !eventModel.isHub()),
            attestation = shown.reduce((sum, eventModel) => sum + eventModel.attestation.value, 0),
            attestationMax = shown.reduce((sum, eventModel) => sum + eventModel.attestation.max, 0),
            missions = tc.model.getOperationModelsAsList(operationModel => operationModel.isNotHidden());
        return {
            events:String(shown.length),
            attestation:String(attestation),
            percent:Math.round(100*attestation/attestationMax) + '%',
            missions:'0 of ' + missions.length
        };
    });

    await loseTheRoster(page);
    await expect(dialogTitle(page, 'Agent Roster Depleted')).toBeVisible();
    await expect(endGameBrief(page)).toContainText('You no longer have any agents under your control.');

    // The score as it stands, since the revisit's paradox costs some.
    const metrics = await readMetrics(page),
        score = await page.evaluate(() => tc.model.score);
    expect(score).toBeGreaterThan(0);
    expect(metrics).toMatchObject({
        'Score':String(score),
        'Missions Completed':expected.missions,
        'Events Shown':expected.events,
        'Total Attestation':expected.attestation,
        'Attestation':expected.percent,
        'Flooded Events':'0',
        'Agents Lost':'1 died · 0 devoured',
        'Time Jumps':'2'
    });

    // No save, so no reload. Escape doesn't close it.
    await expect(reloadBtn(page)).toBeHidden();
    await expect(restartBtn(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(endGameBrief(page)).toBeVisible();

    // Restart starts a new campaign: Alpha is alive again, and the restart is in the legacy.
    await clickAndReload(page, restartBtn(page), {briefExpected:true});
    expect(await page.evaluate(() => ({
        dead:tc.model.getAgentModel('AL').isDead(),
        score:tc.model.score
    }))).toEqual({dead:false, score:0});
    await expect(endGameBrief(page)).toHaveCount(0);

    expect(problems.pageErrors).toEqual([]);
});

test('with a save, reload goes back to it, and Enter chooses it', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        tc.model.setScore(500);
        tc.getPersistenceManager().save();
        tc.model.setScore(900);
    });

    await loseTheRoster(page);
    await expect(reloadBtn(page)).toBeVisible();
    await expect(restartBtn(page)).toBeVisible();
    expect((await readMetrics(page))['Score']).toBe('900');

    // Enter reloads, back to the save: Alpha alive, the score as saved.
    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
    await page.waitForFunction(() => window.tc?.isAppReady?.() === true);
    expect(await page.evaluate(() => ({
        dead:tc.model.getAgentModel('AL').isDead(),
        score:tc.model.score
    }))).toEqual({dead:false, score:500});

    expect(problems.pageErrors).toEqual([]);
});

test('reload, by its button, goes back to the save', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => tc.getPersistenceManager().save());

    await loseTheRoster(page);
    await clickAndReload(page, reloadBtn(page));
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').isDead())).toBe(false);
    await expect(endGameBrief(page)).toHaveCount(0);

    expect(problems.pageErrors).toEqual([]);
});

test('a destabilized timeline ends the game the same way', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.notifyTimelineParadoxExceeded());
    await expect(dialogTitle(page, 'Timeline Destabilized')).toBeVisible();
    await expect(endGameBrief(page)).toContainText('“Otomo” threshold');
    await expect(restartBtn(page)).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
});

test('resigning, after confirming, ends the game with only a restart, even with a save', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => tc.getPersistenceManager().save());
    
    const resignBtn = page.getByRole('button', {name:'⌫', exact:true}).filter({visible:true});
    expect(await resignBtn.getAttribute('title')).toBe('Resign');
    
    // Cancelled, the game goes on.
    await resignBtn.click();
    await expect(dialogTitle(page, 'Resign')).toBeVisible();
    await page.getByRole('button', {name:/Cancel/}).filter({visible:true}).click();
    await expect(endGameBrief(page)).toHaveCount(0);
    
    await resignBtn.click();
    await page.getByRole('button', {name:/Confirm/}).filter({visible:true}).click();
    await expect(dialogTitle(page, 'Campaign Resigned')).toBeVisible();
    await expect(endGameBrief(page)).toContainText('You have resigned this campaign.');
    await expect(reloadBtn(page)).toBeHidden();
    await expect(restartBtn(page)).toBeVisible();
    
    // There's no way back: Escape doesn't close it, and Enter restarts.
    await page.keyboard.press('Escape');
    await expect(endGameBrief(page)).toBeVisible();
    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
    await page.waitForFunction(() => window.tc?.isAppReady?.() === true);
    expect(await page.evaluate(() => tc.getPersistenceManager().hasSave())).toBe(false);
    
    expect(problems.pageErrors).toEqual([]);
});
