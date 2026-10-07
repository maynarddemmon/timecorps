// Checks the game data on disk. These tests don't need a browser.
import {test, expect} from '@playwright/test';
import {readJson, fileExists, SCENARIO_FILES} from './helpers.mjs';

const scenarios = SCENARIO_FILES.map(readJson),
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
        // The .jpg is required even with a video since it's the fallback and the timeline header.
        const files = ['img/location/' + locationId + '.jpg', 'data/location/' + locationId + '.txt'];
        if (locations[locationId].video) files.push('img/location/' + locationId + '.webm');
        for (const file of files) {
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

const skillChecks = Object.assign({}, ...scenarios.map(s => s.skillChecks ?? {})),
    
    // A difficulty is optional, and is an integer or "no-roll", which always succeeds.
    isValidDifficulty = difficulty => difficulty === undefined || Number.isInteger(difficulty) || difficulty === 'no-roll',
    skillCfgs = Object.assign({}, ...scenarios.map(s => s.skills ?? {})),
    
    // Returns why a skill expression doesn't compile, or null if it does. Compiled the same way 
    // as tc.checks.skill, with the same parameters.
    getSkillCompileError = skill => {
        if (typeof skill !== 'string' || skill.trim() === '') return 'is not a non-empty string';
        try {
            new Function('agent', 'event', 'timeline', 'difficulty', '"use strict";return ((' + skill + ')-difficulty);');
            return null;
        } catch (err) {
            return 'does not compile (' + err.message + ')';
        }
    },
    
    // Why an amount expression such as damage, e.g. "d(6)+4", doesn't compile, or null.
    getAmountCompileError = amount => {
        if (typeof amount !== 'string' || amount.trim() === '') return 'is not a non-empty string';
        try {
            new Function('agent', 'event', 'timeline', 'difficulty', 'd', '"use strict";return (' + amount + ');');
            return null;
        } catch (err) {
            return 'does not compile (' + err.message + ')';
        }
    },
    
    // Returns the problems with a skill check config from an investigate or an action.
    checkSkillCheckCfg = (where, cfg) => {
        if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return [where + ' is not an object'];
        const problems = [],
            {difficulty, check, actionType, ...unknown} = cfg;
        if (!isValidDifficulty(difficulty)) problems.push(where + ' difficulty is not an integer or "no-roll"');
        if (check !== undefined) {
            const error = getSkillCompileError(check);
            if (error) problems.push(where + ' check ' + error);
        }
        // An actionType is a default skill check, or a skill, which checks that skill alone.
        if (actionType !== undefined && !skillChecks[actionType] && !skillCfgs[actionType]) {
            problems.push(where + ' actionType ' + actionType + ' is neither a default skill check nor a skill');
        }
        for (const key of Object.keys(unknown)) problems.push(where + ' has unknown key ' + key);
        return problems;
    };

test('every investigate, action and exit injury skill check is valid', () => {
    const problems = [];
    for (const [eventId, event] of Object.entries(events)) {
        if (event.investigate !== undefined) problems.push(...checkSkillCheckCfg(eventId + ' investigate', event.investigate));
        for (const [actionId, action] of Object.entries(event.actions ?? {})) {
            if (action.skillCheck !== undefined) problems.push(...checkSkillCheckCfg(eventId + '.' + actionId + ' skillCheck', action.skillCheck));
        }
        for (const exit of event.exits ?? []) {
            if (exit.injurySkillCheck !== undefined) {
                const where = eventId + ' exit to ' + exit.to + ' injurySkillCheck',
                    {damage, ...checkCfg} = exit.injurySkillCheck ?? {};
                problems.push(...checkSkillCheckCfg(where, checkCfg));
                const error = getAmountCompileError(damage);
                if (error) problems.push(where + ' damage ' + error);
            }
        }
    }
    expect(problems).toEqual([]);
});

test('every default skill check has a name and a skill expression that compiles', () => {
    expect(Object.keys(skillChecks)).toContain('investigate');
    const problems = [];
    for (const [actionType, cfg] of Object.entries(skillChecks)) {
        const {name, check, difficulty, ...unknown} = cfg;
        if (typeof name !== 'string' || name.trim() === '') problems.push(actionType + ' has no name');
        const error = getSkillCompileError(check);
        if (error) problems.push(actionType + ' check ' + error);
        if (!isValidDifficulty(difficulty)) problems.push(actionType + ' difficulty is not an integer or "no-roll"');
        for (const key of Object.keys(unknown)) problems.push(actionType + ' has unknown key ' + key);
    }
    expect(problems).toEqual([]);
});

test('every skill config has a name and a description', () => {
    const problems = [];
    for (const file of SCENARIO_FILES) {
        for (const [skillId, cfg] of Object.entries(readJson(file).skills ?? {})) {
            for (const key of ['name', 'description']) {
                if (typeof cfg?.[key] !== 'string' || cfg[key].trim() === '') problems.push(file + ': ' + skillId + ' has no ' + key);
            }
        }
    }
    expect(problems).toEqual([]);
});

test('every operation has a mission briefing, and an image if it says it has one', () => {
    const missing = [];
    for (const [operationId, operation] of Object.entries(operations)) {
        const files = ['data/mission/' + operationId + '.txt'];
        if (operation.image) files.push('img/mission/' + operationId + '.jpg');
        if (operation.video) files.push('img/mission/' + operationId + '.webm');
        for (const file of files) {
            if (!fileExists(file)) missing.push(file);
        }
    }
    expect(missing).toEqual([]);
});
