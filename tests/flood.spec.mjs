// An Event floods when its paradox reaches its limit, however that happens: no one can time
// travel into or out of it, its descendants gain a paradox, which may flood them too, and every
// agent who has been there gains a paradox per visit. In the test data the origin leads to the
// aftermath, which leads to the finale. The tests' limits are 4 for an Event and 3 for an agent.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData} from './helpers.mjs';

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

test('in a flooded Event, actions that could generate paradox can\'t be taken, but others can', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5'),
            NO_ROLL = {difficulty:'no-roll'};
        Object.assign(json.events.origin.actions, {
            meddle:{label:'Meddle', skillCheck:NO_ROLL, adj:{'timeline.paradox':{onSuccess:'1'}}},
            fumble:{label:'Fumble', skillCheck:NO_ROLL, adj:{'agent.paradox':{onFailure:'1'}}},
            gamble:{label:'Gamble', skillCheck:NO_ROLL, costs:{'agent.paradox':'1'}},
            calm:{label:'Calm', skillCheck:NO_ROLL, adj:{'agent.paradox':{onSuccess:'-1'}}},
            look:{label:'Look', skillCheck:NO_ROLL}
        });
        return route.fulfill({json});
    });
    const problems = await startGame(page),
        take = actionId => page.evaluate(actionId => {
            const alpha = tc.model.getAgentModel('AL'),
                action = tc.model.getEventModel('origin').getActionModels()[actionId];
            alpha.setActionExecCount(0);
            const blocked = alpha.isActionBlockedByFlood(action);
            alpha.doAction(action);
            return {blocked, taken:action.attemptCount};
        }, actionId);
    
    // Not flooded yet, so anything goes.
    expect(await take('meddle')).toEqual({blocked:false, taken:1});
    
    await page.evaluate(() => {
        tc.model.getEventModel('origin').setFlooded(true);
        tc.app.selectEventBox('aftermath');
        tc.app.selectEventBox('origin');
    });
    // Raising anyone's paradox, on a pass or a failure, or paying in paradox, is refused.
    expect(await take('meddle')).toEqual({blocked:true, taken:1});
    expect(await take('fumble')).toEqual({blocked:true, taken:0});
    expect(await take('gamble')).toEqual({blocked:true, taken:0});
    // Lowering paradox, or leaving it alone, is fine.
    expect(await take('calm')).toEqual({blocked:false, taken:1});
    expect(await take('look')).toEqual({blocked:false, taken:1});
    
    const meddleBtn = page.getByText(/^Meddle/).filter({visible:true});
    await expect(meddleBtn).toHaveClass(/disabled/);
    await expect(meddleBtn).toHaveAttribute('title', /Could generate paradox, which a flooded event can't hold$/);
    await expect(page.getByText(/^Look/).filter({visible:true})).not.toHaveClass(/disabled/);
    
    expect(problems.warnings.filter(w => !w.startsWith('Cannot take an action'))).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a flooded Event\'s box takes the paradox color, darker under the mouse and lighter when selected', async ({page}) => {
    const problems = await startGame(page),
        colors = () => page.evaluate(() => {
            const box = tc.app.getTimelineView().getEventBox(tc.model.getEventModel('origin'));
            return {ready:box.readyColor, hover:box.hoverColor, active:box.activeColor, bg:box.bgColor};
        }),
        theme = await page.evaluate(() => tc.theme);
    await page.evaluate(() => tc.app.getTimelineView().deselectAll());
    const before = await colors();
    expect(before.ready).toBe(theme.colorDark);
    
    await flood(page, 'origin');
    await expect.poll(colors).toEqual({ready:theme.colorParadox, hover:theme.colorParadoxDark, active:theme.colorParadoxDark, bg:theme.colorParadox});
    
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect.poll(async () => (await colors()).bg).toBe(theme.colorParadoxLight);
    expect(problems.pageErrors).toEqual([]);
});

test('a devoured agent\'s markers are tinted the paradox color', async ({page}) => {
    const problems = await startGame(page),
        markerClasses = () => page.evaluate(() => [...document.querySelectorAll('.myt-SimpleAgentGridMarker, .myt-SimpleAgentMarker')]
            .filter(marker => marker.getBoundingClientRect().x >= 0)
            .map(marker => marker.classList.contains('agent-devoured')));
    await expect.poll(markerClasses).not.toContain(true);
    
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.paradox.setValue(alpha.paradox.max);
    });
    // In the agents list, and in The Void on the timeline.
    await expect.poll(markerClasses).toEqual([true, true]);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.agent-devoured'), '::after').mixBlendMode)).toBe('color');
    expect(problems.pageErrors).toEqual([]);
});
