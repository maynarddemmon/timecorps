import {test, expect} from '@playwright/test';
import {startGame, queueRolls, readJson, SCENARIO_FILES} from './helpers.mjs';

/*  Evaluates a check in the page against a real agent and event, after forcing the roll. The 
    agent's skills are replaced for the check and restored afterwards. */
const evaluateCheck = (page, expr, {roll, difficulty=500, skills={}, agentId='VQ', eventId='collision'} = {}) => page.evaluate(
        ([expr, roll, difficulty, skills, agentId, eventId]) => {
            const agent = tc.model.getAgentModel(agentId),
                original = agent.getSkills();
            agent.setSkills(skills);
            try {
                if (roll != null) tc.rng.queueRolls(roll);
                return tc.checks.evaluate(expr, {agent, event:tc.model.getEventModel(eventId), difficulty});
            } finally {
                agent.setSkills(original);
            }
        },
        [expr, roll, difficulty, skills, agentId, eventId]
    ),
    
    DECEPTION = 'agent.skills.deception - difficulty';

test.describe('rng', () => {
    test('rolls are integers in range', async ({page}) => {
        await startGame(page);
        const rolls = await page.evaluate(() => Array.from({length:2000}, () => tc.rng.roll()));
        expect(rolls.every(v => Number.isInteger(v) && v >= 0 && v < 1000)).toBe(true);
        
        const ints = await page.evaluate(() => Array.from({length:500}, () => tc.rng.randomInt(6, 3)));
        expect(new Set(ints)).toEqual(new Set([3, 4, 5, 6]));
    });
    
    test('queued rolls are used in order, then rolls are random again', async ({page}) => {
        await startGame(page);
        await queueRolls(page, 7, 999, 0);
        expect(await page.evaluate(() => [tc.rng.roll(), tc.rng.roll(), tc.rng.roll()])).toEqual([7, 999, 0]);
        expect(await page.evaluate(() => tc.rng.getQueuedRollCount())).toBe(0);
        
        // randomInt treats a queued value as the offset from min.
        await queueRolls(page, 2);
        expect(await page.evaluate(() => tc.rng.randomInt(20, 10))).toBe(12);
    });
    
    test('a queued roll out of range is an error, not a silent clamp', async ({page}) => {
        await startGame(page);
        await queueRolls(page, 1000);
        expect(await page.evaluate(() => {
            try {
                tc.rng.roll();
                return 'no error';
            } catch (err) {
                return err.name;
            }
        })).toBe('RangeError');
    });
});

