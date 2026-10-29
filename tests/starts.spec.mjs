// An Event's start can be an offset from the start or end of an Event loaded before it, e.g.
// {"endOf":"plan", "h":1}. It's worked out to a date as the Event loads.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const routeStarts = (page, starts) => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        for (const [eventId, start] of Object.entries(starts)) json.events[eventId].start = start;
        return route.fulfill({json});
    }),
    
    readStarts = (page, eventIds) => page.evaluate(eventIds => Object.fromEntries(
        eventIds.map(eventId => [eventId, new Date(tc.model.getEventModel(eventId).getStart()).toISOString()])
    ), eventIds);

test('a start can be an offset from the start or end of an earlier event, worked out to a date', async ({page}) => {
    // Each works out to the date the test data gives it.
    await routeStarts(page, {
        supply:{endOf:'plan', h:1},
        relay:{startOf:'supply', h:2},
        aftermath:{endOf:'origin', h:2, m:19},
        warnings:{startOf:'plan', h:-13}
    });
    const problems = await startGame(page);
    
    expect(await readStarts(page, ['supply', 'relay', 'aftermath', 'warnings'])).toEqual({
        supply:'1900-01-01T12:00:00.000Z',
        relay:'1900-01-01T14:00:00.000Z',
        aftermath:'1900-01-01T19:00:00.000Z',
        warnings:'1899-12-31T20:00:00.000Z'
    });
    expect(await page.evaluate(() => typeof tc.model.getEventModel('relay').getStart())).toBe('number');
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a start naming an event that isn\'t loaded yet, or given badly, is warned about', async ({page}) => {
    await routeStarts(page, {
        lever:{endOf:'aftermath'},
        signal:{startOf:'relay', endOf:'relay'},
        boats:{startOf:'boats'},
        backlog:{startOf:'plan', y:1}
    });
    // Their starts fall back to 0, which puts them out of order, so the game doesn't start.
    const problems = await startGame(page, {waitForReady:false});
    
    await expect.poll(() => problems.warnings).toEqual(expect.arrayContaining([
        'Event lever start endOf must name an Event loaded before this one (using 0): aftermath',
        'Event signal start must have one of "startOf" or "endOf" (using 0): {startOf: relay, endOf: relay}',
        'Event boats start startOf must name an Event loaded before this one (using 0): boats',
        'Event backlog start offset y must be one of w, d, h, m, s, ms with a number (ignoring it): 1'
    ]));
    expect(problems.warnings.some(warning => warning.startsWith('Event Ordering Issues'))).toBe(true);
    
    // The bad offset is ignored, so backlog starts with plan.
    expect(await readStarts(page, ['backlog'])).toEqual({backlog:'1900-01-01T09:00:00.000Z'});
    expect(problems.pageErrors).toEqual([]);
});
