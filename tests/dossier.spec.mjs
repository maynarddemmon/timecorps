import {test, expect} from '@playwright/test';
import {startGame, readJson} from './helpers.mjs';

const videoAgentIds = Object.entries(readJson('data/agents.json').agents)
        .filter(([, agent]) => agent.video)
        .map(([agentId]) => agentId),

    // The state of a dialog's MediaView, found by its name on the dialog.
    mediaState = (page, getterSrc) => page.evaluate(getterSrc => {
        const mediaView = new Function('return ' + getterSrc)(),
            videoElem = mediaView.getVideoView().getIDE();
        return {
            visible:mediaView.visible,
            showingVideo:mediaView.isShowingVideo(),
            imageVisible:mediaView.getImageView().visible,
            playing:!videoElem.paused && videoElem.currentTime > 0
        };
    }, getterSrc),

    DOSSIER_PORTRAIT = 'tc.app.openAgentDossier.lastDossier._portrait',
    BRIEF_PHOTO = 'tc.app.openAreaBrief.lastBrief._photo',

    openDossier = (page, agentId, video) => page.evaluate(([agentId, video]) => {
        const agentModel = tc.model.getAgentModel(agentId);
        if (video != null) agentModel.setVideo(video);
        tc.app.openAgentDossier.lastDossier = tc.app.openAgentDossier(agentModel);
    }, [agentId, video]);

/*  Opens the dossier for each Agent with a video portrait and checks the video actually plays,
    then that closing the dossier stops it. */
test('video portraits play in the agent dossier', async ({page}) => {
    test.skip(videoAgentIds.length === 0, 'No agents have a video portrait.');
    const problems = await startGame(page);

    for (const agentId of videoAgentIds) {
        await openDossier(page, agentId);
        await expect.poll(() => mediaState(page, DOSSIER_PORTRAIT)).toEqual({visible:true, showingVideo:true, imageVisible:false, playing:true});

        await page.keyboard.press('Escape');
        await expect.poll(() => mediaState(page, DOSSIER_PORTRAIT)).toEqual({visible:true, showingVideo:false, imageVisible:false, playing:false});
    }

    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
});

test('a video portrait that can\'t load falls back to the photo', async ({page}) => {
    const problems = await startGame(page);

    // OK has no .webm, so claiming a video portrait makes the video fail to load.
    await openDossier(page, 'OK', true);
    await expect.poll(() => mediaState(page, DOSSIER_PORTRAIT)).toEqual({visible:true, showingVideo:false, imageVisible:true, playing:false});

    expect(problems.pageErrors).toEqual([]);
});

const openBrief = (page, locationId) => page.evaluate(locationId => {
    tc.app.openAreaBrief.lastBrief = tc.app.openAreaBrief(tc.model.getLocation(locationId));
}, locationId);

test('an area brief shows its location photo, or hides it when there is none', async ({page}) => {
    const problems = await startGame(page);
    
    await openBrief(page, 'titanic.bridge');
    await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toEqual({visible:true, showingVideo:false, imageVisible:true, playing:false});
    await page.keyboard.press('Escape');
    
    // The special _nexus location has no photo, so the report takes the whole dialog.
    await openBrief(page, '_nexus');
    await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toEqual({visible:false, showingVideo:false, imageVisible:false, playing:false});
    
    expect(problems.pageErrors).toEqual([]);
});
