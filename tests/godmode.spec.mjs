// tc.GODMODE: console aids for testing. dump evaluates an expression and returns plain data;
// set, setExpr and adj change what the data's set/adj keys name, through the game's own rules.
import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const god = (page, method, ...args) => page.evaluate(([method, args]) => tc.GODMODE[method](...args), [method, args]);

test('dump shows agents, Events, stats, Values and scratch as plain data', async ({page}) => {
    const problems = await startGame(page);

    const alpha = await god(page, 'dump', 'agents.AL');
    expect(alpha).toMatchObject({id:'AL', name:'Alpha', event:'origin', dead:false});
    expect(alpha.health).toEqual({value:expect.any(Number), min:0, max:expect.any(Number)});
    expect(typeof alpha.skills).toBe('object');

    const origin = await god(page, 'dump', 'events.origin');
    expect(origin).toMatchObject({id:'origin', name:'Origin', hidden:false});
    expect(origin.values).toHaveProperty('struck');
    expect(origin.agents).toContain('AL');

    expect(await god(page, 'dump', 'events.origin.values.struck')).toBe(await page.evaluate(() => tc.model.getEventModel('origin').values.struck.value));
    expect(await god(page, 'dump', 'agents.AL.skills.nothing_at_all')).toBe(0);
    expect(await god(page, 'dump', '1 + 2')).toBe(3);

    // "agent" and "event" are the selected ones, or the ones named.
    await page.evaluate(() => {
        tc.model.getAgentModel('AL').selectRow();
        tc.app.selectEventBox('aftermath');
    });
    await expect.poll(() => god(page, 'dump', 'agent.id')).toBe('AL');
    await expect.poll(() => god(page, 'dump', 'event.id')).toBe('aftermath');
    expect(await god(page, 'dump', 'event.id', {event:'origin'})).toBe('origin');

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('set and adj change stats, Values, scratch and more, within the game\'s rules', async ({page}) => {
    const problems = await startGame(page);

    // A stat, within its limits.
    expect((await god(page, 'set', 'agents.AL.health', 3)).value).toBe(3);
    expect((await god(page, 'adj', 'agents.AL.health', 2)).value).toBe(5);
    const max = await page.evaluate(() => tc.model.getAgentModel('AL').health.getMax());
    expect((await god(page, 'adj', 'agents.AL.health', 100000)).value).toBe(max);

    // An expression, worked out once.
    expect((await god(page, 'setExpr', 'agents.AL.health', 'agents.AL.health.max - 1')).value).toBe(max - 1);

    // A Value, as a literal.
    const struck = await page.evaluate(() => tc.model.getEventModel('origin').values.struck.value);
    expect(await god(page, 'set', 'events.origin.values.struck', !struck)).toBe(!struck);

    // Scratch, and revealing a mission.
    expect(await god(page, 'set', 'scratch.plan_noteCount', 3)).toBe(3);
    expect(await god(page, 'adj', 'scratch.plan_noteCount', 2)).toBe(5);
    await god(page, 'set', 'operations.second.hidden', false);
    expect(await page.evaluate(() => tc.model.getOperationModel('second').revealed)).toBe(true);
    
    // A skill, and the timeline.
    expect(await god(page, 'set', 'agents.AL.skills.stealth', 250)).toBe(250);
    const score = await page.evaluate(() => tc.model.score);
    expect(await god(page, 'adj', 'timeline.score', 1234)).toBe(score + 1234);

    // An agent's Event moves them there.
    await god(page, 'set', 'agents.AL.event', 'aftermath');
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('aftermath');

    // "agent" is the selected agent.
    await page.evaluate(() => tc.model.getAgentModel('AL').selectRow());
    await expect.poll(async () => (await god(page, 'adj', 'agent.chronal', 0))?.value).toBe(await page.evaluate(() => tc.model.getAgentModel('AL').chronal.value));

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a key the data couldn\'t use is refused with the data\'s warning', async ({page}) => {
    const problems = await startGame(page);

    expect(await god(page, 'set', 'agents.AL.nonsense.thing', 1)).toBeUndefined();
    expect(await god(page, 'adj', 'agents.AL.event', 1)).toBeUndefined();
    expect(problems.warnings.length).toBe(2);
    expect(problems.warnings[1]).toContain('can only be set, not adjusted');

    expect(problems.pageErrors).toEqual([]);
});
