// An Event floods when its paradox reaches its limit, however that happens: no one can time
// travel into or out of it, its descendants gain a paradox, which may flood them too, and every
// agent who has been there gains a paradox per visit. In the test data the origin leads to the
// aftermath, which leads to the finale. The tests' limits are 4 for an Event and 3 for an agent.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame} from './helpers.mjs';

const
    /*  Raises an Event's paradox to its limit. */
    flood = (page, eventId) => page.evaluate(eventId => {
        const paradox = tc.model.getEventModel(eventId).paradox;
        paradox.adjValue(paradox.getValueToMax());
    }, eventId),

    readEvents = page => page.evaluate(() => Object.fromEntries(['origin', 'aftermath', 'finale', 'plan'].map(id => {
        const eventModel = tc.model.getEventModel(id);
        return [id, {paradox:eventModel.paradox.value, flooded:eventModel.isFlooded()}];
    })));

test('reaching the limit floods the Event and adds a paradox to each descendant', async ({page}) => {
    const problems = await startGame(page);

    // One short isn't enough.
    await page.evaluate(() => {
        const paradox = tc.model.getEventModel('origin').paradox;
        paradox.adjValue(paradox.max - 1);
    });
    expect((await readEvents(page)).origin.flooded).toBe(false);

    const timelineBefore = await page.evaluate(() => tc.model.paradox.value);
    await flood(page, 'origin');
    const events = await readEvents(page);
    expect(events.origin).toEqual({paradox:4, flooded:true});
    // The aftermath is a hidden descendant, and gains one, which the timeline gains too, on top
    // of the origin's own last point. The finale descends from the aftermath, which didn't
    // flood, so it's untouched.
    expect(events.aftermath).toEqual({paradox:1, flooded:false});
    expect(events.finale).toEqual({paradox:0, flooded:false});
    expect(events.plan).toEqual({paradox:0, flooded:false});
    expect(await page.evaluate(() => tc.model.paradox.value)).toBe(timelineBefore + 2);

    // Pushing it further does nothing more.
    await page.evaluate(() => tc.model.getEventModel('origin').paradox.adjValue(1));
    expect((await readEvents(page)).aftermath).toEqual({paradox:1, flooded:false});
    expect(problems.pageErrors).toEqual([]);
});

test('a flood can flood descendants in turn', async ({page}) => {
    const problems = await startGame(page);
    // The aftermath is one short, so the origin's flood takes it to its limit.
    await page.evaluate(() => {
        const paradox = tc.model.getEventModel('aftermath').paradox;
        paradox.setValue(paradox.max - 1);
    });
    await flood(page, 'origin');
    const events = await readEvents(page);
    expect(events.origin.flooded).toBe(true);
    expect(events.aftermath.flooded).toBe(true);
    expect(events.finale).toEqual({paradox:1, flooded:false});
    expect(problems.pageErrors).toEqual([]);
});

test('every agent who has been to a flooded Event gains a paradox per visit, which can devour them', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const m = tc.model,
                alpha = m.getAgentModel('AL'),
                bravo = m.getAgentModel('BR'),
                charlie = m.getAgentModel('CH'),
                origin = m.getEventModel('origin');

            // Alpha started at the origin, and loops back there once: two visits.
            alpha.chronal.setValue(alpha.chronal.max);
            alpha.doDeployToEvent(origin);
            alpha.paradox.setValue(0);

            // Bravo has been once, and is one short of being devoured.
            bravo.setEvent('origin');
            bravo.setEvent('boats');
            bravo.paradox.setValue(bravo.paradox.max - 1);

            // Charlie has never been.
            const charlieBefore = charlie.paradox.value,
                scoreBefore = m.getScore(),
                visits = [alpha.countVisitsToEvent(origin), bravo.countVisitsToEvent(origin), charlie.countVisitsToEvent(origin)];
            origin.paradox.setValue(origin.paradox.max);
            return {
                visits,
                alpha:alpha.paradox.value,
                bravo:{devoured:bravo.isDevoured(), event:bravo.event},
                charlie:charlie.paradox.value - charlieBefore,
                scoreChange:m.getScore() - scoreBefore
            };
        });
    expect(out.visits).toEqual([2, 1, 0]);
    expect(out.alpha).toBe(2);
    expect(out.bravo).toEqual({devoured:true, event:'the_void'});
    expect(out.charlie).toBe(0);
    // A flood's paradox costs no score.
    expect(out.scoreChange).toBe(0);
    expect(problems.pageErrors).toEqual([]);
});

