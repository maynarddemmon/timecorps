import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {startGame, getCurrentOperationId, dismissMissionBrief, reloadGame, clickAndReload, dialogTitle, dismissAgentDossier} from './helpers.mjs';

/*  Save/load round trips. localStorage survives a page reload within a test, so a reload
    exercises the autoload path at startup. */

const exportModel = page => page.evaluate(() => JSON.parse(JSON.stringify(tc.model.exportToObj()))),
    readSave = page => page.evaluate(() => JSON.parse(localStorage.getItem('tc.save'))),
    visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true}),

    // Sets a Causator the way an Action does, i.e. via its constraint config.
    setCausatorCfg = (page, eventId, valueId, value) => page.evaluate(
        ([eventId, valueId, value]) => tc.model.getEventModel(eventId).getValueModels()[valueId].setValue(value, false),
        [eventId, valueId, value]
    ),

    /*  Save, confirm and acknowledge. Enter dismisses the acknowledgement, which also covers
        the dialogs' Enter key support. */
    saveGame = async page => {
        await visibleButton(page, '✇').click();
        await visibleButton(page, /Confirm/).click();
        await expect(page.getByText('Save Succeeded', {exact:true}).filter({visible:true})).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page.getByText('Save Succeeded', {exact:true}).filter({visible:true})).toHaveCount(0);
    },
    
    // What a fresh campaign would save: only the first mission's setup.
    expectFreshCampaign = async page => {
        const diff = await page.evaluate(() => tc.persistence.exportDiff());
        expect(diff.currentOperation).toBe('titanic_noCollision');
        expect(diff.operations).toEqual({titanic_noCollision:{setupApplied:true}});
        expect(Object.keys(diff.agents)).toEqual(['VQ']);
        expect(diff.events?.roster_reshuffle).toBeUndefined();
    };

/*  The baseline is taken before the first mission is set up, so a fresh campaign saves just 
    that setup: the current mission, VQ revealed and awarded, and the setup's adjustments. */
