// Time travel leaves some of the chronal it used in the Event left, as stray chronal anyone
// can gather: log2 of the chronal used, rounded down, unless the Event is a hub, and up to
// what the Event can hold.
import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

// Travels Alpha from one Event to another, returning the chronal used and the residue left.
const travel = (page, fromId, toId) => page.evaluate(([fromId, toId]) => {
    const alpha = tc.model.getAgentModel('AL'),
        from = tc.model.getEventModel(fromId);
    alpha.setEvent(fromId);
    alpha.chronal.setValue(alpha.chronal.getMax());
    const agentBefore = alpha.chronal.value,
        eventBefore = from.chronal.value;
    alpha.doDeployToEvent(tc.model.getEventModel(toId), null, false);
    return {
        at:alpha.getEventModel().id,
        used:agentBefore - alpha.chronal.value,
        residue:from.chronal.value - eventBefore,
        held:from.chronal.value
    };
}, [fromId, toId]);

test('the residue is log2 of the chronal used, rounded down', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => [0, 1, 2, 3, 4, 7, 8, 15, 16].map(tc.getChronalResidue))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
});

test('time travel leaves residue in the Event left, but not a hub, and no more than it holds', async ({page}) => {
    const problems = await startGame(page);

    const first = await travel(page, 'origin', 'finale');
    expect(first.at).toBe('finale');
    expect(first.used).toBeGreaterThan(1);
    expect(first.residue).toBe(Math.floor(Math.log2(first.used)));

    // A full Event takes no more.
    await page.evaluate(() => {const chronal = tc.model.getEventModel('origin').chronal; chronal.setValue(chronal.getMax());});
    const full = await travel(page, 'origin', 'finale');
    expect(full).toMatchObject({at:'finale', residue:0, held:5});

    // Recalled from an Event, the residue is left there; leaving a hub leaves none.
    const recall = await travel(page, 'finale', 'time_corps_hq');
    expect(recall.at).toBe('time_corps_hq');
    expect(recall.residue).toBe(Math.floor(Math.log2(recall.used)));
    const fromHQ = await travel(page, 'time_corps_hq', 'plan');
    expect(fromHQ.at).toBe('plan');
    expect(fromHQ.used).toBeGreaterThan(1);
    expect(fromHQ.residue).toBe(0);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
