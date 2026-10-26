// An action's set: what it changes in its Event's Values and in scratch. A string sets when
// the check passes; {onSuccess, onFailure} sets for either result, worked out once, and
// {onBoth} is the same for both.
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData} from './helpers.mjs';

/*  Serves the test scenario with a Value and actions at the origin, where Alpha starts, that
    set it per result. The toss's check is roll - 500, so a roll of 900 passes by 400 and a 
    roll of 100 fails by 400. */
const routeScenarioWithSets = page => page.route('**/tests/data/test_scenario.json5', route => {
    const json = readTestData('test_scenario.json5'),
        origin = json.events.origin;
    Object.assign(json.scratch, {origin_margin:0, origin_wins:0});
    origin.values.outcome = {name:'Outcome', value:'0'};
    Object.assign(origin.actions, {
        toss:{
            label:'Toss', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
            set:{
                outcome:{onSuccess:'1', onFailure:'-1'},
                'scratch.origin_margin':{onSuccess:'margin', onFailure:'margin'},
                // A string still sets only on success.
                'scratch.origin_wins':'scratch.origin_wins + 1'
            }
        },
        // Only on failure, so a pass leaves the Value alone.
        fumble:{
            label:'Fumble', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
            set:{outcome:{onFailure:'event.values.outcome.value - 10'}}
        },
        // The same for either result, in a set and an adj. onBoth wins over the others.
        both:{
            label:'Both', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
            set:{outcome:{onBoth:'margin'}, 'scratch.origin_margin':{onBoth:'7', onSuccess:'1'}},
            adj:{'scratch.origin_wins':{onBoth:'1', onFailure:'5'}}
        },
        // A string adj, like a string set, applies only on a pass.
        practice:{
            label:'Practice', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
            adj:{'agent.skills.agl':'10', 'scratch.origin_wins':'1'}
        },
        bad:{
            label:'Bad', skillCheck:{difficulty:'no-roll'},
            set:{outcome:{onSucces:'1'}, struck:{onSuccess:1}, noted:5, empty:{}}
        }
    });
    return route.fulfill({json});
});

const act = (page, actionId, roll) => page.evaluate(([actionId, roll]) => {
    const alpha = tc.model.getAgentModel('AL'),
        origin = tc.model.getEventModel('origin'),
        action = origin.getActionModels()[actionId],
        outcome = origin.getValueModels().outcome;
    tc.rng.queueRolls(roll);
    alpha.doAction(action);
    return {
        outcome:outcome.value, flipCount:outcome.flipCount,
        margin:tc.model.scratch.origin_margin, wins:tc.model.scratch.origin_wins,
        attempts:action.attemptCount, done:action.doneCount
    };
}, [actionId, roll]);

test('a set can give each result its own value, worked out once with margin, and a string still sets only on a pass', async ({page}) => {
    await routeScenarioWithSets(page);
    const problems = await startGame(page);
    
    expect(await act(page, 'toss', 100)).toEqual({outcome:-1, flipCount:1, margin:-400, wins:0, attempts:1, done:0});
    expect(await act(page, 'toss', 900)).toEqual({outcome:1, flipCount:2, margin:400, wins:1, attempts:2, done:1});
    // Worked out once: -10 from the outcome as it was, then left alone.
    expect(await act(page, 'fumble', 100)).toMatchObject({outcome:-9, flipCount:3});
    // Nothing to set on a pass.
    expect(await act(page, 'fumble', 900)).toMatchObject({outcome:-9, flipCount:3, done:1});
    
    // Per result sets are literals, so the Value survives a reload as it was.
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await page.evaluate(() => tc.model.getEventModel('origin').getValueModels().outcome.value)).toBe(-9);
    
    expect(problems.pageErrors).toEqual([]);
});

test('onBoth sets or adjusts the same for either result, and onSuccess or onFailure beside it is ignored with a warning', async ({page}) => {
    await routeScenarioWithSets(page);
    const problems = await startGame(page);
    expect(problems.warnings.filter(warning => warning.includes('has onBoth'))).toEqual([
        expect.stringMatching(/^Event origin action both adj scratch\.origin_wins has onBoth, so its onSuccess and onFailure are ignored:/),
        expect.stringMatching(/^Event origin action both set scratch\.origin_margin has onBoth, so its onSuccess and onFailure are ignored:/)
    ]);
    
    expect(await act(page, 'both', 900)).toMatchObject({outcome:400, margin:7, wins:1});
    expect(await act(page, 'both', 100)).toMatchObject({outcome:-400, margin:7, wins:2});
    
    expect(problems.pageErrors).toEqual([]);
});

