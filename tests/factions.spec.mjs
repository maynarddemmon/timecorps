// Factions: every Agent is in one, "unaligned" unless the data says otherwise. The Agents grid
// and the Agent Dossier show it, and clicking it opens the Faction Brief.
import {test, expect} from '@playwright/test';
import {startGame, dialogTitle, reloadGame, dismissAgentDossier} from './helpers.mjs';

const fieldNotes = page => page.evaluate(() => {
    const brief = document.querySelector('.myt-FactionBrief').model;
    return brief.visible ? brief._fieldNotesView.getValueView().text : null;
});

test('agents are in the faction the data gives them, or unaligned', async ({page}) => {
    const problems = await startGame(page);
    expect(await page.evaluate(() => ['AL', 'BR'].map(id => {
        const agentModel = tc.model.getAgentModel(id);
        return [agentModel.getFaction(), agentModel.getFactionModel().getLabel()];
    }))).toEqual([['timecorps', 'Time Corps'], ['unaligned', 'Unaligned']]);
    expect(problems.warnings).toEqual([]);
});

test('the agents grid shows the faction, and clicking it opens the faction brief', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {tc.model.revealAgents(['BR']);});
    await dismissAgentDossier(page, 'Bravo');
    
    const grid = page.locator('.myt-Agents');
    await expect(grid.getByText('Faction', {exact:true})).toBeVisible();
    await expect(grid.getByText('Unaligned', {exact:true})).toBeVisible();
    
    await grid.getByText('Time Corps', {exact:true}).click();
    await expect(dialogTitle(page, 'Faction Brief')).toHaveText('Faction Brief : Time Corps');
    await expect.poll(() => fieldNotes(page)).toBe('Keeps the causal thread intact.');
    
    expect(problems.pageErrors).toEqual([]);
});

test('the agent dossier shows the faction, and clicking it opens the faction brief over the dossier', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {tc.app.openAgentDossier(tc.model.getAgentModel('AL'));});
    await expect(dialogTitle(page, 'Agent Dossier')).toHaveText('Agent Dossier : Alpha');
    
    await page.locator('.myt-AgentDossier').getByText('Time Corps', {exact:true}).click();
    await expect(dialogTitle(page, 'Faction Brief')).toHaveText('Faction Brief : Time Corps');
    
    // Closing the brief goes back to the dossier.
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Faction Brief')).toHaveCount(0);
    await expect(dialogTitle(page, 'Agent Dossier')).toBeVisible();
    
    expect(problems.pageErrors).toEqual([]);
});

test('an unknown faction is warned about and leaves the agent unaligned, and the faction is saved', async ({page}) => {
    const problems = await startGame(page);
    expect(await page.evaluate(() => {
        const bravo = tc.model.getAgentModel('BR');
        bravo.setFaction('pirates');
        const afterUnknown = bravo.getFaction();
        bravo.setFaction('timecorps');
        tc.persistence.save();
        return afterUnknown;
    })).toBe('unaligned');
    expect(problems.warnings).toEqual(['Agent BR has unknown faction pirates (using unaligned)']);
    
    await reloadGame(page);
    expect(await page.evaluate(() => tc.model.getAgentModel('BR').getFaction())).toBe('timecorps');
    
    expect(problems.pageErrors).toEqual([]);
});
