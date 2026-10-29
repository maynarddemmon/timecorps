// Images: every event, location and agent shows <folder>/<id>.jpg, a mission only with 
// "image":true, unless its "image" names another .jpg from its folder. An "imageExpr" can 
// name one too, which is shown while it works out to a non-empty string, so a picture can 
// follow the game.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, setCausator} from './helpers.mjs';

// Every expression here follows whether the plan is prepared, which it isn't at the start.
const PREPARED = 'events.plan.values.prepared.value',
    
    routeImages = page => Promise.all([
        page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5');
            delete json.events.origin.image;
            json.events.origin.imageExpr = PREPARED + ' ? \'../location/port.jpg\' : \'\'';
            json.locations.deck.imageExpr = PREPARED + ' ? \'yard.jpg\' : \'\'';
            return route.fulfill({json});
        }),
        page.route('**/tests/data/agents.json5', route => {
            const json = readTestData('agents.json5');
            json.agents.BR.imageExpr = PREPARED + ' ? \'CH.jpg\' : \'\'';
            return route.fulfill({json});
        }),
        page.route('**/tests/data/operations.json5', route => {
            const json = readTestData('operations.json5');
            json.operations.first.imageExpr = PREPARED + ' ? \'second.jpg\' : \'\'';
            delete json.operations.third.image;
            return route.fulfill({json});
        })
    ]),
    
    // The file each view shows, as "<folder>/<file>". The brief is whichever is open.
    readShown = page => page.evaluate(() => {
        const timeline = tc.app.getTimelineView(),
            shown = url => url ? url.split('/').slice(-2).join('/') : null,
            openBrief = [...document.querySelectorAll('.myt-EventBrief, .myt-AgentDossier, .myt-MissionBrief')].find(elem => elem.model.visible)?.model;
        return {
            eventBox:shown(timeline.getEventBox('origin')._media.getImageView().imageUrl),
            locationColumn:shown(timeline.colsByLocId.deck._photo.imageUrl),
            agent:shown(tc.model.getAgentModel('BR').getImageUrl()),
            mission:shown(tc.model.getOperationModel('first').getImageUrl()),
            brief:shown(openBrief?.getPhoto().getImageView().imageUrl)
        };
    }),
    
    setPrepared = (page, prepared) => setCausator(page, 'plan', 'prepared', prepared);

test('by default an event, location and agent show <id>.jpg, and a mission with image:true its own', async ({page}) => {
    await routeImages(page);
    const problems = await startGame(page);
    
    await expect.poll(() => readShown(page)).toEqual({
        eventBox:'event/origin.jpg', locationColumn:'location/deck.jpg', agent:'agent/BR.jpg', mission:'mission/first.jpg', brief:null
    });
    // A mission without image:true shows none.
    expect(await page.evaluate(() => tc.model.getOperationModel('third').getImageUrl())).toBeNull();
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an imageExpr changes what\'s shown as the game changes, and back once it works out to \'\'', async ({page}) => {
    await routeImages(page);
    const problems = await startGame(page);
    
    await setPrepared(page, true);
    await expect.poll(() => readShown(page)).toEqual({
        eventBox:'location/port.jpg', locationColumn:'location/yard.jpg', agent:'agent/CH.jpg', mission:'mission/second.jpg', brief:null
    });
    
    await setPrepared(page, false);
    await expect.poll(() => readShown(page)).toEqual({
        eventBox:'event/origin.jpg', locationColumn:'location/deck.jpg', agent:'agent/BR.jpg', mission:'mission/first.jpg', brief:null
    });
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an open brief or dossier follows its imageExpr', async ({page}) => {
    await routeImages(page);
    const problems = await startGame(page);
    
    for (const [open, before, after] of [
        [() => {tc.app.openEventBrief(tc.model.getEventModel('origin'), true);}, 'event/origin.jpg', 'location/port.jpg'],
        [() => {tc.app.openAgentDossier(tc.model.getAgentModel('BR'));}, 'agent/BR.jpg', 'agent/CH.jpg'],
        [() => {tc.app.openMissionBrief(tc.model.getOperationModel('first'));}, 'mission/first.jpg', 'mission/second.jpg']
    ]) {
        await page.evaluate(open);
        await expect.poll(async () => (await readShown(page)).brief).toBe(before);
        await setPrepared(page, true);
        await expect.poll(async () => (await readShown(page)).brief).toBe(after);
        await setPrepared(page, false);
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await readShown(page)).brief).toBeNull();
    }
    
    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('an image that isn\'t a path is warned about', async ({page}) => {
    await page.route('**/tests/data/test_scenario.json5', route => {
        const json = readTestData('test_scenario.json5');
        json.events.plan.image = true;
        json.locations.office.image = 5;
        return route.fulfill({json});
    });
    const problems = await startGame(page);
    
    expect(problems.warnings).toEqual(expect.arrayContaining([
        'event plan image:true isn\'t needed, since it shows plan.jpg by default (ignoring it)',
        'location office image must be a path to a .jpg from its folder (ignoring it): 5'
    ]));
    expect(problems.pageErrors).toEqual([]);
});
