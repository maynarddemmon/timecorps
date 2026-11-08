// The header's rightmost button is GitHub's mark, linking to the project in a new tab.
import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

test('the GitHub mark at the right of the header opens the project in a new tab', async ({page}) => {
    const problems = await startGame(page);
    const btn = page.getByRole('button', {name:'Time Corps on GitHub', exact:true});
    await expect(btn).toBeVisible();
    
    // The rightmost button in the header, showing the dark mark.
    expect(await btn.evaluate(el => {
        const right = el.getBoundingClientRect().right,
            headerBtns = [...el.parentElement.querySelectorAll(':scope > button')];
        return headerBtns.every(other => other.getBoundingClientRect().right <= right);
    })).toBe(true);
    const markUrl = await btn.evaluate(el => getComputedStyle(el.firstElementChild).backgroundImage.match(/url\("(.*)"\)/)[1]);
    const markSvg = await (await page.request.get(markUrl)).text();
    expect(markSvg).toContain('fill="#840"');
    
    await page.evaluate(() => {window.open = (...args) => {globalThis.opened = args; return null;};});
    await btn.click();
    expect(await page.evaluate(() => globalThis.opened)).toEqual(['https://github.com/maynarddemmon/timecorps', '_blank', 'noopener']);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
