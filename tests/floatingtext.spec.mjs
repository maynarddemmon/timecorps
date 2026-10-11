import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true}),
    
    // The state of each FloatingText that is showing, in the order they were made.
    getShowing = page => page.evaluate(() => tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText) && sv.visible).map(floatingText => {
        const elem = floatingText.getODE(),
            rect = elem.getBoundingClientRect(),
            style = getComputedStyle(elem);
        return {
            text:floatingText.text,
            centerX:Math.round(rect.left + rect.width / 2),
            bottom:Math.round(rect.bottom),
            opacity:Number(style.opacity),
            pointerEvents:style.pointerEvents,
            color:style.color,
            bgColor:style.backgroundColor
        };
    })),
    
    // A CSS color as the browser computes it, for comparing with computed styles.
    computeColor = (page, color) => page.evaluate(color => {
        const probe = document.createElement('div');
        probe.style.color = color;
        document.body.appendChild(probe);
        try {
            return getComputedStyle(probe).color;
        } finally {
            probe.remove();
        }
    }, color),
    
    TRANSPARENT = 'rgba(0, 0, 0, 0)',
    
    // Long enough that a check made right after showing sees the start of the animation.
    LONG = 60000;

test('floating text shows centered above x,y and on top of the UI', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(LONG => {tc.showFloatingText('Roll 412', {duration:LONG}, 500, 300);}, LONG);
    
    const [shown] = await getShowing(page);
    expect(shown).toMatchObject({text:'Roll 412', centerX:500, opacity:1, pointerEvents:'none'});
    expect(shown.bottom).toBeGreaterThanOrEqual(299); // Barely risen yet.
    expect(shown.bottom).toBeLessThanOrEqual(300);
    
    // It's what's on top at that point, but not what the mouse would hit.
    expect(await page.evaluate(() => {
        const floatingText = tc.app.getSubviews().find(sv => sv.isA(tc.FloatingText)),
            zIndex = Number(floatingText.getODE().style.zIndex);
        return tc.app.getSubviews().every(sv => sv === floatingText || zIndex > (Number(sv.getODE().style.zIndex) || 0));
    })).toBe(true);
    
    expect(problems.warnings).toEqual([]);
});

test('floating text doesn\'t intercept clicks', async ({page}) => {
    const problems = await startGame(page);
    const settingsBtn = visibleButton(page, '⚙'),
        box = await settingsBtn.boundingBox(),
        x = box.x + box.width / 2,
        y = box.y + box.height / 2;
    
    // Covers the settings button, bottom-centered just below the point that gets clicked.
    await page.evaluate(([x, y, LONG]) => {tc.showFloatingText('████████', {duration:LONG, fontSize:'40px'}, x, y + 5);}, [x, y, LONG]);
    const rect = await page.evaluate(() => tc.app.getSubviews().find(sv => sv.isA(tc.FloatingText)).getODE().getBoundingClientRect().toJSON());
    expect(rect.left < x && x < rect.right && rect.top < y && y < rect.bottom).toBe(true);
    
    await page.mouse.click(x, y);
    await expect(page.getByText('Settings', {exact:false}).filter({visible:true}).first()).toBeVisible();
    
    expect(problems.pageErrors).toEqual([]);
});

test('floating text rises, fades out and is reused with fresh styling', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        globalThis.firstFloatingText = tc.showFloatingText('first', {duration:400, rise:20, textColor:'#0c0', bgColor:'#c00', fontWeight:'bold'}, 400, 300);
    });
    
    // Partway: higher up and partly faded.
    await page.waitForTimeout(200);
    const [midway] = await getShowing(page);
    expect(midway.bottom).toBeLessThan(300);
    expect(midway.bottom).toBeGreaterThan(280);
    expect(midway.opacity).toBeLessThan(1);
    expect(midway.opacity).toBeGreaterThan(0);
    
    // Done: hidden and back in the pool.
    await expect.poll(() => getShowing(page)).toEqual([]);
    
    // The same instance is reused, without the last show's styling.
    expect(await page.evaluate(LONG => tc.showFloatingText('second', {duration:LONG}, 400, 300) === globalThis.firstFloatingText, LONG)).toBe(true);
    const [reused] = await getShowing(page);
    expect(reused).toMatchObject({text:'second', opacity:1, color:await computeColor(page, await page.evaluate(() => tc.theme.colorBtn)), bgColor:TRANSPARENT});
    expect(await page.evaluate(() => globalThis.firstFloatingText.fontWeight)).toBe('normal');
    
    expect(problems.warnings).toEqual([]);
});

test('several can show at once', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(LONG => {
        tc.showFloatingText('a', {duration:LONG}, 100, 300);
        tc.showFloatingText('b', {duration:LONG}, 200, 300);
        tc.showFloatingText('c', {duration:LONG}, 300, 300);
    }, LONG);
    expect((await getShowing(page)).map(shown => [shown.text, shown.centerX])).toEqual([['a', 100], ['b', 200], ['c', 300]]);
    expect(problems.warnings).toEqual([]);
});

test('investigating shows the check result and what it found above the investigate button', async ({page}) => {
    const problems = await startGame(page);
    const investigateBtn = visibleButton(page, /Investigate/),
        investigate = async roll => {
            await page.evaluate(roll => tc.rng.queueRolls(roll), roll);
            const box = await investigateBtn.boundingBox();
            await investigateBtn.click();
            return box;
        };
    
    const box = await investigate(999);
    const [success] = await getShowing(page);
    expect(success.text.replace(/\u00A0/g, ' ')).toMatch(/^Succeeded by \d+ · \+\d+ Attestation$/);
    expect(success.bgColor).toBe(await computeColor(page, await page.evaluate(() => tc.theme.colorSuccess)));
    expect(Math.abs(success.centerX - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
    expect(success.bottom).toBeLessThanOrEqual(Math.round(box.y));
    expect(success.bottom).toBeGreaterThan(box.y - 5);
    
    await investigate(0);
    const failure = (await getShowing(page)).at(-1);
    expect(failure.text).toMatch(/^Failed by \d+$/);
    expect(failure.bgColor).toBe(await computeColor(page, await page.evaluate(() => tc.theme.colorError)));
    
    expect(problems.warnings).toEqual([]);
});
