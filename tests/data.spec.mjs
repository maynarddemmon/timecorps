// Checks the game data on disk. These tests don't need a browser.
import {test, expect} from '@playwright/test';
import {readJson, fileExists} from './helpers.mjs';

const SCENARIO_FILES = ['data/init.json', 'data/titanic_scenario.json', 'data/lusitania_scenario.json'],
    scenarios = SCENARIO_FILES.map(readJson),
    agentsJson = readJson('data/agents.json'),
    operationsJson = readJson('data/operations.json'),
    
    locations = Object.assign({}, ...scenarios.map(s => s.locations ?? {})),
    events = Object.assign({}, ...scenarios.map(s => s.events ?? {})),
    agents = agentsJson.agents,
    operations = operationsJson.operations,
    
    // Every string anywhere inside a JSON value.
    collectStrings = (value, accum=[]) => {
        if (typeof value === 'string') {
            accum.push(value);
        } else if (value && typeof value === 'object') {
            for (const child of Object.values(value)) collectStrings(child, accum);
        }
        return accum;
    },
    
    // Returns a description of every reference in the expression that does not resolve.
    findBadRefs = (expr, ownEventId) => {
        const bad = [];
        for (const [ref, eventId, valueId] of expr.matchAll(/\bevents\.(\w+)(?:\.values\.(\w+))?/g)) {
            if (!events[eventId]) {
                bad.push(ref);
            } else if (valueId && !events[eventId].values?.[valueId]) {
                bad.push(ref);
            }
        }
        for (const [ref, valueId] of expr.matchAll(/(?<![\w.])event\.values\.(\w+)/g)) {
            if (!ownEventId || !events[ownEventId].values?.[valueId]) bad.push(ref);
        }
        for (const [ref, agentId] of expr.matchAll(/\bagents\.(\w+)/g)) {
            if (!agents[agentId]) bad.push(ref);
        }
        for (const [ref, operationId] of expr.matchAll(/\boperations\.(\w+)/g)) {
            if (!operations[operationId]) bad.push(ref);
        }
        return bad;
    };

test('every event, exit and hideAffectedBy points at something that exists', () => {
    const problems = [];
    for (const [eventId, event] of Object.entries(events)) {
        if (!locations[event.location]) problems.push(eventId + ': unknown location ' + event.location);
        for (const exit of event.exits ?? []) {
            if (!events[exit.to]) problems.push(eventId + ': exit to unknown event ' + exit.to);
        }
        for (const affectorId of Object.keys(event.hideAffectedBy ?? {})) {
            if (!events[affectorId]) problems.push(eventId + ': hideAffectedBy unknown event ' + affectorId);
        }
    }
    expect(problems).toEqual([]);
});

test('every constraint reference resolves', () => {
    const problems = [];
    for (const [eventId, event] of Object.entries(events)) {
        for (const str of collectStrings(event)) {
            for (const ref of findBadRefs(str, eventId)) problems.push('event ' + eventId + ': ' + ref);
        }
    }
    const others = {locations, agentDefaults:agentsJson.agentDefaults, agents, operations};
    for (const [label, data] of Object.entries(others)) {
        for (const str of collectStrings(data)) {
            for (const ref of findBadRefs(str, null)) problems.push(label + ': ' + ref);
        }
    }
    expect(problems).toEqual([]);
});

test('every operation link points at something that exists', () => {
    const problems = [];
    for (const [operationId, operation] of Object.entries(operations)) {
        const next = operation.onSuccess?.nextOperation;
        if (next && !operations[next]) problems.push(operationId + ': unknown nextOperation ' + next);
        
        const setup = operation.setup ?? {},
            onSuccess = operation.onSuccess ?? {};
        for (const agentId of [setup.awardAgents, setup.revealAgents, onSuccess.awardAgents, onSuccess.revealAgents].flat()) {
            if (agentId && !agents[agentId]) problems.push(operationId + ': unknown agent ' + agentId);
        }
        for (const eventId of Object.keys(setup.historicityAdjustments ?? {})) {
            if (!events[eventId]) problems.push(operationId + ': historicityAdjustments unknown event ' + eventId);
        }
    }
    if (!operations[operationsJson.initialOperation]) problems.push('unknown initialOperation');
    expect(problems).toEqual([]);
});

test('every location has an image and an area brief', () => {
    const missing = [];
    for (const locationId of Object.keys(locations)) {
        if (locationId.startsWith('_')) continue; // The Nexus and Nowhere are never shown.
        for (const file of ['img/location/' + locationId + '.jpg', 'data/location/' + locationId + '.txt']) {
            if (!fileExists(file)) missing.push(file);
        }
    }
    expect(missing).toEqual([]);
});

test('every agent has a portrait and a dossier', () => {
    const missing = [];
    for (const [agentId, agent] of Object.entries(agents)) {
        // The .jpg is required even with a video portrait since it's the fallback.
        const files = ['img/agent/' + agentId + '.jpg', 'data/dossiers/' + agentId + '.txt'];
        if (agent.video) files.push('img/agent/' + agentId + '.webm');
        for (const file of files) {
            if (!fileExists(file)) missing.push(file);
        }
    }
    expect(missing).toEqual([]);
});
