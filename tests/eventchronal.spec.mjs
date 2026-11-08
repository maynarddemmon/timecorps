// Every Event holds stray chronal, by default 0 of at most 5. An HQ's is the pool its agents
// reload from, e.g. "chronal":{"value":25, "max":100}. Changes can name it as "event.chronal",
// "events.<id>.chronal", or the HQ of an agent's Faction, "agent.hq.chronal" or
// "agents.<id>.hq.chronal".
import {test, expect} from '@playwright/test';
import {startGame, readTestData, reloadGame} from './helpers.mjs';

const routeChronal = async page => {
    // The HQ is shown, so it can be selected.
    await page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.events.time_corps_hq.hidden = 'false';
        return route.fulfill({json});
    });
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5'),
            events = json.events;
        events.plan.chronal = 3;
        events.relay.chronal = {value:2, max:10};
        events.signal.chronal = {max:4};
        events.aftermath.chronoLocked = 'true';
        events.origin.actions.tithe = {
            label:'Tithe', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null},
            adj:{'agent.hq.chronal':'5', 'event.chronal':'1'}
        };
        return route.fulfill({json});
    });
};

const readChronal = (page, eventIds) => page.evaluate(eventIds => Object.fromEntries(eventIds.map(id => {
        const {min, value, max} = tc.model.getEventModel(id).chronal;
        return [id, [min, value, max]];
    })), eventIds),
    
    // The chronal bar in Event Details for an Event, or null if it isn't shown.
    // Selects an Event, and reads the chronal bar in Event Details, spaces normalized, or 
    // null if it isn't shown. The bar catches up after the selection, so poll it.
    selectEvent = (page, eventId) => page.evaluate(eventId => tc.app.selectEventBox(eventId), eventId),
    readBar = page => page.evaluate(() => {
        const bar = tc.app.getEventDetailsView().chronalBar;
        return bar.visible ? bar.getIDE().textContent.replace(/\s+/g, ' ').trim() : null;
    });

test('an Event holds 0 of at most 5 stray chronal unless its data says otherwise, as an amount or {value, max}, whose value defaults to 0', async ({page}) => {
    await routeChronal(page);
    const problems = await startGame(page);
    expect(await readChronal(page, ['origin', 'plan', 'relay', 'signal', 'time_corps_hq'])).toEqual({
        origin:[0, 0, 5], plan:[0, 3, 5], relay:[0, 2, 10], signal:[0, 0, 4], time_corps_hq:[0, 25, 100]
    });
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an action can add to its Event\'s and its agent\'s HQ\'s chronal, which is saved, and Event Details shows it', async ({page}) => {
    await routeChronal(page);
    const problems = await startGame(page);

    await page.evaluate(() => {
        const origin = tc.model.getEventModel('origin');
        tc.model.getAgentModel('AL').doAction(origin.getActionModels().tithe);
    });
    expect(await readChronal(page, ['origin', 'time_corps_hq'])).toEqual({origin:[0, 1, 5], time_corps_hq:[0, 30, 100]});

    await page.evaluate(() => tc.getPersistenceManager().save());
    await reloadGame(page);
    expect(await readChronal(page, ['origin', 'time_corps_hq'])).toEqual({origin:[0, 1, 5], time_corps_hq:[0, 30, 100]});

    // An HQ's is its pool. Any other Event's shows where it can be moved, so not where it's
    // chrono locked, unless it holds some.
    await selectEvent(page, 'time_corps_hq');
    await expect.poll(() => readBar(page)).toMatch(/^HQ .* Pool: 30 \/ 100$/);
    await selectEvent(page, 'origin');
    await expect.poll(() => readBar(page)).toMatch(/^Stray .*: 1 \/ 5$/);
    await selectEvent(page, 'aftermath');
    await expect.poll(() => readBar(page)).toBeNull();

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
