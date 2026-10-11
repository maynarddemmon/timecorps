// Regression tests for the constraint scopes, Describable and the causal links.
import {test, expect} from '@playwright/test';
import {startGame, readJson, setCausator, btnTooltip} from './helpers.mjs';

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
        vq.setDevoured(true);
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

/*  The default investigate check, [difficulty, skill expression], read from the data so the tests 
    don't need changing when it's tuned. */
const getDefaultInvestigate = () => {
    const {difficulty, check} = readJson('data/init.json5').skillChecks.investigate;
    return [difficulty, check];
};

test('every Event offers Investigate first, except the HQ and The Void, hidden once its attestation is at max', async ({page}) => {
    const problems = await startGame(page),
        DEFAULTS = getDefaultInvestigate(),
        out = await page.evaluate(() => {
            const out = {missing:[], notFirst:[]};
            for (const eventModel of tc.model.getEventModelsAsList(eventModel => eventModel.isRegularEvent())) {
                const actionIds = Object.keys(eventModel.getActionModels());
                if (!actionIds.includes('_investigate')) out.missing.push(eventModel.id);
                else if (actionIds[0] !== '_investigate') out.notFirst.push(eventModel.id);
            }
            out.special = [tc.model.getHQEventModel(), tc.model.getEventModel(tc.cfg.EVENT_ID_THE_VOID)]
                .map(eventModel => eventModel.getActionModels()._investigate ?? null);
            
            const roster = tc.model.getEventModel('roster_reshuffle'),
                investigate = roster.getActionModels()._investigate;
            out.check = [investigate.getActionSkillDifficulty(), investigate.getActionSkillExpr()];
            out.label = investigate.label;
            out.name = investigate.getActionSkillName();
            out.hidden = [];
            for (const value of [0, 99, 100]) {
                roster.attestation.setValue(value);
                out.hidden.push(investigate.isHidden());
            }
            return out;
        });
    expect(out).toEqual({
        missing:[], notFirst:[], special:[null, null],
        check:DEFAULTS, label:'Investigate', name:'Investigate', hidden:[false, false, true]
    });
    expect(problems.warnings).toEqual([]);
});

