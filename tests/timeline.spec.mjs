import {test, expect} from '@playwright/test';
import {startGame, setCausator, reloadGame, dialogTitle, showTab, readTestData} from './helpers.mjs';

/*  A causal chain of Events, which are hidden at the start of the campaign. */
const CHAIN = ['plan', 'relay', 'signal'],
    
    // Makes Events known, so their boxes show on the timeline, then lets the layout settle.
    reveal = async (page, eventIds) => {
        await page.evaluate(eventIds => {
            for (const id of eventIds) tc.model.getEventModel(id).attestation.setValue(50);
        }, eventIds);
        await page.waitForTimeout(800);
    },
    
    /*  Records the value change animations from now on: the order boxes animate in and the 
        biggest scale each one reaches. */
    recordAnims = page => page.evaluate(() => {
        const timeline = tc.app.getTimelineView(),
            record = globalThis.animRecord = {order:[], maxScale:{}, badScales:[]};
        clearInterval(globalThis.animRecordTimer);
        globalThis.animRecordTimer = setInterval(() => {
            const id = timeline.getValueChangeAnimState().current;
            if (id) {
                if (record.order.at(-1) !== id) record.order.push(id);
                const scale = timeline.boxesByEventId[id].scaleX ?? 1;
                if (!Number.isFinite(scale)) record.badScales.push(id);
                record.maxScale[id] = Math.max(record.maxScale[id] ?? 1, scale);
            }
        }, 5);
    }),
    getAnimRecord = page => page.evaluate(() => globalThis.animRecord),
    isIdle = page => page.evaluate(() => {
        const {current, queued} = tc.app.getTimelineView().getValueChangeAnimState();
        return current === null && queued.length === 0;
    }),
    getScales = (page, eventIds) => page.evaluate(eventIds => eventIds.map(id => tc.app.getTimelineView().boxesByEventId[id]?.scaleX ?? 1), eventIds);

test('a value change pops each affected box in turn, in causal order', async ({page}) => {
    const problems = await startGame(page);
    await reveal(page, CHAIN);
    await recordAnims(page);
    
    await setCausator(page, 'plan', 'prepared', 'true');
    
    // Queued right away in the order the change spread, each box only once.
    expect(await page.evaluate(() => tc.app.getTimelineView().getValueChangeAnimState())).toEqual({
        current:CHAIN[0], queued:CHAIN.slice(1)
    });
    
    await expect.poll(() => isIdle(page), {timeout:5000}).toBe(true);
    const record = await getAnimRecord(page);
    expect(record.order).toEqual(CHAIN);
    expect(record.badScales).toEqual([]);
    for (const id of CHAIN) expect(record.maxScale[id]).toBeGreaterThan(1.05);
    expect(await getScales(page, CHAIN)).toEqual([1, 1, 1]);
    
    expect(problems.warnings).toEqual([]);
});

test('setting a value to what it already is doesn\'t animate', async ({page}) => {
    const problems = await startGame(page);
    await reveal(page, CHAIN);
    const current = await page.evaluate(() => tc.model.getEventModel('plan').getValueModels().prepared.value);
    await setCausator(page, 'plan', 'prepared', current);
    expect(await isIdle(page)).toBe(true);
    expect(problems.warnings).toEqual([]);
});

test('hidden boxes are skipped', async ({page}) => {
    const problems = await startGame(page);
    
    // The chain is still hidden, so nothing shows, and nothing is left waiting.
    await recordAnims(page);
    await setCausator(page, 'plan', 'prepared', 'true');
    await expect.poll(() => isIdle(page)).toBe(true);
    expect((await getAnimRecord(page)).order).toEqual([]);
    
    // A box that's hidden while it waits its turn is skipped when its turn comes.
    await reveal(page, CHAIN);
    await recordAnims(page);
    await page.evaluate(() => {
        tc.model.getEventModel('plan').getValueModels().prepared.setValue(false, true);
        tc.model.getEventModel('relay').setHidden(true);
    });
    await expect.poll(() => isIdle(page), {timeout:5000}).toBe(true);
    expect((await getAnimRecord(page)).order).toEqual([CHAIN[0], CHAIN[2]]);
    expect(problems.warnings).toEqual([]);
});

test('nothing animates while the campaign starts or a save is restored', async ({page}) => {
    await startGame(page);
    expect(await isIdle(page)).toBe(true);
    
    // A save with the chain known and changed restores those values on reload.
    await reveal(page, CHAIN);
    await page.evaluate(() => tc.model.getEventModel('plan').getValueModels().prepared.setValue('true', false));
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    
    expect(await page.evaluate(() => tc.model.getEventModel('plan').getValueModels().prepared.value)).toBe(true);
    expect(await isIdle(page)).toBe(true);
    expect(await getScales(page, CHAIN)).toEqual([1, 1, 1]);
});

