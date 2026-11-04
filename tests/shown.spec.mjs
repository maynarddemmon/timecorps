// "shown" is the inverse of "hidden", accepted wherever "hidden" is: a boolean, or a constraint
// expression kept up to date. It's turned into the equivalent "hidden".
import {test, expect} from '@playwright/test';
import {startGame, reloadGame, readTestData, setCausator} from './helpers.mjs';

test('shown hides an event, phrase, value, action or exit while it is false', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5'),
            {origin, boats} = json.events;
        // The same as the hidden they replace, read the other way around.
        origin.exits[1] = {mode:'wait', to:'finale', shown:'!event.values.struck.value'};
        origin.values.struck.description = [
            {text:'Nothing is struck.', shown:'!event.values.struck.value'},
            {text:'Something is struck.', shown:'event.values.struck.value'}
        ];
        origin.actions.peek = {label:'Peek', skillCheck:{difficulty:'no-roll'}, shown:'event.values.struck.value'};
        origin.values.flag = {name:'Flag', value:'false', shown:true};
        // A boolean replaces the usual reveal rule, as hidden does.
        delete boats.hidden;
        boats.shown = false;
        return route.fulfill({json});
    });
    const problems = await startGame(page),
        readState = () => page.evaluate(() => {
            const origin = tc.model.getEventModel('origin'),
                boats = tc.model.getEventModel('boats');
            return {
                exitHidden:origin.getExitModels()[1].isHidden(),
                struckDescription:origin.getValueModels().struck.getDescription(),
                peekHidden:origin.getActionModels().peek.isHidden(),
                flagHidden:origin.getValueModels().flag.isHidden(),
                boatsHidden:boats.isHidden()
            };
        });

    // Struck to start with.
    await page.evaluate(() => tc.model.getEventModel('boats').attestation.setValue(50));
    expect(await readState()).toEqual({
        exitHidden:true, struckDescription:'Something is struck.', peekHidden:false, flagHidden:false, boatsHidden:true
    });

    // And not, once the signal is seen and the lever pulled.
    await setCausator(page, 'signal', 'seen', true);
    await setCausator(page, 'lever', 'pulled', true);
    expect(await readState()).toEqual({
        exitHidden:false, struckDescription:'Nothing is struck.', peekHidden:true, flagHidden:false, boatsHidden:true
    });

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('set can change shown, once or as a live expression, and it survives a reload', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        Object.assign(json.events.origin.actions, {
            recruit:{label:'Recruit', skillCheck:{difficulty:'no-roll'}, set:{'agents.BR.shown':{onSuccess:'true'}}},
            lock:{label:'Lock', skillCheck:{difficulty:'no-roll'}, set:{'events.boats.shown':'scratch.plan_noteCount > 0'}}
        });
        return route.fulfill({json});
    });
    const problems = await startGame(page),
        readState = () => page.evaluate(() => ({
            bravoHidden:tc.model.getAgentModel('BR').isHidden(),
            boatsHidden:tc.model.getEventModel('boats').isHidden()
        })),
        act = actionId => page.evaluate(actionId => {
            tc.model.getAgentModel('AL').doAction(tc.model.getEventModel('origin').getActionModels()[actionId]);
        }, actionId);
    expect(await readState()).toEqual({bravoHidden:true, boatsHidden:true});

    await act('recruit');
    await act('lock');
    expect(await readState()).toEqual({bravoHidden:false, boatsHidden:true});
    await page.evaluate(() => tc.model.setScratch('plan_noteCount', 1));
    expect(await readState()).toEqual({bravoHidden:false, boatsHidden:false});

    // Saved as the hidden it stands for, still live.
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    expect(await readState()).toEqual({bravoHidden:false, boatsHidden:false});
    await page.evaluate(() => tc.model.setScratch('plan_noteCount', 0));
    expect(await readState()).toEqual({bravoHidden:false, boatsHidden:true});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('shown can be read in an expression, and agrees with hidden from the start', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        // Follows whether Bravo is shown, and whether origin's struck Value is, which is
        // never hidden, so has never had its hidden set.
        json.events.origin.values.flag = {name:'Flag', value:'agents.BR.shown + "/" + event.values.struck.shown'};
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    
    // Everything that can be hidden starts with shown its opposite, whether its hidden came 
    // from the data or a default.
    expect(await page.evaluate(() => {
        const m = tc.model,
            mismatched = [],
            check = (where, hideable) => {
                if (hideable.shown !== !hideable.hidden) mismatched.push(where + ': ' + hideable.hidden + '/' + hideable.shown);
                for (const phrase of hideable.getDescriptionPhrases?.() ?? []) check(where + ' phrase', phrase);
            };
        for (const event of m.getEventModelsAsList()) {
            check(event.id, event);
            for (const [id, part] of [
                ...Object.entries(event.getActionModels()), ...Object.entries(event.getValueModels()),
                ...event.getExitModels().map((exit, idx) => ['exit ' + idx, exit])
            ]) check(event.id + ' ' + id, part);
        }
        for (const agent of m.getAgentModelsAsList()) check(agent.id, agent);
        for (const operation of m.getOperationModelsAsList()) check(operation.id, operation);
        return mismatched;
    })).toEqual([]);
    
    const readFlag = () => page.evaluate(() => tc.model.getEventModel('origin').getValueModels().flag.getValue());
    expect(await readFlag()).toBe('false/true');
    await page.evaluate(() => tc.model.getAgentModel('BR').setHidden(false));
    expect(await readFlag()).toBe('true/true');
    
    expect(problems.pageErrors).toEqual([]);
});
