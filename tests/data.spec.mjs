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
            for (const [where, credits] of [['onSetup', setup.awardCredits], ['onSuccess', onSuccess.awardCredits]]) {
                if (credits !== undefined && !(Number.isInteger(credits) && credits >= 0)) problems.push(operationId + ': ' + where + '.awardCredits is not a whole number of 0 or more');
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
            const files = [MEDIA_DIR + '/location/' + locationId + '.jpg', DATA_DIR + '/location/' + locationId + '.txt'];
            if (locations[locationId].video) files.push(MEDIA_DIR + '/location/' + locationId + '.webm');
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

    /*  The stats an effect can change, by scope. Mirrors tc.EFFECT_STAT_IDS. */
    const EFFECT_STAT_IDS = {
        agent:['health', 'chronal', 'paradox'],
        event:['paradox', 'historicity', 'attestation'],
        timeline:['paradox', 'chronal']
    };

    /*  What an action can cost. Mirrors tc.COSTS. */
    const COST_KEYS = [
        'agent.action', 'agent.health', 'agent.chronal', 'agent.paradox',
        'event.attestation', 'event.historicity', 'event.paradox',
        'timeline.chronal', 'timeline.paradox', 'timeline.score', 'timeline.credits'
    ];

    test('every investigate, action skill check, action cost, action scratch set and action and exit effect is valid, including the default event actions', () => {
        const problems = [],
            counts = {actionEffects:0, exitEffects:0, costs:0, scratchSets:0},
            
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
        
            // Returns the problems with an action's or exit's effects.
            checkEffects = (where, effects, isAction) => {
                if (effects === null || typeof effects !== 'object' || Array.isArray(effects)) return [where + ' effects is not an object'];
                const effectProblems = [];
                for (const [key, cfg] of Object.entries(effects)) {
                    // Null leaves out an effect of a default action.
                    if (cfg === null) continue;
                    const at = where + ' effect ' + key,
                        [scope, statId, ...rest] = key.split('.');
                    if (rest.length > 0 || !EFFECT_STAT_IDS[scope]?.includes(statId)) effectProblems.push(at + ' is not a stat of the agent, event or timeline');
                    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
                        effectProblems.push(at + ' is not an object');
                        continue;
                    }
                    const {onSuccess, onFailure, enabledForActionSkillCheck, ...checkCfg} = cfg;
                    if (onSuccess === undefined && onFailure === undefined) effectProblems.push(at + ' has no onSuccess or onFailure');
                    for (const [name, amount] of [['onSuccess', onSuccess], ['onFailure', onFailure]]) {
                        const error = amount === undefined ? null : getAmountCompileError(amount);
                        if (error) effectProblems.push(at + ' ' + name + ' ' + error);
                    }
                    if (enabledForActionSkillCheck !== undefined) {
                        if (!isAction) {
                            effectProblems.push(at + ' has enabledForActionSkillCheck, which only applies to actions');
                        } else if (!['success', 'failure', 'both'].includes(enabledForActionSkillCheck)) {
                            effectProblems.push(at + ' enabledForActionSkillCheck is not "success", "failure" or "both"');
                        }
                    }
                    // Anything else is the effect's own skill check.
                    if (Object.keys(checkCfg).length > 0) effectProblems.push(...checkSkillCheckCfg(at, checkCfg));
                    counts[isAction ? 'actionEffects' : 'exitEffects']++;
                }
                return effectProblems;
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
                if (action.effects !== undefined) problems.push(...checkEffects(where, action.effects, true));
                if (action.costs !== undefined) problems.push(...checkCosts(where, action.costs));
                for (const [key, value] of Object.entries(action.set ?? {})) {
                    if (!key.startsWith('scratch.')) continue;
                    const name = key.slice('scratch.'.length),
                        error = getAmountCompileError(value);
                    if (!Object.hasOwn(scratch, name)) problems.push(where + ' sets ' + key + ', which is not declared');
                    if (error) problems.push(where + ' set ' + key + ' ' + error);
                    counts.scratchSets++;
                }
                if ('injurySkillCheck' in action) problems.push(where + ' has an injurySkillCheck, which effects replaced');
            }
            for (const exit of event.exits ?? []) {
                const where = eventId + ' exit to ' + exit.to;
                if (exit.effects !== undefined) problems.push(...checkEffects(where, exit.effects, false));
                if ('costs' in exit) problems.push(where + ' has costs, which only actions have');
                if ('injurySkillCheck' in exit) problems.push(where + ' has an injurySkillCheck, which effects replaced');
            }
        }
        expect(problems).toEqual([]);
    
        // The test data has effects on both, so the checks above aren't vacuous.
        if (DATA_DIR === TEST_DATA_DIR) {
            expect(counts.actionEffects).toBeGreaterThan(0);
            expect(counts.exitEffects).toBeGreaterThan(0);
            expect(counts.costs).toBeGreaterThan(0);
            expect(counts.scratchSets).toBeGreaterThan(0);
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