test('a fresh campaign saves only the first mission\'s setup', async ({page}) => {
    const problems = await startGame(page);
    await expectFreshCampaign(page);
    await expect(page.getByTitle('Not saved', {exact:true})).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('agent moves, actions and investigation survive a reload', async ({page}) => {
    const problems = await startGame(page);

    // Jump VQ, act, investigate, follow an exit, then jump back for a second visit (which 
    // costs paradox), all through the game's own methods.
    await page.evaluate(() => {
        const m = tc.model,
            vq = m.getAgentModel('VQ'),
            roster = m.getEventModel('roster_reshuffle');
        vq.doDeployToEvent(roster);
        tc.rng.queueRolls(999); // So the action's skill check succeeds.
        vq.doAction(roster.getActionModels().prevent);
        tc.rng.queueRolls(999); // So the investigation succeeds and changes attestation.
        vq.doInvestigate();
        vq.doFollowExit(roster.getExitModels().find(exit => exit.to === 'titanic_departs'));
        vq.doDeployToEvent(roster);
    });

    await saveGame(page);
    await expect(page.getByTitle(/^Last saved /)).toBeVisible();

    // Only what changed is saved: an untouched Event isn't in the save at all.
    const save = await readSave(page);
    expect(save.version).toBe(1);
    expect(Object.keys(save.data.events)).toContain('roster_reshuffle');
    expect(save.data.events.roster_reshuffle.values).toEqual({preventReshuffle:{value:'true'}});
    expect(save.data.events.lusitania_sinks).toBeUndefined();
    expect(save.data.agents.VQ.event).toBe('roster_reshuffle');
    expect(save.data.agents.VQ.paradox.value).toBeGreaterThan(0);
    expect(save.data.agents.VQ.log).toContainEqual({type:'exit', exit:['roster_reshuffle', 0]});
    expect(save.data.agents.VQ.log).toContainEqual({type:'action', action:['roster_reshuffle', 'prevent'], success:true});

    const before = await exportModel(page);
    await reloadGame(page);
    expect(await exportModel(page)).toEqual(before);

    // The restored log still drives paradox pricing: a third visit costs 2.
    expect(await page.evaluate(() => {
        const m = tc.model;
        return m.getAgentModel('VQ').calculateParadoxForEntry(m.getEventModel('roster_reshuffle'));
    })).toBe(2);
    await expect(page.getByTitle(/^Last saved /)).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('a completed mission is not granted again after a reload', async ({page}) => {
    const problems = await startGame(page),
        missionComplete = dialogTitle(page, 'Mission Complete');

    await setCausatorCfg(page, 'roster_reshuffle', 'preventReshuffle', 'true');
    await setCausatorCfg(page, 'engine_order', 'countermandAstern', 'true');
    await expect(missionComplete).toBeVisible();
    await visibleButton(page, 'Next Mission ➜').last().click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('titanic_rescued');
    await dismissMissionBrief(page);

    await saveGame(page);
    const before = await exportModel(page);

    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('titanic_rescued');
    expect(await exportModel(page)).toEqual(before);

    // No second debrief, brief or award (score and HQ chronal are compared above).
    await page.waitForTimeout(250);
    await expect(missionComplete).toHaveCount(0);

    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('restart campaign erases the save', async ({page}) => {
    const problems = await startGame(page);

    await setCausatorCfg(page, 'roster_reshuffle', 'remindBlair', 'true');
    await saveGame(page);
    expect(await readSave(page)).not.toBeNull();

    await visibleButton(page, '⌫').click();
    await clickAndReload(page, visibleButton(page, /Confirm/), {briefExpected:true});

    expect(await readSave(page)).toBeNull();
    await expectFreshCampaign(page);
    await expect(page.getByTitle('Not saved', {exact:true})).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

/*  Picks a file in the import file chooser. contents is an object (saved as JSON) or raw text.
    Returns the title of the dialog that follows. */
const importFile = async (page, contents) => {
        await visibleButton(page, '↥').click();
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            visibleButton(page, /Confirm/).click()
        ]);
        await chooser.setFiles({
            name:'timecorps-save.json',
            mimeType:'application/json',
            buffer:Buffer.from(typeof contents === 'string' ? contents : JSON.stringify(contents))
        });
        const title = page.getByText(/^Import (Succeeded|Failed)$/).filter({visible:true});
        await expect(title).toBeVisible();
        return title.textContent();
    };

test('an exported file imports back to the same campaign', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => {
        const m = tc.model,
            vq = m.getAgentModel('VQ'),
            roster = m.getEventModel('roster_reshuffle');
        vq.doDeployToEvent(roster);
        tc.rng.queueRolls(999); // So the action's skill check succeeds.
        vq.doAction(roster.getActionModels().prevent);
        tc.rng.queueRolls(999); // So the investigation succeeds and changes attestation.
        vq.doInvestigate();
    });
    const before = await exportModel(page);
    
    const [download] = await Promise.all([page.waitForEvent('download'), visibleButton(page, '↧').click()]);
    expect(download.suggestedFilename()).toBe('timecorps-save.json');
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.version).toBe(1);
    expect(exported.data.agents.VQ.event).toBe('roster_reshuffle');
    
    // Start over, which also proves the import doesn't depend on the old save.
    await visibleButton(page, '⌫').click();
    await clickAndReload(page, visibleButton(page, /Confirm/), {briefExpected:true});
    await expectFreshCampaign(page);
    
    expect(await importFile(page, exported)).toBe('Import Succeeded');
    await clickAndReload(page, visibleButton(page, 'Continue'));
    expect(await exportModel(page)).toEqual(before);
    
    expect(problems.pageErrors).toEqual([]);
});

for (const [label, contents] of [
    ['a file that is not JSON', 'this is not json'],
    ['JSON that is not a save', {hello:'world'}],
    ['a save from another version', {version:999, savedAt:'2026-01-01T00:00:00.000Z', data:{}}],
    ['a save with no data', {version:1, savedAt:'2026-01-01T00:00:00.000Z'}]
]) {
    test('importing ' + label + ' fails and leaves the save alone', async ({page}) => {
        const problems = await startGame(page);
        
        await setCausatorCfg(page, 'roster_reshuffle', 'remindBlair', 'true');
        await saveGame(page);
        const saveBefore = await readSave(page);
        
        expect(await importFile(page, contents)).toBe('Import Failed');
        expect(await readSave(page)).toEqual(saveBefore);
        
        expect(problems.pageErrors).toEqual([]);
    });
}

test('a stored save that cannot be applied is cleared at startup', async ({page}) => {
    const problems = await startGame(page);
    
    // The right outline but the wrong contents, so it only fails partway through restoring.
    await page.evaluate(() => localStorage.setItem('tc.save', JSON.stringify({
        version:1, savedAt:'2026-01-01T00:00:00.000Z', data:{paradox:5}
    })));
    await page.reload();
    await expect(page.getByText('Save Could Not Be Loaded', {exact:true}).filter({visible:true})).toBeVisible();
    expect(await readSave(page)).toBeNull();
    
    // Starting over gives a fresh campaign, so just the first Mission Brief.
    await clickAndReload(page, visibleButton(page, 'Start Over'), {briefExpected:true});
    await expectFreshCampaign(page);
    await expect(page.getByText('Save Could Not Be Loaded', {exact:true}).filter({visible:true})).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('a restored save still selects the operation\'s initial event', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => {
        const m = tc.model;
        m.getAgentModel('VQ').doDeployToEvent(m.getEventModel('roster_reshuffle'));
    });
    await saveGame(page);
    
    await reloadGame(page);
    await expect.poll(() => page.evaluate(() => tc.app.getTimelineView().getSelectedEventBox()?.model.id ?? null)).toBe('collision');
    
    expect(problems.pageErrors).toEqual([]);
});

const getSelection = page => page.evaluate(() => tc.app.getSelectionForSave()),
    
    // Waits for the debounced timeline layout to settle the event selection.
    expectSelection = (page, selection) => expect.poll(() => page.evaluate(() => ({
        event:tc.app.getTimelineView().getSelectedEventBox()?.model.id ?? null,
        agent:tc.app.getTeamView().getSelectedAgentId()
    }))).toEqual(selection);

test('a restored save keeps the selected event and agent', async ({page}) => {
    const problems = await startGame(page);
    await expectSelection(page, {event:'collision', agent:'VQ'});
    
    await page.evaluate(() => {
        tc.model.getAgentModel('OK').setHidden(false);
        tc.app.selectAgentRow('OK');
        tc.app.selectEventBox('casualties');
    });
    await dismissAgentDossier(page, 'Okonjo');
    await expectSelection(page, {event:'casualties', agent:'OK'});
    await saveGame(page);
    expect((await readSave(page)).data.selection).toEqual({event:'casualties', agent:'OK'});
    
    await reloadGame(page);
    await expectSelection(page, {event:'casualties', agent:'OK'});
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

/*  The second mission has no initial selection, and the selection here matches the baseline 
    so it isn't in the save. It must still be restored rather than lost when the restore 
    switches to the second mission. */
test('a selection on a later mission is restored', async ({page}) => {
    const problems = await startGame(page);
    
    await setCausatorCfg(page, 'roster_reshuffle', 'preventReshuffle', 'true');
    await setCausatorCfg(page, 'engine_order', 'countermandAstern', 'true');
    
    // Wait for the dialog, otherwise last() can match the Mission panel's own Next Mission
    // link, which the dialog's dimmer then covers.
    await expect(dialogTitle(page, 'Mission Complete')).toBeVisible();
    await visibleButton(page, 'Next Mission ➜').last().click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('titanic_rescued');
    await dismissMissionBrief(page);
    
    await page.evaluate(() => {
        tc.app.selectEventBox('collision');
        tc.app.selectAgentRow('VQ');
    });
    await expectSelection(page, {event:'collision', agent:'VQ'});
    await saveGame(page);
    
    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('titanic_rescued');
    await expectSelection(page, {event:'collision', agent:'VQ'});
    
    expect(problems.pageErrors).toEqual([]);
});

/*  A cleared selection matches the baseline (nothing selected before the first mission's 
    setup) so it isn't in the save. It must still override the selection the restored mission 
    applies when it becomes current. */
test('a cleared selection stays cleared after a reload', async ({page}) => {
    const problems = await startGame(page);
    await expectSelection(page, {event:'collision', agent:'VQ'});
    
    await page.evaluate(() => {
        tc.app.getTimelineView().deselectAll();
        tc.app.getTeamView().selectAgent(null);
    });
    expect(await getSelection(page)).toEqual({event:null, agent:null});
    await saveGame(page);
    expect((await readSave(page)).data.selection).toBeUndefined();
    
    await reloadGame(page);
    await expectSelection(page, {event:null, agent:null});
    
    expect(problems.pageErrors).toEqual([]);
});

test('agent health and constitution survive a save and reload', async ({page}) => {
    const problems = await startGame(page),
        readHealth = () => page.evaluate(() => {
            const {value, max} = tc.model.getAgentModel('VQ').health;
            return {value, max};
        });
    await page.evaluate(() => {
        const statHealth = tc.model.getAgentModel('VQ').health;
        statHealth.setMax(120);
        statHealth.setValue(70);
        tc.persistence.save();
    });
    expect((await readSave(page)).data.agents.VQ.health).toMatchObject({value:70, max:120});
    
    await reloadGame(page);
    expect(await readHealth()).toEqual({value:70, max:120});
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

