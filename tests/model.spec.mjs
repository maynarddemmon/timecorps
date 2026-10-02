// Regression tests for the constraint scopes, Describable and the causal links.
import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

test('agent, agents and operations scopes bind and update', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(async () => {
        const wait = ms => new Promise(res => setTimeout(res, ms)),
            model = tc.model,
            vq = model.getAgentModel('VQ'),
            go = model.getAgentModel('GO'),
            events = model.getEventModels(),
            out = {};
        
        // agent: the Agent's own scope.
        vq.setHidden('agent.paradox.value >= 1');
        out.agentBefore = vq.isHidden();
        vq.paradox.setValue(1);
        out.agentAfter = vq.isHidden();
        vq.paradox.setValue(0);
        vq.setHidden(false);
        
        // agents: another Agent by ID.
        go.setHidden('agents.VQ.paradox.value === 0');
        out.agentsBefore = go.isHidden();
        vq.paradox.setValue(2);
        out.agentsAfter = go.isHidden();
        vq.paradox.setValue(0);
        
        // operations: an Operation's objective, from an Event part.
        const struck = events.collision.getValueModels().struck;
        struck.setHidden('operations.titanic_noCollision.objectives.avoid.success');
        out.operationsBefore = struck.isHidden();
        events.roster_reshuffle.getValueModels().preventReshuffle.setValue(true, true);
        events.engine_order.getValueModels().countermandAstern.setValue(true, true);
        await wait(50);
        out.operationsAfter = struck.isHidden();
        
        return out;
    });
    expect(result).toEqual({
        agentBefore:false, agentAfter:true,
        agentsBefore:true, agentsAfter:false,
        operationsBefore:false, operationsAfter:true
    });
    expect(problems.warnings).toEqual([]);
});

test('a self scope that does not match the model warns', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => tc.model.getAgentModel('GO').setHidden('event.attestation.value > 0'));
    expect(problems.warnings.some(w => w.includes('Scope "event" is not available here'))).toBe(true);
});

test('agent field notes follow the agent\'s paradox', async ({page}) => {
    await startGame(page);
    const notes = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            out = [];
        for (const paradox of [0, 1, 2, 3]) {
            vq.paradox.setValue(paradox);
            out.push(vq.getDescription());
        }
        vq.doDevouredByChronovores();
        out.push(vq.getDescription());
        return out;
    });
    expect(notes[0]).toContain('Clean record');
    expect(notes[1]).toContain('Crossed their own timeline once');
    expect(notes[2]).toContain('Several self-encounters');
    expect(notes[3]).toContain('Paradox saturated');
    expect(notes[4]).toContain('Lost to the Chronovores');
    expect(notes[4]).not.toContain('Paradox saturated');
});

test('causator links together match each event\'s precursors and descendants', async ({page}) => {
    await startGame(page);
    const mismatches = await page.evaluate(() => {
        const ids = set => [...set].map(eventModel => eventModel.id).sort(),
            out = [];
        for (const eventModel of Object.values(tc.model.getEventModels())) {
            const precursors = new Set(),
                descendants = new Set();
            for (const valueModel of Object.values(eventModel.getValueModels())) {
                for (const e of valueModel.getPrecursors()) precursors.add(e);
                for (const e of valueModel.getDescendants()) descendants.add(e);
            }
            const expectedP = ids(eventModel.getPrecursors()), actualP = ids(precursors),
                expectedD = ids(eventModel.getDescendants()), actualD = ids(descendants);
            if (expectedP.join() !== actualP.join()) out.push(eventModel.id + ' precursors: ' + actualP + ' vs ' + expectedP);
            if (expectedD.join() !== actualD.join()) out.push(eventModel.id + ' descendants: ' + actualD + ' vs ' + expectedD);
        }
        return out;
    });
    expect(mismatches).toEqual([]);
});

test('an event\'s investigate config is optional, validated and has defaults', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const eventModel = tc.model.getEventModel('collision'),
            read = () => [eventModel.getInvestigateDifficulty(), eventModel.getInvestigateSkillExpr()],
            out = {};
        
        out.none = read();
        
        eventModel.setInvestigate({difficulty:500, skill:'Math.max(agent.skills.deception, agent.skills.disguise)'});
        out.both = read();
        
        // Either part can be left out.
        eventModel.setInvestigate({difficulty:700});
        out.difficultyOnly = read();
        
        // Bad parts are dropped, good ones kept.
        eventModel.setInvestigate({difficulty:'500', skill:'agent.skills.stealth'});
        out.badDifficulty = read();
        eventModel.setInvestigate({difficulty:250.5, skill:'  '});
        out.badBoth = read();
        eventModel.setInvestigate(['agent.skills.stealth']);
        out.notObject = read();
        
        eventModel.setInvestigate(null);
        out.cleared = read();
        return out;
    });
    const DEFAULTS = [250, 'agent.skills.investigation'];
    expect(result).toEqual({
        none:DEFAULTS,
        both:[500, 'Math.max(agent.skills.deception, agent.skills.disguise)'],
        difficultyOnly:[700, DEFAULTS[1]],
        badDifficulty:[DEFAULTS[0], 'agent.skills.stealth'],
        badBoth:DEFAULTS,
        notObject:DEFAULTS,
        cleared:DEFAULTS
    });
    
    // One warning per bad part, naming the event.
    const investigateWarnings = problems.warnings.filter(w => w.includes('investigate'));
    expect(investigateWarnings.length).toBe(4);
    expect(investigateWarnings.every(w => w.startsWith('Event collision investigate'))).toBe(true);
});

test('investigate config in the event JSON reaches the model', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const build = investigate => {
            // The id comes last, as when Events are loaded, so a warning can only name the
            // Event if the config is applied after the other attrs.
            const eventModel = new tc.EventModel({investigate, id:'investigate_test'});
            try {
                return [eventModel.getInvestigateDifficulty(), eventModel.getInvestigateSkillExpr()];
            } finally {
                eventModel.destroy();
            }
        };
        return [build({difficulty:300, skill:'agent.skills.stealth'}), build({difficulty:3.5})];
    });
    expect(result).toEqual([[300, 'agent.skills.stealth'], [250, 'agent.skills.investigation']]);
    expect(problems.warnings.filter(w => w.includes('investigate'))).toEqual([
        'Event investigate_test investigate difficulty must be an integer: {difficulty: 3.5}'
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('investigating succeeds or fails on the check, and a failure still uses the action', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            investigate = roll => {
                const attestation = roster.attestation.value,
                    actionCount = vq.getActionExecCount();
                tc.rng.queueRolls(roll);
                vq.doInvestigate();
                const entry = vq.getLog().at(-1);
                return {
                    gained:roster.attestation.value - attestation,
                    actionsUsed:vq.getActionExecCount() - actionCount,
                    logged:{type:entry.type, success:entry.success, amount:entry.amount}
                };
            };
        vq.doDeployToEvent(roster);
        roster.setInvestigate({difficulty:500, skill:'agent.skills.stealth'});
        vq.setSkills({stealth:100});
        
        // An ease of -400: a roll of 399 fails and 400 succeeds.
        return {failure:investigate(399), success:investigate(400)};
    });
    expect(result.failure).toEqual({gained:0, actionsUsed:1, logged:{type:'investigate', success:false, amount:undefined}});
    expect(result.success.actionsUsed).toBe(1);
    expect(result.success.gained).toBeGreaterThan(0);
    expect(result.success.logged).toEqual({type:'investigate', success:true, amount:result.success.gained});
    expect(problems.warnings).toEqual([]);
});
