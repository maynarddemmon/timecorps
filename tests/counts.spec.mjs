// Counts the engine keeps: how many times each action has been taken (attemptCount), and how many
// times actions have changed each value (flipCount). Expressions can read both.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData} from './helpers.mjs';

const NO_ROLL = {difficulty:'no-roll'},

    /*  Serves the test scenario with an action at the origin, where Alpha starts, that gives
        a paradox every time after the first, and is hidden after three tries. */
    routeScenarioWithCounts = page => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.origin.actions.poke = {
            label:'Poke', skillCheck:{difficulty:250},
            effects:{'agent.paradox':{
                onSuccess:'event.actions.poke.attemptCount >= 1 ? 1 : 0',
                onFailure:'event.actions.poke.attemptCount >= 1 ? 1 : 0'
            }},
            hidden:'event.actions.poke.attemptCount >= 3'
        };
        // Prepare and unprepare toggle the plan's prepared value, which the relay's ready
        // value follows.
        json.events.plan.actions.prepare.skillCheck = NO_ROLL;
        json.events.plan.actions.unprepare.skillCheck = NO_ROLL;
        return route.fulfill({json});
    }),

    /*  An agent takes an action with the rolls queued, from a fresh start: their actions back
        and no paradox. Returns the counts and the agent's paradox after. */
    takeAction = (page, agentId, eventId, actionId, ...rolls) => page.evaluate(([agentId, eventId, actionId, rolls]) => {
        const agent = tc.model.getAgentModel(agentId),
            event = tc.model.getEventModel(eventId),
            action = event.getActionModels()[actionId];
        if (agent.event !== eventId) agent.setEvent(eventId);
        agent.setActionExecCount(0);
        agent.paradox.setValue(0);
        tc.rng.queueRolls(...rolls);
        agent.doAction(action);
        tc.rng.clearQueuedRolls();
        return {attemptCount:action.attemptCount, paradox:agent.paradox.value, hidden:action.isHidden()};
    }, [agentId, eventId, actionId, rolls]),

    readFlips = page => page.evaluate(() => {
        const plan = tc.model.getEventModel('plan'),
            relay = tc.model.getEventModel('relay');
        return {
            prepared:plan.values.prepared.value, preparedFlips:plan.values.prepared.flipCount,
            ready:relay.values.ready.value, readyFlips:relay.values.ready.flipCount
        };
    });

test('attemptCount counts every take, pass or fail, and effects and constraints can use it', async ({page}) => {
    await routeScenarioWithCounts(page);
    const problems = await startGame(page);

    // Effects see the count before this take, so the first is free.
    expect(await takeAction(page, 'AL', 'origin', 'poke', 0)).toEqual({attemptCount:1, paradox:0, hidden:false});
    expect(await takeAction(page, 'AL', 'origin', 'poke', 999)).toEqual({attemptCount:2, paradox:1, hidden:false});
    expect(await takeAction(page, 'AL', 'origin', 'poke', 0)).toEqual({attemptCount:3, paradox:1, hidden:true});

    // Once hidden by its count, the button is gone.
    await page.evaluate(() => {
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
    });
    await expect(page.getByText(/^Poke/).filter({visible:true})).toHaveCount(0);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('flipCount counts changes an action makes, not changes that follow from other values', async ({page}) => {
    await routeScenarioWithCounts(page);
    const problems = await startGame(page);
    expect(await readFlips(page)).toEqual({prepared:false, preparedFlips:0, ready:false, readyFlips:0});

    await takeAction(page, 'AL', 'plan', 'prepare');
    // The relay's ready value follows, but no action set it.
    expect(await readFlips(page)).toEqual({prepared:true, preparedFlips:1, ready:true, readyFlips:0});

    await takeAction(page, 'AL', 'plan', 'unprepare');
    expect(await readFlips(page)).toEqual({prepared:false, preparedFlips:2, ready:false, readyFlips:0});

    // Setting a value to what it already is isn't a flip.
    await page.evaluate(() => tc.model.getEventModel('plan').values.prepared.setValueByAction('false'));
    expect((await readFlips(page)).preparedFlips).toBe(2);

    // Each action counts its own takes.
    const prepare = await takeAction(page, 'AL', 'plan', 'prepare');
    expect((await readFlips(page)).preparedFlips).toBe(3);
    expect(prepare.attemptCount).toBe(2);

    // Constraints can follow it.
    expect(await page.evaluate(() => {
        const prepared = tc.model.getEventModel('plan').values.prepared;
        prepared.setHidden('event.values.prepared.flipCount >= 4');
        const before = prepared.isHidden();
        prepared.setValueByAction('false');
        return [before, prepared.isHidden()];
    })).toEqual([false, true]);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('counts survive a save and reload, are saved only once changed, and restoring doesn\'t add to them', async ({page}) => {
    await routeScenarioWithCounts(page);
    const problems = await startGame(page);

    // Untouched, nothing is saved.
    let diff = await page.evaluate(() => tc.persistence.exportDiff());
    expect(diff.events?.plan).toBeUndefined();

    await takeAction(page, 'AL', 'plan', 'prepare');
    await takeAction(page, 'AL', 'plan', 'unprepare');
    await takeAction(page, 'AL', 'plan', 'prepare');
    diff = await page.evaluate(() => tc.persistence.exportDiff());
    expect(diff.events.plan.values.prepared).toEqual({value:'true', flipCount:3});
    expect(diff.events.plan.actions).toEqual({prepare:{attemptCount:2,doneCount:2}, unprepare:{attemptCount:1,doneCount:1}});
    expect(diff.events.relay).toBeUndefined();

    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await readFlips(page)).toEqual({prepared:true, preparedFlips:3, ready:true, readyFlips:0});
    expect(await page.evaluate(() => {
        const actions = tc.model.getEventModel('plan').getActionModels();
        return [actions.prepare.attemptCount, actions.unprepare.attemptCount];
    })).toEqual([2, 1]);
    expect(problems.pageErrors).toEqual([]);
});
