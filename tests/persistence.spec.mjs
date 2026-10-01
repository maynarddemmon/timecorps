import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {startGame, getCurrentOperationId} from './helpers.mjs';

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
    
    reloadGame = async page => {
        await page.reload();
        await page.waitForFunction(() =>
            window.tc?.model?.getCurrentOperation?.() != null &&
            window.tc?.app?.getTimelineView?.()?.timelineReady === true
        );
    };

test('a fresh campaign has nothing to save', async ({page}) => {
    const problems = await startGame(page);
    expect(await page.evaluate(() => tc.persistence.exportDiff())).toEqual({});
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
        vq.doAction(roster.getActionModels().prevent);
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
    expect(save.data.agents.VQ.log).toContainEqual({type:'action', action:['roster_reshuffle', 'prevent']});

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
        missionComplete = page.getByText('Mission Complete', {exact:true}).filter({visible:true});

    await setCausatorCfg(page, 'roster_reshuffle', 'preventReshuffle', 'true');
    await setCausatorCfg(page, 'engine_order', 'countermandAstern', 'true');
    await expect(missionComplete).toBeVisible();
    await visibleButton(page, 'Next Mission ➜').last().click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('titanic_rescued');

    await saveGame(page);
    const before = await exportModel(page);

    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('titanic_rescued');
    expect(await exportModel(page)).toEqual(before);

    // No second debrief and no second award (score and HQ chronal are compared above).
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
    await Promise.all([
        page.waitForEvent('load'),
        visibleButton(page, /Confirm/).click()
    ]);
    await page.waitForFunction(() => window.tc?.app?.getTimelineView?.()?.timelineReady === true);

    expect(await readSave(page)).toBeNull();
    expect(await page.evaluate(() => tc.persistence.exportDiff())).toEqual({});
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
    },
    
    // Clicking a button that reloads the page, then waiting for the game to be ready again.
    clickAndReload = async (page, name) => {
        await Promise.all([page.waitForEvent('load'), visibleButton(page, name).click()]);
        await page.waitForFunction(() =>
            window.tc?.model?.getCurrentOperation?.() != null &&
            window.tc?.app?.getTimelineView?.()?.timelineReady === true
        );
    };

test('an exported file imports back to the same campaign', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => {
        const m = tc.model,
            vq = m.getAgentModel('VQ'),
            roster = m.getEventModel('roster_reshuffle');
        vq.doDeployToEvent(roster);
        vq.doAction(roster.getActionModels().prevent);
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
    await clickAndReload(page, /Confirm/);
    expect(await page.evaluate(() => tc.persistence.exportDiff())).toEqual({});
    
    expect(await importFile(page, exported)).toBe('Import Succeeded');
    await clickAndReload(page, 'Continue');
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
    
    // Starting over gives a clean campaign with no dialog.
    await clickAndReload(page, 'Start Over');
    expect(await page.evaluate(() => tc.persistence.exportDiff())).toEqual({});
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
test('a selection matching the fresh campaign is restored on a later mission', async ({page}) => {
    const problems = await startGame(page);
    
    await setCausatorCfg(page, 'roster_reshuffle', 'preventReshuffle', 'true');
    await setCausatorCfg(page, 'engine_order', 'countermandAstern', 'true');
    await visibleButton(page, 'Next Mission ➜').last().click();
    await expect.poll(() => getCurrentOperationId(page)).toBe('titanic_rescued');
    
    await page.evaluate(() => {
        tc.app.selectEventBox('collision');
        tc.app.selectAgentRow('VQ');
    });
    await expectSelection(page, {event:'collision', agent:'VQ'});
    await saveGame(page);
    expect((await readSave(page)).data.selection).toBeUndefined();
    
    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('titanic_rescued');
    await expectSelection(page, {event:'collision', agent:'VQ'});
    
    expect(problems.pageErrors).toEqual([]);
});

test('a cleared selection stays cleared after a reload', async ({page}) => {
    const problems = await startGame(page);
    await expectSelection(page, {event:'collision', agent:'VQ'});
    
    await page.evaluate(() => {
        tc.app.getTimelineView().deselectAll();
        tc.app.getTeamView().selectAgent(null);
    });
    expect(await getSelection(page)).toEqual({event:null, agent:null});
    await saveGame(page);
    
    await reloadGame(page);
    await expectSelection(page, {event:null, agent:null});
    
    expect(problems.pageErrors).toEqual([]);
});
