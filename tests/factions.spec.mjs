// Factions: every Agent is in one, "unaligned" unless the data says otherwise. The Agents grid
// and the Agent Dossier show it, and clicking it opens the Faction Brief.
import {test, expect} from '@playwright/test';
import {startGame, dialogTitle, reloadGame, dismissAgentDossier, showTab} from './helpers.mjs';

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
    await showTab(page, 'Agents');
    
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

test('only agents of the Time Corps are offered travel to HQ', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {tc.model.revealAgents(['BR']);});
    await dismissAgentDossier(page, 'Bravo');
    await page.evaluate(() => {
        const bravo = tc.model.getAgentModel('BR');
        bravo.setPlayerControlled(true);
        bravo.setEvent('origin');
        tc.app.selectEventBox('origin');
    });
    
    // Alpha's row offers a recall and unaligned Bravo's doesn't, nor does the HQ header.
    const recallBtns = page.getByRole('button', {name:/^Recall to/}).filter({visible:true});
    await expect(recallBtns).toHaveCount(1);
    await page.evaluate(() => {
        tc.app.selectAgentRow('BR');
        tc.app.selectEventBox(tc.model.getHQEventModel());
    });
    await page.waitForTimeout(250);
    await expect(recallBtns).toHaveCount(0);
    
    // Once in the Corps, Bravo can go to HQ too.
    await page.evaluate(() => {
        tc.model.getAgentModel('BR').setFaction('timecorps');
        tc.app.selectEventBox('origin');
    });
    await expect(recallBtns).toHaveCount(2);
    
    expect(problems.pageErrors).toEqual([]);
});

test('time travel the buttons don\'t offer is refused, with a warning saying why', async ({page}) => {
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            bravo = m.getAgentModel('BR'),
            alpha = m.getAgentModel('AL'),
            origin = m.getEventModel('origin');
        bravo.setEvent('origin');
        bravo.chronal.setValue(bravo.chronal.max);
        alpha.chronal.setValue(alpha.chronal.max);
        
        // Unaligned Bravo can't be recalled.
        bravo.doRecallToHQ();
        const bravoAt = bravo.event;
        
        // Alpha's -100 chronogation can't loop back to the minute-long origin.
        const visits = alpha.countVisitsToEvent(origin);
        alpha.doDeployToEvent(origin);
        const alphaLoopedBack = alpha.countVisitsToEvent(origin) > visits;
        
        // Nor can Alpha be recalled without the chronal.
        alpha.chronal.setValue(0);
        alpha.doRecallToHQ();
        return {bravoAt, alphaLoopedBack, alphaAt:alpha.event};
    });
    expect(out).toEqual({bravoAt:'origin', alphaLoopedBack:false, alphaAt:'origin'});
    expect(problems.warnings).toEqual([
        'Cannot time travel BR to time_corps_hq: Only the Time Corps can go to HQ',
        'Cannot time travel AL to origin: Not enough chronogation to loop back here',
        'Cannot time travel AL to time_corps_hq: Not enough chronal'
    ]);
    
    // The recall button is disabled and says why.
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect(page.getByRole('button', {name:/^Recall to/}).filter({visible:true})).toHaveAttribute('title', /Not enough chronal/);
    
    expect(problems.pageErrors).toEqual([]);
});