test('the Mission Complete dialog waits for the changes that completed the mission to finish animating', async ({page}) => {
    const problems = await startGame(page),
        missionComplete = dialogTitle(page, 'Mission Complete');
    await reveal(page, [...CHAIN, 'lever']);
    await recordAnims(page);
    
    // Notes whether the dialog is ever showing while a box is still animating.
    await page.evaluate(() => {
        const timeline = tc.app.getTimelineView();
        globalThis.dialogDuringAnim = false;
        globalThis.dialogWatchTimer = setInterval(() => {
            if (timeline.getValueChangeAnimState().current && document.body.innerText.includes('Mission Complete')) {
                globalThis.dialogDuringAnim = true;
            }
        }, 5);
    });
    
    // Completes the first mission the way its Actions do.
    await page.evaluate(() => {
        const m = tc.model;
        m.getEventModel('plan').getValueModels().prepared.setValue('true', false);
        m.getEventModel('lever').getValueModels().pulled.setValue('true', false);
    });
    
    await expect(missionComplete).toBeVisible({timeout:10000});
    expect(await isIdle(page)).toBe(true);
    expect((await getAnimRecord(page)).order.length).toBeGreaterThan(1);
    expect(await page.evaluate(() => globalThis.dialogDuringAnim)).toBe(false);
    expect(problems.pageErrors).toEqual([]);
});

test('waiting for the animations runs right away when none are running', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => {
        let ran = false;
        tc.app.getTimelineView().doWhenValueChangeAnimsDone(() => {ran = true;});
        return ran;
    })).toBe(true);
});

/*  The selected Agent's path: an arrow from each Event they entered to the next, leaving the
    right edge and arriving at the left, 55% from the top for a first visit and 5% lower for 
    each later one. Events without a visible box, e.g. HQ, are left out. Arrows to or from the
    selected Event are thicker. */
test('arrows follow the selected agent from Event to Event', async ({page}) => {
    const problems = await startGame(page);
    const readArrows = () => page.evaluate(() => tc.app.getTimelineView().flowLayer.getSplines()
        .filter(spline => spline.splineId.startsWith('visit-'))
        .map(spline => [spline.startView.model.id, spline.startSide, spline.startPosition, spline.endView.model.id, spline.endSide, spline.endPosition]));
    const readThicknesses = () => page.evaluate(() => tc.app.getTimelineView().flowLayer.getSplines()
        .filter(spline => spline.splineId.startsWith('visit-'))
        .map(spline => spline.style.thickness));
    
    await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            origin = m.getEventModel('origin');
        tc.app.selectAgentRow('AL');
        alpha.doFollowExit(origin.getExitModels().find(exit => exit.to === 'aftermath'));
        alpha.doDeployToEvent(origin);
    });
    await expect.poll(readArrows).toEqual([
        ['origin', 'right', '55%', 'aftermath', 'left', '55%'],
        ['aftermath', 'right', '55%', 'origin', 'left', '60%']
    ]);
    // Selecting an Event thickens the arrows into and out of it, and deselecting it thins them.
    await page.evaluate(() => tc.app.selectEventBox('aftermath'));
    await expect.poll(readThicknesses).toEqual([3, 3]);
    await page.evaluate(() => tc.app.getTimelineView().deselectAll());
    await expect.poll(readThicknesses).toEqual([1, 1]);
    
    // The Events visited are outlined, and only those.
    expect(await page.evaluate(() => Object.values(tc.app.getTimelineView().boxesByEventId)
        .filter(box => box.visited).map(box => box.model.id).sort())).toEqual(['aftermath', 'origin']);
    
    // Another agent who hasn't gone anywhere has no path.
    await page.evaluate(() => tc.app.selectAgentRow('BR'));
    await expect.poll(readArrows).toEqual([]);
    
    expect(problems.pageErrors).toEqual([]);
});

/*  Mission Complete waits for the timeline's animations, which must still finish while the 
    Agents tab hides the timeline. */
test('the Mission Complete dialog still opens while the agents tab is showing', async ({page}) => {
    const problems = await startGame(page);
    await showTab(page, 'Agents');
    await setCausator(page, 'plan', 'prepared', true);
    await setCausator(page, 'lever', 'pulled', true);
    await expect(dialogTitle(page, 'Mission Complete')).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
});

