// Factions: every Agent is in one, "unaligned" unless the data says otherwise. The Agents grid
// and the Agent Dossier show it, and clicking it opens the Faction Brief.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, dialogTitle, reloadGame, dismissAgentDossier, showTab} from './helpers.mjs';

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
        const hq = tc.model.getEventModel('time_corps_hq');
        hq.setHidden(false);
        tc.app.selectAgentRow('BR');
        tc.app.selectEventBox(hq);
    });
    await expect.poll(() => page.evaluate(() => tc.app.getEventDetailsView().eventModel?.id)).toBe('time_corps_hq');
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
        
        // Unaligned Bravo has no HQ to be recalled to, and can't go to the Time Corps'.
        bravo.doRecallToHQ();
        bravo.doDeployToEvent(m.getEventModel('time_corps_hq'));
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
        'Cannot recall BR: their faction, unaligned, has no HQ',
        'Cannot time travel BR to time_corps_hq: Only Time Corps agents can go here',
        'Cannot time travel AL to origin: Not enough chronogation to loop back here',
        'Cannot time travel AL to time_corps_hq: Not enough chronal'
    ]);
    
    // The recall button is disabled and says why.
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect(page.getByRole('button', {name:/^Recall to/}).filter({visible:true})).toHaveAttribute('title', /Not enough chronal/);
    
    expect(problems.pageErrors).toEqual([]);
});

test('no one time travels into or out of a chrono locked Event, which an expression can lock and unlock, or loops back at a hub', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.boats.chronoLocked = 'scratch.plan_noteCount < 2';
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            boats = m.getEventModel('boats'),
            hq = m.getEventModel('time_corps_hq'),
            retval = {};
        alpha.chronal.setValue(alpha.chronal.max);
        
        // Locked, so Alpha can't go there.
        alpha.doDeployToEvent(boats);
        retval.lockedAt = alpha.event;
        
        // Unlocked, Alpha can.
        m.setScratch('plan_noteCount', 2);
        alpha.doDeployToEvent(boats);
        retval.unlockedAt = alpha.event;
        
        // Locked again, Alpha can't leave by time travel either.
        m.setScratch('plan_noteCount', 0);
        alpha.doRecallToHQ();
        alpha.doDeployToEvent(m.getEventModel('origin'));
        retval.relockedAt = alpha.event;
        
        // Nor loop back at a hub.
        alpha.setEvent(hq.id);
        const visits = alpha.countVisitsToEvent(hq);
        alpha.doDeployToEvent(hq);
        retval.loopedBack = alpha.countVisitsToEvent(hq) > visits;
        return retval;
    });
    expect(out).toEqual({lockedAt:'origin', unlockedAt:'boats', relockedAt:'boats', loopedBack:false});
    const LOCKED = 'Boats is chrono locked. No one can time travel into or out of it.';
    expect(problems.warnings).toEqual([
        'Cannot time travel AL to boats: ' + LOCKED,
        'Cannot time travel AL to time_corps_hq: ' + LOCKED,
        'Cannot time travel AL to origin: ' + LOCKED,
        'Cannot time travel AL to time_corps_hq: Looping back not possible at chronal hubs'
    ]);
    
    // The lock is worked out again after a reload.
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await page.evaluate(() => tc.model.getEventModel('boats').isChronoLocked())).toBe(true);
    await page.evaluate(() => tc.model.setScratch('plan_noteCount', 3));
    expect(await page.evaluate(() => tc.model.getEventModel('boats').isChronoLocked())).toBe(false);
    expect(problems.pageErrors).toEqual([]);
});

test('each faction has its own HQ, which only its agents can go to, and which they\'re recalled to', async ({page}) => {
    await page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.factions.syndicate = {label:'Syndicate', hq:'boats', description:'Pays well.'};
        json.factions.pirates = {label:'Pirates', hq:'nowhere', description:'Lost.'};
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    expect(problems.warnings).toEqual(['Faction pirates hq names no Event: nowhere']);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            bravo = m.getAgentModel('BR'),
            boats = m.getEventModel('boats'),
            hq = m.getEventModel('time_corps_hq');
        bravo.setPlayerControlled(true);
        bravo.setFaction('syndicate');
        bravo.setEvent('origin');
        for (const agentModel of [alpha, bravo]) agentModel.chronal.setValue(agentModel.chronal.max);
        const retval = {hqs:[boats.isHQ(), hq.isHQ(), m.getEventModel('origin').isHQ()]};
        
        // Each can't go to the other's HQ.
        alpha.doDeployToEvent(boats);
        bravo.doDeployToEvent(hq);
        retval.refusedAt = [alpha.event, bravo.event];
        
        // Bravo's recall costs the trip back to the Syndicate's HQ, and is logged as a recall.
        const chronalBefore = bravo.chronal.value;
        retval.recallCost = tc.getChronalToRecall(bravo, boats);
        bravo.doRecallToHQ();
        retval.bravoAt = bravo.event;
        retval.bravoPaid = chronalBefore - bravo.chronal.value;
        retval.bravoLogType = bravo.getLog().at(-1).type;
        retval.bravoAtHQ = [bravo.isAtHQ(), alpha.isAtHQ()];
        
        alpha.doRecallToHQ();
        retval.alphaAt = alpha.event;
        return retval;
    });
    expect(out.bravoPaid).toBe(out.recallCost);
    expect(out.recallCost).toBeGreaterThan(0);
    expect(out).toMatchObject({
        hqs:[true, true, false],
        refusedAt:['origin', 'origin'],
        bravoAt:'boats',
        bravoLogType:'recall',
        bravoAtHQ:[true, false],
        alphaAt:'time_corps_hq'
    });
    expect(problems.warnings.slice(1)).toEqual([
        'Cannot time travel AL to boats: Only Syndicate agents can go here',
        'Cannot time travel BR to time_corps_hq: Only Time Corps agents can go here'
    ]);
    expect(problems.pageErrors).toEqual([]);
});
