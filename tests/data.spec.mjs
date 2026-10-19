// Checks data on disk. These tests don't need a browser.
import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import {readJson, fileExists, getScenarioFiles, TEST_DATA_DIR, ROOT} from './helpers.mjs';

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
        operations = operationsJson.operations,
        scratch = Object.assign({}, ...scenarios.map(s => s.scratch ?? {})),
        factions = Object.assign({}, ...scenarios.map(s => s.factions ?? {})),
    
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
            for (const [ref, name] of expr.matchAll(/(?<![\w.])scratch\.(\w+)/g)) {
                if (!Object.hasOwn(scratch, name)) bad.push(ref);
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
        if (!operations[operationsJson.initialOperation]) problems.push('unknown initialOperation');
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

    test('there is an unaligned faction, every faction has a label, and every agent is in a known faction', () => {
        const problems = [];
        if (!factions.unaligned) problems.push('no unaligned faction, which agents default to');
        for (const [factionId, faction] of Object.entries(factions)) {
            if (typeof faction.label !== 'string' || faction.label.trim() === '') problems.push('faction ' + factionId + ' has no label');
        }
        for (const [agentId, agent] of Object.entries(agents)) {
            if (agent.faction !== undefined && !factions[agent.faction]) problems.push('agent ' + agentId + ' is in unknown faction ' + agent.faction);
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
        agent:['health', 'chronal', 'paradox'],
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
            counts = {actionAdjustments:0, exitAdjustments:0, costs:0, scratchSets:0, perResultSets:0, operationChanges:0},
            
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
            checkChangeKey = (key, event) => {
                const [scope, statId, ...rest] = key.split('.');
                if (event === null && (statId === undefined || scope === 'agent' || scope === 'event')) return 'names the agent or the Event, and an Operation has neither';
                if (statId === undefined) return event.values?.[key] ? null : 'is not a Value of the Event';
                if (scope === 'events') {
                    if (!events[statId]) return 'names no Event';
                    if (rest.length === 1 && ADJUSTMENT_STAT_IDS.events.includes(rest[0])) return null;
                    if (rest.length === 2 && rest[0] === 'values') return events[statId].values?.[rest[1]] ? null : 'is not a Value of that Event';
                    return 'is not a stat or Value of that Event';
                }
                if (scope === 'scratch' && rest.length === 0) return Object.hasOwn(scratch, statId) ? null : 'is not declared';
                if (scope === 'agent' && statId === 'skills' && rest.length === 1) return Object.hasOwn(skillCfgs, rest[0]) ? null : 'is not a skill';
                if (rest.length === 0 && Object.hasOwn(ADJUSTMENT_STAT_IDS, scope) && ADJUSTMENT_STAT_IDS[scope].includes(statId)) return null;
                return 'is not a stat, skill, Value or scratch entry';
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
                for (const [key, value] of Object.entries(action.set ?? {})) {
                    const isScratch = key.startsWith('scratch.'),
                        keyProblem = checkChangeKey(key, event);
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
                if ('injurySkillCheck' in action) problems.push(where + ' has an injurySkillCheck, which adj replaced');
            }
            for (const exit of event.exits ?? []) {
                const where = eventId + ' exit to ' + exit.to;
                if (exit.adj !== undefined) problems.push(...checkAdjustments(where, exit.adj, false, event));
                if ('effects' in exit) problems.push(where + ' has effects, which is renamed adj');
                if (exit.costs !== undefined) problems.push(...checkCosts(where, exit.costs));
                if ('injurySkillCheck' in exit) problems.push(where + ' has an injurySkillCheck, which adj replaced');
            }
        }
        
        // Operations' set and adj, applied as a success.
        for (const [operationId, operation] of Object.entries(operations)) {
            for (const when of ['onSetup', 'onSuccess']) {
                for (const block of ['set', 'adj']) {
                    for (const [key, value] of Object.entries(operation[when]?.[block] ?? {})) {
                        const at = operationId + ' ' + when + ' ' + block + ' ' + key,
                            keyProblem = checkChangeKey(key, null);
                        if (keyProblem) problems.push(at + ' ' + keyProblem);
                        counts.operationChanges++;
                        if (typeof value === 'string') {
                            // A Value is set to a constraint expression, which isn't checked here.
                            const error = /^events\.[^.]+\.values\./.test(key) ? null : getAmountCompileError(value);
                            if (error) problems.push(at + ' ' + error);
                        } else if (isPlainObject(value)) {
                            const {problems:exprProblems, rest} = checkResultExprs(at, value);
                            problems.push(...exprProblems);
                            if (Object.keys(rest).length > 0) problems.push(at + ' has keys other than onSuccess, onFailure and onBoth');
                            if (value.onFailure !== undefined) problems.push(at + ' has onFailure, which an Operation never uses');
                        } else {
                            problems.push(at + ' is not a string or an object');
                        }
                    }
                }
            }
        }
        expect(problems).toEqual([]);
    
        // The test data has adjustments on both, so the checks above aren't vacuous.
        if (DATA_DIR === TEST_DATA_DIR) {
            expect(counts.actionAdjustments).toBeGreaterThan(0);
            expect(counts.exitAdjustments).toBeGreaterThan(0);
            expect(counts.costs).toBeGreaterThan(0);
            expect(counts.scratchSets).toBeGreaterThan(0);
            expect(counts.operationChanges).toBeGreaterThan(0);
        }
    });

    test('every scratch entry is named as an identifier and starts as a number, a boolean or a string', () => {
        const problems = [];
        SCENARIO_FILES.forEach((file, idx) => {
            const cfg = scenarios[idx].scratch;
            if (cfg === undefined) return;
            if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
                problems.push(file + ' scratch is not an object');
                return;
            }
            for (const [name, value] of Object.entries(cfg)) {
                if (!/^[A-Za-z_$][\w$]*$/.test(name)) problems.push(file + ' scratch entry ' + name + ' is not an identifier');
                if (!['boolean', 'string'].includes(typeof value) && !Number.isFinite(value)) problems.push(file + ' scratch entry ' + name + ' does not start as a number, a boolean or a string');
            }
        });
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

    test('every event has the event brief image and report it says it has', () => {
        const missing = [];
        for (const [eventId, event] of Object.entries(events)) {
            const files = [];
            if (event.image) files.push(MEDIA_DIR + '/event/' + eventId + '.jpg');
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