test('an agent\'s visit history says which visits were by time travel', async ({page}) => {
    // Aftermath's exit to the finale becomes a jump, a time travel exit.
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.aftermath.exits.find(exit => exit.mode === 'wait').mode = 'jump';
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    await setCausator(page, 'origin', 'struck', true);
    
    expect(await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            exitTo = (eventId, toId) => m.getEventModel(eventId).getExitModels().find(exit => exit.to === toId);
        alpha.doFollowExit(exitTo('origin', 'aftermath'));
        alpha.doFollowExit(exitTo('aftermath', 'finale'));
        alpha.doRecallToHQ();
        alpha.doDeployToEvent(m.getEventModel('origin'));
        return alpha.getVisitHistory().map(({event, isTimeTravel}) => [event.id, isTimeTravel]);
    })).toEqual([
        ['origin', false],      // Where Alpha starts.
        ['aftermath', false],   // A walk.
        ['finale', true],       // A jump.
        ['time_corps_hq', true],
        ['origin', true]
    ]);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

/*  The timeline's curves drift: each end's angle wanders around its side, by more as paradox
    builds, while the ends stay where they meet their boxes. */
const sampleOriginCurves = (page, millis=800) => page.evaluate(millis => new Promise(resolve => {
        const timeline = tc.app.getTimelineView(),
            sideDegrees = {right:0, bottom:90, left:180, top:270},
            originBox = timeline.getEventBox('origin'),
            connections = timeline.flowLayer.getConnections().filter(c => c.startView === originBox || c.endView === originBox),
            points = connections.map(c => [c.startX, c.startY, c.endX, c.endY].join()),
            // How far an angle is from its side's, in degrees, either way round.
            deviation = (angle, side) => Math.abs(((angle - sideDegrees[side]) % 360 + 540) % 360 - 180),
            samples = [];
        const sample = () => {
            for (const c of connections) samples.push(deviation(c.startAngle, c.startSide), deviation(c.endAngle, c.endSide));
        };
        const timer = setInterval(sample, 50);
        setTimeout(() => {
            clearInterval(timer);
            resolve({
                count:connections.length,
                maxDeviation:Math.max(0, ...samples.filter(Number.isFinite)),
                pointsKept:connections.every((c, i) => [c.startX, c.startY, c.endX, c.endY].join() === points[i])
            });
        }, millis);
    }), millis),
    readCfg = page => page.evaluate(() => ({base:tc.cfg.TL_SPLINE_DRIFT_BASE_DEGREES, max:tc.cfg.TL_SPLINE_DRIFT_MAX_DEGREES}));

test('the timeline\'s curves drift, by more around a flooded event, with their ends kept in place while its box is still', async ({page}) => {
    const problems = await startGame(page, {timelineUnrest:true}),
        {base, max} = await readCfg(page),
        timelineUnrest = await page.evaluate(() => {
            const stat = tc.model.paradox;
            return Math.min(1, stat.getValue() / stat.getMax());
        });
    
    const calm = await sampleOriginCurves(page);
    expect(calm.count).toBeGreaterThan(0);
    expect(calm.maxDeviation).toBeGreaterThan(0);
    expect(calm.maxDeviation).toBeLessThanOrEqual(base + (max - base)*timelineUnrest + 0.001);
    expect(calm.pointsKept).toBe(true);
    
    // Flooding origin makes its curves drift by up to the max.
    await page.evaluate(() => {
        const paradox = tc.model.getEventModel('origin').paradox;
        paradox.setValue(paradox.getMax());
    });
    expect(await page.evaluate(() => tc.model.getEventModel('origin').flooded)).toBe(true);
    const flooded = await sampleOriginCurves(page);
    expect(flooded.maxDeviation).toBeGreaterThan(calm.maxDeviation);
    expect(flooded.maxDeviation).toBeLessThanOrEqual(max + 0.001);
    
    expect(problems.pageErrors).toEqual([]);
});

test('the curves stay still with the setting off, or when the system asks for reduced motion', async ({page}) => {
    const problems = await startGame(page, {timelineUnrest:true});
    expect((await sampleOriginCurves(page, 300)).maxDeviation).toBeGreaterThan(0);
    
    // Turning it off puts every curve back straight out of its box.
    await page.evaluate(id => tc.settings.set(id, false), await page.evaluate(() => tc.SETTING_ANIMATE_TIMELINE_UNREST));
    await page.waitForTimeout(100);
    expect((await sampleOriginCurves(page, 300)).maxDeviation).toBe(0);
    
    await page.evaluate(id => tc.settings.set(id, true), await page.evaluate(() => tc.SETTING_ANIMATE_TIMELINE_UNREST));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForTimeout(100);
    expect((await sampleOriginCurves(page, 300)).maxDeviation).toBe(0);
    
    expect(problems.pageErrors).toEqual([]);
});

