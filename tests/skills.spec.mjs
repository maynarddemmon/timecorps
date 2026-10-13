// Buying skill points: at HQ, from the agent's dossier, for credits, up to MAX_SKILL_VALUE.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame} from './helpers.mjs';

const
    /*  Puts Alpha at HQ with some credits and opens their dossier. */
    openAtHQ = (page, credits) => page.evaluate(credits => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.setEvent('time_corps_hq');
        tc.model.setCredits(credits);
        tc.app.openAgentDossier(alpha);
    }, credits),

    // A skill's purchase button in the open dossier, by the skill's label.
    buyBtn = (page, skillName) => page.locator('.myt-AgentDossier .myt-SkillBar')
        .filter({visible:true})
        .filter({has:page.getByText(new RegExp('^' + skillName + ' : '))})
        .locator('.myt-UnderlineBtn'),

    readAlpha = (page, skillId) => page.evaluate(skillId => ({
        skill:tc.model.getAgentModel('AL').getSkill(skillId),
        credits:tc.model.getCredits()
    }), skillId);

test('a skill point costs a credit, and can only be bought at HQ, by the Corps\' own living agents, up to the maximum', async ({page}) => {
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const m = tc.model,
                alpha = m.getAgentModel('AL'),
                bravo = m.getAgentModel('BR'),
                buy = (agent, skillId) => ({
                    problem:agent.getSkillPurchaseProblem(skillId),
                    bought:agent.purchaseSkill(skillId),
                    skill:agent.getSkill(skillId),
                    credits:m.getCredits()
                });
            m.setCredits(2);
            const r = {
                purchase:tc.getSkillPurchase(alpha, 'agl'),
                maxSkill:tc.cfg.MAX_SKILL_VALUE,
                // Alpha starts at the origin.
                away:buy(alpha, 'agl')
            };
            alpha.setEvent('time_corps_hq');
            r.first = buy(alpha, 'agl');
            // A skill the agent wasn't given starts at 0.
            r.second = buy(alpha, 'disguise');
            r.broke = buy(alpha, 'agl');

            m.setCredits(5);
            r.unknown = buy(alpha, 'nope');

            alpha.setSkills({...alpha.getSkills(), agl:tc.cfg.MAX_SKILL_VALUE - 1});
            r.toMax = buy(alpha, 'agl');
            r.atMax = buy(alpha, 'agl');

            // Bravo is hidden and not yet under the Corps' control.
            bravo.setEvent('time_corps_hq');
            r.civilian = buy(bravo, 'agl');

            alpha.health.setValue(0);
            r.dead = buy(alpha, 'str');
            return r;
        });
    expect(out.purchase).toEqual({points:1, credits:1});
    expect(out.maxSkill).toBe(1000);
    expect(out.away).toEqual({problem:'Only at HQ', bought:false, skill:25, credits:2});
    expect(out.first).toEqual({problem:null, bought:true, skill:26, credits:1});
    expect(out.second).toEqual({problem:null, bought:true, skill:1, credits:0});
    expect(out.broke).toEqual({problem:'Not enough credits', bought:false, skill:26, credits:0});
    expect(out.unknown).toEqual({problem:'No such skill', bought:false, skill:0, credits:5});
    expect(out.toMax).toEqual({problem:null, bought:true, skill:1000, credits:4});
    expect(out.atMax).toEqual({problem:'At its maximum', bought:false, skill:1000, credits:4});
    expect(out.civilian).toEqual({problem:'Not under Time Corps control', bought:false, skill:50, credits:4});
    expect(out.dead).toEqual({problem:'Deceased', bought:false, skill:50, credits:4});
    expect(problems.pageErrors).toEqual([]);
});

test('the dossier\'s buttons buy skill points, and say why when they can\'t', async ({page}) => {
    const problems = await startGame(page);
    await openAtHQ(page, 2);

    const agility = buyBtn(page, 'Agility');
    await expect(agility).toHaveText('+1');
    await expect(agility).toHaveAttribute('title', 'Train Agility +1 for 1 credit');

    await agility.click();
    await expect(page.getByText('Agility : 26', {exact:true}).filter({visible:true})).toBeVisible();
    expect(await readAlpha(page, 'agl')).toEqual({skill:26, credits:1});

    await agility.click();
    expect(await readAlpha(page, 'agl')).toEqual({skill:27, credits:0});

    // Out of credits, every button is disabled, and a click does nothing.
    await expect(agility).toHaveClass(/disabled/);
    await expect(buyBtn(page, 'Strength')).toHaveClass(/disabled/);
    await expect(agility).toHaveAttribute('title', 'Train Agility +1 for 1 credit · Not enough credits');
    await agility.click({force:true});
    expect(await readAlpha(page, 'agl')).toEqual({skill:27, credits:0});

    // More credits, from anywhere, enable them again.
    await page.evaluate(() => tc.model.setCredits(3));
    await expect(agility).not.toHaveClass(/disabled/);

    // Away from HQ, they're disabled.
    await page.evaluate(() => tc.model.getAgentModel('AL').setEvent('origin'));
    await expect(agility).toHaveClass(/disabled/);
    await expect(agility).toHaveAttribute('title', 'Train Agility +1 for 1 credit · Only at HQ');

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a civilian\'s dossier has no buttons', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const bravo = tc.model.getAgentModel('BR');
        bravo.setHidden(false);
        tc.app.openAgentDossier(bravo);
    });
    await expect(page.getByText('Agility : 50', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(page.locator('.myt-AgentDossier .myt-SkillBar .myt-UnderlineBtn').filter({visible:true})).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});

test('bought skill points survive a save and reload', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.setEvent('time_corps_hq');
        tc.model.setCredits(3);
        alpha.purchaseSkill('agl');
        alpha.purchaseSkill('agl');
        tc.persistence.save();
    });
    await reloadGame(page);
    expect(await readAlpha(page, 'agl')).toEqual({skill:27, credits:1});
    expect(problems.pageErrors).toEqual([]);
});
