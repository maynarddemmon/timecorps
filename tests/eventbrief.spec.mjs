import {test, expect} from '@playwright/test';
import {startGame, dialogTitle, reloadGame, briefTitle, readTestData} from './helpers.mjs';

const visibleText = (page, text) => page.getByText(text, {exact:false}).filter({visible:true});

const eventBriefTitle = page => briefTitle(page, 'event'),
    
    // The parts of the open Event Brief that depend on the Event.
    briefState = page => page.evaluate(() => {
        const brief = document.querySelector('.myt-EventBrief').model,
            fieldNotes = brief._fieldNotesView,
            report = brief._profileView,
            facts = brief._eventFacts;
        return {
            event:brief.getBriefModel()?.id,
            photoVisible:brief.getPhoto().visible,
            photoUrl:brief.getPhoto().getImageView().imageUrl ?? null,
            fieldNotes:fieldNotes.visible ? fieldNotes.getValueView().text : null,
            report:report.visible ? report.getValueView().text : null,
            where:facts._whereBtn.text,
            attestation:facts._attestationBar.value
        };
    });

test('the event details title opens the event brief, with the description as field notes', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    const title = page.locator('.myt-EventDetails').getByText('Origin', {exact:true}).filter({visible:true});
    await expect(title).toBeVisible();
    await title.click();
    
    await expect(eventBriefTitle(page)).toHaveText('Deck : Origin');
    await expect.poll(() => briefState(page)).toEqual({
        event:'origin', photoVisible:true, photoUrl:expect.stringMatching(/\/event\/origin\.jpg$/), fieldNotes:'Everything starts here.', report:'Where it all begins.\n',
        where:'Deck', attestation:0
    });
    
    await page.keyboard.press('Escape');
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
});

test('double-clicking an event box opens its brief, without a photo or report it does not have', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => tc.model.getEventModel('aftermath').attestation.setValue(10));
    const box = page.locator('.myt-EventBox').filter({hasText:/^Aftermath$/}).filter({visible:true});
    await box.dblclick();
    
    await expect(eventBriefTitle(page)).toHaveText('Deck : Aftermath');
    await expect.poll(() => briefState(page)).toMatchObject({event:'aftermath', photoVisible:false, report:null});
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
});

test('an open event brief follows its event', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => {tc.app.openEventBrief(tc.model.getEventModel('plan'));});
    await expect.poll(() => briefState(page)).toMatchObject({event:'plan', fieldNotes:'A plan is made.', attestation:0});
    
    await page.evaluate(() => tc.model.getEventModel('plan').attestation.setValue(20));
    await expect.poll(() => briefState(page)).toMatchObject({fieldNotes:expect.stringContaining('More is known about the plan.'), attestation:20});
    
    expect(problems.pageErrors).toEqual([]);
});

