// Shared helpers for driving the game from tests.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    PORT = 8765,
    BASE_URL = 'http://localhost:' + PORT;

export const readJson = relPath => JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
export const fileExists = relPath => fs.existsSync(path.join(ROOT, relPath));

/*  Loads the game and waits until it is ready to play. Returns an object that collects page
    errors, console warnings and console errors for the rest of the test.
    
    Requests to other origins (e.g. the Font Awesome CDN used by myt) are answered with an 
    empty response so the tests never depend on the network. */
export const startGame = async (page, {skipHelp=true} = {}) => {
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
    await page.waitForFunction(() => 
        window.tc?.model?.getCurrentOperation?.() != null && 
        window.tc?.app?.getTimelineView?.()?.timelineReady === true
    );
    return problems;
};

/*  Sets a Causator's value directly, as an Action would. */
export const setCausator = (page, eventId, valueId, value) => page.evaluate(
    ([eventId, valueId, value]) => tc.model.getEventModel(eventId).getValueModels()[valueId].setValue(value, true),
    [eventId, valueId, value]
);

export const getCurrentOperationId = page => page.evaluate(() => tc.model.getCurrentOperation().id);
