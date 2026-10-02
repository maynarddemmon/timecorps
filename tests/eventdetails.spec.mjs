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
    
    // Click the empty space at the right end of the Causators header, away from the label.
    const header = await page.evaluate(() => {
        const headerView = tc.app.getEventDetailsView().causatorsRow.getHeaderView(),
            elem = headerView.getIDE(),
            rect = elem.getBoundingClientRect();
        return {x:rect.right - 20, y:rect.top + rect.height / 2, cursor:getComputedStyle(elem).cursor};
    });
    expect(header.cursor).toBe('pointer');
    await page.mouse.click(header.x, header.y);
    expect(await expandedRows(page)).toEqual({agents:true, causators:false});
    
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
