// Credits: earned as the score reaches new heights, one per SCORE_TO_CREDITS_EARN_AMOUNT (100),
// awarded by missions, and spent on actions' costs.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData} from './helpers.mjs';

const NO_ROLL = {difficulty:'no-roll'},

    /*  Serves the test data with credits awarded by the first mission, and an action at the
        origin, where Alpha starts, that costs credits. */
    routeDataWithCredits = page => Promise.all([
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5'),
                first = json.operations.first;
            first.onSetup.awardCredits = 5;
            first.onSuccess.awardCredits = 7;
            return route.fulfill({json});
        }),
        page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5');
            json.events.origin.actions.bribe = {
                label:'Bribe', skillCheck:NO_ROLL, costs:{'agent.action':null, 'timeline.credits':'3'}
            };
            return route.fulfill({json});
        })
    ]),

    readCredits = page => page.evaluate(() => ({score:tc.model.getScore(), credits:tc.model.getCredits()})),
    setScore = (page, score) => page.evaluate(score => tc.model.setScore(score), score),
    adjScore = (page, adj) => page.evaluate(adj => tc.model.adjScore(adj), adj);

test('credits are earned once per 100 score the first time the score reaches it', async ({page}) => {
    await routeDataWithCredits(page);
    const problems = await startGame(page);

    // The first mission's setup awarded 5.
    expect(await readCredits(page)).toEqual({score:0, credits:5});

    // Only whole credits, so 78 earns nothing, and 100 earns one.
    await setScore(page, 78);
    expect(await readCredits(page)).toEqual({score:78, credits:5});
    await adjScore(page, 22);
    expect(await readCredits(page)).toEqual({score:100, credits:6});

    // Several at once.
    await adjScore(page, 350);
    expect(await readCredits(page)).toEqual({score:450, credits:9});

    // Losing score takes no credits away, and regaining it earns nothing again.
    await adjScore(page, -500);
    expect(await readCredits(page)).toEqual({score:-50, credits:9});
    await setScore(page, 450);
    expect(await readCredits(page)).toEqual({score:450, credits:9});

    // Only past the old peak.
    await setScore(page, 520);
    expect(await readCredits(page)).toEqual({score:520, credits:10});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a mission awards credits on success, as well as those its score earns', async ({page}) => {
    await routeDataWithCredits(page);
    const problems = await startGame(page);
    await page.evaluate(() => tc.model.getOperationModel('first').doOnSuccess());
    // 5 from setup, 7 from success and 50 from its 5000 score.
    expect(await readCredits(page)).toEqual({score:5000, credits:62});

    // Only once.
    await page.evaluate(() => tc.model.getOperationModel('first').doOnSuccess());
    expect((await readCredits(page)).credits).toBe(62);
    expect(problems.pageErrors).toEqual([]);
});

test('actions can cost credits, and the header shows them', async ({page}) => {
    await routeDataWithCredits(page);
    const problems = await startGame(page),
        bribe = () => page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                action = tc.model.getEventModel('origin').getActionModels().bribe,
                canPay = alpha.canPayCostsFor(action),
                phrase = alpha.getCostsPhrase(action);
            alpha.doAction(action);
            return {canPay, phrase, credits:tc.model.getCredits()};
        });

    await expect(page.getByText('Credits').filter({visible:true})).toBeVisible();
    expect(await bribe()).toEqual({canPay:true, phrase:'Uses no action · Costs: 3 Credits', credits:2});
    expect(await bribe()).toEqual({canPay:false, phrase:"Uses no action · Costs: 3 Credits (can't pay)", credits:2});
    expect(problems.pageErrors).toEqual([]);
});

test('credits and the peak score survive a save and reload, without earning again', async ({page}) => {
    await routeDataWithCredits(page);
    const problems = await startGame(page);
    await setScore(page, 340);
    await adjScore(page, -300);
    expect(await readCredits(page)).toEqual({score:40, credits:8});

    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await readCredits(page)).toEqual({score:40, credits:8});

    // The peak was kept, so regaining score up to it still earns nothing.
    await setScore(page, 340);
    expect(await readCredits(page)).toEqual({score:340, credits:8});
    await setScore(page, 400);
    expect(await readCredits(page)).toEqual({score:400, credits:9});
    expect(problems.pageErrors).toEqual([]);
});

test('a bad credit award is 0, with a warning', async ({page}) => {
    await page.route('**/tests/data/operations.json5', route => {
        const json = readTestData('operations.json5');
        json.operations.first.onSetup.awardCredits = 2.5;
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    expect((await readCredits(page)).credits).toBe(0);
    expect(problems.warnings).toEqual(['onSetup.awardCredits must be a whole number of 0 or more (using 0): 2.5']);
    expect(problems.pageErrors).toEqual([]);
});