test('the brief opens the first time any agent enters an event, unless the setting is off', async ({page}) => {
    const problems = await startGame(page, {eventBriefs:true});
    expect(await page.evaluate(() => tc.settings.get(tc.SETTING_OPEN_EVENT_BRIEF_ON_FIRST_ENTRY))).toBe(true);
    
    // The first mission reveals Alpha at Origin, which counts as a first visit.
    await expect(eventBriefTitle(page)).toHaveText('Deck : Origin');
    await page.keyboard.press('Escape');
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    const deploy = (agentId, eventId) => page.evaluate(([agentId, eventId]) => {
        const eventModel = tc.model.getEventModel(eventId);
        eventModel.attestation.setValue(10); // Known, so not hidden.
        tc.model.getAgentModel(agentId).doDeployToEvent(eventModel);
    }, [agentId, eventId]);
    
    await deploy('AL', 'aftermath');
    await expect(eventBriefTitle(page)).toHaveText('Deck : Aftermath');
    await page.keyboard.press('Escape');
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    // Not again: not for HQ, nor when the same agent or another one enters it later.
    await page.evaluate(() => tc.model.getAgentModel('AL').doRecallToHQ());
    await deploy('AL', 'aftermath');
    await page.evaluate(() => tc.model.getAgentModel('BR').setEvent('aftermath'));
    await page.waitForTimeout(250);
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    // Turned off in Settings, a new Event doesn't open its brief either.
    await page.getByRole('button', {name:'⚙'}).filter({visible:true}).click();
    await visibleText(page, 'Open event briefs on first entry').click();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => tc.settings.get(tc.SETTING_OPEN_EVENT_BRIEF_ON_FIRST_ENTRY))).toBe(false);
    await deploy('AL', 'finale');
    await page.waitForTimeout(250);
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('an agent at an event when it is revealed counts as a first visit, and a reload opens nothing again', async ({page}) => {
    const problems = await startGame(page, {eventBriefs:true});
    await expect(eventBriefTitle(page)).toHaveText('Deck : Origin');
    await page.keyboard.press('Escape');
    
    // Plan is unknown when Alpha arrives, so its brief waits until it's revealed.
    await page.evaluate(() => tc.model.getAgentModel('AL').doDeployToEvent(tc.model.getEventModel('plan')));
    await page.waitForTimeout(250);
    await expect(eventBriefTitle(page)).toHaveCount(0);
    await page.evaluate(() => tc.model.getEventModel('plan').attestation.setValue(10));
    await expect(eventBriefTitle(page)).toHaveText('Office : Plan');
    await page.keyboard.press('Escape');
    
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    await page.waitForTimeout(500);
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('the brief\'s location opens the area brief over it', async ({page}) => {
    const problems = await startGame(page);
    // The area brief already exists, so it has to come forward rather than being made on top.
    await page.evaluate(() => {tc.app.openAreaBrief(tc.model.getEventModel('origin').getLocationModel());});
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Area Brief')).toHaveCount(0);
    
    await page.evaluate(() => {tc.app.openEventBrief(tc.model.getEventModel('origin'));});
    await expect(eventBriefTitle(page)).toBeVisible();
    const where = (await briefState(page)).where;
    await page.locator('.myt-EventBrief').getByText(where, {exact:true}).click();
    await expect(dialogTitle(page, 'Area Brief')).toHaveText('Area Brief : ' + where);
    
    // It's the one on top.
    expect(await page.evaluate(() => {
        const rect = document.querySelector('.myt-AreaBrief').model.getPanelView().getIDE().getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width/2, rect.y + 10)?.closest('.myt-AreaBrief, .myt-EventBrief')?.className;
    })).toContain('AreaBrief');
    
    // Closing it goes back to the event brief.
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Area Brief')).toHaveCount(0);
    await expect(eventBriefTitle(page)).toBeVisible();
    
    expect(problems.pageErrors).toEqual([]);
});

test('the dossier\'s Event opens the brief over it, and a brief queued for that Event is then not shown again', async ({page}) => {
    const problems = await startGame(page);
    await page.evaluate(() => {
        const m = tc.model;
        tc.app.openAgentDossier(m.getAgentModel('AL'));
        // Both wait behind the dossier.
        tc.app.openEventBrief(m.getEventModel('origin'));
        tc.app.openEventBrief(m.getEventModel('aftermath'));
    });
    await expect(briefTitle(page, 'dossier')).toHaveText('Agent : Alpha');
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    // Alpha is at Origin, and its brief opens at once.
    await page.locator('.myt-AgentDossier').getByText('Origin', {exact:true}).click();
    await expect(eventBriefTitle(page)).toHaveText('Deck : Origin');
    await page.keyboard.press('Escape');
    await expect(eventBriefTitle(page)).toHaveCount(0);
    await expect(briefTitle(page, 'dossier')).toBeVisible();
    
    // Closing the dossier skips the queued Origin brief, just seen, and opens Aftermath's.
    await page.keyboard.press('Escape');
    await expect(eventBriefTitle(page)).toHaveText('Deck : Aftermath');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await expect(eventBriefTitle(page)).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('event details\' location opens the area brief', async ({page}) => {
    const problems = await startGame(page),
        details = page.locator('.myt-EventDetails'),
        locationBtn = name => details.getByRole('button', {name, exact:true}).filter({visible:true});
    
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    await expect(details.getByText(/→.*\(/).filter({visible:true})).toBeVisible();
    await locationBtn('Deck').click();
    await expect(dialogTitle(page, 'Area Brief')).toHaveText('Area Brief : Deck');
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Area Brief')).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});

test('an event\'s image can be a path from the event folder, e.g. to a location\'s photo', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.plan.image = '../location/office.jpg';
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    
    await page.evaluate(() => {tc.app.openEventBrief(tc.model.getEventModel('plan'), true);});
    await expect.poll(() => briefState(page)).toMatchObject({event:'plan', photoVisible:true, photoUrl:expect.stringMatching(/\/event\/\.\.\/location\/office\.jpg$/)});
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.warnings).toEqual([]);
});
