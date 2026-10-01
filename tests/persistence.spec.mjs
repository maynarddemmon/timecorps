import {test, expect} from '@playwright/test';
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