test.describe('checks', () => {
    test('the roll plus the ease succeeds at 0 or more', async ({page}) => {
        const problems = await startGame(page);
        
        // Skill 0 at difficulty 500 is an ease of -500, so it succeeds on 500-999: half the rolls.
        expect(await evaluateCheck(page, DECEPTION, {roll:499})).toEqual({success:false, result:-1, roll:499, difficulty:500, ease:-500});
        expect(await evaluateCheck(page, DECEPTION, {roll:500})).toEqual({success:true, result:0, roll:500, difficulty:500, ease:-500});
        
        // Skill lowers the roll needed by one point per skill point.
        expect((await evaluateCheck(page, DECEPTION, {roll:400, skills:{deception:100}})).success).toBe(true);
        expect((await evaluateCheck(page, DECEPTION, {roll:399, skills:{deception:100}})).success).toBe(false);
        
        // Negative skill raises it.
        expect((await evaluateCheck(page, DECEPTION, {roll:599, skills:{deception:-100}})).success).toBe(false);
        expect((await evaluateCheck(page, DECEPTION, {roll:600, skills:{deception:-100}})).success).toBe(true);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('the ease is clamped, by default to between always and never', async ({page}) => {
        const problems = await startGame(page);
        
        expect((await evaluateCheck(page, '5000', {roll:0})).ease).toBe(0);
        expect((await evaluateCheck(page, '-5000', {roll:999})).ease).toBe(-1000);
        expect((await evaluateCheck(page, '-5000', {roll:999})).success).toBe(false);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('skills an agent lacks count as 0, including inside Math.max', async ({page}) => {
        const problems = await startGame(page);
        const bestOf = 'Math.max(agent.skills.deception, agent.skills.disguise) - difficulty';
        
        // Neither skill: still a fair 50% check rather than NaN failing every time.
        expect((await evaluateCheck(page, bestOf, {roll:500})).success).toBe(true);
        
        // Only one skill: the other counts as 0, so the max is the one present.
        expect((await evaluateCheck(page, bestOf, {roll:300, skills:{disguise:200}})).success).toBe(true);
        expect((await evaluateCheck(page, bestOf, {roll:299, skills:{disguise:200}})).success).toBe(false);
        
        // The agent's own data is untouched by the defaulting.
        expect(await page.evaluate(() => {
            const agent = tc.model.getAgentModel('VQ'),
                original = agent.getSkills();
            agent.setSkills({});
            try {
                tc.checks.evaluate('agent.skills.deception', {agent});
                return 'deception' in agent.getSkills();
            } finally {
                agent.setSkills(original);
            }
        })).toBe(false);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('weighted skills and the event are available', async ({page}) => {
        const problems = await startGame(page);
        const weighted = '0.75*agent.skills.disguise + 0.25*agent.skills.stealth - difficulty';
        
        // 0.75*200 + 0.25*100 = 175, so the roll needed is 325.
        expect((await evaluateCheck(page, weighted, {roll:325, skills:{disguise:200, stealth:100}})).success).toBe(true);
        expect((await evaluateCheck(page, weighted, {roll:324, skills:{disguise:200, stealth:100}})).success).toBe(false);
        
        // The event and the full agent model are there too.
        const usesEvent = '(event.id === "collision" && agent.id === "VQ" && agent.paradox.value >= 0) ? 0 : -1000';
        expect((await evaluateCheck(page, usesEvent, {roll:0})).success).toBe(true);
        expect((await evaluateCheck(page, usesEvent, {roll:999, eventId:'roster_reshuffle'})).success).toBe(false);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('expressions are compiled once and shared', async ({page}) => {
        await startGame(page);
        expect(await page.evaluate(expr => tc.checks.compile(expr) === tc.checks.compile(expr), DECEPTION)).toBe(true);
        expect(await page.evaluate(() => tc.checks.compile('difficulty - 1') === tc.checks.compile('difficulty - 2'))).toBe(false);
    });
    
    test('a broken expression fails the check with a warning, even on the best roll', async ({page}) => {
        const problems = await startGame(page);
        
        // Doesn't compile.
        expect(await page.evaluate(() => tc.checks.getCompileError('difficulty +'))).not.toBeNull();
        expect((await evaluateCheck(page, 'difficulty +', {roll:999})).success).toBe(false);
        
        // Throws while running.
        expect((await evaluateCheck(page, 'agent.nothing.here - difficulty', {roll:999})).success).toBe(false);
        
        // Isn't a number, e.g. a leftover boolean success expression.
        expect((await evaluateCheck(page, 'true', {roll:999})).success).toBe(false);
        
        // Is NaN, e.g. a misspelled property.
        expect((await evaluateCheck(page, 'agent.skils - difficulty', {roll:999})).success).toBe(false);
        
        expect(problems.warnings).toHaveLength(3);
        expect(problems.warnings[0]).toContain('does not compile');
        expect(problems.warnings[1]).toContain('threw');
        expect(problems.warnings[2]).toContain('is not a number');
    });
    
    test('valid expressions have no compile error', async ({page}) => {
        await startGame(page);
        expect(await page.evaluate(expr => tc.checks.getCompileError(expr), DECEPTION)).toBeNull();
        expect(await page.evaluate(() => tc.checks.getCompileError(''))).not.toBeNull();
    });
});

test.describe('dice in check expressions', () => {
    // A cfg wide enough that dice aren't clamped away.
    const WIDE = {minEase:-1000, maxEase:1000};
    
    test('d(sides) rolls a whole number from 1 to sides', async ({page}) => {
        const problems = await startGame(page),
            eases = await page.evaluate(cfg => Array.from({length:600}, () => tc.checks.evaluate('d(6)', cfg).ease), WIDE);
        expect(new Set(eases)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
        expect(problems.warnings).toEqual([]);
    });
    
    test('dice roll before the check, and a queued die roll is its value minus 1', async ({page}) => {
        const problems = await startGame(page),
            result = await page.evaluate(cfg => {
                tc.rng.queueRolls(11, 0, 500); // d(12) of 12, d(4) of 1, then the check's roll.
                return tc.checks.evaluate('agent.skills.str + d(12) + d(4) - difficulty', {
                    ...cfg, agent:tc.model.getAgentModel('VQ'), difficulty:100
                });
            }, WIDE),
            str = readJson('data/agents.json').agents.VQ.skills.str;
        expect(result).toMatchObject({ease:str + 12 + 1 - 100, roll:500, result:500 + str + 13 - 100});
        expect(problems.warnings).toEqual([]);
    });
    
    test('the ease without rolling uses the die\'s average and rolls nothing', async ({page}) => {
        const problems = await startGame(page),
            out = await page.evaluate(cfg => {
                tc.rng.queueRolls(0);
                const ease = tc.checks.getEase('d(12) - 20', cfg),
                    // d(100) averages 50.5, so with 350 difficulty the ease is -299.5: fair.
                    phrase = tc.checks.getEasePhrase('d(100)', {difficulty:350}),
                    queued = tc.rng.getQueuedRollCount();
                tc.rng.clearQueuedRolls();
                return {ease, phrase, queued};
            }, WIDE);
        expect(out).toEqual({ease:6.5 - 20, phrase:'fair', queued:1});
        expect(problems.warnings).toEqual([]);
    });
    
    test('a no-roll check rolls no dice', async ({page}) => {
        await startGame(page);
        const out = await page.evaluate(() => {
            tc.rng.queueRolls(2);
            const result = tc.checks.evaluate('d(6) - difficulty', {difficulty:tc.toDifficulty('no-roll')}),
                queued = tc.rng.getQueuedRollCount();
            tc.rng.clearQueuedRolls();
            return {success:result.success, queued};
        });
        // The queued roll is still there: neither the die nor the check used it.
        expect(out).toEqual({success:true, queued:1});
    });
    
    test('a die without a whole number of sides, 1 or more, fails the check with a warning', async ({page}) => {
        const problems = await startGame(page);
        for (const sides of ['0', '-3', '2.5', '"six"', '']) {
            expect((await evaluateCheck(page, 'd(' + sides + ') + 1000', {roll:999})).success, sides).toBe(false);
        }
        expect(problems.warnings).toHaveLength(5);
        for (const warning of problems.warnings) expect(warning).toContain('whole number of sides');
    });
});

test.describe('skill checks', () => {
    // Calls an AgentModel check method on VQ with the given skills and forced roll.
    const callOnAgent = (page, method, args, {roll, skills={}}) => page.evaluate(
        ([method, args, roll, skills]) => {
            const agent = tc.model.getAgentModel('VQ'),
                original = agent.getSkills();
            agent.setSkills(skills);
            try {
                if (roll != null) tc.rng.queueRolls(roll);
                return agent[method](...args);
            } finally {
                agent.setSkills(original);
            }
        },
        [method, args, roll, skills]
    ),
        checkSkill = async (page, method, arg, difficulty, opts) => (await callOnAgent(page, method, [arg, difficulty], opts)).success;
    
    test('checkSkill passes on random + skill - difficulty >= 0', async ({page}) => {
        const problems = await startGame(page);
        
        // Skill 100 at difficulty 500 needs a roll of 400 or more.
        expect(await checkSkill(page, 'checkSkill', 'stealth', 500, {roll:400, skills:{stealth:100}})).toBe(true);
        expect(await checkSkill(page, 'checkSkill', 'stealth', 500, {roll:399, skills:{stealth:100}})).toBe(false);
        
        // A skill the agent lacks counts as 0.
        expect(await checkSkill(page, 'checkSkill', 'disguise', 500, {roll:499})).toBe(false);
        expect(await checkSkill(page, 'checkSkill', 'disguise', 500, {roll:500})).toBe(true);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('checkSkillExpression combines skills', async ({page}) => {
        const problems = await startGame(page);
        const best = 'Math.max(agent.skills.deception, agent.skills.disguise)';
        
        expect(await checkSkill(page, 'checkSkillExpression', best, 500, {roll:300, skills:{disguise:200}})).toBe(true);
        expect(await checkSkill(page, 'checkSkillExpression', best, 500, {roll:299, skills:{disguise:200}})).toBe(false);
        
        // The skill expression is taken as a whole. Unparenthesized, || would make it
        // "agent.skills.stealth || (200 - difficulty)", an ease of 100 instead of -400.
        const either = 'agent.skills.stealth || 200';
        expect(await checkSkill(page, 'checkSkillExpression', either, 500, {roll:399, skills:{stealth:100}})).toBe(false);
        expect(await checkSkill(page, 'checkSkillExpression', either, 500, {roll:400, skills:{stealth:100}})).toBe(true);
        expect(await checkSkill(page, 'checkSkillExpression', either, 500, {roll:299})).toBe(false);
        expect(await checkSkill(page, 'checkSkillExpression', either, 500, {roll:300})).toBe(true);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('a skill check always has at least a 0.1% chance either way', async ({page}) => {
        const problems = await startGame(page);
        
        // Far more skill than difficulty still fails on a roll of 0.
        expect(await callOnAgent(page, 'checkSkill', ['stealth', 0], {roll:0, skills:{stealth:5000}})).toMatchObject({success:false, ease:-1});
        expect(await checkSkill(page, 'checkSkill', 'stealth', 0, {roll:1, skills:{stealth:5000}})).toBe(true);
        
        // Far more difficulty than skill still succeeds on a roll of 999.
        expect(await callOnAgent(page, 'checkSkill', ['stealth', 5000], {roll:999})).toMatchObject({success:true, ease:-999});
        expect(await checkSkill(page, 'checkSkill', 'stealth', 5000, {roll:998})).toBe(false);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('the ease and its phrase come without rolling', async ({page}) => {
        const problems = await startGame(page);
        const phrase = (skill, difficulty) => callOnAgent(page, 'getSkillEasePhrase', ['agent.skills.stealth', difficulty], {skills:{stealth:skill}});
        
        // Each phrase starts at its ease, so one point less is the next phrase down.
        expect(await phrase(5000, 0)).toBe('ensured');
        expect(await phrase(0, 1)).toBe('ensured');
        expect(await phrase(0, 2)).toBe('trivial');
        expect(await phrase(0, 99)).toBe('trivial');
        expect(await phrase(0, 100)).toBe('very easy');
        expect(await phrase(250, 500)).toBe('easy');
        expect(await phrase(0, 499)).toBe('even');
        expect(await phrase(0, 500)).toBe('tough');
        expect(await phrase(0, 899)).toBe('brutal');
        expect(await phrase(0, 900)).toBe('hopeless');
        expect(await phrase(0, 5000)).toBe('hopeless');
        
        // Without the skill check's clamp an ease can reach 'certain' and 'impossible'.
        expect(await page.evaluate(() => [0, -1000, NaN].map(tc.checks.toEasePhrase))).toEqual(['certain', 'impossible', 'impossible']);
        
        // A queued roll is still there afterwards, so showing a phrase can't use up a roll.
        expect(await page.evaluate(() => {
            tc.rng.queueRolls(123);
            tc.model.getAgentModel('VQ').getSkillEasePhrase('agent.skills.stealth', 500);
            tc.model.getAgentModel('VQ').getSkillExpressionEase('agent.skills.stealth', 500);
            return tc.rng.roll();
        })).toBe(123);
        
        expect(problems.warnings).toEqual([]);
    });
});

test('every skill named in the data is a known skill', async ({page}) => {
    await startGame(page);
    const knownIds = await page.evaluate(() => tc.getSkillIds()),
        unknown = new Set();
    
    // Skills the code names, e.g. tc.SKILL_ID_INVESTIGATION for the default investigate check.
    for (const [key, skillId] of await page.evaluate(() => Object.entries(tc).filter(([key]) => key.startsWith('SKILL_ID_')))) {
        if (!knownIds.includes(skillId)) unknown.add('tc.' + key + ': ' + skillId);
    }
    
    // Skills given to agents.
    for (const [agentId, agent] of Object.entries(readJson('data/agents.json').agents)) {
        for (const skillId of Object.keys(agent.skills ?? {})) {
            if (!knownIds.includes(skillId)) unknown.add(agentId + ': ' + skillId);
        }
    }
    
    // Skills used in expressions, e.g. agent.skills.stealth in an investigate config. A typo
    // would otherwise quietly count as 0.
    for (const file of [...SCENARIO_FILES, 'data/operations.json', 'data/agents.json']) {
        for (const [, skillId] of JSON.stringify(readJson(file)).matchAll(/\bskills\.(\w+)/g)) {
            if (!knownIds.includes(skillId)) unknown.add(file + ': ' + skillId);
        }
    }
    
    expect([...unknown]).toEqual([]);
});
