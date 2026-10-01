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
