// myt.debounceMicrotask: one call at the end of each burst of synchronous work, per "this".
import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

test('merges the calls in a burst into one, with the last arguments, for each "this"', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(async () => {
        const calls = [],
            func = myt.debounceMicrotask(function(v) {calls.push([this.name, v]);}),
            a = {name:'a', func}, b = {name:'b', func};
        a.func(1); a.func(2); b.func(3); a.func(4);
        const beforeEnd = calls.length;
        await Promise.resolve();
        const afterBurst = [...calls];
        a.func(5);
        await Promise.resolve();
        return {beforeEnd, afterBurst, all:calls};
    });
    expect(result.beforeEnd).toBe(0);
    expect(result.afterBurst).toEqual([['a', 4], ['b', 3]]);
    expect(result.all).toEqual([['a', 4], ['b', 3], ['a', 5]]);
    expect(problems.pageErrors).toEqual([]);
});

test('an error thrown by the call is logged rather than lost', async ({page}) => {
    const problems = await startGame(page),
        errors = [];
    page.on('console', msg => {if (msg.type() === 'error') errors.push(msg.text());});
    await page.evaluate(async () => {
        myt.debounceMicrotask(() => {throw new Error('boom');})();
        await Promise.resolve();
    });
    await expect.poll(() => errors.some(text => text.includes('debounceMicrotask: the call threw'))).toBe(true);
    expect(problems.pageErrors).toEqual([]);
});