test('an Event\'s action merges over a default action of the same ID, and null leaves the default out', async ({page}) => {
    const problems = await startGame(page),
        [defaultDifficulty, defaultSkill] = getDefaultInvestigate();
    
    // From the data: each overrides only part of the check.
    expect(await page.evaluate(() => ['collision', 'lookout_sights_berg', 'casualties'].map(id => {
        const actionModel = tc.model.getEventModel(id).getActionModels()._investigate;
        return [actionModel.getActionSkillDifficulty(), actionModel.getActionSkillExpr()];
    }))).toEqual([[150, defaultSkill], [defaultDifficulty, '2*agent.skills.investigation'], [-999999, defaultSkill]]);
    
    const out = await page.evaluate(() => {
        // The id comes last, as when Events are loaded, so warnings can name the Event.
        const build = (actions, more) => new tc.EventModel({actions, ...more, id:'merge_test'}),
            describe = eventModel => {
                const actionModels = eventModel.getActionModels(),
                    investigate = actionModels._investigate;
                try {
                    return {
                        ids:Object.keys(actionModels),
                        label:investigate?.label,
                        check:investigate ? [investigate.getActionSkillDifficulty(), investigate.getActionSkillExpr()] : null,
                        effects:investigate?.getEffects().map(effect => effect.key + ' ' + effect.getAmountExpr(true))
                    };
                } finally {
                    eventModel.destroy();
                }
            };
        return {
            // Merged key by key, all the way down, with the Event's own actions after.
            merged:describe(build({
                own:{label:'Own', set:{}},
                _investigate:{label:'Search', skillCheck:{difficulty:300}, effects:{'event.attestation':{onSuccess:'2'}}},
                _rest:null,
                // Null only means something for a default, so it's ignored.
                ghost:null
            })),
            // An effect can be dropped too.
            noEffect:describe(build({_investigate:{effects:{'event.attestation':null}}})),
            // The defaults weren't changed by any of that.
            untouched:describe(build({})),
            // The old investigate config is warned about, and so is a bad override.
            old:describe(build({_investigate:{skillCheck:{difficulty:3.5}}}, {investigate:{difficulty:150}}))
        };
    });
    expect(out.merged).toEqual({ids:['_investigate', 'own'], label:'Search', check:[300, defaultSkill], effects:['event.attestation 2']});
    expect(out.noEffect.effects).toEqual([]);
    expect(out.untouched).toEqual({ids:['_investigate', '_rest'], label:'Investigate', check:[defaultDifficulty, defaultSkill], effects:['event.attestation d(Math.min(margin / 20, event.attestation.max - event.attestation.value))']});
    expect(out.old.check).toEqual([defaultDifficulty, defaultSkill]);
    expect(problems.warnings).toEqual([
        'Event merge_test investigate is replaced by the _investigate action, e.g. {"actions":{"_investigate":{"skillCheck":{"difficulty":150}}}} (ignoring it): {difficulty: 150}',
        'Event merge_test action _investigate skill check difficulty must be an integer or "no-roll": {actionType: investigate, difficulty: 3.5}'
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('the default investigate check gets harder as attestation rises', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            investigate = roster.getActionModels()._investigate,
            getEase = () => vq.getSkillExpressionEase(investigate.getActionSkillExpr(), investigate.getActionSkillDifficulty());
        vq.doDeployToEvent(roster);
        vq.setSkills({investigation:100});
        const out = {difficulty:investigate.getActionSkillDifficulty()};
        roster.attestation.setValue(0);
        out.at0 = getEase();
        roster.attestation.setValue(20);
        out.at20 = getEase();
        return out;
    });
    
    // investigation - difficulty, then attestation makes it harder.
    expect(result.at0).toBe(100 - result.difficulty);
    expect(result.at20).toBeLessThan(result.at0);
    expect(problems.warnings).toEqual([]);
});

test('investigating finds more the better the check goes, scores what it finds, and a failure still uses the action', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            investigate = (roll, attestation=0) => {
                roster.attestation.setValue(attestation);
                const score = tc.model.getScore(),
                    actionCount = vq.getActionExecCount();
                tc.rng.queueRolls(roll);
                vq.doAction(roster.getActionModels()._investigate);
                const entry = vq.getLog().at(-1);
                return {
                    gained:roster.attestation.value - attestation,
                    scored:tc.model.getScore() - score,
                    actionsUsed:vq.getActionExecCount() - actionCount,
                    logged:{type:entry.type, success:entry.success, effects:entry.effects}
                };
            };
        vq.doDeployToEvent(roster);
        roster.getActionModels()._investigate.setSkillCheck({difficulty:500, check:'agent.skills.stealth'});
        vq.setSkills({stealth:100});
        vq.setActionExecCount(-10); // Room for every try.
        
        // An ease of -400: a roll of 399 fails, 400 passes by 0 and 999 by 599.
        return {
            failure:investigate(399),
            bare:investigate(400),
            best:investigate(999),
            // Only as far as the record goes.
            nearlyComplete:investigate(999, 95)
        };
    });
    const found = n => ({'event.attestation':n});
    expect(result.failure).toEqual({gained:0, scored:0, actionsUsed:1, logged:{type:'action', success:false, effects:undefined}});
    expect(result.bare).toEqual({gained:1, scored:3, actionsUsed:1, logged:{type:'action', success:true, effects:found(1)}});
    expect(result.best).toEqual({gained:15, scored:45, actionsUsed:1, logged:{type:'action', success:true, effects:found(15)}});
    expect(result.nearlyComplete).toEqual({gained:5, scored:15, actionsUsed:1, logged:{type:'action', success:true, effects:found(5)}});
    expect(problems.warnings).toEqual([]);
});

test('an action succeeds or fails on its skill check, and a failure still uses the action', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            prevent = roster.getActionModels().prevent,
            value = roster.getValueModels().preventReshuffle,
            // The roll that just succeeds is -ease, so one less just fails.
            ease = () => vq.getSkillExpressionEase(prevent.getActionSkillExpr(), prevent.getActionSkillDifficulty()),
            act = roll => {
                const actionCount = vq.getActionExecCount();
                tc.rng.queueRolls(roll);
                vq.doAction(prevent);
                const entry = vq.getLog().at(-1);
                return {
                    value:value.value,
                    actionsUsed:vq.getActionExecCount() - actionCount,
                    logged:{type:entry.type, success:entry.success}
                };
            };
        vq.doDeployToEvent(roster);
        const neededRoll = -ease();
        return {neededRoll, failure:act(neededRoll - 1), success:act(neededRoll)};
    });
    expect(result.neededRoll).toBeGreaterThan(0);
    expect(result.failure).toEqual({value:false, actionsUsed:1, logged:{type:'action', success:false}});
    expect(result.success).toEqual({value:true, actionsUsed:1, logged:{type:'action', success:true}});
    expect(problems.warnings).toEqual([]);
});

