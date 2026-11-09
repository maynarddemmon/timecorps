// init.json5's "playerAgent" is the player's own agent. An agent marked playerControlled is
// the player's only while in the player agent's faction: otherwise they can't be directed or
// trained, show as an NPC, and their losses don't count for the legacy.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const routePlayerAgent = (page, playerAgent) => page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.playerAgent = playerAgent;
        json.legacy = {died:{'agent.skills.stealth':1}};
        return route.fulfill({json});
    }),

    // Alpha (Time Corps) is the player agent. Bravo, unaligned, is revealed, marked theirs, and
    // put at origin.
    setup = page => page.evaluate(() => {
        const bravo = tc.model.getAgentModel('BR');
        bravo.setHidden(false);
        bravo.setPlayerControlled(true);
        bravo.setEvent('origin');
    }),

    controlled = page => page.evaluate(() => ['AL', 'BR'].filter(id => tc.model.getAgentModel(id).isPlayerControlled())),

    bravoRowNote = page => page.getByText('Not taking direction from you', {exact:true}).filter({visible:true});

test('an agent marked playerControlled is the player\'s only in the player agent\'s faction', async ({page}) => {
    await routePlayerAgent(page, 'AL');
    const problems = await startGame(page);
    await setup(page);
    expect(await controlled(page)).toEqual(['AL']);
    expect(await page.evaluate(() => tc.model.getPlayerAgentModel().id)).toBe('AL');

    // Event Details doesn't offer Bravo's actions or exits.
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect(bravoRowNote(page)).toHaveCount(1);

    // Bravo joins the Corps: theirs.
    await page.evaluate(() => tc.model.getAgentModel('BR').setFaction('timecorps'));
    expect(await controlled(page)).toEqual(['AL', 'BR']);
    await expect(bravoRowNote(page)).toHaveCount(0);

    // Alpha leaves it: Bravo isn't, but Alpha, the player agent, still is. Event Details
    // follows without being reselected.
    await page.evaluate(() => tc.model.getAgentModel('AL').setFaction('unaligned'));
    expect(await controlled(page)).toEqual(['AL']);
    await expect(bravoRowNote(page)).toHaveCount(1);

    // Nor can Bravo be trained.
    expect(await page.evaluate(() => tc.model.getAgentModel('BR').getSkillPurchaseProblem('stealth'))).toBe('Not taking direction from you');

    // Bravo dying isn't the player's loss.
    await page.evaluate(() => tc.model.getAgentModel('BR').health.setValue(0));
    expect(await page.evaluate(() => tc.legacy.getSummary().died)).toBe(0);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('without a playerAgent, playerControlled alone decides, and an unknown one is warned about', async ({page}) => {
    await routePlayerAgent(page, 'ZZ');
    const problems = await startGame(page);
    await setup(page);
    expect(await controlled(page)).toEqual(['AL', 'BR']);
    expect(problems.warnings.some(w => w.includes('playerAgent names no Agent: ZZ'))).toBe(true);
});
