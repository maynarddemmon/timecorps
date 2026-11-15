// The high score: kept in its own storage as soon as a game's score beats it, shown in the top
// bar as it's raised, in the End Game Brief and the legacy dialog, and cleared with the legacy.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, dialogTitle, dismissAgentDossier, reloadGame} from './helpers.mjs';

const HIGH_SCORE_KEY = 'tc.highScore',

    // Turns the legacy on, so the ☠ button shows.
    routeLegacy = page => page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.playerAgent = 'AL';
        json.legacy = {died:{'agent.skills.stealth':1}};
        return route.fulfill({json});
    }),

    // A high score from an earlier game, in storage before the page loads.
    seedHighScore = (page, score) => page.addInitScript(([key, score]) => {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({score, previous:null, campaignStart:1}));
    }, [HIGH_SCORE_KEY, score]),

    storedHighScore = page => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.score ?? null, HIGH_SCORE_KEY),

    setScore = (page, score) => page.evaluate(score => tc.model.setScore(score), score),

    // The score in the top bar, e.g. "Score : 40", and whether it's pulsing.
    readTopScore = page => page.evaluate(() => {
        const elem = [...document.querySelectorAll('.myt-LabeledValue')].find(elem => /^(High )?Score : /.test(elem.textContent));
        return {text:elem.textContent, pulsing:elem.classList.contains('highScorePulse')};
    }),

    // Kills Alpha, the only agent, and returns the End Game Brief's metrics as {label:value}.
    readEndGameMetrics = async page => {
        await page.evaluate(() => tc.model.getAgentModel('AL').health.setValue(0));
        await page.getByRole('button', {name:'Acknowledge', exact:true}).filter({visible:true}).click();
        await dismissAgentDossier(page, 'Alpha');
        await expect(page.locator('.myt-EndGameBrief')).toBeVisible();
        return page.evaluate(() => {
            const metrics = {};
            for (const row of document.querySelectorAll('.myt-EndGameBrief .myt-MetricRow')) {
                const [label, value] = [...row.children].map(child => child.textContent);
                metrics[label] = value;
            }
            return metrics;
        });
    };

test('a score beating the high score is stored at once, and the top bar pulses with each rise', async ({page}) => {
    const problems = await startGame(page);
    expect(await storedHighScore(page)).toBeNull();
    expect(await readTopScore(page)).toEqual({text:'Score : 0', pulsing:false});

    await setScore(page, 100);
    expect(await storedHighScore(page)).toBe(100);
    expect(await readTopScore(page)).toEqual({text:'High Score : 100', pulsing:true});

    // Each rise restarts the pulse.
    const animationsStarted = page.evaluate(() => new Promise(resolve => {
        let count = 0;
        document.addEventListener('animationstart', event => {
            if (event.animationName === 'highScorePulse' && ++count === 1) resolve(count);
        });
    }));
    await setScore(page, 250);
    expect(await animationsStarted).toBe(1);
    expect(await storedHighScore(page)).toBe(250);

    // Falling back, it's just the score again, and the high score stands.
    await setScore(page, 200);
    expect(await readTopScore(page)).toMatchObject({text:'Score : 200'});
    expect(await storedHighScore(page)).toBe(250);

    // Reloading back past it doesn't take it back.
    await reloadGame(page, {briefExpected:true});
    expect(await storedHighScore(page)).toBe(250);

    expect(problems.pageErrors).toEqual([]);
});

test('below an earlier game\'s high score, the End Game Brief shows it and the score as a percentage of it', async ({page}) => {
    await seedHighScore(page, 500);
    const problems = await startGame(page);
    await setScore(page, 400);
    expect(await readTopScore(page)).toMatchObject({text:'Score : 400', pulsing:false});
    expect(await storedHighScore(page)).toBe(500);

    expect(await readEndGameMetrics(page)).toMatchObject({
        'Score':'400',
        'High Score':'500',
        'Of Last High Score':'80%'
    });

    expect(problems.pageErrors).toEqual([]);
});

test('a game that beats the high score shows it as new, against the one it beat, even after a reload', async ({page}) => {
    await seedHighScore(page, 500);
    const problems = await startGame(page);
    await setScore(page, 600);
    expect(await readTopScore(page)).toMatchObject({text:'High Score : 600', pulsing:true});

    // Saved and reloaded, the same game still beat 500.
    await page.evaluate(() => tc.getPersistenceManager().save());
    await reloadGame(page);
    expect(await readTopScore(page)).toMatchObject({text:'High Score : 600'});
    await setScore(page, 750);

    expect(await readEndGameMetrics(page)).toMatchObject({
        'Score':'750',
        'High Score':'750 · New',
        'Of Last High Score':'150%'
    });

    expect(problems.pageErrors).toEqual([]);
});

test('a score that has fallen shows its peak in the End Game Brief, which is what the high score keeps', async ({page}) => {
    const problems = await startGame(page);
    await setScore(page, 600);
    await setScore(page, 450);
    
    const metrics = await readEndGameMetrics(page);
    expect(metrics).toMatchObject({'Score':'450', 'Peak Score':'600', 'High Score':'600 · New'});
    expect(Object.keys(metrics).slice(0, 3)).toEqual(['Score', 'Peak Score', 'High Score']);
    
    expect(problems.pageErrors).toEqual([]);
});

test('a score at its peak shows no Peak Score', async ({page}) => {
    const problems = await startGame(page);
    await setScore(page, 300);
    expect(await readEndGameMetrics(page)).not.toHaveProperty('Peak Score');
    
    expect(problems.pageErrors).toEqual([]);
});

test('with no high score yet, the End Game Brief says so', async ({page}) => {
    const problems = await startGame(page);
    const metrics = await readEndGameMetrics(page);
    expect(metrics['High Score']).toBe('None');
    expect(metrics).not.toHaveProperty('Of Last High Score');

    expect(problems.pageErrors).toEqual([]);
});

test('the legacy dialog shows the high score, and clearing the legacy clears it', async ({page}) => {
    await routeLegacy(page);
    await seedHighScore(page, 1234);
    const problems = await startGame(page),
        legacyBtn = page.getByRole('button', {name:'☠', exact:true});

    // A high score alone is something to show, and clear.
    await legacyBtn.click();
    await expect(dialogTitle(page, 'Accrued Advantages')).toBeVisible();
    await expect(page.getByText('of stray chronal. Your high score is 1,234.To clear them, type RESET below.', {exact:false})).toBeVisible();
    await page.getByRole('textbox').filter({visible:true}).fill('RESET');
    await page.getByRole('button', {name:'Clear', exact:true}).filter({visible:true}).click();
    expect(await storedHighScore(page)).toBeNull();

    // Nothing left.
    await legacyBtn.click();
    await expect(page.getByText(/^Nothing has accrued yet\./)).toBeVisible();

    expect(problems.pageErrors).toEqual([]);
});
