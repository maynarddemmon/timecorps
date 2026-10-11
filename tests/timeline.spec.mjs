import {test, expect} from '@playwright/test';
import {startGame, setCausator, reloadGame, dialogTitle} from './helpers.mjs';

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
