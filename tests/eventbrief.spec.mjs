import {test, expect} from '@playwright/test';
import {startGame, dialogTitle} from './helpers.mjs';

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
