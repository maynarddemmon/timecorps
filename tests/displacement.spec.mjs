// When an Event is hidden, written out of history, the agents in it are displaced: to the
// earliest later Event at the same location, else the nearest at the locations beside it, else
// The Void, devoured. They gain as much paradox as jumping there would cost in chronal, less
// the paradox they carry and their causal stability, but at least a minimum.
// Test data columns, in order: office, tower, deck (lever, origin, aftermath), yard (boats),
// radio, port (finale).
import {test, expect} from '@playwright/test';
import {startGame, dialogTitle, dismissAgentDossier} from './helpers.mjs';

const setHidden = (page, eventId, hidden) => page.evaluate(([eventId, hidden]) => tc.model.getEventModel(eventId).setHidden(hidden), [eventId, hidden]),

    readAgent = (page, agentId) => page.evaluate(agentId => {
        const agent = tc.model.getAgentModel(agentId);
        return {event:agent.event, paradox:agent.paradox.value, devoured:agent.isDevoured(), dead:agent.isDead()};
    }, agentId),

    /*  What jumping from where the agent is to an Event would cost them in chronal. */
    jumpCost = (page, agentId, eventId) => page.evaluate(([agentId, eventId]) =>
        tc.getChronalToDeploy(tc.model.getAgentModel(agentId), tc.model.getEventModel(eventId)), [agentId, eventId]),

    /*  The paradox displacement to an Event would add: the jump's chronal, less the paradox
        the agent already has and a point for each 100 of causal stability, but at least the
        minimum. */
    displacementParadox = (page, agentId, eventId) => page.evaluate(([agentId, eventId]) => {
        const agent = tc.model.getAgentModel(agentId),
            cost = tc.getChronalToDeploy(agent, tc.model.getEventModel(eventId));
        return Math.max(tc.cfg.DISPLACEMENT_MIN_PARADOX, Math.round(cost - agent.paradox.value - agent.getSkill('causalStability') / tc.cfg.DISPLACEMENT_CAUSAL_STABILITY_DIVISOR));
    }, [agentId, eventId]);

test('an agent goes to the next Event at the same location, gaining paradox for the jump, and is told so', async ({page}) => {
    const problems = await startGame(page);
    const gain = await displacementParadox(page, 'AL', 'aftermath'),
        before = await readAgent(page, 'AL');
    expect(gain).toBeGreaterThan(0);

    await setHidden(page, 'origin', true);
    await expect.poll(() => readAgent(page, 'AL')).toMatchObject({event:'aftermath', paradox:before.paradox + gain, devoured:false});
    await expect(dialogTitle(page, 'Agent Displaced : Alpha')).toBeVisible();
    await expect(page.getByText(`Origin has been written out of history. Alpha was there, and has been thrown forward to Aftermath, gaining ${gain === 1 ? '1 point' : gain + ' points'} of paradox.`)).toBeVisible();

    // It's a visit, by time travel, in the agent's history.
    expect(await page.evaluate(() => {
        const {event, isTimeTravel} = tc.model.getAgentModel('AL').getVisitHistory().at(-1);
        return {event:event.id, isTimeTravel};
    })).toEqual({event:'aftermath', isTimeTravel:true});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('with nothing later at the location, the nearest location beside it on the timeline', async ({page}) => {
    const problems = await startGame(page);

    // Alpha at Aftermath, the last at the deck. Finale is three columns over, the only
    // Event later than it once shown.
    // (The test data's paradox limit is low, so it's raised to leave room for the jump.)
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.paradox.setMax(100);
        alpha.setEvent('aftermath');
        tc.model.getEventModel('finale').attestation.setValue(10);
    });
    const gain = await displacementParadox(page, 'AL', 'finale'),
        before = await readAgent(page, 'AL');

    await setHidden(page, 'aftermath', true);
    await expect.poll(() => readAgent(page, 'AL')).toMatchObject({event:'finale', paradox:before.paradox + gain});

    expect(problems.pageErrors).toEqual([]);
});

