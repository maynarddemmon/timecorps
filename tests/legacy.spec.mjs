// The legacy: each of the player's agents lost, devoured by chronovores or dead of their 
// wounds, gives init.json5's "legacy" agent skills at the start of every new game, and leaves 
// the Event they fell at haunted, in every game. It's kept in its own storage, apart from any
// save, until the player clears it. A loss is stored only once the game it happened in is saved
// or abandoned for a new one.
import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {startGame, reloadGame, clickAndReload, readTestData, dialogTitle, dismissAgentDossier} from './helpers.mjs';

const HAUNTINGS = ['A chill.', 'A whisper.', 'A shadow.'],
    GLITCHES = ['A stutter.', 'A skip.'],
    
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
    
    hauntingOf = (page, eventId) => page.evaluate(eventId => tc.legacy.getHaunting(eventId), eventId),
    
    visibleButton = (page, name) => page.getByRole('button', {name, exact:true}).filter({visible:true}),
    
    // Abandons the game for a new one, as the ⌫ button and the end of a game do.
    restartCampaign = page => clickAndReload(page, {
        click:() => page.evaluate(() => setTimeout(() => tc.app.doRestartCampaign()))
    }, {briefExpected:true}),
    
    // Saves the game with the ✇ button.
    saveGame = async page => {
        await visibleButton(page, '✇').click();
        await page.getByRole('button', {name:/Confirm/}).filter({visible:true}).click();
        await expect(dialogTitle(page, 'Save Succeeded')).toBeVisible();
        await visibleButton(page, 'Acknowledge').click();
    },
    
    storedDied = page => page.evaluate(() => JSON.parse(localStorage.getItem('tc.legacy'))?.died ?? 0),
    
    // Exports the game with the ↧ button, returning the file's record.
    exportGame = async page => {
        const [download] = await Promise.all([page.waitForEvent('download'), visibleButton(page, '↧').click()]);
        return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    },
    
    // Imports a record with the ↥ button, and reloads into it.
    importGame = async (page, record) => {
        await visibleButton(page, '↥').click();
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.getByRole('button', {name:/Confirm/}).filter({visible:true}).click()
        ]);
        await chooser.setFiles({name:'timecorps-save.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(record))});
        await expect(dialogTitle(page, 'Import Succeeded')).toBeVisible();
        await clickAndReload(page, visibleButton(page, 'Continue'));
    };
    

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
    })).toEqual({devoured:1, died:1, restarted:0, hauntedCount:1, glitchedCount:0, pocketCount:0, agent:'AL', bonuses:[['stealth', 4], ['investigation', 1]], credits:0});
    
    // The game in progress keeps what it started with. Abandoned, the next one starts Alpha 
    // ahead.
    expect(await readAlpha(page)).toEqual(start);
    await restartCampaign(page);
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
    await restartCampaign(page);
    expect(await hauntingOf(page, 'origin')).toBe(haunting);
    expect(await page.evaluate(haunting => {
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
        return [...document.querySelectorAll('i')].some(el => el.textContent === haunting && el.offsetParent !== null);
    }, haunting)).toBe(true);
    
    expect(problems.pageErrors).toEqual([]);
});

