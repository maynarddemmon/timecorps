import {test, expect} from '@playwright/test';
import {startGame, dialogTitle, reloadGame} from './helpers.mjs';

const visibleText = (page, text) => page.getByText(text, {exact:false}).filter({visible:true});

const briefTitle = page => dialogTitle(page, 'Event Brief'),
    
    // The parts of the open Event Brief that depend on the Event.
    briefState = page => page.evaluate(() => {
        const brief = document.querySelector('.myt-EventBrief').model,
            fieldNotes = brief._fieldNotesView,
            report = brief._profileView;
        return {
            event:brief.getBriefModel()?.id,
            photoVisible:brief.getPhoto().visible,
            fieldNotes:fieldNotes.visible ? fieldNotes.getValueView().text : null,
            report:report.visible ? report.getValueView().text : null,
            where:brief._whereView._vv.text,
            attestation:brief._attestationView.value
        };
    });

test('the event details title opens the event brief, with the description as field notes', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => tc.app.selectEventBox('origin'));
    const title = page.locator('.myt-EventDetails').getByText('Origin', {exact:true}).filter({visible:true});
    await expect(title).toBeVisible();
    await title.click();
    
    await expect(briefTitle(page)).toHaveText('Event Brief : Origin');
    await expect.poll(() => briefState(page)).toEqual({
        event:'origin', photoVisible:true, fieldNotes:'Everything starts here.', report:'Where it all begins.\n',
        where:'Deck', attestation:0
    });
    
    await page.keyboard.press('Escape');
    await expect(briefTitle(page)).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
    expect(problems.errors).toEqual([]);
});

test('double-clicking an event box opens its brief, without a photo or report it does not have', async ({page}) => {
    const problems = await startGame(page);
    
    await page.evaluate(() => tc.model.getEventModel('aftermath').attestation.setValue(10));
    const box = page.locator('.myt-EventBox').filter({hasText:/^Aftermath$/}).filter({visible:true});
    await box.dblclick();
    
    await expect(briefTitle(page)).toHaveText('Event Brief : Aftermath');
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
    await expect(briefTitle(page)).toHaveText('Event Brief : Origin');
    await page.keyboard.press('Escape');
    await expect(briefTitle(page)).toHaveCount(0);
    
    const deploy = (agentId, eventId) => page.evaluate(([agentId, eventId]) => {
        const eventModel = tc.model.getEventModel(eventId);
        eventModel.attestation.setValue(10); // Known, so not hidden.
        tc.model.getAgentModel(agentId).doDeployToEvent(eventModel);
    }, [agentId, eventId]);
    
    await deploy('AL', 'aftermath');
    await expect(briefTitle(page)).toHaveText('Event Brief : Aftermath');
    await page.keyboard.press('Escape');
    await expect(briefTitle(page)).toHaveCount(0);
    
    // Not again: not for HQ, nor when the same agent or another one enters it later.
    await page.evaluate(() => tc.model.getAgentModel('AL').doRecallToHQ());
    await deploy('AL', 'aftermath');
    await page.evaluate(() => tc.model.getAgentModel('BR').setEvent('aftermath'));
    await page.waitForTimeout(250);
    await expect(briefTitle(page)).toHaveCount(0);
    
    // Turned off in Settings, a new Event doesn't open its brief either.
    await page.getByRole('button', {name:'⚙'}).filter({visible:true}).click();
    await visibleText(page, 'Open event briefs on first entry').click();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => tc.settings.get(tc.SETTING_OPEN_EVENT_BRIEF_ON_FIRST_ENTRY))).toBe(false);
    await deploy('AL', 'finale');
    await page.waitForTimeout(250);
    await expect(briefTitle(page)).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});

test('an agent at an event when it is revealed counts as a first visit, and a reload opens nothing again', async ({page}) => {
    const problems = await startGame(page, {eventBriefs:true});
    await expect(briefTitle(page)).toHaveText('Event Brief : Origin');
    await page.keyboard.press('Escape');
    
    // Plan is unknown when Alpha arrives, so its brief waits until it's revealed.
    await page.evaluate(() => tc.model.getAgentModel('AL').doDeployToEvent(tc.model.getEventModel('plan')));
    await page.waitForTimeout(250);
    await expect(briefTitle(page)).toHaveCount(0);
    await page.evaluate(() => tc.model.getEventModel('plan').attestation.setValue(10));
    await expect(briefTitle(page)).toHaveText('Event Brief : Plan');
    await page.keyboard.press('Escape');
    
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    await page.waitForTimeout(500);
    await expect(briefTitle(page)).toHaveCount(0);
    
    expect(problems.pageErrors).toEqual([]);
});
