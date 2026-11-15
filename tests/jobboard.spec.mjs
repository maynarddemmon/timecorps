// Job boards: each Faction's "jobBoard" names a scratch entry holding the mission on offer at
// its HQ, picked at random from the Operations with a true "job" when a player-controlled
// member arrives there. The HQ's board action reveals it with "operations[scratch.<name>]",
// which takes it off the board until the next arrival.
import {test, expect} from '@playwright/test';
import {startGame, readTestData, reloadGame} from './helpers.mjs';

const boardAction = scratchName => ({
        label:'Check the Job Board',
        skillCheck:{difficulty:'no-roll'},
        shown:`scratch.${scratchName} !== ''`,
        costs:{'agent.action':null},
        set:{[`operations[scratch.${scratchName}].hidden`]:'false'}
    }),

    /*  Gives the Time Corps a job board at HQ, and a Syndicate with its HQ (and board) at
        boats. second is a job for anyone, third only for the Syndicate. */
    routeJobBoards = async (page, {jobs={second:'true', third:'agent.faction === \'syndicate\''}} = {}) => {
        await page.route('**/tests/data/init.json5', route => {
            const json = readTestData('init.json5');
            json.factions.timecorps.jobBoard = 'job_timecorps';
            json.factions.syndicate = {label:'The Syndicate', hq:'boats', jobBoard:'job_syndicate', description:'Rivals.'};
            json.scratch = {...json.scratch, job_timecorps:'', job_syndicate:''};
            json.events.time_corps_hq.actions.jobBoard = boardAction('job_timecorps');
            return route.fulfill({json});
        });
        await page.route('**/tests/data/test_scenario.json5', route => {
            const json = readTestData('test_scenario.json5');
            json.events.boats.actions = {...json.events.boats.actions, jobBoard:boardAction('job_syndicate')};
            return route.fulfill({json});
        });
        await page.route('**/tests/data/test_operations.json5', route => {
            const json = readTestData('test_operations.json5');
            for (const [id, job] of Object.entries(jobs)) json.operations[id].job = job;
            return route.fulfill({json});
        });
    },

    readBoards = page => page.evaluate(() => ({timecorps:tc.model.scratch.job_timecorps, syndicate:tc.model.scratch.job_syndicate})),

    /*  Moves an agent to an Event, as an arrival. */
    arrive = (page, agentId, eventId) => page.evaluate(([agentId, eventId]) => tc.model.getAgentModel(agentId).setEvent(eventId), [agentId, eventId]),

    /*  Whether the board action at an Event is shown to an agent there. */
    isBoardShown = (page, agentId, eventId) => page.evaluate(([agentId, eventId]) => {
        const action = tc.model.getEventModel(eventId).getActionModels().jobBoard;
        return !action.isHiddenFor(tc.model.getAgentModel(agentId));
    }, [agentId, eventId]),

    useBoard = (page, agentId, eventId) => page.evaluate(([agentId, eventId]) => {
        const agent = tc.model.getAgentModel(agentId);
        agent.doAction(tc.model.getEventModel(eventId).getActionModels().jobBoard);
    }, [agentId, eventId]);