test('an action\'s skill check comes from its actionType, with the action\'s own parts first', async ({page}) => {
    const problems = await startGame(page);
    const DEFAULTS = readJson('data/init.json5').skillChecks;
    const result = await page.evaluate(() => {
        const roster = tc.model.getEventModel('roster_reshuffle'),
            read = action => [action.getActionSkillType(), action.getActionSkillDifficulty(), action.getActionSkillExpr()];
        roster.setActions({
            byType:{label:'By Type', skillCheck:{actionType:'sneak'}},
            overridden:{label:'Overridden', skillCheck:{actionType:'sneak', difficulty:5, check:'agent.skills.disguise'}},
            unchecked:{label:'Unchecked'},
            bad:{label:'Bad', skillCheck:{actionType:'sneak', difficulty:2.5, dificulty:3}},
            notObject:{label:'Not Object', skillCheck:'sneak'}
        });
        const actions = roster.getActionModels();
        return {
            byType:read(actions.byType),
            overridden:read(actions.overridden),
            unchecked:read(actions.unchecked),
            bad:read(actions.bad),
            notObject:read(actions.notObject),
            defaults:[tc.cfg.DEFAULT_SKILL_DIFFICULTY, tc.cfg.DEFAULT_SKILL_EXPR]
        };
    });
    const sneak = DEFAULTS.sneak,
        [defaultDifficulty, defaultExpr] = result.defaults;
    expect(result.byType).toEqual(['sneak', sneak.difficulty, sneak.check]);
    expect(result.overridden).toEqual(['sneak', 5, 'agent.skills.disguise']);
    expect(result.unchecked).toEqual(['', defaultDifficulty, defaultExpr]);
    expect(result.bad).toEqual(['sneak', sneak.difficulty, sneak.check]);
    expect(result.notObject).toEqual(['', defaultDifficulty, defaultExpr]);
    
    // Warnings name the action and its Event, and a config that isn't an object doesn't throw.
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([
        'Event roster_reshuffle action bad skill check difficulty must be an integer or "no-roll": {actionType: sneak, difficulty: 2.5, dificulty: 3}',
        'Event roster_reshuffle action bad skill check has unknown keys dificulty: {actionType: sneak, difficulty: 2.5, dificulty: 3}',
        'Event roster_reshuffle action notObject skill check must be an object: sneak'
    ]);
});

test('action button tooltips show the action type and how easy the check is', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const roster = tc.model.getEventModel('roster_reshuffle');
        roster.attestation.setValue(50); // Known, so it shows on the timeline and can be selected.
        roster.setActions({unchecked:{label:'Unchecked'}});
        tc.model.getAgentModel('VQ').doDeployToEvent(roster);
        tc.app.selectEventBox('roster_reshuffle');
    });
    await expect(page.getByRole('button', {name:'Prevent Reshuffle', exact:true}).filter({visible:true})).toBeVisible();
    expect(await btnTooltip(page, 'Prevent Reshuffle')).toMatch(/^Prevent Reshuffle\u00A0·\u00A0Social \/ [a-z -]+$/);
    
    // Without an actionType there's no type to show.
    expect(await btnTooltip(page, 'Unchecked')).toMatch(/^Unchecked\u00A0·\u00A0[a-z -]+$/);
    
    // Investigating is an action too, with what it finds on average.
    expect(await btnTooltip(page, 'Investigate')).toMatch(/^Investigate\u00A0·\u00A0Investigate \/ [a-z -]+\u00A0·\u00A0Event Attestation: ~\+\d+ if passed$/);
    expect(problems.pageErrors).toEqual([]);
});