test('an effect that takes paradox to the limit floods the Event, or devours the agent', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const m = tc.model,
                bravo = m.getAgentModel('BR'),
                origin = m.getEventModel('origin'),
                exit = origin.getExitModels().find(exit => exit.to === 'aftermath'),
                r = {};

            // Effects are cut to what the stat allows, so these only ever reach the limit.
            exit.setEffects({'event.paradox':{onSuccess:'10'}});
            origin.paradox.setValue(origin.paradox.max - 1);
            bravo.setEvent('origin');
            bravo.doFollowExit(exit);
            r.originFlooded = origin.isFlooded();

            exit.setEffects({'agent.paradox':{onSuccess:'10'}});
            bravo.setEvent('origin');
            bravo.paradox.setValue(0);
            bravo.doFollowExit(exit);
            r.bravo = {devoured:bravo.isDevoured(), event:bravo.event};
            return r;
        });
    expect(out.originFlooded).toBe(true);
    expect(out.bravo).toEqual({devoured:true, event:'the_void'});
    expect(problems.pageErrors).toEqual([]);
});

test('no one can time travel into or out of a flooded Event, but its exits still work', async ({page}) => {
    const problems = await startGame(page);

    // Alpha is at the origin. Jumping into the flooded aftermath is refused, with the reason.
    await page.evaluate(() => {
        const aftermath = tc.model.getEventModel('aftermath');
        aftermath.setHidden(false);
        aftermath.setFlooded(true);
        tc.model.getAgentModel('AL').chronal.setValue(50);
        tc.app.selectAgentRow('AL');
        tc.app.selectEventBox('aftermath');
    });
    const jumpBtn = page.getByText(/^Jump to/).filter({visible:true});
    await expect(jumpBtn).toHaveClass(/disabled/);
    await expect(jumpBtn).toHaveAttribute('title', 'Aftermath is flooded with paradox. No one can time travel into or out of it.');
    expect(await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.doDeployToEvent(tc.model.getEventModel('aftermath'));
        return alpha.event;
    })).toBe('origin');

    // Walking in is fine.
    expect(await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.doFollowExit(tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'));
        return alpha.event;
    })).toBe('aftermath');

    // But there's no recalling, jumping or looping back out.
    const out = await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            tries = [];
        alpha.doRecallToHQ();
        tries.push(alpha.event);
        alpha.doDeployToEvent(tc.model.getEventModel('origin'));
        tries.push(alpha.event);
        alpha.doDeployToEvent(tc.model.getEventModel('aftermath'));
        tries.push(alpha.event);
        return tries;
    });
    expect(out).toEqual(['aftermath', 'aftermath', 'aftermath']);
    await page.evaluate(() => tc.app.selectEventBox('aftermath'));
    await expect(page.getByText(/^Recall to/).filter({visible:true}).first()).toHaveClass(/disabled/);

    expect(problems.warnings.filter(w => !w.startsWith('Cannot time travel'))).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a flooded Event stays flooded after a save and reload, without flooding again', async ({page}) => {
    const problems = await startGame(page);
    await flood(page, 'origin');
    const before = await readEvents(page);
    expect((await page.evaluate(() => tc.persistence.exportDiff())).events.origin.flooded).toBe(true);

    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await readEvents(page)).toEqual(before);
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').paradox.value)).toBe(1);
    expect(problems.pageErrors).toEqual([]);
});

test('restoring a save with stats at their limits doesn\'t devour or flood again', async ({page}) => {
    const problems = await startGame(page),
        snapshot = () => page.evaluate(() => ({
            bravoLog:tc.model.getAgentModel('BR').getLog().length,
            alpha:tc.model.getAgentModel('AL').paradox.value,
            aftermath:tc.model.getEventModel('aftermath').paradox.value,
            timeline:tc.model.paradox.value,
            devoured:tc.model.getAgentModel('BR').isDevoured(),
            flooded:tc.model.getEventModel('origin').isFlooded()
        }));
    await page.evaluate(() => {
        const bravo = tc.model.getAgentModel('BR');
        bravo.setEvent('origin');
        bravo.paradox.setValue(bravo.paradox.max);
        const origin = tc.model.getEventModel('origin');
        origin.paradox.setValue(origin.paradox.max);
        tc.persistence.save();
    });
    const before = await snapshot();
    expect([before.devoured, before.flooded]).toEqual([true, true]);

    await reloadGame(page);
    expect(await snapshot()).toEqual(before);
    expect(problems.pageErrors).toEqual([]);
});
