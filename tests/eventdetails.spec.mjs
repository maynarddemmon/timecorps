import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const expandedRows = page => page.evaluate(() => {
        const details = tc.app.getEventDetailsView();
        return {agents:details.agentsRow.expanded, causators:details.causatorsRow.expanded};
    }),
    visibleText = (page, text) => page.getByText(text, {exact:true}).filter({visible:true}),
    
    // The header label shows a minus sign when expanded and a plus when collapsed.
    EXPANDED = '⊟ ',
    COLLAPSED = '⊞ ';

test('clicking a section header collapses and expands it, and the icon follows', async ({page}) => {
    const problems = await startGame(page);
    
    await visibleText(page, EXPANDED + 'Causators').click();
    expect(await expandedRows(page)).toEqual({agents:true, causators:false});
    await expect(visibleText(page, COLLAPSED + 'Causators')).toBeVisible();
    
    await visibleText(page, COLLAPSED + 'Causators').click();
    expect(await expandedRows(page)).toEqual({agents:true, causators:true});
    await expect(visibleText(page, EXPANDED + 'Causators')).toBeVisible();
    
    expect(problems.pageErrors).toEqual([]);
});

test('the whole header toggles, with a pointer cursor', async ({page}) => {
    const problems = await startGame(page);
    
    // The header is the label's parent. A locator click (unlike page.mouse) waits for the
    // header to be visible and stable, which matters since Event Details stays hidden until
    // the initial event selection lands, and checks the click point actually hits it.
    const header = visibleText(page, EXPANDED + 'Causators').locator('..');
    await expect(header).toBeVisible();
    expect(await header.evaluate(elem => getComputedStyle(elem).cursor)).toBe('pointer');
    
    // Click the empty space at the right end of the header, away from the label.
    const box = await header.boundingBox();
    await header.click({position:{x:box.width - 20, y:box.height / 2}});
    await expect.poll(() => expandedRows(page)).toEqual({agents:true, causators:false});
    
    expect(problems.pageErrors).toEqual([]);
});

/*  The Deploy/Recall buttons live in the Agent Activity header, so their clicks bubble to the 
    header's toggle. They must not collapse the section. */
test('a button in a section header does not collapse the section', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => tc.app.selectEventBox('casualties'));
    await page.getByRole('button', {name:/Jump to/}).filter({visible:true}).click();
    await expect.poll(() => page.evaluate(() => tc.model.getAgentModel('VQ').event)).toBe('casualties');
    expect(await expandedRows(page)).toEqual({agents:true, causators:true});
    
    expect(problems.pageErrors).toEqual([]);
});

test('exit routes to an event without a box yet are skipped rather than warned about', async ({page}) => {
    const problems = await startGame(page);
    const skipped = await page.evaluate(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
            timeline = tc.app.getTimelineView(),
            boxes = timeline.boxesByEventId,
            collision = tc.model.getEventModel('collision'),
            exit = collision.getExitModels()[0],
            target = exit.getToEventModel();
        
        // Both ends known, so the route would normally be drawn when collision is selected.
        target.attestation.setValue(50);
        tc.model.getEventModel('roster_reshuffle').attestation.setValue(50); // Something else to select.
        await wait(200);
        if (!collision.getVisibleExitAndEntrances().includes(exit)) return 'route not visible';
        
        // As while the timeline is rebuilt during a restore.
        const box = boxes[target.id];
        delete boxes[target.id];
        try {
            tc.app.selectEventBox('roster_reshuffle');
            await wait(100);
            tc.app.selectEventBox('collision');
            await wait(300);
        } finally {
            boxes[target.id] = box;
        }
        return target.id;
    });
    expect(skipped).toBe('casualties');
    expect(problems.warnings).toEqual([]);
});

const visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true});

test('an exit from the agent\'s event to the selected event can be taken from the header', async ({page}) => {
    const problems = await startGame(page);
    
    // VQ starts at collision, which has an exit to casualties.
    const exit = await page.evaluate(() => {
        const exitModel = tc.model.getEventModel('collision').getExitModels().find(e => e.to === 'casualties');
        return {phrase:exitModel.getModePhrase(), chronal:tc.model.getAgentModel('VQ').chronal.value};
    });
    await page.evaluate(() => tc.app.selectEventBox('casualties'));
    const followBtn = visibleButton(page, new RegExp('^' + exit.phrase + '$'));
    await expect(followBtn).toBeVisible();
    await expect(visibleButton(page, /Jump to/)).toBeVisible(); // Still offered alongside.
    
    await followBtn.click();
    await expect.poll(() => page.evaluate(() => tc.model.getAgentModel('VQ').event)).toBe('casualties');
    const after = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            entry = vq.getLog().at(-1);
        return {type:entry.type, from:entry.exit.event.id, to:entry.exit.to, chronal:vq.chronal.value};
    });
    
    // Taken as the exit, so it's logged as one and costs no chronal, unlike jumping.
    expect(after).toEqual({type:'exit', from:'collision', to:'casualties', chronal:exit.chronal});
    
    // Now at casualties, so there's no exit to offer for it.
    await expect(followBtn).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});

test('no exit button without an exit from the agent\'s event to the selected event', async ({page}) => {
    const problems = await startGame(page);
    // The header button is just the phrase, plus any paradox cost. The agent's own list of 
    // exits names the event too, e.g. "Walk to Loss of Life".
    const exitPhrases = /^(Walk to|Wait til|To)( \[.*\])?$/;
    
    // The agent's own event.
    await page.evaluate(() => tc.app.selectEventBox('collision'));
    await expect(visibleButton(page, /Loop back/)).toBeVisible();
    await expect(page.getByRole('button', {name:exitPhrases}).filter({visible:true})).toHaveCount(0);
    
    // An event with no exit leading to it from collision.
    expect(await page.evaluate(() => {
        tc.model.getEventModel('roster_reshuffle').attestation.setValue(50);
        return tc.model.getAgentModel('VQ').getExitTo(tc.model.getEventModel('roster_reshuffle'));
    })).toBeNull();
    await page.waitForTimeout(300);
    await page.evaluate(() => tc.app.selectEventBox('roster_reshuffle'));
    await expect(visibleButton(page, /Jump to/)).toBeVisible();
    await expect(page.getByRole('button', {name:exitPhrases}).filter({visible:true})).toHaveCount(0);
    
    // Nor does an exit to a hidden event.
    expect(await page.evaluate(() => {
        const casualties = tc.model.getEventModel('casualties');
        casualties.setHidden(true);
        try {
            return tc.model.getAgentModel('VQ').getExitTo(casualties);
        } finally {
            casualties.setHidden(false);
        }
    })).toBeNull();
    
    // A hidden exit doesn't count.
    expect(await page.evaluate(() => {
        const exitModel = tc.model.getEventModel('collision').getExitModels().find(e => e.to === 'casualties');
        exitModel.setHidden(true);
        return tc.model.getAgentModel('VQ').getExitTo(tc.model.getEventModel('casualties'));
    })).toBeNull();
    
    expect(problems.pageErrors).toEqual([]);
});
