import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true}),
    restartTitle = page => page.getByText('Restart Campaign', {exact:true}).filter({visible:true});

/*  myt buttons stop keydown from bubbling, so these cover the keys reaching the dialog 
    when one of its buttons has focus. */
test('Esc cancels a confirm dialog even when one of its buttons has focus', async ({page}) => {
    const problems = await startGame(page);
    
    for (const focusName of [/Cancel/, /Confirm/]) {
        await visibleButton(page, '⌫').click();
        await expect(restartTitle(page)).toBeVisible();
        await visibleButton(page, focusName).focus();
        await page.keyboard.press('Escape');
        await expect(restartTitle(page)).toHaveCount(0);
    }
    
    expect(problems.pageErrors).toEqual([]);
});

test('Enter on a focused Cancel cancels rather than confirming', async ({page}) => {
    const problems = await startGame(page);
    
    await visibleButton(page, '⌫').click();
    await visibleButton(page, /Cancel/).focus();
    await page.keyboard.press('Enter');
    await expect(restartTitle(page)).toHaveCount(0);
    expect(await page.evaluate(() => tc.model.getCurrentOperation()?.id)).toBe('titanic_noCollision'); // No reload happened.
    
    expect(problems.pageErrors).toEqual([]);
});

const visibleText = (page, text) => page.getByText(text, {exact:true}).filter({visible:true});

test('an ack opened during a confirm waits for it, then shows with focus', async ({page}) => {
    const problems = await startGame(page);
    
    const queued = await page.evaluate(() => {
        const {openConfirmMsgDialog, openAckMsgDialog} = tc.dialogUtil;
        openConfirmMsgDialog('Confirm First', 'A confirm.', () => {
            // As when a confirmed action reports back, e.g. saving.
            globalThis.ackResult = openAckMsgDialog('Ack Second', 'An ack.');
        });
        return openAckMsgDialog('Ack Early', 'Opened while the confirm is showing.') === undefined;
    });
    expect(queued).toBe(true);
    await expect(visibleText(page, 'Confirm First')).toBeVisible();
    await expect(visibleText(page, 'Ack Early')).toHaveCount(0);
    
    // Confirming hides the confirm and shows the queued acks in the order they were opened, 
    // each able to take Enter.
    await page.keyboard.press('Enter');
    await expect(visibleText(page, 'Confirm First')).toHaveCount(0);
    await expect(visibleText(page, 'Ack Early')).toBeVisible();
    expect(await page.evaluate(() => globalThis.ackResult)).toBeUndefined(); // Queued too.
    
    await page.keyboard.press('Enter');
    await expect(visibleText(page, 'Ack Early')).toHaveCount(0);
    await expect(visibleText(page, 'Ack Second')).toBeVisible();
    
    await page.keyboard.press('Enter');
    await expect(visibleText(page, 'Ack Second')).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('queued acks keep their order when a confirm opens over an ack', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const {openConfirmMsgDialog, openAckMsgDialog} = tc.dialogUtil;
        openAckMsgDialog('Ack 1', 'Showing first.');
        openConfirmMsgDialog('Confirm Over', 'Opened over the ack.');
        openAckMsgDialog('Ack 2', 'Queued.');
        openAckMsgDialog('Ack 3', 'Queued.');
    });
    
    // Cancel the confirm, then dismiss the acks in turn.
    await page.keyboard.press('Escape');
    await expect(visibleText(page, 'Confirm Over')).toHaveCount(0);
    for (const title of ['Ack 1', 'Ack 2', 'Ack 3']) {
        await expect(visibleText(page, title)).toBeVisible();
        await visibleButton(page, /Acknowledge/).click();
        await expect(visibleText(page, title)).toHaveCount(0);
    }
    
    expect(problems.pageErrors).toEqual([]);
});