test('a string adj is short for {onSuccess}, so it applies only on a pass', async ({page}) => {
    await routeScenarioWithSets(page);
    const problems = await startGame(page),
        practice = roll => page.evaluate(roll => {
            const alpha = tc.model.getAgentModel('AL');
            tc.rng.queueRolls(roll);
            alpha.doAction(tc.model.getEventModel('origin').getActionModels().practice);
            return {agl:alpha.getSkill('agl'), wins:tc.model.scratch.origin_wins};
        }, roll),
        agl = await page.evaluate(() => tc.model.getAgentModel('AL').getSkill('agl'));
    
    expect(await practice(100)).toEqual({agl, wins:0});
    expect(await practice(900)).toEqual({agl:agl + 10, wins:1});
    expect(await page.evaluate(() => tc.model.getEventModel('origin').getActionModels().practice.getAdjustments().map(a => a.getAmountExpr(false) ?? null))).toEqual([null, null]);
    
    expect(problems.pageErrors).toEqual([]);
});

test('a set that is neither a string nor {onSuccess, onFailure} is left out, with a warning', async ({page}) => {
    await routeScenarioWithSets(page);
    const problems = await startGame(page),
        setKeys = await page.evaluate(() => Object.keys(tc.model.getEventModel('origin').getActionModels().bad.setObj));
    expect(setKeys).toEqual([]);
    expect(problems.warnings.filter(warning => warning.startsWith('Event origin action bad set '))).toEqual([
        expect.stringMatching(/^Event origin action bad set outcome has keys other than onSuccess, onFailure and onBoth \(ignoring it\)/),
        expect.stringMatching(/^Event origin action bad set struck onSuccess must be a non-empty string \(ignoring it\)/),
        expect.stringMatching(/^Event origin action bad set struck needs an onSuccess, onFailure or onBoth \(ignoring it\)/),
        expect.stringMatching(/^Event origin action bad set noted must be a string or an object \(ignoring it\)/),
        expect.stringMatching(/^Event origin action bad set empty needs an onSuccess, onFailure or onBoth \(ignoring it\)/)
    ]);
    expect(problems.pageErrors).toEqual([]);
});

/*  Serves the test scenario with actions at the origin that set stats and skills, and adjust
    Values and scratch. */
const routeScenarioWithAnyTargets = page => page.route('**/tests/data/test_scenario.json5', route => {
    const json = readTestData('test_scenario.json5'),
        origin = json.events.origin,
        NO_ROLL = {difficulty:'no-roll'};
    Object.assign(json.scratch, {origin_tally:0, origin_word:'hello'});
    Object.assign(origin.values, {count:{name:'Count', value:'0'}, label:{name:'Label', value:"'none'"}});
    Object.assign(origin.actions, {
        train:{
            label:'Train', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
            set:{
                // A string sets on a pass, worked out once.
                'agent.skills.agl':'50',
                'agent.health':{onFailure:'10'},
                'event.attestation':{onSuccess:'event.attestation.value + 4'},
                // Within the stat's limits.
                'agent.chronal':{onSuccess:'100000'}
            }
        },
        tally:{
            label:'Tally', skillCheck:NO_ROLL, costs:{'agent.action':null},
            adj:{
                count:{onSuccess:'2'},
                'scratch.origin_tally':{onSuccess:'3'},
                'agent.skills.dex':{onSuccess:'1'},
                // Not numbers, so they're left alone with a warning.
                label:{onSuccess:'1'},
                'scratch.origin_word':{onSuccess:'1'}
            }
        },
        badSet:{label:'Bad Set', skillCheck:NO_ROLL, set:{'agent.luck':'1', 'event.skills.agl':'1'}}
    });
    origin.exits.find(exit => exit.to === 'aftermath').adj = {count:{onSuccess:'10'}};
    return route.fulfill({json});
});

test('set can set stats and skills, worked out once and within their limits', async ({page}) => {
    await routeScenarioWithAnyTargets(page);
    const problems = await startGame(page),
        take = roll => page.evaluate(roll => {
            const alpha = tc.model.getAgentModel('AL'),
                origin = tc.model.getEventModel('origin');
            alpha.health.setValue(50);
            origin.attestation.setValue(5);
            tc.model.setScore(0);
            tc.rng.queueRolls(roll);
            alpha.doAction(origin.getActionModels().train);
            return {
                agl:alpha.getSkill('agl'), health:alpha.health.value, chronal:alpha.chronal.value, chronalMax:alpha.chronal.max,
                attestation:origin.attestation.value, score:tc.model.getScore()
            };
        }, roll);
    const failed = await take(100);
    expect(failed).toMatchObject({health:10, attestation:5, score:0});
    expect(failed.agl).not.toBe(50);
    const passed = await take(900);
    expect(passed).toMatchObject({agl:50, health:50, attestation:9, score:12});
    // Set as far as the stat allows.
    expect(passed.chronal).toBe(passed.chronalMax);
    expect(problems.warnings).toEqual([
        'Event origin action badSet set agent.luck names no stat, or attribute that can be set, of an agent (ignoring it): 1',
        expect.stringMatching(/^Event origin action badSet set event\.skills\.agl must be named for a stat/)
    ]);
    expect(problems.pageErrors).toEqual([]);
});

