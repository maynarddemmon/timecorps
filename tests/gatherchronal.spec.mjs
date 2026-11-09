// The game's default Gather Chronal and Release Chronal, from data/init.json5: anywhere not
// chrono locked, an agent can gather an Event's stray chronal into their own, or release theirs
// into it, 1 at a time and taking no action. Both roll, so the rolls are pinned to pass.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, readJson, queueRolls} from './helpers.mjs';

const GAME_INIT = readJson('data/init.json5'),

    // The actions, and the action group they're shown in.
    routeGameChronalActions = page => page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        for (const id of ['_gatherChronal', '_releaseChronal']) {
            const action = json.defaultEventActions[id] = GAME_INIT.defaultEventActions[id];
            if (action.group) (json.actionGroups ??= {})[action.group] = GAME_INIT.actionGroups[action.group];
        }
        return route.fulfill({json});
    }),

    readAt = (page, eventId) => page.evaluate(eventId => {
        const eventModel = tc.model.getEventModel(eventId),
            alpha = tc.model.getAgentModel('AL'),
            actions = eventModel.getActionModels(),
            shown = id => actions[id] && !actions[id].isHiddenFor(alpha);
        return {
            gather:shown('_gatherChronal'), release:shown('_releaseChronal'),
            agent:alpha.chronal.value, event:eventModel.chronal.value, actionsLeft:alpha.getActionsRemaining()
        };
    }, eventId),

    take = async(page, eventId, actionId) => {
        await queueRolls(page, 999);
        await page.evaluate(([eventId, actionId]) => {
            tc.model.getAgentModel('AL').doAction(tc.model.getEventModel(eventId).getActionModels()[actionId]);
        }, [eventId, actionId]);
    },
    
    isAvailable = (page, eventId, actionId) => page.evaluate(([eventId, actionId]) => 
        tc.model.getEventModel(eventId).getActionModels()[actionId].isAvailableFor(tc.model.getAgentModel('AL')), 
    [eventId, actionId]);

test('an agent can release chronal into an Event and gather it back, 1 at a time, taking no action', async ({page}) => {
    await routeGameChronalActions(page);
    const problems = await startGame(page);
    await page.evaluate(() => tc.model.getAgentModel('AL').chronal.setValue(10));

    // Nothing to gather yet, but Gather is still offered: it can't be paid for.
    const start = await readAt(page, 'origin');
    expect(start).toMatchObject({gather:true, release:true, agent:10, event:0});

    await take(page, 'origin', '_releaseChronal');
    await take(page, 'origin', '_releaseChronal');
    await expect.poll(() => readAt(page, 'origin')).toEqual({...start, gather:true, agent:8, event:2});

    await take(page, 'origin', '_gatherChronal');
    await expect.poll(() => readAt(page, 'origin')).toEqual({...start, gather:true, agent:9, event:1});
    
    // An agent with none to release can't release.
    await page.evaluate(() => tc.model.getAgentModel('AL').chronal.setValue(0));
    expect(await isAvailable(page, 'origin', '_releaseChronal')).toBe(false);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('neither is offered where an Event is chrono locked, and they can\'t move what isn\'t there or has no room', async ({page}) => {
    await routeGameChronalActions(page);
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.plan.chronoLocked = 'true';
        json.events.plan.chronal = 3;
        json.events.origin.chronal = {value:5, max:5};
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    expect(await readAt(page, 'plan')).toMatchObject({gather:false, release:false, event:3});

    // Origin is full, and Alpha is full: neither can be taken, so nothing is lost.
    await page.evaluate(() => tc.model.getAgentModel('AL').chronal.setValue(tc.model.getAgentModel('AL').chronal.max));
    const before = await readAt(page, 'origin');
    expect(before).toMatchObject({gather:true, release:true, event:5});
    expect(await isAvailable(page, 'origin', '_releaseChronal')).toBe(false);
    expect(await isAvailable(page, 'origin', '_gatherChronal')).toBe(false);
    await take(page, 'origin', '_releaseChronal');
    await take(page, 'origin', '_gatherChronal');
    expect(await readAt(page, 'origin')).toEqual(before);

    expect(problems.pageErrors).toEqual([]);
});

test('hidden from an agent whose Chronogation is too low', async ({page}) => {
    await routeGameChronalActions(page);
    const problems = await startGame(page);
    const hiddenFor = skill => page.evaluate(skill => {
        const alpha = tc.model.getAgentModel('AL'),
            actions = tc.model.getEventModel('origin').getActionModels();
        alpha.skills = {...alpha.skills, chronogation:skill};
        return ['_gatherChronal', '_releaseChronal'].filter(id => actions[id].isHiddenFor(alpha));
    }, skill);
    
    expect(await hiddenFor(0)).toEqual([]);
    expect(await hiddenFor(-1000)).toEqual(['_gatherChronal', '_releaseChronal']);
    
    expect(problems.pageErrors).toEqual([]);
});
