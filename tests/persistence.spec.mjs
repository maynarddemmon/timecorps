import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {startGame, getCurrentOperationId, acceptMission, reloadGame, clickAndReload, dialogTitle, dismissAgentDossier} from './helpers.mjs';

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
        expect(diff.currentOperation).toBe('first');
        expect(diff.operations).toEqual({first:{revealed:true, setupApplied:true}});
        expect(Object.keys(diff.agents)).toEqual(['AL']);
        expect(diff.events?.plan).toBeUndefined();
    };

/*  The baseline is taken before the first mission is set up, so a fresh campaign saves just 
    that setup: the current mission, AL revealed and awarded, and the setup's adjustments. */
test('a fresh campaign saves only the first mission\'s setup', async ({page}) => {
    const problems = await startGame(page);
    await expectFreshCampaign(page);
    await expect(page.getByTitle('Not saved', {exact:true})).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('agent moves, actions and investigation survive a reload', async ({page}) => {
    const problems = await startGame(page);

    // Jump Alpha, act, investigate, follow an exit, then jump back for a second visit (which 
    // costs paradox), all through the game's own methods.
    await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            plan = m.getEventModel('plan');
        alpha.doDeployToEvent(plan);
        tc.rng.queueRolls(999); // So the action's skill check succeeds.
        alpha.doAction(plan.getActionModels().prepare);
        tc.rng.queueRolls(999); // So the investigation succeeds and changes attestation.
        alpha.doAction(plan.getActionModels()._investigate);
        alpha.doFollowExit(plan.getExitModels().find(exit => exit.to === 'supply'));
        alpha.doDeployToEvent(plan);
    });

    await saveGame(page);
    await expect(page.getByTitle(/^Last saved /)).toBeVisible();

    // Only what changed is saved: an untouched Event isn't in the save at all.
    const save = await readSave(page);
    expect(save.version).toBe(1);
    expect(Object.keys(save.data.events)).toContain('plan');
    expect(save.data.events.plan.values).toEqual({prepared:{value:'true', flipCount:1}});
    expect(save.data.events.finale).toBeUndefined();
    expect(save.data.agents.AL.event).toBe('plan');
    expect(save.data.agents.AL.paradox.value).toBeGreaterThan(0);
    expect(save.data.agents.AL.log).toContainEqual({type:'exit', exit:['plan', 0]});
    expect(save.data.agents.AL.log).toContainEqual({type:'action', action:['plan', 'prepare'], success:true, costs:{'agent.action':1}});
    expect(save.data.agents.AL.log).toContainEqual(expect.objectContaining({type:'action', action:['plan', '_investigate'], success:true}));

    const before = await exportModel(page);
    await reloadGame(page);
    expect(await exportModel(page)).toEqual(before);

    // The restored log still drives paradox pricing: a third visit costs 2.
    expect(await page.evaluate(() => {
        const m = tc.model;
        return m.getAgentModel('AL').calculateParadoxForEntry(m.getEventModel('plan'));
    })).toBe(2);
    await expect(page.getByTitle(/^Last saved /)).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('a completed mission is not granted again after a reload', async ({page}) => {
    const problems = await startGame(page),
        missionComplete = dialogTitle(page, 'Mission Complete');

    await setCausatorCfg(page, 'plan', 'prepared', 'true');
    await setCausatorCfg(page, 'lever', 'pulled', 'true');
    await expect(missionComplete).toBeVisible();
    await visibleButton(page, 'Next Mission ➜').click();
    await acceptMission(page);
    await expect.poll(() => getCurrentOperationId(page)).toBe('second');

    await saveGame(page);
    const before = await exportModel(page);

    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('second');
    expect(await exportModel(page)).toEqual(before);

    // No second debrief, brief or award (score and HQ chronal are compared above).
    await page.waitForTimeout(250);
    await expect(missionComplete).toHaveCount(0);

    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('restart campaign erases the save', async ({page}) => {
    const problems = await startGame(page);

    await setCausatorCfg(page, 'plan', 'noted', 'true');
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
            alpha = m.getAgentModel('AL'),
            plan = m.getEventModel('plan');
        alpha.doDeployToEvent(plan);
        tc.rng.queueRolls(999); // So the action's skill check succeeds.
        alpha.doAction(plan.getActionModels().prepare);
        tc.rng.queueRolls(999); // So the investigation succeeds and changes attestation.
        alpha.doAction(plan.getActionModels()._investigate);
    });
    const before = await exportModel(page);
    
    const [download] = await Promise.all([page.waitForEvent('download'), visibleButton(page, '↧').click()]);
    expect(download.suggestedFilename()).toBe('timecorps-save.json');
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.version).toBe(1);
    expect(exported.data.agents.AL.event).toBe('plan');
    
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
        
        await setCausatorCfg(page, 'plan', 'noted', 'true');
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
        m.getAgentModel('AL').setEvent('plan'); // Unlike a deploy, doesn't change the selection.
    });
    await saveGame(page);
    
    await reloadGame(page);
    await expect.poll(() => page.evaluate(() => tc.app.getTimelineView().getSelectedEventBox()?.model.id ?? null)).toBe('origin');
    
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
    await expectSelection(page, {event:'origin', agent:'AL'});
    
    await page.evaluate(() => {
        tc.model.getAgentModel('BR').setHidden(false);
        tc.app.selectAgentRow('BR');
        tc.app.selectEventBox('aftermath');
    });
    await dismissAgentDossier(page, 'Bravo');
    await expectSelection(page, {event:'aftermath', agent:'BR'});
    await saveGame(page);
    expect((await readSave(page)).data.selection).toEqual({event:'aftermath', agent:'BR'});
    
    await reloadGame(page);
    await expectSelection(page, {event:'aftermath', agent:'BR'});
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

/*  The second mission has no initial selection, and the selection here matches the baseline 
    so it isn't in the save. It must still be restored rather than lost when the restore 
    switches to the second mission. */
test('a selection on a later mission is restored', async ({page}) => {
    const problems = await startGame(page);
    
    await setCausatorCfg(page, 'plan', 'prepared', 'true');
    await setCausatorCfg(page, 'lever', 'pulled', 'true');
    
    await expect(dialogTitle(page, 'Mission Complete')).toBeVisible();
    await visibleButton(page, 'Next Mission ➜').click();
    await acceptMission(page);
    await expect.poll(() => getCurrentOperationId(page)).toBe('second');
    
    await page.evaluate(() => {
        tc.app.selectEventBox('origin');
        tc.app.selectAgentRow('AL');
    });
    await expectSelection(page, {event:'origin', agent:'AL'});
    await saveGame(page);
    
    await reloadGame(page);
    expect(await getCurrentOperationId(page)).toBe('second');
    await expectSelection(page, {event:'origin', agent:'AL'});
    
    expect(problems.pageErrors).toEqual([]);
});

/*  A cleared selection matches the baseline (nothing selected before the first mission's 
    setup) so it isn't in the save. It must still override the selection the restored mission 
    applies when it becomes current. */
test('a cleared selection stays cleared after a reload', async ({page}) => {
    const problems = await startGame(page);
    await expectSelection(page, {event:'origin', agent:'AL'});
    
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
            const {value, max} = tc.model.getAgentModel('AL').health;
            return {value, max};
        });
    await page.evaluate(() => {
        const statHealth = tc.model.getAgentModel('AL').health;
        statHealth.setMax(120);
        statHealth.setValue(70);
        tc.persistence.save();
    });
    expect((await readSave(page)).data.agents.AL.health).toMatchObject({value:70, max:120});
    
    await reloadGame(page);
    expect(await readHealth()).toEqual({value:70, max:120});
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('a devoured agent stays devoured after a save and reload', async ({page}) => {
    const problems = await startGame(page);
    
    // Bravo joins and is devoured, so Alpha keeps the campaign going.
    await page.evaluate(() => {
        tc.model.revealAgents(['BR']);
        tc.model.awardAgents(['BR']);
    });
    await dismissAgentDossier(page, 'Bravo');
    await page.evaluate(() => tc.model.getAgentModel('BR').setDevoured(true));
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    await dismissAgentDossier(page, 'Bravo');
    await page.evaluate(() => tc.persistence.save());
    
    await reloadGame(page);
    expect(await page.evaluate(() => {
        const ok = tc.model.getAgentModel('BR');
        return {devoured:ok.isDevoured(), event:ok.event, active:tc.model.getActiveAgentsAsList().map(agentModel => agentModel.id)};
    })).toEqual({devoured:true, event:'the_void', active:['AL']});
    
    expect(problems.pageErrors).toEqual([]);
});

test('timeline paradox above the starting limit survives a save and reload', async ({page}) => {
    const problems = await startGame(page),
        read = () => page.evaluate(() => ({value:tc.model.paradox.value, max:tc.model.paradox.max}));
    
    // More known Events raise the limit, and the paradox goes up to it, past the starting limit.
    const start = await read();
    await page.evaluate(() => {
        for (const eventId of ['plan', 'warnings', 'supply', 'relay', 'backlog']) {
            tc.model.getEventModel(eventId).attestation.setValue(10);
        }
        tc.model.paradox.setValue(tc.model.paradox.max);
        tc.persistence.save();
    });
    const saved = await read();
    expect(saved.value).toBe(saved.max);
    expect(saved.value).toBeGreaterThan(start.max);
    
    await reloadGame(page);
    expect(await read()).toEqual(saved);
    
    // A stale limit in the save, e.g. from before the data changed, is worked out again.
    await page.evaluate(() => {
        const record = JSON.parse(localStorage.getItem('tc.save'));
        record.data.paradox.max = 99;
        localStorage.setItem('tc.save', JSON.stringify(record));
    });
    await reloadGame(page);
    expect(await read()).toEqual(saved);
    
    expect(problems.pageErrors).toEqual([]);
});

