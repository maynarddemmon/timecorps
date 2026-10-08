// Shared helpers for driving the game from tests.
import fs from 'node:fs';
import {expect} from '@playwright/test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    PORT = 8765,
    BASE_URL = 'http://localhost:' + PORT;

/*  The data files that hold Events and Locations, in load order. */
export const SCENARIO_FILES = ['data/init.json', 'data/titanic_scenario.json', 'data/lusitania_scenario.json'];

export const readJson = relPath => JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
export const fileExists = relPath => fs.existsSync(path.join(ROOT, relPath));

/*  Loads the game and waits until it is ready to play. Returns an object that collects page
    errors, console warnings and console errors for the rest of the test.
    
    Requests to other origins (e.g. the Font Awesome CDN used by myt) are answered with an 
    empty response so the tests never depend on the network. */
export const startGame = async (page, {skipHelp=true, dismissBrief=true} = {}) => {
    const problems = {pageErrors:[], warnings:[], errors:[]};
    page.on('pageerror', err => problems.pageErrors.push(err.message));
    page.on('console', msg => {
        const type = msg.type();
        if (type === 'warning') problems.warnings.push(msg.text());
        if (type === 'error') problems.errors.push(msg.text());
    });
    
    await page.route(url => url.origin !== BASE_URL, route => route.fulfill({status:200, body:''}));
    
    if (skipHelp) {
        await page.addInitScript(() => {
            try {
                localStorage.setItem('tc.helpSeen', 'true');
            } catch {
                // Ignore. The manual will just show.
            }
        });
    }
    
    await page.goto('/index.html');
    await waitForGame(page);
    
    // A fresh campaign opens with the first mission's brief and its Agent's dossier.
    if (dismissBrief) await dismissCampaignStart(page);
    return problems;
};

/*  Waits until the game has started a campaign, whether fresh or restored. */
export const waitForGame = page => page.waitForFunction(() => 
    window.tc?.model?.getCurrentOperation?.() != null && 
    window.tc?.app?.getTimelineView?.()?.timelineReady === true
);

/*  A visible dialog title, e.g. "Mission Brief", including titles that go on to name something,
    e.g. "Mission Brief : Avoid the Iceberg". Anchored at both ends so it only matches the title 
    itself, not the dialog that contains it. */
export const dialogTitle = (page, title) => page.getByText(
    new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( : .*)?$')
).filter({visible:true});

const missionBriefTitle = page => dialogTitle(page, 'Mission Brief');

/*  Acknowledges the Mission Brief that opens when a mission is set up. Fails if it isn't open. */
export const dismissMissionBrief = async page => {
    await expect(missionBriefTitle(page)).toBeVisible();
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    await expect(missionBriefTitle(page)).toHaveCount(0);
};

/*  Acknowledges the dossier shown when an Agent is revealed. Fails if it isn't 
    open, or is for some other Agent. */
export const dismissAgentDossier = async (page, agentName) => {
    const title = dialogTitle(page, 'Agent Dossier');
    await expect(title).toBeVisible();
    if (agentName) await expect(title).toHaveText('Agent Dossier : ' + agentName);
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    // The next queued dossier may reuse the dialog at once, so wait for this one's title to go.
    await expect(agentName ? page.getByText('Agent Dossier : ' + agentName, {exact:true}).filter({visible:true}) : title).toHaveCount(0);
};

/*  A fresh campaign opens with the first mission's brief, then the dossier of the Agent it 
    reveals. */
export const dismissCampaignStart = async page => {
    await dismissMissionBrief(page);
    await dismissAgentDossier(page, 'Vasquez');
};

/*  After a reload: without a save the game starts a fresh campaign, which opens the first 
    Mission Brief and then Vasquez's dossier, so pass briefExpected:true to dismiss them. 
    Restoring a save never shows either, since the mission was already set up, so otherwise 
    that's checked. */
const settleAfterReload = async (page, briefExpected) => {
    await waitForGame(page);
    if (briefExpected) {
        await dismissCampaignStart(page);
    } else {
        await expect(missionBriefTitle(page)).toHaveCount(0);
        await expect(dialogTitle(page, 'Agent Dossier')).toHaveCount(0);
    }
};

export const reloadGame = async (page, {briefExpected=false} = {}) => {
    await page.reload();
    await settleAfterReload(page, briefExpected);
};

/*  Clicks a button (a Locator) that reloads the page, then settles as reloadGame does. */
export const clickAndReload = async (page, button, {briefExpected=false} = {}) => {
    await Promise.all([page.waitForEvent('load'), button.click()]);
    await settleAfterReload(page, briefExpected);
};

/*  Sets a Causator's value directly, as an Action would. */
export const setCausator = (page, eventId, valueId, value) => page.evaluate(
    ([eventId, valueId, value]) => tc.model.getEventModel(eventId).getValueModels()[valueId].setValue(value, true),
    [eventId, valueId, value]
);

export const getCurrentOperationId = page => page.evaluate(() => tc.model.getCurrentOperation().id);

/*  Forces the next rolls of tc.rng, in order. After they're used, rolls are random again. */
export const queueRolls = (page, ...values) => page.evaluate(values => tc.rng.queueRolls(...values), values);

/*  The tooltip of the visible button with exactly this text, read from its view. Tooltips show
    on hover after a delay, so this avoids waiting for one. */
export const btnTooltip = (page, text) => page.evaluate(text => {
    const elem = [...document.querySelectorAll('button')].find(btn => btn.textContent === text && btn.offsetParent !== null);
    return elem ? elem.model.tooltip ?? '' : null;
}, text);

