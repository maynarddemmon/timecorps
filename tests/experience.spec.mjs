// Experience: init.json5's "agingSkillGains" gives an agent a point in a skill, picked by
// weight, for every monthsPerGain of lived age. Effective age doesn't count. A skill with
// "trainable":false can't be bought at HQ.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData} from './helpers.mjs';

const routeExperience = (page, agingSkillGains) => page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.skills.luck = {name:'Luck', description:'Fate.', trainable:false};
        json.agingSkillGains = agingSkillGains;
        return route.fulfill({json});
    }),

    alphaSkills = page => page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        return {luck:alpha.getSkill('luck'), investigation:alpha.getSkill('investigation'), toward:alpha.livedTowardSkillGain};
    });

test('each month of lived age gains a point in a skill picked by weight', async ({page}) => {
    await routeExperience(page, {monthsPerGain:1, weights:{investigation:1, luck:3}});
    const problems = await startGame(page),
        start = await alphaSkills(page),
        MILLIS_PER_MONTH = await page.evaluate(() => tc.timeUtil.MILLIS_PER_YEAR / 12);
    expect(start.luck).toBe(0);

    // Two and a half months: two gains, picked by rolls out of 4. 0 is investigation's, and
    // 3 is luck's. The half month carries over.
    await page.evaluate(MILLIS_PER_MONTH => {
        tc.rng.queueRolls(0, 3);
        tc.model.getAgentModel('AL').ageBy(2.5 * MILLIS_PER_MONTH);
    }, MILLIS_PER_MONTH);
    let skills = await alphaSkills(page);
    expect([skills.investigation - start.investigation, skills.luck]).toEqual([1, 1]);
    expect(skills.toward / MILLIS_PER_MONTH).toBeCloseTo(0.5, 6);

    // Another half month completes the third.
    await page.evaluate(MILLIS_PER_MONTH => {
        tc.rng.queueRolls(1);
        tc.model.getAgentModel('AL').ageBy(0.5 * MILLIS_PER_MONTH);
    }, MILLIS_PER_MONTH);
    skills = await alphaSkills(page);
    expect([skills.investigation - start.investigation, skills.luck]).toEqual([1, 2]);

    // The body's age doesn't count, however it changes.
    await page.evaluate(() => tc.model.getAgentModel('AL').adjEffectiveAge(5));
    expect(await alphaSkills(page)).toEqual(skills);

    // What's toward the next gain is saved.
    await page.evaluate(MILLIS_PER_MONTH => tc.model.getAgentModel('AL').ageBy(0.25 * MILLIS_PER_MONTH), MILLIS_PER_MONTH);
    const beforeSave = await alphaSkills(page);
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await alphaSkills(page)).toEqual(beforeSave);

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an action\'s gains float just above its own result', async ({page}) => {
    // A gain every 5 seconds or so, all luck, so Investigate's 20 seconds of origin gain several.
    await routeExperience(page, {monthsPerGain:0.000002, weights:{luck:1}});
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.selectEventBox('origin'));

    await page.getByRole('button', {name:/^Investigate/}).filter({visible:true}).first().click();
    const floating = await page.evaluate(() => tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText)).map(sv => ({text:tc.stripMarkup(sv.text), y:sv.y})));
    expect(floating).toHaveLength(2);
    const [result, gains] = floating;
    expect(result.text).toMatch(/^(Succeeded|Failed)/);
    expect(gains.text).toBe('+' + (await alphaSkills(page)).luck + ' Luck');
    expect(gains.y).toBeLessThan(result.y);

    expect(problems.pageErrors).toEqual([]);
});

test('a skill that isn\'t trainable has no Train button, and can\'t be bought', async ({page}) => {
    await routeExperience(page, {weights:{luck:1}});
    const problems = await startGame(page);

    expect(await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL'),
            dossier = tc.app.openAgentDossier(alpha),
            hasTrainBtn = skillId => !!dossier._skillBars.find(bar => bar.skillId === skillId).increaseBtn;
        return {
            luck:hasTrainBtn('luck'), investigation:hasTrainBtn('investigation'),
            problem:alpha.getSkillPurchaseProblem('luck'), bought:alpha.purchaseSkill('luck')
        };
    })).toEqual({
        luck:false, investigation:true,
        problem:'Can’t be trained; it grows with experience', bought:false
    });

    expect(problems.pageErrors).toEqual([]);
});

test('a broken agingSkillGains is warned about, keeping what\'s usable', async ({page}) => {
    await routeExperience(page, {monthsPerGain:1, weights:{luck:2, nope:3, investigation:1.5}, extra:true});
    const problems = await startGame(page);
    expect(problems.warnings.filter(warning => warning.startsWith('agingSkillGains'))).toEqual([
        'agingSkillGains has unknown keys extra (ignoring them)',
        'agingSkillGains weights names no skill nope (ignoring it)',
        'agingSkillGains weight for investigation must be a whole number above 0 (ignoring it): 1.5'
    ]);
    expect(await page.evaluate(() => tc.model.getAgingSkillGains())).toEqual({monthsPerGain:1, weights:[['luck', 2]], totalWeight:2});
    expect(problems.pageErrors).toEqual([]);
});