test('an actionType that names a skill checks that skill alone', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const read = action => [action.getActionSkillType(), action.getActionSkillName(), action.getActionSkillDifficulty(), action.getActionSkillExpr()],
            roster = tc.model.getEventModel('roster_reshuffle');
        roster.setActions({
            bySkill:{label:'By Skill', skillCheck:{actionType:'stealth'}},
            bySkillHarder:{label:'By Skill, Harder', skillCheck:{actionType:'cha', difficulty:150}},
            unknownType:{label:'Unknown Type', skillCheck:{actionType:'juggling'}}
        });
        const actions = roster.getActionModels();
        return {
            bySkill:read(actions.bySkill),
            bySkillHarder:read(actions.bySkillHarder),
            unknownType:read(actions.unknownType),
            byCheck:read(roster.getActionModels().prevent),
            defaults:[tc.cfg.DEFAULT_SKILL_DIFFICULTY, tc.cfg.DEFAULT_SKILL_EXPR]
        };
    });
    const [defaultDifficulty, defaultExpr] = result.defaults,
        initJson = readJson('data/init.json5');
    expect(result.bySkillHarder).toEqual(['cha', initJson.skills.cha.name, 150, 'agent.skills.cha']);
    expect(result.bySkill).toEqual(['stealth', initJson.skills.stealth.name, defaultDifficulty, 'agent.skills.stealth']);
    
    // Neither a default check nor a skill: the global defaults, shown by its id.
    expect(result.unknownType).toEqual(['juggling', 'juggling', defaultDifficulty, defaultExpr]);
    
    // A default check takes its name from the check.
    expect(result.byCheck[1]).toBe(initJson.skillChecks.social.name);
    expect(problems.warnings).toEqual([]);
});

test('a sure_thing check never rolls and never fails, whatever the agent\'s skills', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            original = vq.getSkills();
        roster.setActions({sure:{label:'Sure', skillCheck:{actionType:'sure_thing'}}});
        const sure = roster.getActionModels().sure,
            // Whether it passed, and whether it left the queued roll alone.
            check = roll => {
                tc.rng.queueRolls(roll);
                const {success} = vq.checkSkillExpression(sure.getActionSkillExpr(), sure.getActionSkillDifficulty()),
                    unrolled = tc.rng.getQueuedRollCount() === 1;
                tc.rng.clearQueuedRolls();
                return success && unrolled;
            },
            out = {};
        vq.doDeployToEvent(roster);
        try {
            for (const [label, skills] of [['unskilled', {}], ['inept', {cha:-5000, stealth:-5000, dex:-5000}]]) {
                vq.setSkills(skills);
                out[label] = {
                    phrase:vq.getSkillEasePhrase(sure.getActionSkillExpr(), sure.getActionSkillDifficulty()),
                    roll0:check(0),
                    roll1:check(1)
                };
            }
        } finally {
            vq.setSkills(original);
        }
        return out;
    });
    
    // It's a no-roll check, so even the lowest roll can't fail it.
    const expected = {phrase:'certain', roll0:true, roll1:true};
    expect(result).toEqual({unskilled:expected, inept:expected});
    expect(problems.warnings).toEqual([]);
});

test('a no-roll check succeeds without rolling, whatever the agent\'s skills', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            casualties = tc.model.getEventModel('casualties'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            original = vq.getSkills();
        
        // A default skill check can be no-roll too.
        tc.model.processData({skillChecks:{test_no_roll:{name:'Test No Roll', check:'agent.skills.cha', difficulty:'no-roll'}}});
        roster.setActions({
            byType:{label:'By Type', skillCheck:{actionType:'test_no_roll'}},
            byAction:{label:'By Action', skillCheck:{actionType:'cha', difficulty:'no-roll'}},
            bad:{label:'Bad', skillCheck:{difficulty:'no roll'}}
        });
        const actions = roster.getActionModels(),
            check = (expr, difficulty) => {
                tc.rng.clearQueuedRolls();
                tc.rng.queueRolls(0); // The worst roll, which should be left unused.
                const result = vq.checkSkillExpression(expr, difficulty);
                return {...result, rollsLeft:tc.rng.getQueuedRollCount(), phrase:vq.getSkillEasePhrase(expr, difficulty)};
            },
            out = {};
        vq.setSkills({cha:-5000, investigation:-5000});
        try {
            // From the data: investigating casualties is no-roll.
            const investigate = casualties.getActionModels()._investigate;
            out.investigate = check(investigate.getActionSkillExpr(), investigate.getActionSkillDifficulty());
            out.byType = check(actions.byType.getActionSkillExpr(), actions.byType.getActionSkillDifficulty());
            out.byAction = check(actions.byAction.getActionSkillExpr(), actions.byAction.getActionSkillDifficulty());
        } finally {
            vq.setSkills(original);
            tc.rng.clearQueuedRolls();
        }
        out.badDifficulty = actions.bad.getActionSkillDifficulty();
        out.defaultDifficulty = tc.cfg.DEFAULT_SKILL_DIFFICULTY;
        
        // The floating text has no margin to show.
        tc.checks.showFloatingTextForSkillCheck(tc.app, out.byAction);
        out.text = tc.app.getSubviews().filter(sv => sv.isA(tc.FloatingText) && sv.visible).at(-1)?.text;
        return out;
    });
    
    for (const key of ['investigate', 'byType', 'byAction']) {
        expect(result[key]).toMatchObject({success:true, roll:null, result:0, ease:0, rollsLeft:1, phrase:'certain'});
    }
    expect(result.text).toBe('Succeeded');
    
    // Anything else that isn't an integer is dropped, with a warning.
    expect(result.badDifficulty).toBe(result.defaultDifficulty);
    expect(problems.warnings).toEqual(['Event roster_reshuffle action bad skill check difficulty must be an integer or "no-roll": {difficulty: no roll}']);
});