test('each restart adds credits to every new game, and leaves the Event the legacy agent was at glitched if they were alive', async ({page}) => {
    await routeLegacy(page, {agent:'AL', died:{'agent.skills.stealth':1}, restarted:{'timeline.credits':2}, hauntings:HAUNTINGS, glitches:GLITCHES});
    const problems = await startGame(page),
        credits = await page.evaluate(() => tc.model.getCredits()),
        glitchOf = eventId => page.evaluate(eventId => tc.legacy.getGlitch(eventId), eventId);
    
    // Alpha alive at origin: glitched.
    await restartCampaign(page);
    expect(await page.evaluate(() => tc.model.getCredits())).toBe(credits + 2);
    const glitch = await glitchOf('origin');
    expect(GLITCHES).toContain(glitch);
    
    // At HQ, a hub, nothing more is glitched; dead at the plan, neither. Each still adds credits.
    await page.evaluate(() => tc.model.getAgentModel('AL').setEvent('time_corps_hq'));
    await restartCampaign(page);
    await page.evaluate(() => tc.model.getAgentModel('AL').setEvent('plan'));
    await kill(page, 'AL');
    await restartCampaign(page);
    expect(await page.evaluate(() => [tc.model.getCredits(), tc.legacy.getSummary().restarted, tc.legacy.getSummary().glitchedCount]))
        .toEqual([credits + 6, 3, 1]);
    expect(await glitchOf('plan')).toBe('');
    
    // An Event both haunted and glitched shows both lines, the haunting first.
    await kill(page, 'AL');
    await restartCampaign(page);
    const haunting = await hauntingOf(page, 'origin');
    expect(await page.evaluate(() => {
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
        return [...document.querySelectorAll('i')].filter(el => el.offsetParent !== null).map(el => el.textContent);
    }).then(lines => lines.filter(line => line === haunting || line === glitch))).toEqual([haunting, glitch]);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a loss is stored only once its game is saved or abandoned, so reloading back to an earlier save forgets it', async ({page}) => {
    await routeLegacy(page);
    const problems = await startGame(page);
    await saveGame(page);
    
    // Bravo's death counts for now, but isn't stored.
    await kill(page, 'BR');
    expect(await page.evaluate(() => tc.legacy.getSummary().died)).toBe(1);
    expect(await storedDied(page)).toBe(0);
    
    // Reloaded back to the save, it never happened.
    await reloadGame(page);
    expect(await page.evaluate(() => [tc.model.getAgentModel('BR').isNotDead(), tc.legacy.getSummary().died])).toEqual([true, 0]);
    
    // Saved with the game, it's stored, and stays through a reload.
    await kill(page, 'BR');
    await visibleButton(page, 'Acknowledge').click();
    await dismissAgentDossier(page, 'Bravo');
    await saveGame(page);
    expect(await storedDied(page)).toBe(1);
    await reloadGame(page);
    expect(await page.evaluate(() => [tc.model.getAgentModel('BR').isNotDead(), tc.legacy.getSummary().died])).toEqual([false, 1]);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a save exports with the legacy, and importing it puts the legacy back, so its losses can\'t be had again', async ({page}) => {
    await routeLegacy(page);
    const problems = await startGame(page);
    await saveGame(page);
    
    // A pending loss goes with the export, as the game exported has it.
    await kill(page, 'DE');
    await visibleButton(page, 'Acknowledge').click();
    await dismissAgentDossier(page, 'Delta');
    const exported = await exportGame(page);
    expect(exported.legacy).toEqual({devoured:0, died:1, restarted:0, haunted:{}, glitched:{}, pockets:{}});
    
    // Import it, lose Bravo and save: 2 accrued.
    await importGame(page, exported);
    await kill(page, 'BR');
    await visibleButton(page, 'Acknowledge').click();
    await dismissAgentDossier(page, 'Bravo');
    await saveGame(page);
    expect(await storedDied(page)).toBe(2);
    
    // A save exported before the legacy went with it leaves the legacy alone.
    const {legacy:_legacy, ...older} = exported;
    await importGame(page, older);
    expect(await storedDied(page)).toBe(2);
    
    // Importing it again takes the legacy back to the export's, and Bravo is alive again.
    await importGame(page, exported);
    expect(await storedDied(page)).toBe(1);
    expect(await page.evaluate(() => [tc.model.getAgentModel('BR').isNotDead(), tc.legacy.getSummary().died])).toEqual([true, 1]);
    
    expect(problems.warnings).toEqual([]);
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
    await expect(page.getByText('In past games 1 agent was devoured by chronovores and 1 died of their wounds, and you started over 0 times. So Alpha starts each new game with +4 Stealth, +1 Investigation, and the game with 0 extra credits. 1 Event is haunted, 0 glitched, and 0 hold pockets of stray chronal.To clear them, type RESET below.', {exact:false})).toBeVisible();
    
    // Clearing can't be undone, so Clear waits for RESET to be typed, exactly.
    const clearBtn = page.getByRole('button', {name:'Clear', exact:true}).filter({visible:true}),
        field = page.getByRole('textbox').filter({visible:true});
    await expect(clearBtn).toHaveClass(/disabled/);
    await field.fill('reset');
    await expect(clearBtn).toHaveClass(/disabled/);
    await field.press('Enter');
    await clearBtn.click();
    await expect(dialogTitle(page, 'Accrued Advantages')).toBeVisible();
    
    // Cancelled, nothing's cleared.
    await page.getByRole('button', {name:/Cancel/}).filter({visible:true}).click();
    expect(await page.evaluate(() => tc.legacy.getSummary().devoured)).toBe(1);
    
    // The field starts empty each time.
    await legacyBtn.click();
    await expect(field).toHaveValue('');
    await field.fill('RESET');
    await expect(clearBtn).not.toHaveClass(/disabled/);
    await clearBtn.click();
    
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
        'legacy died agent.health must be a skill, e.g. "agent.skills.luck", or "timeline.credits" (ignoring it)',
        'legacy has unknown keys extra (ignoring them)',
        'legacy hauntings must be non-empty strings (ignoring it): '
    ]);
    
    // A skill that doesn't exist is warned about when it would be given.
    await kill(page, 'BR');
    await restartCampaign(page);
    expect(problems.warnings.slice(-1)).toEqual(['legacy names no skill nope (ignoring it)']);
    expect(problems.pageErrors).toEqual([]);
});

