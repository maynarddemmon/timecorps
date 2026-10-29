// Checks data on disk. These tests don't need a browser.
import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import {readJson, fileExists, getScenarioFiles, TEST_DATA_DIR, ROOT} from './helpers.mjs';

/*  The keys of tc.cfg, which expressions read as "timeline.cfg.<KEY>", taken from the cfg 
    block in js/tc/tc.js. */
const CFG_KEYS = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'js/tc/tc.js'), 'utf8').replace(/\r/g, ''),
        start = src.indexOf('\n            cfg: {\n'),
        end = src.indexOf('\n            },\n', start);
    return new Set([...src.slice(start, end).matchAll(/^ {16}([A-Z][A-Z0-9_]*)\s*:/gm)].map(match => match[1]));
})();

/*  Checks the game's data, so problems in it show up without playing, and the test data that
    the other tests play with, so it stays valid too. */
for (const DATA_DIR of ['data', TEST_DATA_DIR]) test.describe(DATA_DIR, () => {
    const MEDIA_DIR = DATA_DIR === TEST_DATA_DIR ? TEST_DATA_DIR + '/img' : 'img',
        SCENARIO_FILES = getScenarioFiles(DATA_DIR);

    const scenarios = SCENARIO_FILES.map(readJson),
        agentsJson = readJson(DATA_DIR + '/agents.json5'),
        operationsJson = readJson(DATA_DIR + '/operations.json5'),
    
        locations = Object.assign({}, ...scenarios.map(s => s.locations ?? {})),
        events = Object.assign({}, ...scenarios.map(s => s.events ?? {})),
        defaultEventActions = Object.assign({}, ...scenarios.map(s => s.defaultEventActions ?? {})),
        agents = agentsJson.agents,
        // Operations, scratch entries and prompts can be in any data file, and so can the
        // initialOperation, of which the last one loaded counts.
        operations = Object.assign({}, ...[...scenarios, agentsJson, operationsJson].map(s => s.operations ?? {})),
        initialOperation = [...scenarios, agentsJson, operationsJson].map(s => s.initialOperation).filter(id => id !== undefined).at(-1),
        scratch = Object.assign({}, ...[...scenarios, agentsJson, operationsJson].map(s => s.scratch ?? {})),
        factions = Object.assign({}, ...scenarios.map(s => s.factions ?? {})),
        prompts = Object.assign({}, ...[...scenarios, agentsJson, operationsJson].map(s => s.prompts ?? {})),
    
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
            for (const [ref, factionId] of expr.matchAll(/\bfactions\.(\w+)/g)) {
                if (!factions[factionId]) bad.push(ref);
            }
            for (const [ref, name] of expr.matchAll(/(?<![\w.])scratch\.(\w+)/g)) {
                if (!Object.hasOwn(scratch, name)) bad.push(ref);
            }
            for (const [ref, key] of expr.matchAll(/(?<![\w.])timeline\.cfg\.(\w+)/g)) {
                if (!CFG_KEYS.has(key)) bad.push(ref);
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
        // The cfg keys were found, so a misspelled one is caught rather than all of them.
        expect(CFG_KEYS.has('AGE_MIN_EFFECTIVE')).toBe(true);
        const problems = [];
        for (const [eventId, event] of Object.entries(events)) {
            for (const str of collectStrings(event)) {
                for (const ref of findBadRefs(str, eventId)) problems.push('event ' + eventId + ': ' + ref);
            }
        }
        const others = {locations, agentDefaults:agentsJson.agentDefaults, agents, operations, prompts, defaultEventActions};
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
            // An Operation's ID, or a check expression whose results, the quoted strings it 
            // starts with or that follow a ? or :, must all be Operations.
            const next = operation.onSuccess?.nextOperation;
            if (next !== undefined && !operations[next]) {
                const error = getAmountCompileError(next),
                    quotedIds = [...String(next).matchAll(/(?:^|[?:])\s*'([^']*)'/g)].map(match => match[1]);
                if (error || quotedIds.length === 0) {
                    problems.push(operationId + ': nextOperation is neither an Operation ID nor an expression naming them: ' + next);
                } else {
                    for (const id of quotedIds) if (!operations[id]) problems.push(operationId + ': nextOperation names unknown Operation ' + id);
                }
            }
        
            const setup = operation.onSetup ?? {},
                onSuccess = operation.onSuccess ?? {};
            for (const agentId of [setup.awardAgents, setup.revealAgents, onSuccess.awardAgents, onSuccess.revealAgents].flat()) {
                if (agentId && !agents[agentId]) problems.push(operationId + ': unknown agent ' + agentId);
            }
            for (const [where, cfg] of [['onSetup', setup], ['onSuccess', onSuccess]]) {
                for (const oldKey of ['historicityAdjustments', 'awardScore', 'awardCredits', 'awardHQChronal']) {
                    if (oldKey in cfg) problems.push(operationId + ': ' + where + ' has ' + oldKey + ', which set and adj replaced');
                }
            }
        }
        if (!operations[initialOperation]) problems.push('unknown initialOperation');
        expect(problems).toEqual([]);
    });

    test('every prompt has a known type, a title, only the buttons its type has, and an input for a declared scratch entry if it takes text', () => {
        const problems = [],
            BUTTONS_BY_TYPE = {ack:['confirm'], confirm:['confirm', 'cancel'], text:['confirm']};
        for (const [promptId, prompt] of Object.entries(prompts)) {
            const where = 'prompt ' + promptId,
                {type='ack', title, description, hidden, buttons, input, ...unknown} = prompt;
            for (const key of Object.keys(unknown)) problems.push(where + ' has unknown key ' + key);
            if (!Object.hasOwn(BUTTONS_BY_TYPE, type)) problems.push(where + ' type is not "ack", "confirm" or "text"');
            if (type === 'text') {
                const {scratch:scratchName, maxLength, allowedChars, placeholder, ...rest} = input ?? {};
                if (!Object.hasOwn(scratch, scratchName ?? '')) problems.push(where + ' input scratch is not a declared scratch entry');
                if (typeof scratch[scratchName] !== 'string') problems.push(where + ' input scratch entry is not a string');
                for (const key of Object.keys(rest)) problems.push(where + ' input has unknown key ' + key);
                if (maxLength !== undefined && !(Number.isInteger(maxLength) && maxLength > 0)) problems.push(where + ' input maxLength is not a whole number above 0');
                if (allowedChars !== undefined && (typeof allowedChars !== 'string' || allowedChars === '')) problems.push(where + ' input allowedChars is not a string of characters');
                if (placeholder !== undefined && typeof placeholder !== 'string') problems.push(where + ' input placeholder is not a string');
            } else if (input !== undefined) {
                problems.push(where + ' has an input but isn\'t a "text" prompt');
            }
            if (typeof title !== 'string' || title.trim() === '') problems.push(where + ' has no title');
            if (description === undefined) problems.push(where + ' has no description');
            if (hidden !== undefined && typeof hidden !== 'string' && typeof hidden !== 'boolean') problems.push(where + ' hidden is not a string or a boolean');
            for (const [buttonId, button] of Object.entries(buttons ?? {})) {
                const at = where + ' button ' + buttonId;
                if (!BUTTONS_BY_TYPE[type]?.includes(buttonId)) problems.push(at + ' is not a button of its type');
                if (button === null || typeof button !== 'object' || Array.isArray(button)) {
                    problems.push(at + ' is not an object');
                    continue;
                }
                const {label, onClick, ...rest} = button;
                for (const key of Object.keys(rest)) problems.push(at + ' has unknown key ' + key);
                if (label !== undefined && typeof label !== 'string') problems.push(at + ' label is not a string');
                if (onClick !== undefined) {
                    if (onClick === null || typeof onClick !== 'object' || Array.isArray(onClick)) {
                        problems.push(at + ' onClick is not an object');
                    } else {
                        for (const key of Object.keys(onClick)) if (key !== 'set' && key !== 'adj') problems.push(at + ' onClick has unknown key ' + key);
                    }
                }
            }
        }
        expect(problems).toEqual([]);
    });
    
    test('every prompt an action, exit or operation opens exists', () => {
        const problems = [],
            check = (where, promptId) => {
                if (promptId !== undefined && !Object.hasOwn(prompts, promptId)) problems.push(where + ' opens unknown prompt ' + promptId);
            };
        for (const [eventId, event] of [...Object.entries(events), ['defaultEventActions', {actions:defaultEventActions}]]) {
            for (const [actionId, action] of Object.entries(event.actions ?? {})) check(eventId + '.' + actionId, action?.prompt);
            for (const exit of event.exits ?? []) check(eventId + ' exit to ' + exit.to, exit.prompt);
        }
        for (const [operationId, operation] of Object.entries(operations)) {
            for (const when of ['onSetup', 'onSuccess']) {
                check(operationId + ' ' + when, operation[when]?.prompt);
                check(operationId + ' ' + when + ' promptEarly', operation[when]?.promptEarly);
            }
        }
        expect(problems).toEqual([]);
    });
    
    test('every location has an image and an area brief', () => {
        const missing = [];
        for (const locationId of Object.keys(locations)) {
            if (locationId.startsWith('_')) continue; // The Nexus and Nowhere are never shown.
            // The .jpg is required even with a video since it's the fallback and the timeline header.
            const files = [MEDIA_DIR + '/location/' + locationId + '.jpg', DATA_DIR + '/location/' + locationId + '.txt'];
            if (locations[locationId].video) files.push(MEDIA_DIR + '/location/' + locationId + '.webm');
            for (const file of files) {
                if (!fileExists(file)) missing.push(file);
            }
        }
        expect(missing).toEqual([]);
    });

    test('there is an unaligned faction, every faction has a label and any hq is an Event, and every agent is in a known faction and starts somewhere', () => {
        const problems = [];
        if (!factions.unaligned) problems.push('no unaligned faction, which agents default to');
        for (const [factionId, faction] of Object.entries(factions)) {
            if (typeof faction.label !== 'string' || faction.label.trim() === '') problems.push('faction ' + factionId + ' has no label');
            if (faction.hq !== undefined && !events[faction.hq]) problems.push('faction ' + factionId + ' hq is not an Event: ' + faction.hq);
        }
        for (const [agentId, agent] of Object.entries(agents)) {
            if (agent.faction !== undefined && !factions[agent.faction]) problems.push('agent ' + agentId + ' is in unknown faction ' + agent.faction);
            if (agent.event === undefined && !factions[agent.faction]?.hq) problems.push('agent ' + agentId + ' has no event, and no faction HQ to start at');
        }
        expect(problems).toEqual([]);
    });

    test('every agent has a portrait and a dossier', () => {
        const missing = [];
        for (const [agentId, agent] of Object.entries(agents)) {
            // The .jpg is required even with a video portrait since it's the fallback.
            const files = [MEDIA_DIR + '/agent/' + agentId + '.jpg', DATA_DIR + '/dossiers/' + agentId + '.txt'];
            if (agent.video) files.push(MEDIA_DIR + '/agent/' + agentId + '.webm');
            for (const file of files) {
                if (!fileExists(file)) missing.push(file);
            }
        }
        expect(missing).toEqual([]);
    });

    test('every agent has a birth date, before HQ\'s present, and any age and effective age are numbers', () => {
        const problems = [],
            hq = events.time_corps_hq;
        for (const [agentId, agent] of Object.entries(agents)) {
            // An agent who starts before they were born is reckoned from HQ, the present.
            const born = Date.parse(agent.born),
                start = Date.parse(hq.start + 'Z');
            if (typeof agent.born !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(agent.born) || isNaN(born)) {
                problems.push(agentId + ' has no birth date as "born", e.g. "2140-06-12"');
            } else if (!(born < start)) {
                problems.push(agentId + ' is born after HQ\'s present');
            }
            for (const key of ['age', 'effectiveAge']) {
                if (agent[key] !== undefined && !Number.isFinite(agent[key])) problems.push(agentId + ' ' + key + ' is not a number');
            }
        }
        expect(problems).toEqual([]);
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
                new Function('agent', 'event', 'timeline', 'difficulty', 'd', 'margin', '"use strict";return (' + amount + ');');
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

    /*  Merges a config over a base as the game does for an Event's actions over the defaults: 
        objects key by key, and anything else replaces. */
    const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value),
        mergeCfg = (base, cfg) => {
            if (cfg === undefined) return base;
            if (!isPlainObject(base) || !isPlainObject(cfg)) return cfg;
            for (const key in cfg) base[key] = mergeCfg(base[key], cfg[key]);
            return base;
        },
    
        // An Event's actions with the defaults first, merged with any of the same ID, and null 
        // leaving a default out.
        withDefaultActions = actions => {
            const retval = {};
            for (const id in defaultEventActions) {
                if (actions?.[id] !== null) retval[id] = mergeCfg(structuredClone(defaultEventActions[id]), actions?.[id]);
            }
            for (const id in actions) {
                if (!Object.hasOwn(defaultEventActions, id) && actions[id] !== null) retval[id] = actions[id];
            }
            return retval;
        };

    /*  The stats set and adj can change, by scope. Mirrors tc.ADJUSTMENT_STAT_IDS. */
    const ADJUSTMENT_STAT_IDS = {
        agent:['health', 'chronal', 'paradox', 'effectiveAge'],
        agents:['health', 'chronal', 'paradox', 'effectiveAge'],
        event:['paradox', 'historicity', 'attestation'],
        events:['paradox', 'historicity', 'attestation'],
        timeline:['paradox', 'chronal', 'score', 'credits']
    };

    /*  What an action can cost. Mirrors tc.COSTS. */
    const COST_KEYS = [
        'agent.action', 'agent.health', 'agent.chronal', 'agent.paradox',
        'event.attestation', 'event.historicity', 'event.paradox',
        'timeline.chronal', 'timeline.paradox', 'timeline.score', 'timeline.credits'
    ];

    test('every investigate, action skill check, action cost, action scratch set and action and exit adjustment is valid, including the default event actions', () => {
        const problems = [],
            counts = {actionAdjustments:0, exitAdjustments:0, costs:0, scratchSets:0, perResultSets:0, successChanges:0},
            
            // Returns the problems with an action's costs. null leaves them all out.
            checkCosts = (where, costs) => {
                if (costs === null) return [];
                if (typeof costs !== 'object' || Array.isArray(costs)) return [where + ' costs is not an object'];
                const costProblems = [];
                for (const [key, amount] of Object.entries(costs)) {
                    // Null leaves out a cost, including the default action.
                    if (amount === null) continue;
                    const at = where + ' cost ' + key;
                    if (!COST_KEYS.includes(key)) costProblems.push(at + ' is not one of ' + COST_KEYS.join(', '));
                    const error = getAmountCompileError(amount);
                    if (error) costProblems.push(at + ' ' + error);
                    counts.costs++;
                }
                return costProblems;
            },
        
            // Returns why a set or adj key names nothing, or null: a stat or skill of the agent, a
            // stat of the event or timeline, a Value of the event, or a declared scratch entry.
            // The problem with a set or adj key, or null. event is the action's or exit's own 
            // Event, or null for an Operation, which has no agent or Event of its own.
            checkChangeKey = (key, event, isSet=false) => {
                const [scope, statId, ...rest] = key.split('.');
                if (event === null && (statId === undefined || scope === 'agent' || scope === 'event')) return 'names the agent or the Event, and an Operation or prompt has neither';
                if ((scope === 'agent' && statId === 'event' && rest.length === 0) || (scope === 'agents' && rest.length === 1 && rest[0] === 'event')) {
                    if (!isSet) return 'is where an agent is, which can only be set';
                    return scope === 'agents' && !agents[statId] ? 'names no agent' : null;
                }
                if ((scope === 'agent' && statId === 'faction' && rest.length === 0) || (scope === 'agents' && rest.length === 1 && rest[0] === 'faction')) {
                    if (!isSet) return 'is the Faction an agent is in, which can only be set';
                    return scope === 'agents' && !agents[statId] ? 'names no agent' : null;
                }
                if (statId === undefined) return event.values?.[key] ? null : 'is not a Value of the Event';
                if (scope === 'agents') {
                    if (!agents[statId]) return 'names no agent';
                    if (rest.length === 1 && ADJUSTMENT_STAT_IDS.agents.includes(rest[0])) return null;
                    if (rest.length === 2 && rest[0] === 'skills') return Object.hasOwn(skillCfgs, rest[1]) ? null : 'is not a skill';
                    // Any other attribute can be set. The game warns at load if it has no setter.
                    if (rest.length === 1 && isSet) return null;
                    return 'is not a stat or skill of that agent';
                }
                if (scope === 'events') {
                    if (!events[statId]) return 'names no Event';
                    if (rest.length === 1 && ADJUSTMENT_STAT_IDS.events.includes(rest[0])) return null;
                    if (rest.length === 2 && rest[0] === 'values') return events[statId].values?.[rest[1]] ? null : 'is not a Value of that Event';
                    if (rest.length === 1 && isSet) return null;
                    return 'is not a stat or Value of that Event';
                }
                if (scope === 'scratch' && rest.length === 0) return Object.hasOwn(scratch, statId) ? null : 'is not declared';
                if (scope === 'agent' && statId === 'skills' && rest.length === 1) return Object.hasOwn(skillCfgs, rest[0]) ? null : 'is not a skill';
                if (rest.length === 0 && Object.hasOwn(ADJUSTMENT_STAT_IDS, scope) && ADJUSTMENT_STAT_IDS[scope].includes(statId)) return null;
                if (rest.length === 0 && isSet && (scope === 'agent' || scope === 'event')) return null;
                return 'is not a stat, skill, Value or scratch entry';
            },
            
            // A set of where an agent is, or the Faction they're in, should give the ID as a 
            // quoted string, e.g. "'origin'" or "'timecorps'". Returns the problem, or null.
            checkEventDestination = (key, value) => {
                const match = typeof value === 'string' ? /^agents?\.(?:[^.]+\.)?(event|faction)$/.exec(key) : null;
                if (!match) return null;
                const [ids, what] = match[1] === 'event' ? [events, 'Event'] : [factions, 'Faction'],
                    quoted = /^'([^']*)'$/.exec(value.trim());
                if (quoted) return ids[quoted[1]] ? null : 'names no ' + what + ' ' + quoted[1];
                if (ids[value.trim()]) return 'needs the ' + what + ' ID in quotes, e.g. "\'' + value.trim() + '\'"';
                return null;
            },
            
            // Returns the problems with the onSuccess, onFailure and onBoth of a set or adj 
            // entry, and its other keys, which are the rest.
            checkResultExprs = (at, cfg) => {
                const problems = [],
                    {onSuccess, onFailure, onBoth, ...rest} = cfg;
                if (onSuccess === undefined && onFailure === undefined && onBoth === undefined) problems.push(at + ' has no onSuccess, onFailure or onBoth');
                if (onBoth !== undefined && (onSuccess !== undefined || onFailure !== undefined)) problems.push(at + ' has onBoth with onSuccess or onFailure');
                for (const [name, expr] of [['onSuccess', onSuccess], ['onFailure', onFailure], ['onBoth', onBoth]]) {
                    const error = expr === undefined ? null : getAmountCompileError(expr);
                    if (error) problems.push(at + ' ' + name + ' ' + error);
                }
                return {problems, rest};
            },
            
            // Returns the problems with an action's or exit's adjustments.
            checkAdjustments = (where, adjustments, isAction, event) => {
                if (adjustments === null || typeof adjustments !== 'object' || Array.isArray(adjustments)) return [where + ' adj is not an object'];
                const adjustmentProblems = [];
                for (let [key, cfg] of Object.entries(adjustments)) {
                    // Null leaves out an adjustment of a default action.
                    if (cfg === null) continue;
                    const at = where + ' adj ' + key,
                        keyProblem = checkChangeKey(key, event);
                    if (keyProblem) adjustmentProblems.push(at + ' ' + keyProblem);
                    if (typeof cfg === 'string') cfg = {onSuccess:cfg}; // Applies on success.
                    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
                        adjustmentProblems.push(at + ' is not a string or an object');
                        continue;
                    }
                    const {problems:exprProblems, rest:{enabledForActionSkillCheck, ...checkCfg}} = checkResultExprs(at, cfg);
                    adjustmentProblems.push(...exprProblems);
                    if (enabledForActionSkillCheck !== undefined) {
                        if (!isAction) {
                            adjustmentProblems.push(at + ' has enabledForActionSkillCheck, which only applies to actions');
                        } else if (!['success', 'failure', 'both'].includes(enabledForActionSkillCheck)) {
                            adjustmentProblems.push(at + ' enabledForActionSkillCheck is not "success", "failure" or "both"');
                        }
                    }
                    // Anything else is the adjustment's own skill check.
                    if (Object.keys(checkCfg).length > 0) adjustmentProblems.push(...checkSkillCheckCfg(at, checkCfg));
                    counts[isAction ? 'actionAdjustments' : 'exitAdjustments']++;
                }
                return adjustmentProblems;
            };
    
        // Checks an action's or exit's set.
        const checkSets = (where, set, event) => {
            for (const [key, value] of Object.entries(set ?? {})) {
                const isScratch = key.startsWith('scratch.'),
                    keyProblem = checkChangeKey(key, event, true) ?? checkEventDestination(key, value);
                if (keyProblem) problems.push(where + ' sets ' + key + ', which ' + keyProblem);
                if (isScratch) counts.scratchSets++;
                if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                    // Per result, worked out once with the same parameters as an amount.
                    const at = where + ' set ' + key,
                        {problems:exprProblems, rest} = checkResultExprs(at, value);
                    problems.push(...exprProblems);
                    if (Object.keys(rest).length > 0) problems.push(at + ' has keys other than onSuccess, onFailure and onBoth');
                    counts.perResultSets++;
                } else if (typeof value !== 'string') {
                    problems.push(where + ' set ' + key + ' is not a string or an object');
                } else if (key.includes('.')) {
                    // Scratch, stats and skills are worked out once, as check expressions.
                    const error = getAmountCompileError(value);
                    if (error) problems.push(where + ' set ' + key + ' ' + error);
                }
            }
        };
        
        // The default actions every Event gets are checked as if on an Event of their own, and 
        // each Event's actions as the game sees them: merged over the defaults.
        for (const [eventId, event] of [...Object.entries(events), ['defaultEventActions', {actions:defaultEventActions}]]) {
            if ('investigate' in event) problems.push(eventId + ' has investigate, which the _investigate action replaced');
            for (const [actionId, action] of Object.entries(event.actions ?? {})) {
                if (action === null && !Object.hasOwn(defaultEventActions, actionId)) problems.push(eventId + '.' + actionId + ' is null, which only leaves out a default action');
            }
            for (const [actionId, action] of Object.entries(withDefaultActions(event.actions))) {
                const where = eventId + '.' + actionId;
                if (action === null || typeof action !== 'object' || Array.isArray(action)) {
                    problems.push(where + ' is not an object');
                    continue;
                }
                if (action.skillCheck !== undefined) problems.push(...checkSkillCheckCfg(where + ' skillCheck', action.skillCheck));
                // A condition with the same parameters as an amount. null leaves out a default's.
                if (action.available != null) {
                    const error = getAmountCompileError(action.available);
                    if (error) problems.push(where + ' available ' + error);
                }
                if (action.adj !== undefined) problems.push(...checkAdjustments(where, action.adj, true, event));
                if ('effects' in action) problems.push(where + ' has effects, which is renamed adj');
                if (action.costs !== undefined) problems.push(...checkCosts(where, action.costs));
                checkSets(where, action.set, event);
                if ('injurySkillCheck' in action) problems.push(where + ' has an injurySkillCheck, which adj replaced');
            }
            for (const exit of event.exits ?? []) {
                const where = eventId + ' exit to ' + exit.to;
                if (exit.adj !== undefined) problems.push(...checkAdjustments(where, exit.adj, false, event));
                checkSets(where, exit.set, event);
                if (exit.toHidden !== undefined) {
                    if (typeof exit.toHidden !== 'boolean') problems.push(where + ' toHidden is not true or false');
                    // It leads to an Event that may be hidden, so something must be able to reveal it.
                    else if (exit.toHidden && events[exit.to]?.hidden === 'true') problems.push(where + ' is toHidden, but ' + exit.to + ' is always hidden');
                }
                if ('effects' in exit) problems.push(where + ' has effects, which is renamed adj');
                if (exit.costs !== undefined) problems.push(...checkCosts(where, exit.costs));
                if ('injurySkillCheck' in exit) problems.push(where + ' has an injurySkillCheck, which adj replaced');
            }
        }
        
        // The set and adj of something with no agent or Event, applied as a success: an 
        // Operation's onSetup and onSuccess, and a prompt button's onClick.
        const checkSuccessChanges = (where, cfg, owner) => {
            for (const block of ['set', 'adj']) {
                for (const [key, value] of Object.entries(cfg?.[block] ?? {})) {
                    const at = where + ' ' + block + ' ' + key,
                        keyProblem = checkChangeKey(key, null, block === 'set') ?? checkEventDestination(key, value);
                    if (keyProblem) problems.push(at + ' ' + keyProblem);
                    counts.successChanges++;
                    if (typeof value === 'string') {
                        // A Value is set to a constraint expression, which isn't checked here.
                        const error = /^events\.[^.]+\.values\./.test(key) ? null : getAmountCompileError(value);
                        if (error) problems.push(at + ' ' + error);
                    } else if (isPlainObject(value)) {
                        const {problems:exprProblems, rest} = checkResultExprs(at, value);
                        problems.push(...exprProblems);
                        if (Object.keys(rest).length > 0) problems.push(at + ' has keys other than onSuccess, onFailure and onBoth');
                        if (value.onFailure !== undefined) problems.push(at + ' has onFailure, which ' + owner + ' never uses');
                    } else {
                        problems.push(at + ' is not a string or an object');
                    }
                }
            }
        };
        for (const [operationId, operation] of Object.entries(operations)) {
            for (const when of ['onSetup', 'onSuccess']) checkSuccessChanges(operationId + ' ' + when, operation[when], 'an Operation');
        }
        for (const [promptId, prompt] of Object.entries(prompts)) {
            for (const [buttonId, button] of Object.entries(prompt?.buttons ?? {})) {
                if (isPlainObject(button?.onClick)) checkSuccessChanges('prompt ' + promptId + ' ' + buttonId + ' onClick', button.onClick, 'a prompt');
            }
        }
        expect(problems).toEqual([]);
    
        // The test data has adjustments on both, so the checks above aren't vacuous.
        if (DATA_DIR === TEST_DATA_DIR) {
            expect(counts.actionAdjustments).toBeGreaterThan(0);
            expect(counts.exitAdjustments).toBeGreaterThan(0);
            expect(counts.costs).toBeGreaterThan(0);
            expect(counts.scratchSets).toBeGreaterThan(0);
            expect(counts.successChanges).toBeGreaterThan(0);
        }
    });

    test('every scratch entry is named as an identifier and starts as a number, a boolean or a string', () => {
        const problems = [];
        const files = [
            ...SCENARIO_FILES.map((file, idx) => [file, scenarios[idx]]),
            [DATA_DIR + '/agents.json5', agentsJson], [DATA_DIR + '/operations.json5', operationsJson]
        ];
        for (const [file, json] of files) {
            const cfg = json.scratch;
            if (cfg === undefined) continue;
            if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
                problems.push(file + ' scratch is not an object');
                continue;
            }
            for (const [name, value] of Object.entries(cfg)) {
                if (!/^[A-Za-z_$][\w$]*$/.test(name)) problems.push(file + ' scratch entry ' + name + ' is not an identifier');
                if (!['boolean', 'string'].includes(typeof value) && !Number.isFinite(value)) problems.push(file + ' scratch entry ' + name + ' does not start as a number, a boolean or a string');
            }
        }
        expect(problems).toEqual([]);
    });

    test('every default skill check has a name and a skill expression that compiles', () => {
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
            const files = [DATA_DIR + '/mission/' + operationId + '.txt'];
            if (operation.image) files.push(MEDIA_DIR + '/mission/' + operationId + '.jpg');
            if (operation.video) files.push(MEDIA_DIR + '/mission/' + operationId + '.webm');
            for (const file of files) {
                if (!fileExists(file)) missing.push(file);
            }
        }
        expect(missing).toEqual([]);
    });

    test('every start that\'s an offset names an event loaded before it, with an offset in duration units', () => {
        const problems = [],
            loaded = new Set();
        for (const scenario of scenarios) {
            for (const [eventId, event] of Object.entries(scenario.events ?? {})) {
                const start = event.start;
                if (start !== null && typeof start === 'object') {
                    const {startOf, endOf, ...offset} = start,
                        refId = startOf ?? endOf;
                    if ((startOf === undefined) === (endOf === undefined)) {
                        problems.push(eventId + ' start must have one of startOf or endOf');
                    } else if (!loaded.has(refId) || refId === eventId) {
                        problems.push(eventId + ' start names ' + refId + ', which isn\'t loaded before it');
                    }
                    for (const [key, value] of Object.entries(offset)) {
                        if (!['w', 'd', 'h', 'm', 's', 'ms'].includes(key) || !Number.isFinite(value)) problems.push(eventId + ' start offset ' + key + ' is not a duration unit with a number');
                    }
                }
                loaded.add(eventId);
            }
        }
        expect(problems).toEqual([]);
    });
    
    test('every event has the event brief image and report it says it has', () => {
        const missing = [];
        for (const [eventId, event] of Object.entries(events)) {
            const files = [];
            // An image can be a path from the event folder instead, e.g. "../location/x.jpg".
            if (event.image) files.push(path.posix.join(MEDIA_DIR, 'event', typeof event.image === 'string' ? event.image : eventId + '.jpg'));
            if (event.video) files.push(MEDIA_DIR + '/event/' + eventId + '.webm');
            if (event.brief) files.push(DATA_DIR + '/event/' + eventId + '.txt');
            for (const file of files) {
                if (!fileExists(file)) missing.push(file);
            }
        }
        expect(missing).toEqual([]);
    });

    test('the data files are JSON5, but plain JSON apart from comments and trailing commas', () => {
        // Every data file was moved to JSON5.
        expect(fs.readdirSync(path.join(ROOT, DATA_DIR)).filter(name => name.endsWith('.json'))).toEqual([]);
    
        // Drops comments and trailing commas, keeping strings intact so a "//" or "," inside one 
        // isn't touched.
        const COMMENT = String.raw`\/\/[^\n]*(?=\n|$)|\/\*(?:[^*]|\*(?!\/))*\*\/`,
            TOKENS = new RegExp(String.raw`"(?:[^"\\]|\\.)*"|` + COMMENT + String.raw`|,(?=(?:\s|` + COMMENT + String.raw`)*[}\]])`, 'g'),
            toPlainJson = text => text.replace(TOKENS, token => token[0] === '"' ? token : '');
    
        const problems = [];
        for (const file of [...SCENARIO_FILES, DATA_DIR + '/agents.json5', DATA_DIR + '/operations.json5']) {
            const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
            let plain;
            try {
                plain = JSON.parse(toPlainJson(text));
            } catch (err) {
                // e.g. an unquoted key, a single-quoted string or a hex number.
                problems.push(file + ' uses JSON5 beyond comments and trailing commas: ' + err.message);
                continue;
            }
            expect(plain, file).toEqual(JSON5.parse(text));
        }
        expect(problems).toEqual([]);
    
        // The stripping itself: comments and trailing commas go, strings stay as they are.
        expect(JSON.parse(toPlainJson('{\n// a\n"a":"x // y, z",/* b */"b":[1, 2, /* c */],\n}'))).toEqual({a:'x // y, z', b:[1, 2]});
        // A comment that has a } in it, between a comma and the next key.
        expect(JSON.parse(toPlainJson('{"a":1,\n// e.g. {"b":2}, or\n"c":3}'))).toEqual({a:1, c:3});
    });
});
