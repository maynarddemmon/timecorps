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
    await page.getByRole('button', {name:/Jump Here/}).filter({visible:true}).click();
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
