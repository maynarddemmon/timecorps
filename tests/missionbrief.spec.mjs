import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {startGame, dismissMissionBrief, dismissAgentDossier, setCausator, dialogTitle, ROOT, TEST_DATA_DIR} from './helpers.mjs';

const brief = page => page.locator('.myt-MissionBrief'),
    
    // The first line of an Operation's briefing file.
    briefingHeading = operationId => fs.readFileSync(path.join(ROOT, TEST_DATA_DIR, 'mission', operationId + '.txt'), 'utf8').split(/\r?\n/)[0],
    
    getBriefState = page => page.evaluate(() => {
        const dialog = tc.app.getSubviews().find(sv => sv.isA(tc.MissionBrief));
        return {
            visible:dialog.visible,
            operationId:dialog.getBriefModel()?.id ?? null,
            photoVisible:dialog._photo.visible,
            fieldNotesVisible:dialog._fieldNotesView.visible,
            // A hidden row still holds a placeholder, so only a showing row's text counts.
            fieldNotes:dialog._fieldNotesView.visible ? dialog._fieldNotesContent.getSubviews().map(part => part.part.value).join('<p>') : ''
        };
    });

test('a new mission opens with its brief: the briefing file, and field notes from the mission', async ({page}) => {
    const problems = await startGame(page, {dismissBrief:false});
    
    await expect(dialogTitle(page, 'Mission Brief')).toBeVisible();
    await expect(page.getByText('Mission Brief : First Mission', {exact:true}).filter({visible:true})).toBeVisible();
    await expect(brief(page).getByText(briefingHeading('first'), {exact:false})).toBeVisible();
    
    // The field notes are the mission's description. The row is hidden when there's none to 
    // show yet, as for the first mission at the start.
    const description = await page.evaluate(() => tc.model.getOperationModel('first').getDescription());
    expect(await getBriefState(page)).toEqual({
        visible:true, operationId:'first', photoVisible:true,
        fieldNotesVisible:description !== '', fieldNotes:description
    });
    
    await dismissMissionBrief(page);
    
    // No image was asked for, so nothing tried to load one.
    expect(problems.errors).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('the Mission panel title opens the brief, and Esc closes it', async ({page}) => {
    const problems = await startGame(page);
    
    // The description now lives in the brief, not the panel.
    const panel = page.locator('.myt-OperationDetails');
    await expect(panel.getByText('Many will be lost', {exact:false})).toHaveCount(0);
    
    const title = panel.getByText(/First Mission/).first();
    expect(await title.evaluate(elem => getComputedStyle(elem).cursor)).toBe('pointer');
    await title.click();
    await expect(dialogTitle(page, 'Mission Brief')).toBeVisible();
    
    await page.keyboard.press('Escape');
    await expect(dialogTitle(page, 'Mission Brief')).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});

test('the field notes follow the mission\'s description as it changes', async ({page}) => {
    const problems = await startGame(page);
    const opened = await page.evaluate(() => tc.app.openMissionBrief(tc.model.getCurrentOperation()) != null);
    expect(opened).toBe(true);
    const before = (await getBriefState(page)).fieldNotes;
    
    // Learning enough about the aftermath reveals another phrase of the description.
    await page.evaluate(() => tc.model.getEventModel('aftermath').attestation.setValue(50));
    await expect.poll(async () => (await getBriefState(page)).fieldNotes).not.toBe(before);
    expect((await getBriefState(page)).fieldNotes).toBe(await page.evaluate(() => tc.model.getCurrentOperation().getDescription()));
    expect(problems.pageErrors).toEqual([]);
});

test('a mission brief waits its turn behind other dialogs', async ({page}) => {
    const problems = await startGame(page);
    const result = await page.evaluate(() => {
        tc.dialogUtil.openAckMsgDialog('Ack First', 'Showing first.');
        return tc.app.openMissionBrief(tc.model.getCurrentOperation()) === undefined;
    });
    expect(result).toBe(true);
    await expect(dialogTitle(page, 'Ack First')).toBeVisible();
    await expect(dialogTitle(page, 'Mission Brief')).toHaveCount(0);
    
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    await expect(dialogTitle(page, 'Ack First')).toHaveCount(0);
    await expect(dialogTitle(page, 'Mission Brief')).toBeVisible();
    
    // And acks opened while it's showing wait for it.
    expect(await page.evaluate(() => tc.dialogUtil.openAckMsgDialog('Ack Second', 'Waits.') === undefined)).toBe(true);
    await dismissMissionBrief(page);
    await expect(dialogTitle(page, 'Ack Second')).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
});

test('a mission image is only loaded when the mission has one', async ({page}) => {
    await startGame(page);
    expect(await page.evaluate(() => {
        const operationModel = tc.model.getCurrentOperation(),
            withImage = operationModel.getMediaUrls();
        operationModel.setImage(false);
        const without = operationModel.getMediaUrls();
        try {
            return [without, withImage];
        } finally {
            operationModel.setImage(true);
        }
    })).toEqual([[null, null], ['./tests/data/img/mission/first.jpg', null]]);
});

test('a completed mission\'s brief shows its debrief after the briefing', async ({page}) => {
    const problems = await startGame(page, {dismissBrief:false}),
        visibleInBrief = text => brief(page).getByText(text, {exact:true}).filter({visible:true});
    
    // Not while the mission is still to be done.
    await expect(visibleInBrief('Briefing')).toBeVisible();
    await expect(visibleInBrief('Debrief')).toHaveCount(0);
    await dismissMissionBrief(page);
    await dismissAgentDossier(page, 'Alpha');
    
    // Completing it shows the debrief in Mission Complete, then in the brief as well.
    await setCausator(page, 'plan', 'prepared', true);
    await setCausator(page, 'lever', 'pulled', true);
    await expect(dialogTitle(page, 'Mission Complete')).toBeVisible();
    await page.getByRole('button', {name:'X Close'}).filter({visible:true}).click();
    await page.evaluate(() => {tc.app.openMissionBrief(tc.model.getOperationModel('first'));});
    
    await expect(visibleInBrief('Debrief')).toBeVisible();
    await expect(visibleInBrief('The first mission is complete. The plan was prepared.')).toBeVisible();
    // It comes after the briefing.
    const [briefingY, debriefY] = await page.evaluate(() => {
        const dialog = tc.app.getSubviews().find(sv => sv.isA(tc.MissionBrief));
        return [dialog._profileView.y, dialog._debriefView.y];
    });
    expect(debriefY).toBeGreaterThan(briefingY);
    
    expect(problems.pageErrors).toEqual([]);
});
