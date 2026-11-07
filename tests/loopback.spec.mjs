// An exit with "allowLoopback":true leads back into its own Event, starting it over, e.g. to stay
// another month at HQ. Without it, an exit back into its own Event isn't offered.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const YEAR = 365 * 24 * 60 * 60 * 1000;

const routeHQWithExit = (page, exit) => page.route('**/tests/data/init.json5', route => {
    const json = readTestData('init.json5');
    const hq = json.events.time_corps_hq;
    hq.hidden = 'false';
    hq.actions.week = {label:'A Week', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':'7'}};
    hq.exits = [{mode:'wait', to:'time_corps_hq', ...exit}];
    return route.fulfill({json});
});

test('a loop back exit starts its Event over: the actions are back, the rest of it is lived through, and the agent stays', async ({page}) => {
    await routeHQWithExit(page, {allowLoopback:true});
    const problems = await startGame(page);
    await page.evaluate(() => {
        tc.model.getAgentModel('AL').setEvent('time_corps_hq');
        tc.app.selectAgentRow('AL');
        tc.app.selectEventBox('time_corps_hq');
    });
    const before = await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.doAction(tc.model.getEventModel('time_corps_hq').getActionModels().week);
        return {age:alpha.getAge(), left:alpha.getActionsRemaining(), visits:alpha.getVisitHistory().length};
    });
    expect(before.left).toBe(23);

    const exitBtn = page.getByRole('button', {name:/^Wait til ❉ Time Corps Headquarters/}).filter({visible:true});
    await expect(exitBtn).toBeVisible();
    await exitBtn.click();

    const after = await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            hq = tc.model.getEventModel('time_corps_hq');
        return {
            at:alpha.event, age:alpha.getAge(), left:alpha.getActionsRemaining(),
            visits:alpha.getVisitHistory().length, paradox:alpha.paradox.value,
            day:hq.getDuration() / hq.getActionLimit()
        };
    });
    expect(after.at).toBe('time_corps_hq');
    expect(after.left).toBe(30);
    // The 23 unused days, and no travel time.
    expect(after.age - before.age).toBeCloseTo(23 * after.day / YEAR, 9);
    expect(after.visits).toBe(before.visits + 1);
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('without allowLoopback, an exit back into its own Event isn\'t offered and does nothing', async ({page}) => {
    await routeHQWithExit(page, {});
    const problems = await startGame(page);
    await page.evaluate(() => {
        tc.model.getAgentModel('AL').setEvent('time_corps_hq');
        tc.app.selectAgentRow('AL');
        tc.app.selectEventBox('time_corps_hq');
    });
    await expect(page.getByText('A Week', {exact:false}).filter({visible:true}).first()).toBeVisible();
    await expect(page.getByRole('button', {name:/^Wait til /}).filter({visible:true})).toHaveCount(0);

    const out = await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            hq = tc.model.getEventModel('time_corps_hq');
        alpha.doAction(hq.getActionModels().week);
        const age = alpha.getAge();
        alpha.doFollowExit(hq.getExitModels()[0]);
        return {left:alpha.getActionsRemaining(), aged:alpha.getAge() - age};
    });
    expect(out).toEqual({left:23, aged:0});
    expect(problems.warnings).toEqual(['Exit from time_corps_hq leads back into it without allowLoopback']);
    expect(problems.pageErrors).toEqual([]);
});
