// Naming an agent: a "text" prompt puts what the player types in a scratch entry, and an
// agent's "nameExpr" can read it, e.g. so the player names their own agent.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, dialogTitle, dismissCampaignStart, dismissMissionBrief, dismissAgentDossier, reloadGame} from './helpers.mjs';

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',

    // First's setup asks for Alpha's name, which Alpha's nameExpr reads.
    routeNaming = (page, prompt) => Promise.all([
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5');
            json.scratch = {alpha_name:''};
            json.prompts.naming = prompt ?? {
                type:'text',
                title:'Your Name',
                description:['What do they call you?'],
                input:{scratch:'alpha_name', maxLength:6, allowedChars:LETTERS + ' -', placeholder:'Name'},
                buttons:{confirm:{label:'That’s Me', onClick:{adj:{'timeline.score':'10'}}}}
            };
            json.operations.first.onSetup.prompt = 'naming';
            return route.fulfill({json});
        }),
        page.route('**/tests/data/agents.json5', route => {
            const json = readTestData('agents.json5');
            json.agents.AL.nameExpr = 'scratch.alpha_name';
            return route.fulfill({json});
        })
    ]),

    nameField = page => page.getByPlaceholder('Name').filter({visible:true}),
    confirmBtn = page => page.getByRole('button', {name:'That’s Me', exact:true}).filter({visible:true}),
    readState = page => page.evaluate(() => ({
        name:tc.model.getAgentModel('AL').getName(),
        scratch:tc.model.scratch.alpha_name,
        score:tc.model.getScore()
    }));

test('a text prompt names an agent with what the player types, within its limits, and the name survives a reload', async ({page}) => {
    await routeNaming(page);
    const problems = await startGame(page, {dismissBrief:false});
    await dismissCampaignStart(page);
    await expect(dialogTitle(page, 'Your Name')).toBeVisible();
    await expect(page.getByText('What do they call you?', {exact:true})).toBeVisible();

    // Blank, the data's name is used and the prompt can't be confirmed, by click or Enter.
    expect(await readState(page)).toEqual({name:'Alpha', scratch:'', score:0});
    await expect(nameField(page)).toBeFocused();
    await expect(confirmBtn(page)).toHaveClass(/\bdisabled\b/);
    await nameField(page).fill('   ');
    await page.keyboard.press('Enter');
    await expect(dialogTitle(page, 'Your Name')).toBeVisible();

    // Only the allowed characters go in, up to the limit, and the name is trimmed.
    await nameField(page).fill('');
    await nameField(page).pressSequentially(' Zé9d!-Q-Lonnng');
    await expect(nameField(page)).toHaveValue(' Zd-Q-');
    await expect(confirmBtn(page)).not.toHaveClass(/\bdisabled\b/);
    await page.keyboard.press('Enter');
    await expect(dialogTitle(page, 'Your Name')).toHaveCount(0);
    expect(await readState(page)).toEqual({name:'Zd-Q-', scratch:'Zd-Q-', score:10});
    await expect(page.locator('.myt-Agents').getByText('Zd-Q-', {exact:true})).toHaveCount(1);

    // The name comes back with the scratch entry it reads, and isn't asked for again.
    await page.evaluate(() => tc.persistence.save());
    await reloadGame(page);
    await expect(dialogTitle(page, 'Your Name')).toHaveCount(0);
    expect((await readState(page)).name).toBe('Zd-Q-');

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('the field starts with the scratch entry\'s value, and a nameExpr that isn\'t a non-empty string uses the data\'s name', async ({page}) => {
    await routeNaming(page);
    const problems = await startGame(page, {dismissBrief:false});
    await page.evaluate(() => tc.model.setScratch('alpha_name', 'Ada'));
    expect((await readState(page)).name).toBe('Ada');
    await page.evaluate(() => tc.model.setScratch('alpha_name', '  '));
    expect((await readState(page)).name).toBe('Alpha');
    await page.evaluate(() => tc.model.setScratch('alpha_name', 'Ada'));

    // The dossier shows the name too.
    await dismissMissionBrief(page);
    await dismissAgentDossier(page, 'Ada');
    await expect(nameField(page)).toHaveValue('Ada');
    await confirmBtn(page).click();
    expect(await readState(page)).toEqual({name:'Ada', scratch:'Ada', score:10});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('problems with a text prompt\'s input are warned about', async ({page}) => {
    await Promise.all([
        routeNaming(page, {type:'text', title:'Missing'}),
        page.route('**/tests/data/init.json5', route => {
            const json = readTestData('init.json5');
            json.prompts = {
                ...json.prompts,
                bare:{type:'text', input:'alpha_name'},
                extra:{type:'ack', input:{scratch:'alpha_name'}},
                limits:{type:'text', input:{scratch:'alpha_name', maxLength:0, allowedChars:5, placeholder:3, size:2}}
            };
            return route.fulfill({json});
        })
    ]);
    const problems = await startGame(page, {dismissBrief:false});
    expect(problems.warnings).toEqual(expect.arrayContaining([
        'Prompt bare input must be an object with the name of a scratch entry as "scratch" (using "ack"): alpha_name',
        'Prompt extra input is only for a "text" prompt (ignoring it)',
        'Prompt limits input has keys other than scratch, maxLength, allowedChars, placeholder (ignoring them): size',
        'Prompt limits input maxLength must be a whole number above 0 (ignoring it): 0',
        'Prompt limits input allowedChars must be a string of characters (ignoring it): 5',
        'Prompt limits input placeholder must be a string (ignoring it): 3',
        'Prompt naming input is missing, which a "text" prompt needs (using "ack")'
    ]));

    // Without an input, it's shown as an ack.
    await dismissCampaignStart(page);
    await expect(dialogTitle(page, 'Missing')).toBeVisible();
    await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
    await expect(dialogTitle(page, 'Missing')).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
});