/*  How far origin's box is shown from where the layout put it, whether its x and y, which
    the layout sets, stay put, and whether the curves joined to it still meet it where it's
    shown, sampled over a while. */
const sampleOriginBox = (page, home, millis=800) => page.evaluate(([home, millis]) => new Promise(resolve => {
        const timeline = tc.app.getTimelineView(),
            originBox = timeline.getEventBox('origin'),
            connections = timeline.flowLayer.getConnections().filter(c => c.startView === originBox || c.endView === originBox),
            // Where the box is shown: where the layout put it, translated by its drift, which
            // is read from the style itself.
            shownAt = () => {
                const [dx=0, dy=0] = (originBox.getIDE().style.translate || '0px 0px').split(' ').map(parseFloat);
                return [originBox.x + dx, originBox.y + dy];
            },
            // Where each curve's end at origin is, relative to where the box is shown, which 
            // stays the same if the curve follows the box.
            endAtBox = c => {
                const [x, y] = shownAt();
                return c.startView === originBox ? [c.startX - x, c.startY - y] : [c.endX - x, c.endY - y];
            },
            near = (a, b) => Math.abs(a - b) < 0.01,
            firstEnds = connections.map(endAtBox);
        let maxOffset = 0,
            layoutKept = true,
            curvesFollow = true;
        const sample = () => {
            const [x, y] = shownAt();
            maxOffset = Math.max(maxOffset, Math.abs(x - home.x), Math.abs(y - home.y));
            if (originBox.x !== home.x || originBox.y !== home.y) layoutKept = false;
            connections.forEach((c, i) => {
                const [x, y] = endAtBox(c);
                if (!near(x, firstEnds[i][0]) || !near(y, firstEnds[i][1])) curvesFollow = false;
            });
        };
        const timer = setInterval(sample, 50);
        setTimeout(() => {
            clearInterval(timer);
            resolve({maxOffset, layoutKept, curvesFollow, connectionCount:connections.length});
        }, millis);
    }), [home, millis]),
    setOriginParadox = (page, fraction) => page.evaluate(fraction => {
        const paradox = tc.model.getEventModel('origin').paradox;
        paradox.setValue(Math.round(paradox.getMax()*fraction));
    }, fraction);

test('the box of an event with paradox is shown drifting around where it belongs, further as it fills, and the curves follow', async ({page}) => {
    const problems = await startGame(page, {timelineUnrest:true}),
        maxPixels = await page.evaluate(() => tc.cfg.TL_EVENT_DRIFT_MAX_PIXELS),
        home = await page.evaluate(() => {
            const box = tc.app.getTimelineView().getEventBox('origin');
            return {x:box.x, y:box.y};
        });
    
    // Without paradox it stays put.
    expect((await sampleOriginBox(page, home, 400)).maxOffset).toBe(0);
    
    // Half full, it drifts by up to half the most.
    await setOriginParadox(page, 0.5);
    const half = await sampleOriginBox(page, home);
    expect(half.maxOffset).toBeGreaterThan(0);
    expect(half.maxOffset).toBeLessThanOrEqual(maxPixels/2 + 0.5);
    expect(half.connectionCount).toBeGreaterThan(0);
    expect(half.layoutKept).toBe(true);
    expect(half.curvesFollow).toBe(true);
    
    // Flooded, by up to the most.
    await setOriginParadox(page, 1);
    const flooded = await sampleOriginBox(page, home);
    expect(flooded.maxOffset).toBeGreaterThan(half.maxOffset);
    expect(flooded.maxOffset).toBeLessThanOrEqual(maxPixels + 0.5);
    expect(flooded.layoutKept).toBe(true);
    expect(flooded.curvesFollow).toBe(true);
    
    // Turned off, it goes back home, and so do the ends of its curves.
    await page.evaluate(() => tc.settings.set(tc.SETTING_ANIMATE_TIMELINE_UNREST, false));
    await page.waitForTimeout(100);
    const settled = await sampleOriginBox(page, home, 200);
    expect(settled.maxOffset).toBe(0);
    expect(settled.curvesFollow).toBe(true);
    expect(await page.evaluate(() => {
        const timeline = tc.app.getTimelineView(),
            originBox = timeline.getEventBox('origin');
        return timeline.flowLayer.getConnections().filter(c => c.startView === originBox).every(c => {
            const [x, y] = [c.startX, c.startY];
            c.updateEndpoints();
            return c.startX === x && c.startY === y;
        });
    })).toBe(true);
    
    expect(problems.pageErrors).toEqual([]);
});