test('arriving at HQ puts a job on the board, which reveals the mission once and comes back on the next arrival', async ({page}) => {
    await routeJobBoards(page);
    const problems = await startGame(page);

    // Nothing is picked as the game starts, even with Bravo at HQ.
    expect(await readBoards(page)).toEqual({timecorps:'', syndicate:''});
    expect(await isBoardShown(page, 'BR', 'time_corps_hq')).toBe(false);

    // Alpha arrives: only second is a job for the Time Corps.
    await arrive(page, 'AL', 'time_corps_hq');
    expect(await readBoards(page)).toEqual({timecorps:'second', syndicate:''});
    expect(await isBoardShown(page, 'AL', 'time_corps_hq')).toBe(true);

    // Taking it reveals the mission and offers its brief, and empties the board.
    await useBoard(page, 'AL', 'time_corps_hq');
    expect(await page.evaluate(() => tc.model.getOperationModel('second').getState())).toBe('available');
    expect(await readBoards(page)).toEqual({timecorps:'', syndicate:''});
    expect(await isBoardShown(page, 'AL', 'time_corps_hq')).toBe(false);

    // Back again, nothing's left for the Corps.
    await arrive(page, 'AL', 'origin');
    await arrive(page, 'AL', 'time_corps_hq');
    expect(await readBoards(page)).toEqual({timecorps:'', syndicate:''});

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('the job is picked at random among those whose job is true for the agent, and is saved', async ({page}) => {
    await routeJobBoards(page, {jobs:{second:'true', third:'true'}});
    const problems = await startGame(page);

    await page.evaluate(() => tc.rng.queueRolls(1));
    await arrive(page, 'AL', 'time_corps_hq');
    expect((await readBoards(page)).timecorps).toBe('third');

    // A new arrival picks again. (Going back to origin rolls for its paradox first.)
    await arrive(page, 'AL', 'origin');
    await page.evaluate(() => tc.rng.queueRolls(0));
    await arrive(page, 'AL', 'time_corps_hq');
    expect((await readBoards(page)).timecorps).toBe('second');

    // Saved: a reload doesn't pick again.
    await page.evaluate(() => tc.getPersistenceManager().save());
    await reloadGame(page);
    expect((await readBoards(page)).timecorps).toBe('second');

    // An agent who isn't player-controlled arriving changes nothing.
    await page.evaluate(() => {
        tc.model.getAgentModel('BR').setFaction('timecorps');
        tc.rng.queueRolls(1);
    });
    await arrive(page, 'BR', 'origin');
    await arrive(page, 'BR', 'time_corps_hq');
    expect((await readBoards(page)).timecorps).toBe('second');

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('each Faction has its own board, with only its jobs, and a job on one board isn\'t offered at the other', async ({page}) => {
    await routeJobBoards(page, {jobs:{second:'true', third:'agent.faction === \'syndicate\''}});
    const problems = await startGame(page);
    await page.evaluate(() => {
        const bravo = tc.model.getAgentModel('BR');
        bravo.setFaction('syndicate');
        bravo.setPlayerControlled(true);
    });

    // The Syndicate's board gets second, the first of its two.
    await page.evaluate(() => tc.rng.queueRolls(0));
    await arrive(page, 'BR', 'boats');
    expect(await readBoards(page)).toEqual({timecorps:'', syndicate:'second'});

    // So the Corps' board can't have second, and third isn't a Corps job.
    await arrive(page, 'AL', 'time_corps_hq');
    expect(await readBoards(page)).toEqual({timecorps:'', syndicate:'second'});

    // Taken at the Syndicate's HQ, the Corps' board is untouched.
    await useBoard(page, 'BR', 'boats');
    expect(await page.evaluate(() => tc.model.getOperationModel('second').revealed)).toBe(true);
    expect(await readBoards(page)).toEqual({timecorps:'', syndicate:''});

    // A mission revealed some other way comes off any board it's on. (Back at boats, Bravo
    // rolls for its paradox before the pick, so every roll is 0.)
    await arrive(page, 'BR', 'origin');
    await page.evaluate(() => tc.rng.queueRolls(...Array(20).fill(0)));
    await arrive(page, 'BR', 'boats');
    await page.evaluate(() => tc.rng.clearQueuedRolls());
    expect((await readBoards(page)).syndicate).toBe('third');
    await page.evaluate(() => tc.model.getOperationModel('third').offer());
    expect((await readBoards(page)).syndicate).toBe('');

    expect(problems.warnings).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
});

test('warns about a jobBoard naming no scratch entry, a non-string job, and a board key whose entry is empty', async ({page}) => {
    await page.route('**/tests/data/init.json5', route => {
        const json = readTestData('init.json5');
        json.factions.timecorps.jobBoard = 'job_nowhere';
        json.events.time_corps_hq.actions.jobBoard = {
            label:'Check the Job Board',
            skillCheck:{difficulty:'no-roll'},
            costs:{'agent.action':null},
            set:{'operations[scratch.plan_noteCount].hidden':'false', 'operations[scratch.plan_noteCount].name':'false'}
        };
        return route.fulfill({json});
    });
    await page.route('**/tests/data/test_operations.json5', route => {
        const json = readTestData('test_operations.json5');
        json.operations.second.job = true;
        return route.fulfill({json});
    });
    const problems = await startGame(page);

    expect(problems.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('Faction timecorps jobBoard names no scratch entry: job_nowhere'),
        expect.stringContaining('Operation second job must be a check expression string (ignoring it): true'),
        expect.stringContaining('operations[scratch.plan_noteCount].name names nothing of an Operation that can be set, only hidden or shown (ignoring it)')
    ]));

    // plan_noteCount is 0, which names no Operation.
    await page.evaluate(() => {
        const bravo = tc.model.getAgentModel('BR');
        bravo.doAction(tc.model.getEventModel('time_corps_hq').getActionModels().jobBoard);
    });
    await expect.poll(() => problems.warnings.some(text => text.includes('scratch.plan_noteCount names no Operation to set operations[scratch.plan_noteCount].hidden of'))).toBe(true);

    expect(problems.pageErrors).toEqual([]);
});
