import {test, expect} from '@playwright/test';
import {startGame, readJson, SCENARIO_FILES, dialogTitle, dismissMissionBrief, dismissAgentDossier, reloadGame} from './helpers.mjs';

const idsWithVideo = models => Object.entries(models).filter(([, model]) => model.video).map(([id]) => id),
    
    videoAgentIds = idsWithVideo(readJson('data/agents.json5').agents),
    locations = Object.assign({}, ...SCENARIO_FILES.map(file => readJson(file).locations ?? {})),
    videoLocationIds = idsWithVideo(locations),
    
    // A shown location (not _nexus or _nowhere) with just a photo.
    photoOnlyLocationId = Object.keys(locations).find(id => !id.startsWith('_') && !locations[id].video),

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

    DOSSIER_PORTRAIT = 'tc.app.openAgentDossier.lastDossier._photo',
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
    
    await openBrief(page, photoOnlyLocationId);
    await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toEqual({visible:true, showingVideo:false, imageVisible:true, playing:false});
    await page.keyboard.press('Escape');
    
    // The special _nexus location has no photo, so the report takes the whole dialog.
    await openBrief(page, '_nexus');
    await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toEqual({visible:false, showingVideo:false, imageVisible:false, playing:false});
    
    expect(problems.pageErrors).toEqual([]);
});

/*  Where a brief's report panel starts, relative to the bottom of its photo's space. */
const reportTop = (page, getterSrc) => page.evaluate(getterSrc => {
    const brief = new Function('return ' + getterSrc)(),
        photo = brief._photo;
    return brief._profileView.parent.parent.y - (photo.y + photo.height);
}, getterSrc);

test('without a photo, an area brief\'s report moves up but a dossier\'s stays below the vitals', async ({page}) => {
    const problems = await startGame(page);
    
    await openBrief(page, '_nexus');
    await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toMatchObject({visible:false});
    expect(await reportTop(page, BRIEF_PHOTO.replace('._photo', ''))).toBeLessThan(0);
    await page.keyboard.press('Escape');
    
    await page.evaluate(() => {
        const agentModel = tc.model.getAgentModel('OK');
        agentModel.getMediaUrls = () => ['./img/agent/missing.jpg', null];
        tc.app.openAgentDossier.lastDossier = tc.app.openAgentDossier(agentModel);
    });
    await expect.poll(() => mediaState(page, DOSSIER_PORTRAIT)).toMatchObject({visible:false});
    expect(await reportTop(page, DOSSIER_PORTRAIT.replace('._photo', ''))).toBeGreaterThan(0);
    
    expect(problems.pageErrors).toEqual([]);
});

/*  Opens the area brief for each Location with a video and checks the video actually plays,
    then that closing the brief stops it. */
test('location videos play in the area brief', async ({page}) => {
    test.skip(videoLocationIds.length === 0, 'No locations have a video.');
    const problems = await startGame(page);
    
    for (const locationId of videoLocationIds) {
        await openBrief(page, locationId);
        await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toEqual({visible:true, showingVideo:true, imageVisible:false, playing:true});
        
        await page.keyboard.press('Escape');
        await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toEqual({visible:true, showingVideo:false, imageVisible:false, playing:false});
    }
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
});

test('a location video that can\'t load falls back to the photo', async ({page}) => {
    const problems = await startGame(page);
    
    // Claiming a video for a location without a .webm makes the video fail to load.
    await page.evaluate(locationId => tc.model.getLocation(locationId).setVideo(true), photoOnlyLocationId);
    await openBrief(page, photoOnlyLocationId);
    await expect.poll(() => mediaState(page, BRIEF_PHOTO)).toEqual({visible:true, showingVideo:false, imageVisible:true, playing:false});
    
    expect(problems.pageErrors).toEqual([]);
});

