import {test, expect} from '@playwright/test';
import {startGame, queueRolls} from './helpers.mjs';

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
    
    DECEPTION = 'difficulty - agent.skills.deception <= random';

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
    test('difficulty against the roll, at the boundary', async ({page}) => {
        const problems = await startGame(page);
        
        // Skill 0 at difficulty 500 succeeds on 500-999: exactly half the rolls.
        expect(await evaluateCheck(page, DECEPTION, {roll:499})).toEqual({success:false, roll:499, difficulty:500});
        expect(await evaluateCheck(page, DECEPTION, {roll:500})).toEqual({success:true, roll:500, difficulty:500});
        
        // Skill lowers the roll needed by one point per skill point.
        expect((await evaluateCheck(page, DECEPTION, {roll:400, skills:{deception:100}})).success).toBe(true);
        expect((await evaluateCheck(page, DECEPTION, {roll:399, skills:{deception:100}})).success).toBe(false);
        
        // Negative skill raises it.
        expect((await evaluateCheck(page, DECEPTION, {roll:599, skills:{deception:-100}})).success).toBe(false);
        expect((await evaluateCheck(page, DECEPTION, {roll:600, skills:{deception:-100}})).success).toBe(true);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('skills an agent lacks count as 0, including inside Math.max', async ({page}) => {
        const problems = await startGame(page);
        const bestOf = 'difficulty - Math.max(agent.skills.deception, agent.skills.disguise) <= random';
        
        // Neither skill: still a fair 50% check rather than NaN failing every time.
        expect((await evaluateCheck(page, bestOf, {roll:500})).success).toBe(true);
        
        // Only one skill: the other counts as 0, so the max is the one present.
        expect((await evaluateCheck(page, bestOf, {roll:300, skills:{disguise:200}})).success).toBe(true);
        expect((await evaluateCheck(page, bestOf, {roll:299, skills:{disguise:200}})).success).toBe(false);
        
        // The agent's own data is untouched by the defaulting.
        expect(await page.evaluate(() => 'deception' in tc.model.getAgentModel('VQ').getSkills())).toBe(false);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('weighted skills and the event are available', async ({page}) => {
        const problems = await startGame(page);
        const weighted = 'difficulty - (0.75*agent.skills.disguise + 0.25*agent.skills.stealth) <= random';
        
        // 0.75*200 + 0.25*100 = 175, so the roll needed is 325.
        expect((await evaluateCheck(page, weighted, {roll:325, skills:{disguise:200, stealth:100}})).success).toBe(true);
        expect((await evaluateCheck(page, weighted, {roll:324, skills:{disguise:200, stealth:100}})).success).toBe(false);
        
        // The event and the full agent model are there too.
        const usesEvent = 'event.id === "collision" && agent.id === "VQ" && agent.paradox.value >= 0';
        expect((await evaluateCheck(page, usesEvent, {roll:0})).success).toBe(true);
        
        expect(problems.warnings).toEqual([]);
    });
    
    test('expressions are compiled once and shared', async ({page}) => {
        await startGame(page);
        expect(await page.evaluate(expr => tc.checks.compile(expr) === tc.checks.compile(expr), DECEPTION)).toBe(true);
        expect(await page.evaluate(() => tc.checks.compile('random > 1') === tc.checks.compile('random > 2'))).toBe(false);
    });
    
    test('a broken expression fails the check with a warning', async ({page}) => {
        const problems = await startGame(page);
        
        // Doesn't compile.
        expect(await page.evaluate(() => tc.checks.getCompileError('difficulty <= random +'))).not.toBeNull();
        expect((await evaluateCheck(page, 'difficulty <= random +', {roll:999})).success).toBe(false);
        
        // Throws while running.
        expect((await evaluateCheck(page, 'agent.nothing.here > 0', {roll:999})).success).toBe(false);
        
        expect(problems.warnings).toHaveLength(2);
        expect(problems.warnings[0]).toContain('does not compile');
        expect(problems.warnings[1]).toContain('threw');
    });
    
    test('valid expressions have no compile error', async ({page}) => {
        await startGame(page);
        expect(await page.evaluate(expr => tc.checks.getCompileError(expr), DECEPTION)).toBeNull();
        expect(await page.evaluate(() => tc.checks.getCompileError(''))).not.toBeNull();
    });
});