test('the ship that reaches New York, and who it lands, follow the night of the collision', async ({page}) => {
    const problems = await startGame(page),
        arrival = () => page.evaluate(() => {
            const model = tc.model,
                eventModel = model.getEventModel('arrival_new_york'),
                {arrivingShip, peopleLanded} = eventModel.getValueModels(),
                exitsToNY = (id, mode) => model.getEventModel(id).getExitModels()
                    .filter(exitModel => exitModel.getToEventModel() === eventModel && exitModel.mode === mode),
                // Waiting for New York is only possible while she stays afloat.
                waitHidden = id => exitsToNY(id, 'wait').map(exitModel => exitModel.isHidden()),
                // Once she sinks, the lifeboats are the way, and they hurt even on a pass when
                // there aren't enough of them.
                lifeboatDamageOnSuccess = exitsToNY('casualties', 'lifeboat')
                    .filter(exitModel => !exitModel.isHidden())
                    .map(exitModel => exitModel.getEffects().find(effect => effect.key === 'agent.health')?.getAmountExpr(true) ?? null);
            return {
                ship:arrivingShip.value, landed:peopleLanded.value,
                waitHidden:[...waitHidden('collision'), ...waitHidden('casualties')], lifeboatDamageOnSuccess
            };
        });
    
    // History: she sinks, and the Carpathia lands the survivors.
    expect(await arrival()).toEqual({ship:'Carpathia', landed:706, waitHidden:[true, true], lifeboatDamageOnSuccess:['-d(4,2)']});
    
    // The Californian answers the call, but there aren't boats for everyone.
    await setCausator(page, 'wireless_priority', 'clearBacklogEarlier', true);
    expect(await arrival()).toEqual({ship:'Californian', landed:706, waitHidden:[true, true], lifeboatDamageOnSuccess:['-d(4,2)']});
    
    // With boats for everyone, the Californian lands almost everyone.
    await setCausator(page, 'lifeboat_capacity', 'fullDavits', true);
    expect(await arrival()).toEqual({ship:'Californian', landed:2112, waitHidden:[true, true], lifeboatDamageOnSuccess:[null]});
    
    // No collision: Titanic arrives herself, and both events can wait for her.
    await setCausator(page, 'ice_warnings', 'relayToBridge', true);
    await setCausator(page, 'engine_order', 'countermandAstern', true);
    expect(await arrival()).toEqual({ship:'Titanic', landed:2224, waitHidden:[false, false], lifeboatDamageOnSuccess:[]});
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('agent health comes from the data, with a constitution that can rise to the absolute max', async ({page}) => {
    const problems = await startGame(page),
        agentsJson = readJson('data/agents.json5').agents,
        health = await page.evaluate(() => Object.fromEntries(Object.values(tc.model.getAgentModels()).map(agentModel => {
            const {value, max, absMax} = agentModel.health;
            return [agentModel.id, {value, max, absMax}];
        })));
    for (const [agentId, datum] of Object.entries(agentsJson)) {
        const expected = {max:datum.health?.max ?? 100};
        expected.value = datum.health?.value ?? expected.max;
        expect(health[agentId], agentId).toEqual({...expected, absMax:150});
    }
    
    // A value alone, or a max alone where the value follows it.
    const forms = await page.evaluate(() => {
        const agentModel = tc.model.getAgentModel('VQ'),
            statHealth = agentModel.health,
            out = [];
        agentModel.inited = false;
        for (const v of [80, {max:75}, {max:200}, {max:120, value:90}]) {
            statHealth.setMax(100);
            statHealth.setValue(100);
            agentModel.setHealth(v);
            out.push([statHealth.value, statHealth.max]);
        }
        agentModel.inited = true;
        return out;
    });
    expect(forms).toEqual([[80, 100], [75, 75], [150, 150], [90, 120]]);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

/*  The Timeline's paradox limit, what the formula says it should be, and the regular Events
    that aren't hidden. */
const readParadoxLimit = page => page.evaluate(() => {
    const {TIMELINE_PARADOX_LIMIT, TIMELINE_PARADOX_LIMIT_PER_EVENT} = tc.cfg,
        visibleCount = tc.model.getEventModelsAsList(eventModel => eventModel.isRegularEvent() && !eventModel.isHidden()).length;
    return {
        max:tc.model.paradox.max,
        expected:Math.floor(TIMELINE_PARADOX_LIMIT + TIMELINE_PARADOX_LIMIT_PER_EVENT*visibleCount),
        visibleCount
    };
});

test('the timeline paradox limit grows with each regular event that isn\'t hidden', async ({page}) => {
    const problems = await startGame(page),
        start = await readParadoxLimit(page);
    expect(start.max).toBe(start.expected);
    
    // The HQ and The Void aren't regular Events, so showing them doesn't count.
    await page.evaluate(() => {
        tc.model.getHQEventModel().setHidden(false);
        tc.model.getEventModel(tc.cfg.EVENT_ID_THE_VOID).setHidden(false);
    });
    expect(await readParadoxLimit(page)).toEqual(start);
    
    // Revealing Events raises it, and hiding them lowers it, by the formula with any fraction 
    // dropped.
    await page.evaluate(() => {
        for (const eventId of ['roster_reshuffle', 'ice_warnings', 'purser_spare', 'missing_binoculars', 'wireless_priority']) {
            tc.model.getEventModel(eventId).attestation.setValue(10);
        }
    });
    const revealed = await readParadoxLimit(page);
    expect(revealed.visibleCount).toBeGreaterThan(start.visibleCount);
    expect(revealed.max).toBe(revealed.expected);
    expect(revealed.max).toBeGreaterThan(start.max);
    
    await page.evaluate(() => tc.model.getEventModel('roster_reshuffle').setHidden(true));
    const hidden = await readParadoxLimit(page);
    expect(hidden.visibleCount).toBe(revealed.visibleCount - 1);
    expect(hidden.max).toBe(hidden.expected);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('hiding events can drop the paradox limit below the paradox, destabilizing the timeline', async ({page}) => {
    const problems = await startGame(page);
    
    // Enough Events revealed to raise the limit above its fixed part, and the paradox at the
    // limit. None of these Events reveal an Agent, whose dossier would hold up the dialog.
    await page.evaluate(() => {
        for (const eventId of ['roster_reshuffle', 'ice_warnings', 'purser_spare', 'missing_binoculars', 'wireless_priority']) {
            tc.model.getEventModel(eventId).attestation.setValue(10);
        }
        tc.model.paradox.setValue(tc.model.paradox.max);
    });
    expect(await page.evaluate(() => tc.model.paradox.value > tc.cfg.TIMELINE_PARADOX_LIMIT)).toBe(true);
    
    // Hiding them again brings the limit back down, below the paradox.
    await page.evaluate(() => {
        for (const eventId of ['roster_reshuffle', 'ice_warnings', 'purser_spare', 'missing_binoculars', 'wireless_priority']) {
            tc.model.getEventModel(eventId).setHidden(true);
        }
    });
    expect(await page.evaluate(() => tc.model.paradox.max)).toBeLessThan(await page.evaluate(() => tc.cfg.TIMELINE_PARADOX_LIMIT + 1));
    await expect(page.getByText('Timeline Destabilized', {exact:true}).filter({visible:true})).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
});


test('an event without a hidden expression is revealed by its causal neighbors\' attestation', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const model = tc.model,
            {DEFAULT_DESCENDANT_ATTESTATION_FOR_REVEAL:descReveal, DEFAULT_PRECURSOR_ATTESTATION_FOR_REVEAL:preReveal} = tc.cfg,
            ev = id => model.getEventModel(id),
            hiddenWith = (watchedId, value, targetId) => {
                const stat = ev(watchedId).attestation,
                    prior = stat.value;
                stat.setValue(value);
                const hidden = ev(targetId).isHidden();
                stat.setValue(prior);
                return hidden;
            },
            binoculars = ev('missing_binoculars');
        return {
            descReveal, preReveal,
            precursorIds: [...binoculars.getPrecursors()].map(e => e.id).sort(),
            descendantIds: [...binoculars.getDescendants()].map(e => e.id).sort(),
            startsHidden: binoculars.isHidden(),
            
            // A descendant reveals it at the descendant threshold.
            belowDesc: hiddenWith('lookout_sights_berg', descReveal - 1, 'missing_binoculars'),
            atDesc: hiddenWith('lookout_sights_berg', descReveal, 'missing_binoculars'),
            
            // A precursor reveals it at the precursor threshold.
            belowPre: hiddenWith('purser_spare', preReveal - 1, 'missing_binoculars'),
            atPre: hiddenWith('purser_spare', preReveal, 'missing_binoculars'),
            
            // An unrelated event doesn't.
            unrelated: hiddenWith('wireless_priority', 100, 'missing_binoculars'),
            
            // An expression from the data is kept as is.
            dataExpr: tc.getConstrainedValueCfg(ev('lifeboat_capacity'), 'hidden'),
            
            // Nothing known about the event itself still hides it, and something known shows it.
            ownAttestation: (() => {
                binoculars.attestation.setValue(1);
                const hidden = binoculars.isHidden();
                binoculars.attestation.setValue(0);
                return hidden;
            })(),
            endsHidden: binoculars.isHidden()
        };
    });
    
    expect(result.precursorIds).toEqual(['purser_spare', 'roster_reshuffle']);
    expect(result.descendantIds).toEqual(['lookout_sights_berg']);
    expect(result.descReveal).toBeLessThan(result.preReveal);
    expect(result.startsHidden).toBe(true);
    expect(result.belowDesc).toBe(true);
    expect(result.atDesc).toBe(false);
    expect(result.belowPre).toBe(true);
    expect(result.atPre).toBe(false);
    expect(result.unrelated).toBe(true);
    expect(result.dataExpr).toBe(readJson('data/titanic_scenario.json5').events.lifeboat_capacity.hidden);
    expect(result.ownAttestation).toBe(false);
    expect(result.endsHidden).toBe(true);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('a stat previews an adjustment without changing, and adjusts by the same amount', async ({page}) => {
    await startGame(page);
    const out = await page.evaluate(() => {
        const stat = new tc.NumericStatModel({id:'test', absMin:0, min:0, value:50, max:80, absMax:100}),
            fired = [];
        stat.attachObserver({onFired: e => fired.push(e.type)}, 'onFired', 'valueClampedToMax');
        stat.attachObserver({onFired: e => fired.push(e.type)}, 'onFired', 'valueClampedToMin');
        const preview = (adj, cfg) => {
                const allowed = stat.getAllowedAdj(adj, cfg);
                return [allowed.adj, allowed.clamp, stat.value];
            },
            apply = (adj, cfg) => {
                const before = stat.value, adjusted = stat.adjValue(adj, cfg), result = [adjusted, stat.value, fired.splice(0)];
                stat.setValue(before);
                return result;
            };
        return {
            within:preview(10), overMax:preview(40), underMin:preview(-60),
            upperLimit:preview(40, {upperLimit:60}), allOrNothing:preview(40, {allOrNothing:true}), nan:preview(NaN),
            applyWithin:apply(10), applyOverMax:apply(40), applyUnderMin:apply(-60), applyUpperLimit:apply(40, {upperLimit:60}), applyNaN:apply(NaN)
        };
    });
    expect(out).toEqual({
        within:[10, null, 50], overMax:[30, 'max', 50], underMin:[-50, 'min', 50],
        upperLimit:[10, null, 50], allOrNothing:[0, null, 50], nan:[0, null, 50],
        applyWithin:[10, 60, []], applyOverMax:[30, 80, ['valueClampedToMax']], applyUnderMin:[-50, 0, ['valueClampedToMin']],
        applyUpperLimit:[10, 60, []], applyNaN:[0, 50, []]
    });
});
