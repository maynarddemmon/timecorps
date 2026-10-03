import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const visibleButton = (page, name) => page.getByRole('button', {name}).filter({visible:true}),
    
    // The state of each FloatingText that is showing.
    getActives = page => page.evaluate(() => tc.getActiveFloatingTexts().map(floatingText => {
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
            visible:floatingText.visible
        };
    })),
    
    // Animates for a moment so the start position can be checked.
    LONG = 60000;

test('floating text shows centered above x,y and on top of the UI', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(LONG => {tc.showFloatingText('Roll 412', 500, 300, {duration:LONG});}, LONG);
    
    const [shown] = await getActives(page);
    expect(shown).toMatchObject({text:'Roll 412', centerX:500, opacity:1, pointerEvents:'none', visible:true});
    expect(shown.bottom).toBeGreaterThanOrEqual(299); // Barely risen yet.
    expect(shown.bottom).toBeLessThanOrEqual(300);
    
    // It's what's on top at that point, but not what the mouse would hit.
    expect(await page.evaluate(() => {
        const floatingText = tc.getActiveFloatingTexts()[0],
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
    await page.evaluate(([x, y, LONG]) => {tc.showFloatingText('████████', x, y + 5, {duration:LONG, fontSize:'40px'});}, [x, y, LONG]);
    const [cover] = await getActives(page),
        rect = await page.evaluate(() => tc.getActiveFloatingTexts()[0].getODE().getBoundingClientRect().toJSON());
    expect(cover.visible).toBe(true);
    expect(rect.left < x && x < rect.right && rect.top < y && y < rect.bottom).toBe(true);
    
    await page.mouse.click(x, y);
    await expect(page.getByText('Settings', {exact:false}).filter({visible:true}).first()).toBeVisible();
    
    expect(problems.pageErrors).toEqual([]);
});

test('floating text rises, fades out and is reused with fresh styling', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        globalThis.firstFloatingText = tc.showFloatingText('first', 400, 300, {duration:400, rise:20, textColor:'#0c0', fontWeight:'bold'});
    });
    
    // Partway: higher up and partly faded.
    await page.waitForTimeout(200);
    const [midway] = await getActives(page);
    expect(midway.bottom).toBeLessThan(300);
    expect(midway.bottom).toBeGreaterThan(280);
    expect(midway.opacity).toBeLessThan(1);
    expect(midway.opacity).toBeGreaterThan(0);
    
    // Done: gone and back in the pool.
    await expect.poll(() => getActives(page)).toEqual([]);
    expect(await page.evaluate(() => tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText)).map(sv => sv.visible))).toEqual([false]);
    
    // The same instance is reused, without the last show's styling.
    expect(await page.evaluate(LONG => tc.showFloatingText('second', 400, 300, {duration:LONG}) === globalThis.firstFloatingText, LONG)).toBe(true);
    const [reused] = await getActives(page);
    expect(reused).toMatchObject({text:'second', opacity:1, visible:true});
    expect(reused.color).toBe(await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.color = tc.theme.colorBtn;
        document.body.appendChild(probe);
        try {
            return getComputedStyle(probe).color;
        } finally {
            probe.remove();
        }
    }));
    expect(await page.evaluate(() => tc.getActiveFloatingTexts()[0].fontWeight)).toBe('normal');
    
    expect(problems.warnings).toEqual([]);
});

test('several can show at once and can be cleared', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        tc.showFloatingText('a', 100, 300, {duration:300});
        tc.showFloatingText('b', 200, 300, {duration:300});
        tc.showFloatingText('c', 300, 300, {duration:300});
    });
    expect((await getActives(page)).map(shown => shown.text)).toEqual(['a', 'b', 'c']);
    
    await page.evaluate(() => tc.clearFloatingText());
    expect(await getActives(page)).toEqual([]);
    expect(await page.evaluate(() => tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText) && sv.visible).length)).toBe(0);
    
    // Their animations were stopped, so a reused instance isn't faded or put back by the 
    // animation of what it showed before.
    await page.evaluate(LONG => {tc.showFloatingText('d', 100, 300, {duration:LONG});}, LONG);
    await page.waitForTimeout(500);
    const [reused] = await getActives(page);
    expect(reused).toMatchObject({text:'d', visible:true});
    expect(reused.opacity).toBeGreaterThan(0.95);
    expect(problems.warnings).toEqual([]);
});

test('floating text can show just above the mouse', async ({page}) => {
    const problems = await startGame(page);
    await page.mouse.move(640, 420);
    expect(await page.evaluate(() => tc.getMousePosition())).toEqual({x:640, y:420});
    
    await page.evaluate(LONG => {tc.showFloatingTextAboveMouse('above', {duration:LONG});}, LONG);
    const [shown] = await getActives(page);
    expect(shown.centerX).toBe(640);
    expect(shown.bottom).toBeLessThan(420);
    expect(shown.bottom).toBeGreaterThan(400);
    
    expect(problems.warnings).toEqual([]);
});
