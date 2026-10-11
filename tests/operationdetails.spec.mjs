import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const precursorBtn = (page, name) => page.locator('.myt-OperationDetails').getByRole('button', {name, exact:true}),
    precursorsRow = page => page.locator('.myt-OperationDetails').getByText('Entanglements', {exact:true}),
    
    // Replaces the first mission's objective, so a test can read whatever it likes.
    setObjectiveSuccess = (page, expr) => page.evaluate(expr => {
        tc.model.getCurrentOperation().getObjectiveModelsAsList()[0].setSuccess(expr, false);
    }, expr),
    
    getSelectedEventId = page => page.evaluate(() => tc.app.getTimelineView().getSelectedEventId());

test('an objective lists the causators it depends on, and they select the event', async ({page}) => {
    const problems = await startGame(page);
    
    // The first mission's objective is "!events.origin.values.struck.value".
    const btn = precursorBtn(page, 'Origin: Struck ❯');
    await expect(btn).toBeVisible();
    
    await page.evaluate(() => tc.app.selectEventBox('aftermath'));
    await expect.poll(() => getSelectedEventId(page)).toBe('aftermath');
    await btn.click();
    await expect.poll(() => getSelectedEventId(page)).toBe('origin');
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('hovering a precursor scrolls to its event, and leaving scrolls back', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => {
        const app = tc.app;
        globalThis.scrolls = [];
        app.scrollToDebounced = eventModel => {globalThis.scrolls.push(eventModel?.id ?? null);};
        const scrollToSelectedEvent = app.scrollToSelectedEvent;
        app.scrollToSelectedEvent = function() {
            globalThis.scrolls.push('selected');
            scrollToSelectedEvent.call(this);
        };
    });
    
    await precursorBtn(page, 'Origin: Struck ❯').hover();
    await page.mouse.move(5, 5);
    // Scrolling back also cancels the pending scroll, which is a call with no event.
    expect(await page.evaluate(() => globalThis.scrolls)).toEqual(['origin', 'selected', null]);
    
    expect(problems.pageErrors).toEqual([]);
});

test('precursors follow the expression, stats included, and unknown ones are summed up', async ({page}) => {
    const problems = await startGame(page);
    
    // Plan and the Message Backlog start hidden.
    await setObjectiveSuccess(page, 'events.backlog.attestation.value > 5 && events.plan.values.prepared.value && !events.origin.values.struck.value');
    expect(await page.evaluate(() => tc.model.getCurrentOperation().getObjectiveModelsAsList()[0].getPrecursors().map(
        ({eventModel, valueModel, statId}) => [eventModel.id, valueModel?.id ?? null, statId]
    ))).toEqual([
        ['backlog', null, 'attestation'],
        ['plan', 'prepared', null],
        ['origin', 'struck', null]
    ]);
    
    const objectives = page.locator('.myt-OperationDetails');
    await expect(precursorBtn(page, 'Origin: Struck ❯')).toBeVisible();
    await expect(objectives.getByText('Unknown', {exact:true})).toBeVisible();
    await expect(objectives.getByText('Plan', {exact:false})).toHaveCount(0);
    
    // Revealing an event adds its button, without anything else changing the objective.
    await page.evaluate(() => tc.model.getEventModel('plan').attestation.setValue(50));
    await expect(precursorBtn(page, 'Plan: Prepared ❯')).toBeVisible();
    await expect(objectives.getByText('Unknown', {exact:true})).toBeVisible();
    
    await page.evaluate(() => tc.model.getEventModel('backlog').attestation.setValue(50));
    await expect(precursorBtn(page, 'Message Backlog: Attestation ❯')).toBeVisible();
    await expect(objectives.getByText('Unknown', {exact:true})).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('an objective that reads no events has no precursors row', async ({page}) => {
    const problems = await startGame(page);
    
    await expect(precursorsRow(page)).toBeVisible();
    await setObjectiveSuccess(page, 'timeline.paradox.value === 0');
    await expect(precursorsRow(page)).toBeHidden();
    
    expect(problems.pageErrors).toEqual([]);
});
