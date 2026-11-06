// Entering an Event again generates paradox, and each point of it is kept, or resisted, by its
// own roll: a 5% to 95% chance of keeping it, lower with the agent's resistParadox skill
// check, and lower the fuller the agent's, its Event's and the timeline's paradox already are.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const routeResistParadox = (page, check='agent.skills.stealth') => page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.skillChecks.resistParadox = {name:'Resist Paradox', check};
        return route.fulfill({json});
    }),
    
    /*  Enters origin again with Alpha's stealth, and paradox as a fraction of its max, every
        roll forced to roll. Returns the paradox owed and how much of it was kept, from empty
        paradox everywhere else. */
    reenter = (page, {stealth=0, agentFull=0, roll}) => page.evaluate(({stealth, agentFull, roll}) => {
        const alpha = tc.model.getAgentModel('AL'),
            origin = tc.model.getEventModel('origin');
        alpha.setSkills({...alpha.getSkills(), stealth});
        // Room for all that's owed, which grows with each visit.
        for (const stat of [origin.paradox, alpha.paradox]) stat.setMax(100);
        for (const stat of [origin.paradox, tc.model.paradox]) stat.setValue(0);
        alpha.paradox.setValue(agentFull * alpha.paradox.getMax());
        const before = origin.paradox.value,
            owed = alpha.calculateParadoxForEntry(origin);
        tc.rng.queueRolls(...Array(owed + 1).fill(roll));
        alpha.setEvent('origin', undefined, true);
        const left = tc.rng.getQueuedRollCount();
        tc.rng.clearQueuedRolls();
        return {owed, kept:origin.paradox.value - before, rolled:owed + 1 - left};
    }, {stealth, agentFull, roll});

test('the better the agent resists, the less paradox entering again keeps', async ({page}) => {
    await routeResistParadox(page);
    const problems = await startGame(page),
        kept = async opts => {
            const {owed, kept, rolled} = await reenter(page, opts);
            // A roll for each point, and no more.
            expect(owed).toBeGreaterThan(0);
            expect(rolled).toBe(owed);
            return kept === owed ? 'kept' : kept === 0 ? 'resisted' : 'some';
        };
    
    // With no paradox anywhere, a 95% chance of keeping each point at the worst skill, 72.5%
    // at none, and 50% at the best.
    expect(await kept({stealth:-1000, roll:949})).toBe('kept');
    expect(await kept({stealth:-1000, roll:950})).toBe('resisted');
    expect(await kept({stealth:0, roll:724})).toBe('kept');
    expect(await kept({stealth:0, roll:725})).toBe('resisted');
    expect(await kept({stealth:1000, roll:499})).toBe('kept');
    expect(await kept({stealth:1000, roll:500})).toBe('resisted');
    // Beyond the skill range is the same as at its end.
    expect(await kept({stealth:5000, roll:500})).toBe('resisted');
    
    // The fuller the paradox already is, the more is resisted: half the agent's makes 72.5%
    // into 65%.
    expect(await kept({agentFull:0.5, roll:649})).toBe('kept');
    expect(await kept({agentFull:0.5, roll:650})).toBe('resisted');
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a broken resistParadox check counts as no skill, with a warning', async ({page}) => {
    await routeResistParadox(page, 'agent.skils.stealth');
    const problems = await startGame(page);
    expect(await reenter(page, {stealth:1000, roll:724})).toMatchObject({kept:1});
    expect(await reenter(page, {stealth:1000, roll:725})).toMatchObject({kept:0});
    expect([...new Set(problems.warnings)]).toEqual([
        expect.stringMatching(/^Check expression threw .*agent\.skils\.stealth$/)
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('arriving shows the paradox it generated and resisted, floating above the button', async ({page}) => {
    await routeResistParadox(page);
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                aftermath = tc.model.getEventModel('aftermath'),
                walk = tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'),
                // Where the button is, as floating text sees it.
                btnView = {getPagePosition:() => ({x:100, y:300}), width:40};
            // Two visits to Aftermath already, so walking there owes 2. All the paradox on the
            // way is resisted, so none of it sends Alpha to The Void.
            tc.rng.queueRolls(999, 999, 999, 999);
            alpha.setEvent('aftermath');
            alpha.setEvent('origin');
            alpha.setEvent('aftermath');
            alpha.setEvent('origin');
            for (const stat of [alpha.paradox, aftermath.paradox, tc.model.paradox]) stat.setValue(0);
            
            // Keeps the first point and resists the second.
            tc.rng.queueRolls(0, 999);
            alpha.doFollowExit(walk, btnView);
            return {
                floating:tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText)).map(sv => ({
                    text:tc.stripMarkup(sv.text), paradoxBg:sv.bgColor === tc.theme.colorParadox
                })),
                kept:aftermath.paradox.value,
                queued:tc.rng.getQueuedRollCount()
            };
        });
    expect(out).toEqual({floating:[{text:'+1⥁\u00A0·\u00A01⥁ resisted', paradoxBg:true}], kept:1, queued:0});
    
    // Without a button, nothing shows.
    expect(await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        tc.rng.queueRolls(999, 999, 999);
        alpha.setEvent('origin');
        for (const stat of [alpha.paradox, tc.model.getEventModel('aftermath').paradox, tc.model.paradox]) stat.setValue(0);
        tc.rng.queueRolls(0, 0, 0);
        alpha.doFollowExit(tc.model.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'));
        tc.rng.clearQueuedRolls();
        return tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText) && tc.stripMarkup(sv.text).startsWith('+3')).length;
    })).toBe(0);
    
    expect(problems.pageErrors).toEqual([]);
});
