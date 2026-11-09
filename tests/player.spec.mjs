// "player" names the player agent (init.json5's "playerAgent") in constraint expressions,
// check expressions, and set and adj keys, so data needn't name it by ID.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, queueRolls} from './helpers.mjs';

const routePlayer = (page, playerAgent) => {
        page.route('**/tests/data/init.json5', route => {
            const json = readTestData('init.json5');
            if (playerAgent) json.playerAgent = playerAgent;
            return route.fulfill({json});
        });
        return page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5'),
                origin = json.events.origin;
            // A constraint expression.
            origin.values.playerFaction = {name:'Player Faction', value:'player.faction'};
            origin.actions ??= {};
            origin.actions.recruit = {
                label:'Recruit', skillCheck:{difficulty:'no-roll'},
                // Once done, Alpha has no HQ for its flags to name.
                hidden:'event.actions.recruit.doneCount > 0',
                // A check expression.
                available:"player.faction !== 'unaligned'",
                // Keys, set and adj, with check expressions for amounts.
                set:{'player.faction':"'unaligned'", 'player.skills.stealth':{onSuccess:'player.skills.stealth + 10'}},
                adj:{'player.chronal':'player.chronal.value >= 0 ? 2 : 0', 'player.hq.chronal':'1'}
            };
            return route.fulfill({json});
        });
    },

    readPlayer = page => page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            origin = tc.model.getEventModel('origin');
        return {
            valueFaction:origin.getValueModels().playerFaction.value,
            faction:alpha.getFaction(),
            stealth:alpha.getSkill('stealth'),
            chronal:alpha.chronal.value,
            pool:tc.model.getEventModel('time_corps_hq').chronal.value,
            recruitAvailable:origin.getActionModels().recruit.isAvailableFor(alpha)
        };
    });

test('player names the player agent in expressions and keys', async ({page}) => {
    await routePlayer(page, 'AL');
    const problems = await startGame(page);

    const before = await readPlayer(page);
    expect(before).toMatchObject({valueFaction:'timecorps', faction:'timecorps', recruitAvailable:true});

    await queueRolls(page, 999);
    await page.evaluate(() => tc.model.getAgentModel('AL').doAction(tc.model.getEventModel('origin').getActionModels().recruit));

    // Alpha's HQ is worked out as the action is taken, before the set moves them out of the Corps.
    await expect.poll(() => readPlayer(page)).toEqual({
        valueFaction:'unaligned', faction:'unaligned', stealth:before.stealth + 10,
        chronal:before.chronal + 2, pool:before.pool + 1, recruitAvailable:false
    });

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('player without a playerAgent is warned about, and the keys ignored', async ({page}) => {
    await routePlayer(page, null);
    const problems = await startGame(page);
    expect(problems.warnings.some(w => w.includes('names the player agent, but there\'s no playerAgent (ignoring it)'))).toBe(true);
    expect(problems.warnings.some(w => w.includes('Scope "player" names the player agent, but there\'s no playerAgent'))).toBe(true);
});

test('"player" names the player agent in a mission\'s agent IDs', async ({page}) => {
    // The first mission reveals, awards and selects Alpha, the player agent here, by ID.
    await routePlayer(page, 'AL');
    await page.route('**/tests/data/test_operations.json5', route => {
        const json = readTestData('test_operations.json5'),
            first = json.operations.first;
        first.onSetup = {...first.onSetup, revealAgents:'player', awardAgents:['player'], initialAgentSelection:'player'};
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    await expect.poll(() => page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        return [alpha.isNotHidden(), alpha.playerControlled, tc.app.getTeamView().getSelectedAgentId()];
    })).toEqual([true, true, 'AL']);
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