test('adj can add to numeric Values and scratch, from actions and exits, without showing them to the player', async ({page}) => {
    await routeScenarioWithAnyTargets(page);
    const problems = await startGame(page),
        out = await page.evaluate(() => {
            const alpha = tc.model.getAgentModel('AL'),
                origin = tc.model.getEventModel('origin'),
                values = origin.getValueModels(),
                tally = origin.getActionModels().tally,
                dex = alpha.getSkill('dex'),
                read = () => ({count:values.count.value, label:values.label.value, tally:tc.model.scratch.origin_tally, word:tc.model.scratch.origin_word});
            const phrase = alpha.getAdjustmentsPhrase(tally);
            alpha.doAction(tally);
            const once = read();
            alpha.doAction(tally);
            const twice = read();
            alpha.doFollowExit(origin.getExitModels().find(exit => exit.to === 'aftermath'));
            return {phrase, once, twice, walked:read(), dex:alpha.getSkill('dex') - dex, logged:alpha.getLog().at(-2).adj};
        });
    // Only the skill shows.
    expect(out.phrase).toBe('Dexterity: ~+1 if passed');
    expect(out.once).toEqual({count:2, label:'none', tally:3, word:'hello'});
    expect(out.twice).toEqual({count:4, label:'none', tally:6, word:'hello'});
    expect(out.walked.count).toBe(14);
    expect(out.dex).toBe(2);
    expect(out.logged).toEqual({count:2, 'scratch.origin_tally':3, 'agent.skills.dex':1, label:0, 'scratch.origin_word':0});
    expect(problems.warnings).toContain('Event origin Value label is not a number, so adj can\'t change it: none');
    expect(problems.warnings).toContain('scratch.origin_word is not a number, so adj can\'t change it: hello');
    expect(problems.pageErrors).toEqual([]);
});

test('set can change any attribute with a setter of an agent or Event, once or as a live expression, and it survives a reload', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        Object.assign(json.events.origin.actions, {
            recruit:{
                label:'Recruit', skillCheck:{check:'0', difficulty:500}, costs:{'agent.action':null},
                set:{
                    // Worked out once, on a pass.
                    'agents.BR.hidden':{onSuccess:'false'},
                    'agents.BR.playerControlled':{onSuccess:'true'},
                    // A live expression, kept up to date.
                    'event.chronoLocked':'scratch.plan_noteCount > 0'
                }
            },
            bad:{
                label:'Bad', skillCheck:{difficulty:'no-roll'},
                set:{'agents.BR.nope':'true', 'events.boats.id':"'x'", 'agent.hidden':{onSuccess:'false'}},
                adj:{'agents.BR.hidden':'1'}
            }
        });
        return route.fulfill({json});
    });
    const problems = await startGame(page),
        readState = () => page.evaluate(() => {
            const m = tc.model,
                bravo = m.getAgentModel('BR');
            return {hidden:bravo.isHidden(), controlled:bravo.isPlayerControlled(), locked:m.getEventModel('origin').isChronoLocked()};
        }),
        act = (actionId, roll) => page.evaluate(([actionId, roll]) => {
            tc.rng.queueRolls(roll);
            tc.model.getAgentModel('AL').doAction(tc.model.getEventModel('origin').getActionModels()[actionId]);
        }, [actionId, roll]);
    expect(problems.warnings).toEqual([
        'Event origin action bad adj agents.BR.hidden can only be set, not adjusted (ignoring it): 1',
        'Event origin action bad set agents.BR.nope names no stat, or attribute that can be set, of an agent (ignoring it): true',
        'Event origin action bad set events.boats.id names no stat, or attribute that can be set, of an Event (ignoring it): \'x\''
    ]);
    expect(await readState()).toEqual({hidden:true, controlled:false, locked:false});
    
    // A failure sets nothing, since a string, too, sets only on a pass.
    await page.evaluate(() => tc.model.setScratch('plan_noteCount', 1));
    await act('recruit', 100);
    expect(await readState()).toEqual({hidden:true, controlled:false, locked:false});
    
    // A pass reveals Bravo, puts them under the player's control, and locks the origin while
    // the scratch it reads says so.
    await act('recruit', 900);
    expect(await readState()).toEqual({hidden:false, controlled:true, locked:true});
    await page.evaluate(() => tc.model.setScratch('plan_noteCount', 0));
    expect(await readState()).toEqual({hidden:false, controlled:true, locked:false});
    
    // All of it survives a reload, the expression still live.
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await readState()).toEqual({hidden:false, controlled:true, locked:false});
    await page.evaluate(() => tc.model.setScratch('plan_noteCount', 2));
    expect(await readState()).toEqual({hidden:false, controlled:true, locked:true});
    expect(problems.pageErrors).toEqual([]);
});
