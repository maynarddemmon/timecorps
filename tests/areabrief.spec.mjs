// The Area Brief ends with a chronology: the known Events at the location, earliest first,
// each with its name and when it happens, its picture and its description. The name opens the
// Event's brief, or with shift, selects the Event and closes the Area Brief.
import {test, expect} from '@playwright/test';
import {startGame} from './helpers.mjs';

const areaBrief = page => page.locator('.myt-AreaBrief'),

    openDeckBrief = page => page.evaluate(() => {tc.app.openAreaBrief(tc.model.getEventModel('origin').getLocationModel());}),

    // Each entry's name, and when it happens, from its first line: "<name> · <when>".
    readEntries = page => page.evaluate(() => [...document.querySelectorAll('.myt-AreaBrief .myt-ChronologyEntry')]
        .filter(el => el.offsetParent !== null)
        .map(el => {
            const line = el.innerText.split('\n')[0],
                idx = line.indexOf(tc.ICON_SEPARATOR.trim());
            return {name:line.slice(0, idx).trim(), when:line.slice(idx).trim()};
        })),

    entryName = (page, name) => areaBrief(page).locator('.myt-ChronologyEntry').getByText(name, {exact:true});

test('the chronology lists the known Events at the location, earliest first, and keeps up', async ({page}) => {
    const problems = await startGame(page);
    await openDeckBrief(page);
    await expect(areaBrief(page)).toBeVisible();

    // Origin and Aftermath are known at the deck, but Lever isn't yet. Each says when, as
    // Event Details does.
    await expect.poll(async () => (await readEntries(page)).map(entry => entry.name)).toEqual(['Origin', 'Aftermath']);
    const [origin] = await readEntries(page),
        originWhen = await page.evaluate(() => tc.ICON_SEPARATOR + tc.model.getEventModel('origin').formatAsTemporalExtent());
    expect(origin.when).toBe(originWhen.trim());
    await expect(areaBrief(page).getByText('Chronology', {exact:true})).toBeVisible();

    // Revealing Lever adds it in time order, while it's open, even when an Event somewhere 
    // else changes right after.
    await page.evaluate(() => {
        tc.model.getEventModel('lever').attestation.setValue(50);
        tc.model.getEventModel('relay').attestation.setValue(5);
    });
    await expect.poll(async () => (await readEntries(page)).map(entry => entry.name)).toEqual(['Lever', 'Origin', 'Aftermath']);

    // Each has its description.
    const originDescription = await page.evaluate(() => tc.model.getEventModel('origin').getDescription());
    await expect(areaBrief(page).locator('.myt-ChronologyEntry').nth(1)).toContainText(originDescription.replace(/<[^>]+>/g, '').slice(0, 20));

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an Event\'s name opens its brief, and with shift selects it and closes the Area Brief', async ({page}) => {
    const problems = await startGame(page);
    await openDeckBrief(page);

    // Opens the Event Brief over the Area Brief.
    await entryName(page, 'Origin').click();
    const eventBrief = page.locator('.myt-EventBrief');
    await expect(eventBrief).toBeVisible();
    await expect(eventBrief).toContainText('Origin');
    await page.keyboard.press('Escape');
    await expect(eventBrief).toBeHidden();
    await expect(areaBrief(page)).toBeVisible();

    // With shift, selects it and closes.
    await page.keyboard.down('Shift');
    await entryName(page, 'Aftermath').click();
    await page.keyboard.up('Shift');
    await expect(areaBrief(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => tc.app.getTimelineView().getSelectedEventId())).toBe('aftermath');

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('a location with no known Events has no chronology', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {tc.app.openAreaBrief(tc.model.getEventModel('finale').getLocationModel());});
    await expect(areaBrief(page)).toBeVisible();
    await expect(areaBrief(page).getByText('Chronology', {exact:true})).toBeHidden();
    expect(problems.pageErrors).toEqual([]);
});
