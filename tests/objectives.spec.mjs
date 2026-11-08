// An Objective can be hidden, e.g. "shown":"agents.ME.faction === 'syndicate'" for one
// faction's. While hidden it isn't shown and doesn't count toward the mission's success.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, showTab, setCausator} from './helpers.mjs';

const routeSyndicateObjective = page => page.route('**/tests/data/test_operations.json5', route => {
        const json = readTestData('test_operations.json5');
        // The test data has no Syndicate, so an unaligned agent stands in for one.
        json.operations.first.objectives.cut = {
            name:'Syndicate Cut',
            description:['The Syndicate wants its share.'],
            shown:"agents.AL.faction === 'unaligned'",
            success:'false'
        };
        return route.fulfill({json});
    }),

    readFirst = page => page.evaluate(() => {
        const first = tc.model.getOperationModel('first'),
            {success, total} = first.getProgress();
        return {
            shown:first.getShownObjectiveModels().map(objectiveModel => objectiveModel.id),
            progress:success + '/' + total,
            successGranted:first.successGranted
        };
    }),

    setFaction = (page, faction) => page.evaluate(faction => tc.model.getAgentModel('AL').setFaction(faction), faction);

test('a hidden objective isn\'t shown or counted, and hiding an unmet one can complete the mission', async ({page}) => {
    await routeSyndicateObjective(page);
    const problems = await startGame(page);
    await showTab(page, 'Missions');
    const cutTxt = page.getByText('Syndicate Cut', {exact:true}).filter({visible:true});

    // Alpha is Corps, so the Syndicate's objective is hidden.
    expect(await readFirst(page)).toEqual({shown:['avoid'], progress:'0/1', successGranted:false});
    await expect(page.getByText('Not Struck', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(cutTxt).toHaveCount(0);

    // Out of the Corps, it shows and counts.
    await setFaction(page, 'unaligned');
    await expect.poll(() => readFirst(page)).toEqual({shown:['avoid', 'cut'], progress:'0/2', successGranted:false});
    await expect(cutTxt).toBeVisible();

    // With the rest met, it's what holds the mission back.
    await setCausator(page, 'plan', 'prepared', true);
    await setCausator(page, 'lever', 'pulled', true);
    await expect.poll(() => readFirst(page)).toEqual({shown:['avoid', 'cut'], progress:'1/2', successGranted:false});

    // Hidden again, it no longer counts, and the mission completes.
    await setFaction(page, 'timecorps');
    await expect.poll(() => readFirst(page)).toEqual({shown:['avoid'], progress:'1/1', successGranted:true});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});