test('each restart leaves pockets of chronal where there was paradox, which later games hold until harvested', async ({page}) => {
    await routeLegacy(page, {agent:'AL', paradoxPerChronal:3});
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.relay.chronoLocked = 'true';
        json.events.plan.paradox = {value:0, max:15};
        return route.fulfill({json});
    });
    const problems = await startGame(page),
        setParadox = (eventId, paradox) => page.evaluate(([eventId, paradox]) => tc.model.getEventModel(eventId).paradox.setValue(paradox), [eventId, paradox]),
        setChronal = (eventId, chronal) => page.evaluate(([eventId, chronal]) => tc.model.getEventModel(eventId).chronal.setValue(chronal), [eventId, chronal]),
        readChronal = eventId => page.evaluate(eventId => {
            const {value, max} = tc.model.getEventModel(eventId).chronal;
            return {value, max, pocket:tc.legacy.getPocket(eventId)};
        }, eventId),
        storedPockets = () => page.evaluate(() => JSON.parse(localStorage.getItem('tc.legacy'))?.pockets),
        // Paradox spreads, so what each Event is left with is read back as the game ends.
        expectedPockets = () => page.evaluate(() => Object.fromEntries(tc.model.getEventModelsAsList()
            .filter(e => e.paradox.value > 0 && e.isNotHub() && e.isNotChronoLocked())
            .map(e => [e.id, Math.ceil(e.paradox.value / 3)])));
    
    // 3 paradox to 1 chronal, rounded up. Not at a chrono locked Event, or a hub.
    await setParadox('plan', 12);
    await setParadox('supply', 1);
    await setParadox('relay', 4);
    await setParadox('time_corps_hq', 4);
    const firstPockets = await expectedPockets();
    expect(firstPockets).toMatchObject({plan:4, supply:1});
    await restartCampaign(page);
    expect(await storedPockets()).toEqual(firstPockets);
    expect(await readChronal('plan')).toEqual({value:4, max:5, pocket:4});
    expect(await readChronal('supply')).toEqual({value:1, max:5, pocket:1});
    expect(await page.evaluate(() => [tc.model.getEventModel('relay').chronal.value, tc.legacy.getPocket('relay'), tc.legacy.getPocket('time_corps_hq')])).toEqual([0, 0, 0]);
    expect(await page.evaluate(() => tc.legacy.getSummary().pocketCount)).toBe(Object.keys(firstPockets).length);
    
    // Chronal released into the Event and gathered back doesn't touch the pocket; gathering
    // below it harvests it. That's pending until the game is saved.
    await setChronal('plan', 5);
    await setChronal('plan', 4);
    expect(await readChronal('plan')).toEqual({value:4, max:5, pocket:4});
    await setChronal('plan', 1);
    expect(await readChronal('plan')).toEqual({value:1, max:5, pocket:1});
    await setChronal('supply', 0);
    expect(await page.evaluate(() => tc.legacy.getPocket('supply'))).toBe(0);
    expect(await storedPockets()).toEqual(firstPockets);
    await saveGame(page);
    const {supply:_supply, ...harvested} = firstPockets;
    expect(await storedPockets()).toEqual({...harvested, plan:1});
    
    // Released back after harvesting, it's the agent's chronal, not the pocket's.
    await setChronal('plan', 3);
    expect(await readChronal('plan')).toEqual({value:3, max:5, pocket:1});
    
    // What's left adds to the next game's, and the Event's max rises to hold it.
    await setParadox('plan', 15);
    await restartCampaign(page);
    expect(await readChronal('plan')).toEqual({value:6, max:6, pocket:6});
    
    // The raised max, and what's held, outlast a reload of a save.
    await setChronal('plan', 2);
    await saveGame(page);
    await reloadGame(page);
    expect(await readChronal('plan')).toEqual({value:2, max:6, pocket:2});
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('without paradoxPerChronal no pockets are left', async ({page}) => {
    await routeLegacy(page, {agent:'AL'});
    const problems = await startGame(page);
    await page.evaluate(() => tc.model.getEventModel('plan').paradox.setValue(12));
    await restartCampaign(page);
    expect(await page.evaluate(() => [tc.model.getEventModel('plan').chronal.value, tc.legacy.getSummary().pocketCount])).toEqual([0, 0]);
    expect(problems.warnings).toEqual([]);
});
