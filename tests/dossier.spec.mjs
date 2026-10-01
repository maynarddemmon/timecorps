import {test, expect} from '@playwright/test';
import {startGame, readJson} from './helpers.mjs';

const videoAgentIds = Object.entries(readJson('data/agents.json').agents)
    .filter(([, agent]) => agent.video)
    .map(([agentId]) => agentId);

/*  Opens the dossier for each Agent with a video portrait and checks the video actually plays,
    then that closing the dossier stops it. */
test('video portraits play in the agent dossier', async ({page}) => {
    test.skip(videoAgentIds.length === 0, 'No agents have a video portrait.');
    const problems = await startGame(page);
    
    const videoState = () => page.evaluate(() => {
        const dossier = tc.app.openAgentDossier.dossier,
            videoElem = dossier._video.getIDE();
        return {
            visible:dossier._video.visible, photoVisible:dossier._photo.visible,
            playing:!videoElem.paused && videoElem.currentTime > 0, src:videoElem.getAttribute('src')
        };
    });
    
    for (const agentId of videoAgentIds) {
        await page.evaluate(agentId => {
            tc.app.openAgentDossier.dossier = tc.app.openAgentDossier(tc.model.getAgentModel(agentId));
        }, agentId);
        await expect.poll(videoState).toEqual({visible:true, photoVisible:false, playing:true, src:'./img/agent/' + agentId + '.webm'});
        
        await page.keyboard.press('Escape');
        await expect.poll(videoState).toEqual({visible:false, photoVisible:false, playing:false, src:null});
    }
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
});
