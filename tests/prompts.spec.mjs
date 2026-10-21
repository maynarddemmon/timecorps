// Prompts: messages the player answers with a button, e.g. an offer to join a Faction.
// Actions, exits and missions open them by ID with "prompt", and a button's onClick changes
// things as a mission's set and adj do.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, dialogTitle, dismissCampaignStart, setCausator} from './helpers.mjs';

const offerTitle = page => dialogTitle(page, 'An Offer'),
    clickBtn = (page, name) => page.getByRole('button', {name, exact:true}).filter({visible:true}).click(),
    
    readState = page => page.evaluate(() => ({
        faction:tc.model.getAgentModel('BR').getFaction(),
        score:tc.model.getScore(),
        credits:tc.model.getCredits()
    })),
    
    // Adds actions to origin, where Alpha starts.
    routeOriginActions = (page, actions) => page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        Object.assign(json.events.origin.actions, actions);
        return route.fulfill({json});
    }),
    doOriginAction = (page, actionId) => page.evaluate(actionId => {
        tc.model.getAgentModel('AL').doAction(tc.model.getEventModel('origin').getActionModels()[actionId]);
    }, actionId);

test('an action opens its prompt when its check passes, and a hidden prompt doesn\'t open', async ({page}) => {
    await routeOriginActions(page, {
        offer:{label:'Offer', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null}, prompt:'recruit'},
        botch:{label:'Botch', skillCheck:{actionType:'impossible'}, costs:{'agent.action':null}, prompt:'recruit'}
    });
    const problems = await startGame(page);
    const before = await readState(page);
    await page.evaluate(() => {
        const health = tc.model.getAgentModel('BR').health;
        health.setValue(health.max);
    });
    
    // A failed check opens nothing, so only the offer's prompt is waiting.
    await doOriginAction(page, 'botch');
    await doOriginAction(page, 'offer');
    await expect(offerTitle(page)).toBeVisible();
    await expect(page.getByText('Will Bravo join the Time Corps?', {exact:true})).toBeVisible();
    await clickBtn(page, 'Join');
    await expect(offerTitle(page)).toHaveCount(0);
    // The score can earn credits, so only the faction and score are compared.
    const after = await readState(page);
    expect([after.faction, after.score]).toEqual(['timecorps', before.score + 100]);
    
    // Bravo has joined, which hides the prompt.
    await doOriginAction(page, 'offer');
    await expect(offerTitle(page)).toHaveCount(0);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an exit opens its prompt before arriving, and its cancel button applies its own changes', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.origin.exits.find(exit => exit.to === 'aftermath').prompt = 'recruit';
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    const before = await readState(page);
    
    await page.evaluate(() => {
        const m = tc.model,
            alpha = m.getAgentModel('AL');
        m.getAgentModel('BR').health.setValue(1);
        alpha.doFollowExit(m.getEventModel('origin').getExitModels().find(exit => exit.to === 'aftermath'));
    });
    await expect(offerTitle(page)).toBeVisible();
    // The description's phrases follow what they read, as other descriptions do.
    await expect(page.getByText('Will Bravo join the Time Corps? He is hurt.', {exact:true})).toBeVisible();
    // Alpha arrives once it's answered.
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('origin');
    await clickBtn(page, 'Decline');
    await expect(offerTitle(page)).toHaveCount(0);
    expect(await readState(page)).toEqual({...before, credits:before.credits + 5});
    expect(await page.evaluate(() => tc.model.getAgentModel('AL').event)).toBe('aftermath');
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a mission\'s setup prompt follows its brief, and Mission Complete waits for its success prompt', async ({page}) => {
    await page.route('**/tests/data/operations.json5', route => {
        const json = readTestData('operations.json5');
        json.operations.first.onSetup.prompt = 'notice';
        json.operations.first.onSuccess.prompt = 'recruit';
        return route.fulfill({json});
    });
    const problems = await startGame(page, {dismissBrief:false});
    
    await dismissCampaignStart(page);
    await expect(dialogTitle(page, 'A Notice')).toBeVisible();
    // An ack prompt without a label has the dialog's own.
    await clickBtn(page, 'Acknowledge');
    await expect(dialogTitle(page, 'A Notice')).toHaveCount(0);
    expect((await readState(page)).score).toBe(10);
    
    await setCausator(page, 'plan', 'prepared', true);
    await setCausator(page, 'lever', 'pulled', true);
    await expect(offerTitle(page)).toBeVisible();
    await page.waitForTimeout(250);
    await expect(dialogTitle(page, 'Mission Complete')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('tc.save'))).toBeNull();
    await clickBtn(page, 'Join');
    
    // The completion's save comes after the answer, so it has it.
    await expect(dialogTitle(page, 'Mission Complete')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tc.save')).data.agents.BR.faction)).toBe('timecorps');
    await page.getByRole('button', {name:/^Next Mission/}).filter({visible:true}).last().click();
    await expect(dialogTitle(page, 'Mission Brief')).toHaveText('Mission Brief : Second Mission');
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('set can put an agent in a Faction, and problems with prompts are warned about', async ({page}) => {
    await Promise.all([
        routeOriginActions(page, {
            defect:{
                label:'Defect', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null},
                set:{'agent.faction':"'unaligned'"}
            },
            ask:{
                label:'Ask', skillCheck:{difficulty:'no-roll'}, costs:{'agent.action':null},
                prompt:'missing', set:{'agents.BR.faction':"'nowhere'"}, adj:{'agent.faction':'1'}
            }
        }),
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5');
            json.prompts.bad = {
                type:'choice', title:'Bad',
                buttons:{
                    cancel:{label:'No'},
                    confirm:{label:3, extra:1, onClick:{adj:{'timeline.score':{onFailure:'1'}}}}
                }
            };
            json.operations.first.onSuccess.prompt = 5;
            return route.fulfill({json});
        })
    ]);
    const problems = await startGame(page);
    const loadWarnings = [...problems.warnings];
    
    await doOriginAction(page, 'defect');
    await doOriginAction(page, 'ask');
    expect(await page.evaluate(() => ['AL', 'BR'].map(id => tc.model.getAgentModel(id).getFaction()))).toEqual(['unaligned', 'unaligned']);
    
    expect(loadWarnings).toEqual([
        'Event origin action ask adj agent.faction can only be set, not adjusted (ignoring it): 1',
        'Prompt bad type must be "ack" or "confirm" (using "ack"): choice',
        'Prompt bad button cancel is not a button of its type, "ack", which has confirm (ignoring it)',
        'Prompt bad button confirm has keys other than label and onClick (ignoring them): extra',
        'Prompt bad button confirm label must be a string (ignoring it): 3',
        'Prompt bad button confirm onClick adj timeline.score has onFailure, which a prompt never uses',
        'Operation first onSuccess prompt must be the ID of a prompt (ignoring it): 5'
    ]);
    expect(problems.warnings.slice(loadWarnings.length)).toEqual([
        'agents.BR.faction is not a Faction ID: nowhere',
        'Event origin action ask opens no prompt missing'
    ]);
    expect(problems.pageErrors).toEqual([]);
});
