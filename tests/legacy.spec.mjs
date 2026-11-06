// The legacy: each of the player's agents lost, devoured by chronovores or dead of their 
// wounds, gives init.json5's "legacy" agent skills at the start of every new game, and leaves 
// the Event they fell at haunted, in every game. It's kept in its own storage, apart from any
// save, until the player clears it.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData, dialogTitle, dismissAgentDossier} from './helpers.mjs';

const HAUNTINGS = ['A chill.', 'A whisper.', 'A shadow.'],
    
    routeLegacy = (page, legacy) => page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.legacy = legacy ?? {
            agent:'AL',
            devoured:{'agent.skills.stealth':3},
            died:{'agent.skills.investigation':1, 'agent.skills.stealth':1},
            hauntings:HAUNTINGS
        };
        return route.fulfill({json});
    }),
    
    readAlpha = page => page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        return {stealth:alpha.getSkill('stealth'), investigation:alpha.getSkill('investigation')};
    }),
    
    // Kills an agent where they are, as one of the player's or not.
    kill = (page, agentId, playerControlled=true) => page.evaluate(([agentId, playerControlled]) => {
        const agent = tc.model.getAgentModel(agentId);
        agent.setPlayerControlled(playerControlled);
        agent.health.setValue(0);
    }, [agentId, playerControlled]),
    
    // Gets an agent devoured, as one of the player's.
    devour = (page, agentId) => page.evaluate(agentId => {
        const agent = tc.model.getAgentModel(agentId);
        agent.setPlayerControlled(true);
        agent.paradox.setValue(agent.paradox.getMax());
    }, agentId),
    
    hauntingOf = (page, eventId) => page.evaluate(eventId => tc.legacy.getHaunting(eventId), eventId);
    

test('each of the player\'s agents lost gives the legacy agent skills in every new game', async ({page}) => {
    await routeLegacy(page);
    const problems = await startGame(page),
        start = await readAlpha(page);
    
    // Bravo dies at HQ and Charlie is devoured at the boats. Dying again doesn't count again,
    // nor does an agent the player doesn't control.
    await kill(page, 'BR');
    await devour(page, 'CH');
    await page.evaluate(() => tc.model.getAgentModel('BR').health.setValue(0));
    await kill(page, 'AL', false);
    expect(await page.evaluate(() => {
        const {agentModel, ...summary} = tc.legacy.getSummary();
        return {...summary, agent:agentModel.id};
    })).toEqual({devoured:1, died:1, hauntedCount:1, agent:'AL', bonuses:[['stealth', 4], ['investigation', 1]]});
    
    // The game in progress keeps what it started with. A new one starts Alpha ahead.
    expect(await readAlpha(page)).toEqual(start);
    await reloadGame(page, {briefExpected:true});
    expect(await readAlpha(page)).toEqual({stealth:start.stealth + 4, investigation:start.investigation + 1});
    
    // Saved with the game, so restoring it doesn't add them again.
    await page.evaluate(() => tc.getPersistenceManager().save());
    await reloadGame(page);
    expect(await readAlpha(page)).toEqual({stealth:start.stealth + 4, investigation:start.investigation + 1});
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an Event an agent was lost at is haunted in every game, by a line under its description', async ({page}) => {
    await routeLegacy(page);
    const problems = await startGame(page);
    
    // Lost at origin, but not at HQ, a hub.
    await devour(page, 'AL');
    await kill(page, 'BR');
    const haunting = await hauntingOf(page, 'origin');
    expect(HAUNTINGS).toContain(haunting);
    expect(await hauntingOf(page, 'time_corps_hq')).toBe('');
    expect(await hauntingOf(page, 'aftermath')).toBe('');
    
    // Still there in the next game, in italics after the description.
    await reloadGame(page, {briefExpected:true});
    expect(await hauntingOf(page, 'origin')).toBe(haunting);
    expect(await page.evaluate(haunting => {
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
        return [...document.querySelectorAll('i')].some(el => el.textContent === haunting && el.offsetParent !== null);
    }, haunting)).toBe(true);
    
    expect(problems.pageErrors).toEqual([]);
});

test('the ☠ button shows what\'s accrued, and clears it', async ({page}) => {
    await routeLegacy(page);
    const problems = await startGame(page),
        legacyBtn = page.getByRole('button', {name:'☠', exact:true});
    
    // Nothing yet.
    await legacyBtn.click();
    await expect(dialogTitle(page, 'Accrued Advantages')).toBeVisible();
    await expect(page.getByText(/^Nothing has accrued yet\. .* starts Alpha a little stronger/)).toBeVisible();
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    
    // Each loss is acknowledged, and then each agent's dossier shows.
    await kill(page, 'BR');
    await devour(page, 'CH');
    for (let i = 0; i < 2; i++) await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    for (const name of ['Bravo', 'Charlie']) await dismissAgentDossier(page, name);
    await legacyBtn.click();
    await expect(page.getByText('In past games 1 agent was devoured by chronovores and 1 died of their wounds, so Alpha starts each new game with +4 Stealth, +1 Investigation. 1 Event is haunted.', {exact:false})).toBeVisible();
    await page.getByRole('button', {name:'Clear', exact:true}).filter({visible:true}).click();
    
    expect(await page.evaluate(() => [tc.legacy.getSummary().devoured, tc.legacy.getHaunting('boats')])).toEqual([0, '']);
    const before = await readAlpha(page);
    await reloadGame(page, {briefExpected:true});
    expect(await readAlpha(page)).toEqual(before);
    
    expect(problems.pageErrors).toEqual([]);
});

test('without a legacy in the data, nothing accrues and there\'s no ☠ button', async ({page}) => {
    const problems = await startGame(page);
    await kill(page, 'BR');
    expect(await page.evaluate(() => [tc.legacy.isEnabled(), localStorage.getItem('tc.legacy')])).toEqual([false, null]);
    await expect(page.getByRole('button', {name:'☠', exact:true})).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});

test('a broken legacy is warned about, keeping what\'s usable', async ({page}) => {
    await routeLegacy(page, {
        agent:'AL', died:{'agent.skills.stealth':'1', 'agent.health':5, 'agent.skills.nope':2}, hauntings:['Fine.', ''], extra:1
    });
    const problems = await startGame(page);
    expect(problems.warnings).toEqual([
        'legacy died agent.skills.stealth must be a number (ignoring it): 1',
        'legacy died agent.health must be a skill, e.g. "agent.skills.luck" (ignoring it)',
        'legacy has unknown keys extra (ignoring them)',
        'legacy hauntings must be non-empty strings (ignoring it): '
    ]);
    
    // A skill that doesn't exist is warned about when it would be given.
    await kill(page, 'BR');
    await reloadGame(page, {briefExpected:true});
    expect(problems.warnings.slice(-1)).toEqual(['legacy names no skill nope (ignoring it)']);
    expect(problems.pageErrors).toEqual([]);
});
