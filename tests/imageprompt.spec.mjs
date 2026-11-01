// An "image" prompt lets the player step through a list of images and pick one, which goes in
// a scratch entry, e.g. so the player picks their own agent's picture.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, dialogTitle, dismissCampaignStart} from './helpers.mjs';

const IMAGES = ['agent/BR.jpg', 'agent/CH.jpg', 'agent/DE.jpg'],
    
    // First's setup asks for Alpha's picture, which Alpha's imageExpr reads.
    routePicking = (page, prompt) => Promise.all([
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5');
            json.scratch = {...json.scratch, alpha_photo:'agent/CH.jpg'};
            json.prompts.picking = prompt ?? {
                type:'image',
                title:'Your Photo',
                description:['Who is that?'],
                input:{scratch:'alpha_photo', images:IMAGES},
                buttons:{confirm:{label:'That’s Me', onClick:{adj:{'timeline.score':'10'}}}}
            };
            json.operations.first.onSetup.prompt = 'picking';
            return route.fulfill({json});
        }),
        page.route('**/tests/data/agents.json5', route => {
            const json = readTestData('agents.json5');
            json.agents.AL.imageExpr = '\'../\' + scratch.alpha_photo';
            return route.fulfill({json});
        })
    ]),
    
    // The image showing, from the images folder, and the count under it.
    readShowing = page => page.evaluate(() => {
        const dialog = document.querySelector('.myt-ImageSelectorDialog')?.model;
        return {
            image:dialog?._image.imageUrl.replace(tc.cfg.IMAGE_BASE_DIR, '') ?? null,
            count:dialog?._countTxt.text ?? null
        };
    }),
    clickStep = (page, name) => page.locator('.myt-ImageSelectorDialog').getByRole('button', {name, exact:true}).click();

test('an image prompt starts on its scratch entry\'s image, steps either way around the list, and puts the one showing in the entry', async ({page}) => {
    await routePicking(page);
    const problems = await startGame(page, {dismissBrief:false});
    await dismissCampaignStart(page);
    await expect(dialogTitle(page, 'Your Photo')).toBeVisible();
    await expect(page.getByText('Who is that?', {exact:true})).toBeVisible();
    
    expect(await readShowing(page)).toEqual({image:'agent/CH.jpg', count:'2 / 3'});
    await clickStep(page, '❯');
    expect(await readShowing(page)).toEqual({image:'agent/DE.jpg', count:'3 / 3'});
    
    // Past the last is the first, and before the first the last.
    await clickStep(page, '❯');
    expect(await readShowing(page)).toEqual({image:'agent/BR.jpg', count:'1 / 3'});
    await clickStep(page, '❮');
    expect(await readShowing(page)).toEqual({image:'agent/DE.jpg', count:'3 / 3'});
    
    // The arrow keys step too.
    await page.keyboard.press('ArrowLeft');
    expect(await readShowing(page)).toEqual({image:'agent/CH.jpg', count:'2 / 3'});
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await readShowing(page)).toEqual({image:'agent/BR.jpg', count:'1 / 3'});
    
    // Confirming puts it in the scratch entry, which Alpha's picture reads, then applies the
    // button's changes.
    const scoreBefore = await page.evaluate(() => tc.model.getScore());
    await page.getByRole('button', {name:'That’s Me', exact:true}).filter({visible:true}).click();
    await expect(dialogTitle(page, 'Your Photo')).toHaveCount(0);
    expect(await page.evaluate(() => ({
        scratch:tc.model.scratch.alpha_photo,
        image:tc.model.getAgentModel('AL').getImageUrl().replace(tc.cfg.IMAGE_BASE_DIR, '')
    }))).toEqual({scratch:'agent/BR.jpg', image:'agent/../agent/BR.jpg'});
    expect(await page.evaluate(() => tc.model.getScore())).toBe(scoreBefore + 10);
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an image prompt starts on the first image when its entry isn\'t one of them, and problems with its input are warned about', async ({page}) => {
    await Promise.all([
        routePicking(page, {
            type:'image', title:'Your Photo', description:['Who is that?'],
            input:{scratch:'alpha_photo', images:['agent/DE.jpg', 5, '', 'agent/EC.jpg'], size:3}
        }),
        page.route('**/tests/data/init.json5', route => {
            const json = readTestData('init.json5');
            json.prompts = {...json.prompts, noImages:{type:'image', title:'None', input:{scratch:'alpha_photo', images:[]}}};
            return route.fulfill({json});
        })
    ]);
    const problems = await startGame(page, {dismissBrief:false});
    expect(problems.warnings).toEqual(expect.arrayContaining([
        'Prompt picking input has keys other than scratch, images (ignoring them): size',
        'Prompt picking input images must be paths to images, from the images folder (ignoring it): 5',
        'Prompt picking input images must be paths to images, from the images folder (ignoring it): ',
        'Prompt noImages input images must be an array of paths to images, from the images folder (using "ack"): []'
    ]));
    
    await dismissCampaignStart(page);
    await expect(dialogTitle(page, 'Your Photo')).toBeVisible();
    expect(await readShowing(page)).toEqual({image:'agent/DE.jpg', count:'1 / 2'});
    expect(problems.pageErrors).toEqual([]);
});
