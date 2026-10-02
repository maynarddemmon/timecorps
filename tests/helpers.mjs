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
    
    // A fresh campaign opens with the first mission's brief.
    if (dismissBrief) await dismissMissionBrief(page);
    return problems;
};

/*  Waits until the game has started a campaign, whether fresh or restored. */
export const waitForGame = page => page.waitForFunction(() => 
    window.tc?.model?.getCurrentOperation?.() != null && 
    window.tc?.app?.getTimelineView?.()?.timelineReady === true
);

const missionBriefTitle = page => page.getByText('Mission Brief', {exact:true}).filter({visible:true});

/*  Acknowledges the Mission Brief that opens when a mission is set up. Fails if it isn't open. */
export const dismissMissionBrief = async page => {
    await expect(missionBriefTitle(page)).toBeVisible();
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    await expect(missionBriefTitle(page)).toHaveCount(0);
};

/*  After a reload: without a save the game starts a fresh campaign, which opens the first 
    Mission Brief, so pass briefExpected:true to dismiss it. Restoring a save never shows a 
    brief, since the mission was already set up, so otherwise that's checked. */
const settleAfterReload = async (page, briefExpected) => {
    await waitForGame(page);
    if (briefExpected) {
        await dismissMissionBrief(page);
    } else {
        await expect(missionBriefTitle(page)).toHaveCount(0);
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
