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
    
    await page.evaluate(() => tc.app.selectEventBox('aftermath'));
    await page.getByRole('button', {name:/Jump to/}).filter({visible:true}).click();
    await expect.poll(() => page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('aftermath');
    expect(await expandedRows(page)).toEqual({agents:true, causators:true});
    
    expect(problems.pageErrors).toEqual([]);
});

test('exit routes to an event without a box yet are skipped rather than warned about', async ({page}) => {
    const problems = await startGame(page);
    const skipped = await page.evaluate(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
            timeline = tc.app.getTimelineView(),
            boxes = timeline.boxesByEventId,
            origin = tc.model.getEventModel('origin'),
            exit = origin.getExitModels()[0],
            target = exit.getToEventModel();
        
        // Both ends known, so the route would normally be drawn when origin is selected.
        target.attestation.setValue(50);
        tc.model.getEventModel('plan').attestation.setValue(50); // Something else to select.
        await wait(200);
        if (!origin.getVisibleExitAndEntrances().includes(exit)) return 'route not visible';
        
        // As while the timeline is rebuilt during a restore.
        const box = boxes[target.id];
        delete boxes[target.id];
        try {
            tc.app.selectEventBox('plan');
            await wait(100);
            tc.app.selectEventBox('origin');
            await wait(300);
        } finally {
            boxes[target.id] = box;
        }
        return target.id;
    });
    expect(skipped).toBe('aftermath');
    expect(problems.warnings).toEqual([]);
});

const visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true});

test('an exit from the agent\'s event to the selected event can be taken from the header', async ({page}) => {
    const problems = await startGame(page);
    
    // Alpha starts at origin, which has an exit to aftermath.
    const exit = await page.evaluate(() => {
        const exitModel = tc.model.getEventModel('origin').getExitModels().find(e => e.to === 'aftermath');
        return {phrase:exitModel.getModePhrase(), chronal:tc.model.getAgentModel('AL').chronal.value};
    });
    await page.evaluate(() => tc.app.selectEventBox('aftermath'));
    const followBtn = visibleButton(page, new RegExp('^' + exit.phrase + '$'));
    await expect(followBtn).toBeVisible();
    await expect(visibleButton(page, /Jump to/)).toBeVisible(); // Still offered alongside.
    
    await followBtn.click();
    await expect.poll(() => page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('aftermath');
    const after = await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            entry = alpha.getLog().at(-1);
        return {type:entry.type, from:entry.exit.event.id, to:entry.exit.to, chronal:alpha.chronal.value};
    });
    
    // Taken as the exit, so it's logged as one and costs no chronal, unlike jumping.
    expect(after).toEqual({type:'exit', from:'origin', to:'aftermath', chronal:exit.chronal});
    
    // Now at aftermath, so there's no exit to offer for it.
    await expect(followBtn).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});

test('no exit button without an exit from the agent\'s event to the selected event', async ({page}) => {
    const problems = await startGame(page);
    // The header button is just the phrase, plus any paradox cost. The agent's own list of 
    // exits names the event too, e.g. "Walk to Aftermath".
    const exitPhrases = /^(Walk to|Wait til|To)( \[.*\])?$/;
    
    // The agent's own event.
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect(visibleButton(page, /Loop back/)).toBeVisible();
    await expect(page.getByRole('button', {name:exitPhrases}).filter({visible:true})).toHaveCount(0);
    
    // An event with no exit leading to it from origin.
    expect(await page.evaluate(() => {
        tc.model.getEventModel('plan').attestation.setValue(50);
        return tc.model.getAgentModel('AL').getExitTo(tc.model.getEventModel('plan'));
    })).toBeNull();
    await page.waitForTimeout(300);
    await page.evaluate(() => tc.app.selectEventBox('plan'));
    await expect(visibleButton(page, /Jump to/)).toBeVisible();
    await expect(page.getByRole('button', {name:exitPhrases}).filter({visible:true})).toHaveCount(0);
    
    // Nor does an exit to a hidden event.
    expect(await page.evaluate(() => {
        const aftermath = tc.model.getEventModel('aftermath');
        aftermath.setHidden(true);
        try {
            return tc.model.getAgentModel('AL').getExitTo(aftermath);
        } finally {
            aftermath.setHidden(false);
        }
    })).toBeNull();
    
    // A hidden exit doesn't count.
    expect(await page.evaluate(() => {
        const exitModel = tc.model.getEventModel('origin').getExitModels().find(e => e.to === 'aftermath');
        exitModel.setHidden(true);
        return tc.model.getAgentModel('AL').getExitTo(tc.model.getEventModel('aftermath'));
    })).toBeNull();
    
    expect(problems.pageErrors).toEqual([]);
});
