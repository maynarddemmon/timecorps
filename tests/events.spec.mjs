// The Events tab: a grid of the known Events, whose selection follows the timeline's.
import {test, expect} from '@playwright/test';
import {startGame, showTab} from './helpers.mjs';

const grid = page => page.locator('.myt-Events'),
    
    // The rows drawn, in order, as {id, cells}: each cell's text, and the IDs of the agents shown.
    readRows = page => page.evaluate(() => {
        const listView = tc.app.getEventsView().gridWrapper.getGrid().getListView();
        return listView.getSubviews()
            .filter(row => row.model && row.visible)
            .sort((a, b) => a.y - b.y)
            .map(row => ({
                id:row.model.id,
                name:row.getRef('name').text,
                agents:row.getRef('agents').getSubviews().filter(sv => sv.model).map(sv => sv.model.id),
                attestation:row.getRef('attestation').value
            }));
    }),
    // The known Events, in the grid's order.
    readKnownIds = page => page.evaluate(() => tc.model.getEventModelsAsList(eventModel => eventModel.isNotHidden())
        .sort((a, b) => a.getStart() - b.getStart() || a.id.localeCompare(b.id)).map(eventModel => eventModel.id)),
    selectedIds = page => page.evaluate(() => ({
        grid:tc.app.getEventsView().getSelectedEventId(),
        timeline:tc.app.getTimelineView().getSelectedEventId(),
        details:tc.app.getEventDetailsView().eventModel?.id ?? null
    }));

test('the events tab lists the known Events by start, with the agents at them, and keeps up', async ({page}) => {
    const problems = await startGame(page);
    await showTab(page, 'Events');
    const known = await readKnownIds(page);
    await expect.poll(async () => (await readRows(page)).map(row => row.id)).toEqual(known);
    
    const rows = await readRows(page);
    expect(rows.find(row => row.id === 'origin')).toMatchObject({name:'Origin', agents:['AL']});
    for (const header of ['Name', 'Start', 'End', 'Duration', 'Agents']) {
        await expect(grid(page).getByText(header, {exact:true})).toBeVisible();
    }
    
    // Revealing an Event lists it, and an agent moving and a stat changing show.
    await page.evaluate(() => {
        const m = tc.model;
        m.getEventModel('aftermath').attestation.setValue(30);
        m.getAgentModel('AL').doFollowExit(m.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'));
    });
    await expect.poll(async () => (await readRows(page)).find(row => row.id === 'aftermath')).toMatchObject({agents:['AL'], attestation:30});
    expect((await readRows(page)).find(row => row.id === 'origin').agents).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('the grid\'s selection follows the timeline\'s, selecting a row selects the Event, and activating it again shows it on the timeline', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect.poll(() => selectedIds(page)).toEqual({grid:'origin', timeline:'origin', details:'origin'});
    
    await showTab(page, 'Events');
    await page.evaluate(() => tc.model.getEventModel('aftermath').attestation.setValue(30));
    // That reveals its neighbors, and the grid redraws a moment later, moving the rows, so wait
    // for it before clicking.
    await expect.poll(async () => (await readRows(page)).map(row => row.id)).toEqual(['boats', 'origin', 'aftermath', 'finale']);
    const aftermathRow = grid(page).getByText('Aftermath', {exact:true});
    await aftermathRow.click();
    await expect.poll(() => selectedIds(page)).toEqual({grid:'aftermath', timeline:'aftermath', details:'aftermath'});
    // Still on the Events tab.
    await expect(grid(page)).toBeVisible();
    
    // Activating the selected row shows it on the timeline.
    await aftermathRow.click();
    await expect(page.locator('.myt-TimelineCompact')).toBeVisible();
    await expect(grid(page)).toBeHidden();
    expect(await selectedIds(page)).toEqual({grid:'aftermath', timeline:'aftermath', details:'aftermath'});
    
    // Clearing the timeline's selection clears the grid's.
    await page.evaluate(() => tc.app.getTimelineView().deselectAll());
    await expect.poll(() => selectedIds(page)).toMatchObject({grid:null, timeline:null});
    expect(problems.pageErrors).toEqual([]);
});

test('the event details only offer HQ and The Void once they\'re revealed, whatever Event is showing', async ({page}) => {
    const problems = await startGame(page),
        readBtns = () => page.evaluate(() => {
            const details = tc.app.getEventDetailsView();
            return {hq:details.hqBtn.visible, theVoid:details.theVoidBtn.visible};
        });
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect.poll(readBtns).toEqual({hq:false, theVoid:false});
    
    // Revealing them shows their buttons without selecting another Event.
    await page.evaluate(() => tc.model.getHQEventModel().setHidden(false));
    await expect.poll(readBtns).toEqual({hq:true, theVoid:false});
    await page.evaluate(() => tc.model.getEventModel(tc.cfg.EVENT_ID_THE_VOID).setHidden(false));
    await expect.poll(readBtns).toEqual({hq:true, theVoid:true});
    expect(problems.pageErrors).toEqual([]);
});