test('the dossier lists every configured skill by name, with its description as the tooltip', async ({page}) => {
    const problems = await startGame(page);
    await openDossier(page, 'VQ');
    
    const skillsJson = readJson('data/init.json5').skills,
        skills = readJson('data/agents.json5').agents.VQ.skills;
    for (const [skillId, cfg] of Object.entries(skillsJson)) {
        // Skills the agent wasn't given show as 0. Each skill's bar carries the description.
        const label = cfg.name + ' : ' + (skills[skillId] ?? 0),
            skillBar = page.locator('.myt-AgentDossier [title]').filter({visible:true})
                .filter({has:page.getByText(label, {exact:true})});
        await expect(skillBar).toHaveCount(1);
        await expect(skillBar).toHaveAttribute('title', label + ' - ' + cfg.description);
    }
    
    expect(problems.pageErrors).toEqual([]);
});

test('revealing an agent shows their dossier, after a mission brief opened first', async ({page}) => {
    const problems = await startGame(page);
    
    // As a mission's setup does: open the brief, then reveal.
    await page.evaluate(() => {
        tc.app.openMissionBrief(tc.model.getCurrentOperation());
        tc.model.revealAgents(['OK']);
    });
    await expect(dialogTitle(page, 'Agent Dossier')).toHaveCount(0);
    await dismissMissionBrief(page);
    await dismissAgentDossier(page, 'Okonjo');
    
    // Agents who are already visible aren't announced again.
    await page.evaluate(() => tc.model.revealAgents(['VQ', 'OK']));
    await page.waitForTimeout(300);
    await expect(dialogTitle(page, 'Agent Dossier')).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('an agent revealed during play has their dossier shown', async ({page}) => {
    const problems = await startGame(page);
    const isHidden = () => page.evaluate(() => tc.model.getAgentModel('HW').isHidden());
    
    // Halloway is hidden until his event is attested.
    expect(await isHidden()).toBe(true);
    await page.evaluate(() => tc.model.getEventModel('lifeboat_capacity').attestation.setValue(10));
    await dismissAgentDossier(page, 'Halloway');
    expect(await isHidden()).toBe(false);
    
    expect(problems.pageErrors).toEqual([]);
});

test('an agent already visible in a restored save has no dossier shown', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => tc.model.getEventModel('lifeboat_capacity').attestation.setValue(10));
    await dismissAgentDossier(page, 'Halloway');
    await page.evaluate(() => tc.persistence.save());
    
    // The reload helper fails if any dossier shows.
    await reloadGame(page);
    expect(await page.evaluate(() => tc.model.getAgentModel('HW').isHidden())).toBe(false);
    await page.waitForTimeout(1500);
    await expect(dialogTitle(page, 'Agent Dossier')).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('agent health shows in the dossier and the agents grid, and follows changes', async ({page}) => {
    const problems = await startGame(page),
        // A stat bar's tooltip, e.g. "Health · 60% · [60/100]".
        healthTooltip = (value, max) => ['Health', Math.round(100*value/max) + '%', '[' + value + '/' + max + ']'].join('\u00A0·\u00A0'),
        dossierHealth = (value, max) => page.locator('.myt-AgentDossier').locator(`[title="${healthTooltip(value, max)}"]`);
    
    await page.evaluate(() => {
        const statHealth = tc.model.getAgentModel('VQ').health;
        statHealth.setMax(100);
        statHealth.setValue(100);
        tc.app.openAgentDossier(tc.model.getAgentModel('VQ'));
    });
    await expect(dossierHealth(100, 100)).not.toHaveCount(0);
    
    // A change while the dossier is open shows at once.
    await page.evaluate(() => tc.model.getAgentModel('VQ').health.adjValue(-40));
    await expect(dossierHealth(60, 100)).not.toHaveCount(0);
    await page.keyboard.press('Escape');
    
    // The grid has a Health column whose bar tracks the stat.
    await expect(page.getByText('Health', {exact:true}).filter({visible:true})).toHaveCount(1);
    await expect(page.locator(`[title="${healthTooltip(60, 100)}"]`).filter({visible:true})).not.toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

