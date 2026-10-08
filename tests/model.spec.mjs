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
    const {difficulty, check} = readJson('data/init.json').skillChecks.investigate;
    return [difficulty, check];
};

test('an event\'s investigate config is optional, validated and has defaults', async ({page}) => {
    const problems = await startGame(page);
    const DEFAULTS = getDefaultInvestigate();
    const result = await page.evaluate(() => {
        // An event with no investigate config in the data.
        const eventModel = tc.model.getEventModel('roster_reshuffle'),
            read = () => [eventModel.getInvestigateDifficulty(), eventModel.getInvestigateSkillExpr()],
            out = {};
        
        out.none = read();
        
        eventModel.setInvestigate({difficulty:500, check:'Math.max(agent.skills.deception, agent.skills.disguise)'});
        out.both = read();
        
        // Either part can be left out.
        eventModel.setInvestigate({difficulty:700});
        out.difficultyOnly = read();
        
        // Bad parts are dropped, good ones kept.
        eventModel.setInvestigate({difficulty:'500', check:'agent.skills.stealth'});
        out.badDifficulty = read();
        eventModel.setInvestigate({difficulty:250.5, check:'  '});
        out.badBoth = read();
        eventModel.setInvestigate(['agent.skills.stealth']);
        out.notObject = read();
        
        // The old name for check is an unknown key, so stale data is warned about.
        eventModel.setInvestigate({skill:'agent.skills.stealth'});
        out.oldKey = read();
        
        eventModel.setInvestigate(null);
        out.cleared = read();
        return out;
    });
    expect(result).toEqual({
        none:DEFAULTS,
        both:[500, 'Math.max(agent.skills.deception, agent.skills.disguise)'],
        difficultyOnly:[700, DEFAULTS[1]],
        badDifficulty:[DEFAULTS[0], 'agent.skills.stealth'],
        badBoth:DEFAULTS,
        notObject:DEFAULTS,
        oldKey:DEFAULTS,
        cleared:DEFAULTS
    });
    
    // One warning per bad part, naming the event.
    const investigateWarnings = problems.warnings.filter(w => w.includes('investigate'));
    expect(investigateWarnings.length).toBe(5);
    expect(investigateWarnings.every(w => w.startsWith('Event roster_reshuffle investigate skill check'))).toBe(true);
});

test('investigate config in the event JSON reaches the model', async ({page}) => {
    const problems = await startGame(page);
    const [defaultDifficulty, defaultSkill] = getDefaultInvestigate();
    
    // collision's data sets just the difficulty.
    expect(await page.evaluate(() => {
        const eventModel = tc.model.getEventModel('collision');
        return [eventModel.getInvestigateDifficulty(), eventModel.getInvestigateSkillExpr()];
    })).toEqual([150, defaultSkill]);
    
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
        return [build({difficulty:300, check:'agent.skills.stealth'}), build({difficulty:3.5})];
    });
    expect(result).toEqual([[300, 'agent.skills.stealth'], [defaultDifficulty, defaultSkill]]);
    expect(problems.warnings.filter(w => w.includes('investigate'))).toEqual([
        'Event investigate_test investigate skill check difficulty must be an integer or "no-roll": {difficulty: 3.5}'
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('the default investigate check gets harder as attestation rises', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            getEase = () => vq.getSkillExpressionEase(roster.getInvestigateSkillExpr(), roster.getInvestigateDifficulty());
        vq.doDeployToEvent(roster);
        vq.setSkills({investigation:100});
        const out = {difficulty:roster.getInvestigateDifficulty()};
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
        roster.setInvestigate({difficulty:500, check:'agent.skills.stealth'});
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
    const DEFAULTS = readJson('data/init.json').skillChecks;
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
    
    // Investigating just has its ease.
    expect(await btnTooltip(page, 'Investigate')).toMatch(/^Investigate \/ [a-z -]+$/);
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
        initJson = readJson('data/init.json');
    expect(result.bySkillHarder).toEqual(['cha', initJson.skills.cha.name, 150, 'agent.skills.cha']);
    expect(result.bySkill).toEqual(['stealth', initJson.skills.stealth.name, defaultDifficulty, 'agent.skills.stealth']);
    
    // Neither a default check nor a skill: the global defaults, shown by its id.
    expect(result.unknownType).toEqual(['juggling', 'juggling', defaultDifficulty, defaultExpr]);
    
    // A default check takes its name from the check.
    expect(result.byCheck[1]).toBe(initJson.skillChecks.social.name);
    expect(problems.warnings).toEqual([]);
});

test('a sure_thing check only fails on the lowest roll, whatever the agent\'s skills', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        const vq = tc.model.getAgentModel('VQ'),
            roster = tc.model.getEventModel('roster_reshuffle'),
            original = vq.getSkills();
        roster.setActions({sure:{label:'Sure', skillCheck:{actionType:'sure_thing'}}});
        const sure = roster.getActionModels().sure,
            check = roll => {
                tc.rng.queueRolls(roll);
                return vq.checkSkillExpression(sure.getActionSkillExpr(), sure.getActionSkillDifficulty()).success;
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
    
    // MAX_SKILL_EASE keeps a 0.1% chance of failure.
    const expected = {phrase:'ensured', roll0:false, roll1:true};
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
            out.investigate = check(casualties.getInvestigateSkillExpr(), casualties.getInvestigateDifficulty());
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
                    .map(exitModel => exitModel.getInjuryDamage(true) ?? null);
            return {
                ship:arrivingShip.value, landed:peopleLanded.value,
                waitHidden:[...waitHidden('collision'), ...waitHidden('casualties')], lifeboatDamageOnSuccess
            };
        });
    
    // History: she sinks, and the Carpathia lands the survivors.
    expect(await arrival()).toEqual({ship:'Carpathia', landed:706, waitHidden:[true, true], lifeboatDamageOnSuccess:['d(4,2)']});
    
    // The Californian answers the call, but there aren't boats for everyone.
    await setCausator(page, 'wireless_priority', 'clearBacklogEarlier', true);
    expect(await arrival()).toEqual({ship:'Californian', landed:706, waitHidden:[true, true], lifeboatDamageOnSuccess:['d(4,2)']});
    
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
        agentsJson = readJson('data/agents.json').agents,
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

