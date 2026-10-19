// Exits with "toHidden":true are offered while the Event they lead to is hidden, as "somewhere",
// and their set can reveal it on the way.
import {test, expect} from '@playwright/test';
import {startGame, readTestData} from './helpers.mjs';

const routeScenarioWithVault = page => page.route('**/tests/data/test_scenario.json5', route => {
    const json = readTestData('test_scenario.json5');
    json.scratch.vault_found = false;
    json.events.vault = {
        name:'Vault', start:'1900-01-01T17:00:00', duration:{m:1}, location:'deck',
        hidden:'!scratch.vault_found'
    };
    json.events.origin.exits.push({mode:'enter', to:'vault', toHidden:true, set:{'scratch.vault_found':'true'}});
    return route.fulfill({json});
});

test('an exit to a hidden Event is offered as "somewhere", and taking it reveals the Event', async ({page}) => {
    await routeScenarioWithVault(page);
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    
    const exitBtn = page.getByRole('button', {name:/^Enter somewhere/}).filter({visible:true});
    await expect(exitBtn).toBeVisible();
    expect(await exitBtn.innerHTML()).toContain('<i>somewhere</i>');
    expect(await page.evaluate(() => tc.model.getEventModel('vault').hidden)).toBe(true);
    
    await exitBtn.click();
    expect(await page.evaluate(() => ({
        at:tc.model.getAgentModel('AL').event,
        hidden:tc.model.getEventModel('vault').hidden,
        found:tc.model.scratch.vault_found
    }))).toEqual({at:'vault', hidden:false, found:true});
    
    // Once it's known, the exit names it.
    await page.evaluate(() => {
        const alpha = tc.model.getAgentModel('AL');
        alpha.setEvent('origin');
        tc.app.selectEventBox('origin');
    });
    await expect(page.getByRole('button', {name:/^Enter Vault/}).filter({visible:true})).toBeVisible();
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('without toHidden, an exit to a hidden Event isn\'t offered', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.scratch.vault_found = false;
        json.events.vault = {
            name:'Vault', start:'1900-01-01T17:00:00', duration:{m:1}, location:'deck',
            hidden:'!scratch.vault_found'
        };
        json.events.origin.exits.push({mode:'enter', to:'vault'});
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect(page.getByText('Exits:', {exact:false}).filter({visible:true}).first()).toBeVisible();
    await expect(page.getByRole('button', {name:/^Enter /}).filter({visible:true})).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});
