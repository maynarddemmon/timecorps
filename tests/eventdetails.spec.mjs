import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const expandedRows = page => page.evaluate(() => {
        const details = tc.app.getEventDetailsView();
        return {agents:details.agentsRow.expanded, causators:details.causatorsRow.expanded};
    }),
    visibleText = (page, text) => page.getByText(text, {exact:true}).filter({visible:true});

test('clicking a section header collapses and expands it', async ({page}) => {
    const problems = await startGame(page);
    
    await visibleText(page, 'Causators').click();
    expect(await expandedRows(page)).toEqual({agents:true, causators:false});
    await visibleText(page, 'Causators').click();
    expect(await expandedRows(page)).toEqual({agents:true, causators:true});
    
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
