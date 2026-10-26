// Ages: every agent has a lived age and an effective (biological) age, in years. Actions and
// exits age them by the time they live through; time travel doesn't. From an effective age 
// of 35 their maximum health declines, to nothing at 85. Treatments, as set or adj on 
// "agent.effectiveAge", wind the effective age back, but not below 25.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, reloadGame} from './helpers.mjs';

const YEAR = 365 * 24 * 60 * 60 * 1000,
    
    readAges = (page, agentId) => page.evaluate(agentId => {
        const agentModel = tc.model.getAgentModel(agentId);
        return {age:agentModel.getAge(), effectiveAge:agentModel.getEffectiveAge(), healthMax:agentModel.health.max, dead:agentModel.isDead()};
    }, agentId);

test('an agent starts at the age the data gives, or 30, and their effective age as that unless the data gives one', async ({page}) => {
    await page.route('**/tests/data/agents.json5', route => {
        const json = readTestData('agents.json5');
        json.agents.AL.age = 31.5;
        json.agents.BR.age = 40;
        json.agents.BR.effectiveAge = 33;
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    expect(await page.evaluate(() => ['AL', 'BR', 'CH'].map(id => {
        const agentModel = tc.model.getAgentModel(id);
        return [agentModel.getAge(), agentModel.getEffectiveAge()];
    }))).toEqual([[31.5, 31.5], [40, 33], [30, 30]]);
    expect(problems.warnings).toEqual([]);
});

test('actions age by a share of the Event, exits by the rest of it and the time between Events, and time travel not at all', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.origin.actions.wait = {label:'Wait', skillCheck:{difficulty:'no-roll'}};
        // Lived through whole on arrival.
        json.events.aftermath.actionLimit = 0;
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            origin = m.getEventModel('origin'),
            aftermath = m.getEventModel('aftermath'),
            steps = [alpha.getAge()];
        alpha.doAction(origin.getActionModels().wait);
        steps.push(alpha.getAge());
        alpha.doFollowExit(origin.getExitModels().find(exit => exit.to === 'aftermath'));
        steps.push(alpha.getAge());
        alpha.doDeployToEvent(origin);
        steps.push(alpha.getAge());
        // Leaving by time travel doesn't live through the rest of the Event.
        alpha.doRecallToHQ();
        steps.push(alpha.getAge());
        return {
            steps, effectiveAge:alpha.getEffectiveAge(),
            share:origin.getDuration() / origin.getActionLimit(),
            duration:origin.getDuration(), gap:aftermath.getStart() - origin.getEnd(), stay:aftermath.getDuration(), at:alpha.event
        };
    });
    const [start, afterAction, afterExit, afterDeploy, afterRecall] = out.steps;
    expect(afterAction - start).toBeCloseTo(out.share / YEAR, 9);
    // The rest of Origin, its unused actions, then the way to Aftermath, then all of it.
    expect(out.gap).toBeGreaterThan(0);
    expect(afterExit - afterAction).toBeCloseTo((out.duration - out.share + out.gap + out.stay) / YEAR, 9);
    expect(out.at).toBe('time_corps_hq');
    expect(afterDeploy).toBe(afterExit);
    expect(afterRecall).toBe(afterDeploy);
    expect(out.effectiveAge).toBe(afterRecall);
    expect(problems.pageErrors).toEqual([]);
});

test('maximum health declines with effective age, to death at 85; treatments wind it back, but not below 25', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.origin.actions.treat = {
            label:'Treat', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null},
            adj:{'agent.effectiveAge':'-100'}
        };
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    const setAge = years => page.evaluate(years => {
        tc.model.getAgentModel('AL').adjEffectiveAge(years - tc.model.getAgentModel('AL').getEffectiveAge());
    }, years);
    const prime = await page.evaluate(() => tc.model.getAgentModel('AL').health.max);
    
    await setAge(35);
    expect((await readAges(page, 'AL')).healthMax).toBe(prime);
    await setAge(60);
    const at60 = (await readAges(page, 'AL')).healthMax;
    await setAge(80);
    const at80 = (await readAges(page, 'AL')).healthMax;
    // Slow at first, then faster: less is lost from 35 to 60 than from 60 to 80.
    expect(at60).toBeLessThan(prime);
    expect(prime - at60).toBeLessThan(at60 - at80);
    
    // A treatment winds it back no further than 25, and the health returns.
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.doAction(alpha.getEventModel().getActionModels().treat);
    });
    // Then the action itself ages a little.
    const treated = await readAges(page, 'AL');
    expect(treated.effectiveAge).toBeCloseTo(25, 3);
    expect(treated).toMatchObject({healthMax:prime, dead:false});
    
    // Saved and restored.
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await readAges(page, 'AL')).toEqual(treated);
    
    await setAge(85);
    expect(await readAges(page, 'AL')).toMatchObject({healthMax:0, dead:true});
    expect(problems.pageErrors).toEqual([]);
});

test('an exit that is time travel, a jump or a pull, ages only the rest of the Event left', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.origin.exits.find(exit => exit.to === 'aftermath').mode = 'pulled';
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            origin = m.getEventModel('origin'),
            before = alpha.getAge();
        alpha.doFollowExit(origin.getExitModels().find(exit => exit.to === 'aftermath'));
        return {at:alpha.event, aged:alpha.getAge() - before, rest:origin.getDuration()};
    });
    expect(out.at).toBe('aftermath');
    expect(out.aged).toBeCloseTo(out.rest / YEAR, 9);
    expect(problems.pageErrors).toEqual([]);
});

test('an action ages by the actions it spends, a free one not at all, and actions at HQ age too', async ({page}) => {
    await page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        Object.assign(json.events.time_corps_hq.actions, {
            week:{label:'A Week', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':'7'}},
            glance:{label:'A Glance', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null}}
        });
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    const out = await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL'),
            hq = m.getEventModel('time_corps_hq'),
            actions = hq.getActionModels();
        alpha.setEvent('time_corps_hq');
        const steps = [alpha.getAge()];
        alpha.doAction(actions.glance);
        steps.push(alpha.getAge());
        alpha.doAction(actions.week);
        steps.push(alpha.getAge());
        return {steps, day:hq.getDuration() / hq.getActionLimit(), left:alpha.getActionsRemaining()};
    });
    const [start, afterGlance, afterWeek] = out.steps;
    expect(afterGlance).toBe(start);
    expect(afterWeek - afterGlance).toBeCloseTo(7 * out.day / YEAR, 9);
    expect(out.left).toBe(23);
    expect(problems.pageErrors).toEqual([]);
});
