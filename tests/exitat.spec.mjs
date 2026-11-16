// An exit's "at": it leaves its Event partway through, rather than at the end. An agent who has
// lived past it there can't take it, the time on the way is counted from it, and on the timeline
// its route starts on the box's right edge, as far down as it is through the Event.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

/*  Origin lasts a minute, and each of its actions lives through a third of it (20 seconds).
    The exit to Aftermath leaves 30 seconds in. */
const routeAtExit = (page, at={startOf:'origin', s:30}) => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.origin.exits = [...(json.events.origin.exits ?? []).filter(exit => exit.to !== 'aftermath'), {mode:'walk', to:'aftermath', at}];
        return route.fulfill({json});
    }),

    exitToAftermath = page => page.evaluate(() => {
        const exit = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath');
        return {
            leaveOffset:exit.getLeaveOffset(), fraction:exit.getLeaveFraction(), travelTime:exit.getTravelTime(),
            passed:exit.isPassedFor(tc.model.getAgentModel('AL'))
        };
    }),

    investigate = page => page.evaluate(() => {
        tc.rng.queueRolls(999);
        const alpha = tc.model.getAgentModel('AL');
        alpha.doAction(alpha.getEventModel().getActionModels()._investigate);
        tc.rng.clearQueuedRolls();
    }),

    exitShownInDetails = page => page.getByText(/^Walk to Aftermath/).filter({visible:true}).count().then(count => count > 0);

test('an exit with an "at" leaves partway through, and is gone once the agent has lived past it', async ({page}) => {
    await routeAtExit(page);
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.selectEventBox('origin'));

    const exit = await exitToAftermath(page),
        aftermathFromOrigin = await page.evaluate(() => tc.model.getEventModel('aftermath').getStart() - tc.model.getEventModel('origin').getStart());
    expect(exit).toMatchObject({leaveOffset:30000, fraction:0.5, travelTime:aftermathFromOrigin - 30000, passed:false});
    await expect.poll(() => exitShownInDetails(page)).toBe(true);

    // 20 seconds in, it's still there.
    await investigate(page);
    expect((await exitToAftermath(page)).passed).toBe(false);
    await expect.poll(() => exitShownInDetails(page)).toBe(true);

    // 40 seconds in, it's gone, and can't be taken.
    await investigate(page);
    expect((await exitToAftermath(page)).passed).toBe(true);
    await expect.poll(() => exitShownInDetails(page)).toBe(false);
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.doFollowExit(alpha.getEventModel().getExitModels().find(exit => exit.to === 'aftermath'));
    });
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('origin');
    expect(problems.warnings).toEqual([expect.stringContaining('Exit from origin to aftermath is already past for AL')]);

    expect(problems.pageErrors).toEqual([]);
});

test('taking it lives through the Event up to it, then the time on the way', async ({page}) => {
    await routeAtExit(page);
    const problems = await startGame(page);

    const before = await page.evaluate(() => tc.model.getAgentModel('AL').getAge()),
        aftermathFromOrigin = await page.evaluate(() => tc.model.getEventModel('aftermath').getStart() - tc.model.getEventModel('origin').getStart());
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.doFollowExit(alpha.getEventModel().getExitModels().find(exit => exit.to === 'aftermath'));
    });
    await expect.poll(() => page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('aftermath');

    // 30 seconds of Origin, then the rest of the time until Aftermath: the same as from its start.
    const aged = await page.evaluate(before => tc.model.getAgentModel('AL').getAge() - before, before),
        msPerYear = await page.evaluate(() => tc.timeUtil.MILLIS_PER_YEAR);
    expect(aged * msPerYear).toBeCloseTo(aftermathFromOrigin, -2);

    expect(problems.pageErrors).toEqual([]);
});

test('on the timeline, its route starts on the right edge, as far down as it is through the Event', async ({page}) => {
    await routeAtExit(page);
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.selectEventBox('origin'));

    const readSpline = () => page.evaluate(() => {
        const spline = tc.app.getTimelineView().flowLayer.getSpline('exit-origin-aftermath');
        return spline ? {side:spline.startSide, position:spline.startPosition} : null;
    });
    await expect.poll(readSpline).toEqual({side:'right', position:'50%'});

    expect(problems.pageErrors).toEqual([]);
});

test('an "at" outside its Event is moved to the nearer end, with a warning', async ({page}) => {
    await routeAtExit(page, {startOf:'origin', h:2});
    const problems = await startGame(page);

    expect((await exitToAftermath(page)).leaveOffset).toBe(60000);
    expect(problems.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('Event origin exit to aftermath at must be within the Event')
    ]));

    expect(problems.pageErrors).toEqual([]);
});
