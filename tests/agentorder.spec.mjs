// In Event Details, the agents at an Event are listed by how far through it they are, earliest
// first, and agents at the same time by arrival, latest first.
import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const readAgentNames = page => page.evaluate(() =>
        [...document.querySelectorAll('.myt-EventDetails .myt-AgentRow')]
            .map(row => ['Alpha', 'Bravo'].find(name => row.textContent.includes(name)))
    ),

    // Lives through a third of Origin, 20 seconds.
    investigate = (page, agentId) => page.evaluate(agentId => {
        tc.rng.queueRolls(999);
        const agentModel = tc.model.getAgentModel(agentId);
        agentModel.doAction(agentModel.getEventModel().getActionModels()._investigate);
        tc.rng.clearQueuedRolls();
    }, agentId);

test('agents are listed by their time at the Event, then latest arrival first', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        tc.model.revealAgents(['BR']);
        tc.model.awardAgents(['BR']);
        tc.model.getAgentModel('BR').setEvent('origin');
        tc.app.selectEventBox('origin');
    });

    // Both at the start, so Bravo, who arrived after Alpha, comes first.
    await expect.poll(() => readAgentNames(page)).toEqual(['Bravo', 'Alpha']);

    // Bravo is 20 seconds in, so later than Alpha.
    await investigate(page, 'BR');
    await expect.poll(() => readAgentNames(page)).toEqual(['Alpha', 'Bravo']);

    // Alpha catches up, so it's by arrival again, then goes past.
    await investigate(page, 'AL');
    await expect.poll(() => readAgentNames(page)).toEqual(['Bravo', 'Alpha']);
    await investigate(page, 'AL');
    await expect.poll(() => readAgentNames(page)).toEqual(['Bravo', 'Alpha']);
    await investigate(page, 'BR');
    await investigate(page, 'BR');
    await expect.poll(() => readAgentNames(page)).toEqual(['Alpha', 'Bravo']);

    expect(problems.pageErrors).toEqual([]);
});