test('paradox already carried and causal stability lessen the paradox gained, down to the minimum', async ({page}) => {
    const problems = await startGame(page);

    // A long jump: Alpha at Aftermath, Finale shown.
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.paradox.setMax(1000);
        alpha.setEvent('aftermath');
        tc.model.getEventModel('finale').attestation.setValue(10);
    });
    const cost = await jumpCost(page, 'AL', 'finale');
    expect(cost).toBeGreaterThan(3);

    // 1 paradox and 100 causal stability take 2 off.
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.paradox.setValue(1);
        alpha.getSkills().causalStability = 100;
    });
    await setHidden(page, 'aftermath', true);
    await expect.poll(() => readAgent(page, 'AL')).toMatchObject({event:'finale', paradox:1 + cost - 2});

    // With plenty of causal stability, it's just the minimum.
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.getSkills().causalStability = 1000;
        tc.model.getEventModel('aftermath').setHidden(false);
        alpha.setEvent('aftermath');
    });
    const before = (await readAgent(page, 'AL')).paradox;
    // Arriving at Finale again is a revisit, whose own paradox is resisted.
    await page.evaluate(() => tc.rng.queueRolls(...Array(20).fill(999)));
    await setHidden(page, 'aftermath', true);
    await expect.poll(() => readAgent(page, 'AL')).toMatchObject({event:'finale', paradox:before + 1});
    await page.evaluate(() => tc.rng.clearQueuedRolls());

    expect(problems.pageErrors).toEqual([]);
});

test('an earlier Event in a nearer column wins, and hubs and locked Events don\'t count', async ({page}) => {
    const problems = await startGame(page);

    // Charlie, at boats in the yard (the 30th), hidden and not player-controlled. The deck, 
    // one column left, has Origin (the 1st, 16:40); the radio, one right, Warnings (the 
    // 31st). Warnings is earlier, so it wins.
    await page.evaluate(() => {
        tc.model.getAgentModel('CH').paradox.setMax(100);
        tc.model.getAgentModel('CH').setPlayerControlled(false);
        tc.model.getEventModel('boats').attestation.setValue(10);
        tc.model.getEventModel('warnings').attestation.setValue(10);
    });
    await setHidden(page, 'boats', true);
    await expect.poll(async () => (await readAgent(page, 'CH')).event).toBe('warnings');
    
    // Locked, it doesn't count, and Origin does.
    await page.evaluate(() => {
        tc.model.getAgentModel('CH').setEvent('boats');
        tc.model.getEventModel('boats').setHidden(false);
        tc.model.getEventModel('warnings').setChronoLocked(true);
    });
    await setHidden(page, 'boats', true);
    await expect.poll(async () => (await readAgent(page, 'CH')).event).toBe('origin');

    // No dialog for an agent the player doesn't control.
    await expect(dialogTitle(page, 'Agent Displaced : Charlie')).toHaveCount(0);

    expect(problems.pageErrors).toEqual([]);
});

test('with nowhere to go, or too much paradox, the agent is devoured', async ({page}) => {
    const problems = await startGame(page);

    // Nowhere: everything but Origin hidden.
    await setHidden(page, 'aftermath', true);
    await setHidden(page, 'origin', true);
    await expect.poll(() => readAgent(page, 'AL')).toMatchObject({event:'the_void', devoured:true});
    await expect(dialogTitle(page, 'Agent Devoured : Alpha')).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
});

test('paradox from the jump can devour the agent', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const paradox = tc.model.getAgentModel('AL').paradox;
        paradox.setValue(paradox.getMax() - 1);
    });
    await setHidden(page, 'origin', true);
    await expect.poll(() => readAgent(page, 'AL')).toMatchObject({event:'the_void', devoured:true});

    expect(problems.pageErrors).toEqual([]);
});

test('the dead stay where they are, and nothing moves when an Event is shown', async ({page}) => {
    const problems = await startGame(page);

    await page.evaluate(() => tc.model.getAgentModel('AL').health.setValue(0));
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    await dismissAgentDossier(page, 'Alpha');
    await setHidden(page, 'origin', true);
    await page.waitForTimeout(200);
    expect(await readAgent(page, 'AL')).toMatchObject({event:'origin', dead:true, devoured:false});

    expect(problems.pageErrors).toEqual([]);
});
