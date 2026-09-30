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
