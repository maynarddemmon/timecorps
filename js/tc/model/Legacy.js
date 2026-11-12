(pkg => {
    'use strict';
    
    // From init.json5's "legacy", once read. null until then, or if it's unusable, which
    // turns the whole thing off.
    let cfg = null,
        
        // Losses in the game in progress, and its restart, not yet in storage, as a record 
        // (see toRecord). They're stored when the game is saved, or abandoned for a new one,
        // so reloading the page back to an earlier save, or to a new game, doesn't keep 
        // them, and a loss can't be had again and again for the advantages. See commit.
        pending = null;
    
    const {min:mathMin, max:mathMax, ceil:mathCeil} = Math,
        
        {isPlainObject, hashToRange} = pkg,
        
        // Kept apart from the save, so it outlasts every game.
        STORAGE_KEY = 'tc.legacy',
        
        DATA_KEY = 'legacy',
        
        // How a player-controlled agent can be lost: to chronovores, or to their wounds.
        LOSS_DEVOURED = 'devoured',
        LOSS_DIED = 'died',
        LOSS_KINDS = [LOSS_DEVOURED, LOSS_DIED],
        
        // A game abandoned for a new one, however it was.
        RESTARTED = 'restarted',
        
        // What's counted, each giving its own advantages.
        KINDS = [...LOSS_KINDS, RESTARTED],
        
        // Adjustment keys each can give: a skill of the player agent's, or credits.
        SKILL_KEY_PREFIX = 'agent.skills.',
        CREDITS_KEY = 'timeline.credits',
        
        /*  Reads a list of phrases, e.g. "hauntings", warning about any that aren't. */
        readPhrases = (where, phrases) => {
            if (!Array.isArray(phrases)) {
                console.warn(where, 'must be an array of phrases (ignoring it):', phrases);
                return [];
            }
            return phrases.filter(phrase => {
                if (typeof phrase === 'string' && phrase.trim() !== '') return true;
                console.warn(where, 'must be non-empty strings (ignoring it):', phrase);
                return false;
            });
        },
        
        /*  Reads the legacy config, e.g. {"devoured":{"agent.skills.luck":1}, 
            "restarted":{"timeline.credits":1}, "hauntings":["…"], "glitches":["…"], 
            "paradoxPerChronal":3}, into {amounts:{devoured:{skills:[[skillId, amount], …], 
            credits}, died:…, restarted:…}, hauntings:[…], glitches:[…], paradoxPerChronal}, 
            warning about its problems. paradoxPerChronal is null without one, which leaves no
            pockets. The skills go to the player agent (init.json5's "playerAgent"). null if
            it isn't an object. */
        readCfg = json => {
            const where = DATA_KEY;
            if (!isPlainObject(json)) {
                console.warn(where, 'must be an object, e.g. {"devoured":{"agent.skills.causalStability":3}} (ignoring it):', json);
                return null;
            }
            const {agent:agentId, hauntings=[], glitches=[], paradoxPerChronal=null, ...rest} = json,
                amounts = {};
            if (agentId !== undefined) console.warn(where, 'agent is now init.json5\'s "playerAgent" (ignoring it):', agentId);
            for (const kind of KINDS) {
                const kindCfg = rest[kind] ?? {};
                delete rest[kind];
                amounts[kind] = {skills:[], credits:0};
                if (!isPlainObject(kindCfg)) {
                    console.warn(where, kind, 'must be an object of amounts by skill or credits, e.g. {"agent.skills.luck":1} (ignoring it):', kindCfg);
                    continue;
                }
                for (const key in kindCfg) {
                    const amount = kindCfg[key];
                    if (key !== CREDITS_KEY && !key.startsWith(SKILL_KEY_PREFIX)) {
                        console.warn(where, kind, key, 'must be a skill, e.g. "agent.skills.luck", or "timeline.credits" (ignoring it)');
                    } else if (!Number.isFinite(amount)) {
                        console.warn(where, kind, key, 'must be a number (ignoring it):', amount);
                    } else if (key === CREDITS_KEY) {
                        amounts[kind].credits = amount;
                    } else {
                        amounts[kind].skills.push([key.slice(SKILL_KEY_PREFIX.length), amount]);
                    }
                }
            }
            if (Object.keys(rest).length > 0) console.warn(where, 'has unknown keys', Object.keys(rest).join(', '), '(ignoring them)');
            
            const pocketsOn = paradoxPerChronal === null || (Number.isFinite(paradoxPerChronal) && paradoxPerChronal > 0);
            if (!pocketsOn) console.warn(where, 'paradoxPerChronal must be a positive number, e.g. 3 (leaving no pockets):', paradoxPerChronal);
            
            return {
                amounts, 
                hauntings:readPhrases(where + ' hauntings', hauntings), 
                glitches:readPhrases(where + ' glitches', glitches),
                paradoxPerChronal:pocketsOn ? paradoxPerChronal : null
            };
        },
        
        makeEmptyRecord = () => ({[LOSS_DEVOURED]:0, [LOSS_DIED]:0, [RESTARTED]:0, haunted:{}, glitched:{}, pockets:{}}),
        
        /*  A record as {devoured, died, restarted, haunted:{eventId:phraseIdx}, 
            glitched:{eventId:phraseIdx}, pockets:{eventId:chronal}}, with anything unusable 
            in it taken as nothing accrued. */
        toRecord = record => {
            const result = makeEmptyRecord();
            for (const kind of KINDS) if (Number.isInteger(record?.[kind])) result[kind] = record[kind];
            for (const key of ['haunted', 'glitched']) if (isPlainObject(record?.[key])) result[key] = record[key];
            if (isPlainObject(record?.pockets)) {
                for (const [eventId, chronal] of Object.entries(record.pockets)) {
                    if (Number.isInteger(chronal) && chronal > 0) result.pockets[eventId] = chronal;
                }
            }
            return result;
        },
        
        /*  Changes the pending pocket at an Event by an amount: more chronal, or less as it's 
            harvested. */
        adjPendingPocket = (eventId, amount) => {
            pending ??= makeEmptyRecord();
            pending.pockets[eventId] = (pending.pockets[eventId] ?? 0) + amount;
        },
        
        /*  What's in storage, as toRecord gives it. Empty if nothing is, or storage can't be 
            read. */
        readStoredRecord = () => {
            let record;
            try {
                record = JSON.parse(localStorage.getItem(STORAGE_KEY));
            } catch {
                // Treated as nothing accrued.
            }
            return toRecord(record);
        },
        
        /*  What's accrued so far, stored or pending, as readStoredRecord gives it. */
        readRecord = () => {
            const record = readStoredRecord();
            if (pending) {
                for (const kind of KINDS) record[kind] += pending[kind];
                record.haunted = {...pending.haunted, ...record.haunted};
                record.glitched = {...pending.glitched, ...record.glitched};
                for (const [eventId, amount] of Object.entries(pending.pockets)) {
                    const chronal = (record.pockets[eventId] ?? 0) + amount;
                    if (chronal > 0) {
                        record.pockets[eventId] = chronal;
                    } else {
                        delete record.pockets[eventId];
                    }
                }
            }
            return record;
        },
        
        writeRecord = record => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
            } catch {
                // Lost. It's only an advantage.
            }
        },
        
        /*  A phrase from phrases for an Event, the same each time for the same Event and 
            count so far, but varied between Events. No dice, so it never uses up a roll. */
        pickPhraseIdx = (phrases, eventId, count) => hashToRange([eventId, count], 0, phrases.length - 1),
        
        /*  The phrase an Event got in record[recordKey], or ''. */
        getPhrase = (phrases, recordKey, eventId) => {
            if (!cfg || phrases.length === 0) return '';
            const idx = readRecord()[recordKey][eventId];
            return idx === undefined ? '' : phrases[idx % phrases.length];
        },
        
        /*  The line under an Event's description if an agent was lost there, in any game, or
            ''. */
        getHaunting = eventId => cfg ? getPhrase(cfg.hauntings, 'haunted', eventId) : '',
        
        /*  The line under an Event's description if a game was abandoned with the legacy 
            agent there, alive, in any game, or ''. */
        getGlitch = eventId => cfg ? getPhrase(cfg.glitches, 'glitched', eventId) : '',
        
        /*  The total each skill gains from what's accrued, as [[skillId, amount], …], leaving
            out any that add up to nothing. */
        getBonuses = record => {
            const totals = new Map();
            for (const kind of KINDS) {
                for (const [skillId, amount] of cfg.amounts[kind].skills) totals.set(skillId, (totals.get(skillId) ?? 0) + record[kind] * amount);
            }
            return [...totals].filter(([, amount]) => amount !== 0);
        },
        
        /*  The credits a new game starts with from what's accrued. */
        getCreditsBonus = record => KINDS.reduce((total, kind) => total + record[kind] * cfg.amounts[kind].credits, 0);
    
    /*  The first roguelike thread: what carries from one game to the next. Each player-
        controlled agent lost, devoured by chronovores or dead of their wounds, gives the 
        player agent (init.json5's "playerAgent", e.g. ME) a little more of some skills at
        the start of every new game, and leaves the Event they were lost at haunted, with a 
        line under its description, in every game. Each game abandoned leaves a pocket of 
        chronal at every Event it left with paradox, other than hubs and chrono locked ones,
        which every new game starts holding until it's harvested. It's kept in its own 
        storage key, apart from any save, until the player clears it. Without a "legacy" in
        the data, none of it happens. */
    pkg.legacy = {
        /*  Reads init.json5's "legacy". A later file's replaces an earlier's. */
        readData: json => {
            if (json[DATA_KEY] === undefined) return;
            if (cfg) console.warn(DATA_KEY, 'is given more than once (using the later one)');
            cfg = readCfg(json[DATA_KEY]);
        },
        
        isEnabled: () => !!cfg,
        
        /*  Records a player-controlled agent lost at an Event: LOSS_DEVOURED or LOSS_DIED. 
            Only while a game is being played, not as one's set up or restored. It's pending
            until commit stores it, but counts as accrued from now on. */
        recordLoss: (agentModel, kind, eventId) => {
            if (!cfg || !pkg.isAppReady?.() || !agentModel.isPlayerControlled()) return;
            const record = readRecord();
            pending ??= makeEmptyRecord();
            pending[kind]++;
            const eventModel = pkg.model.getEventModel(eventId);
            if (eventModel?.isNotHub() && cfg.hauntings.length > 0 && record.haunted[eventId] === undefined) {
                pending.haunted[eventId] = pickPhraseIdx(cfg.hauntings, eventId, record[LOSS_DEVOURED] + record[LOSS_DIED] + 1);
            }
        },
        
        /*  Records the game being abandoned for a new one, however it was. If the player 
            agent is still alive and not devoured, the Event they're at, unless a hub, is 
            glitched: as though someone were taken out of it. Every Event left with paradox,
            unless a hub or chrono locked, gets a pocket of chronal, paradoxPerChronal 
            paradox to 1 rounded up, on top of any pocket it still holds. Pending until 
            commit, which should follow. */
        recordRestart: () => {
            if (!cfg) return;
            const record = readRecord();
            pending ??= makeEmptyRecord();
            pending[RESTARTED]++;
            const agentModel = pkg.model.getPlayerAgentModel(),
                eventModel = agentModel?.getEventModel();
            if (agentModel?.isNotDead() && agentModel.isNotDevoured() && eventModel?.isNotHub() && 
                cfg.glitches.length > 0 && record.glitched[eventModel.id] === undefined
            ) {
                pending.glitched[eventModel.id] = pickPhraseIdx(cfg.glitches, eventModel.id, record[RESTARTED] + 1);
            }
            
            const {paradoxPerChronal} = cfg;
            if (paradoxPerChronal) {
                for (const eventModel of pkg.model.getEventModelsAsList()) {
                    const paradox = eventModel.paradox.value;
                    if (paradox > 0 && eventModel.isNotHub() && eventModel.isNotChronoLocked()) {
                        adjPendingPocket(eventModel.id, mathCeil(paradox / paradoxPerChronal));
                    }
                }
            }
        },
        
        /*  Notes an Event's chronal changing. A pocket can be no more than the Event holds, so
            when it holds less, the difference was harvested, and leaves the pocket, pending 
            until commit. Chronal released into an Event and gathered back doesn't touch it. 
            Only while a game is being played, not as one's set up or restored. */
        notifyEventChronalChanged: eventModel => {
            if (!cfg || !pkg.isAppReady?.()) return;
            const pocket = readRecord().pockets[eventModel.id],
                held = eventModel.chronal.value;
            if (pocket > held) adjPendingPocket(eventModel.id, held - pocket);
        },
        
        /*  Stores the pending losses, as the game is saved or abandoned for a new one. */
        commit: () => {
            if (!pending) return;
            writeRecord(readRecord());
            pending = null;
        },
        
        /*  Gives what's accrued as a new game starts: credits, the pockets, each Event's max 
            raised to hold it all if need be, and the player agent skills, which stay in the 
            skill range. */
        applyToNewGame: () => {
            if (!cfg) return;
            const record = readRecord(),
                credits = getCreditsBonus(record);
            if (credits !== 0) pkg.model.setCredits(mathMax(0, pkg.model.getCredits() + credits));
            
            for (const [eventId, pocket] of Object.entries(record.pockets)) {
                // An Event no longer in the data just keeps its pocket.
                const chronal = pkg.model.getEventModel(eventId)?.chronal;
                if (chronal) {
                    const value = chronal.value + pocket;
                    if (value > chronal.getMax()) chronal.setMax(value);
                    chronal.setValue(value);
                }
            }
            
            const bonuses = getBonuses(record);
            if (bonuses.length === 0) return;
            const agentModel = pkg.model.getPlayerAgentModel();
            if (!agentModel) {
                console.warn(DATA_KEY, 'has skills to give, but there\'s no playerAgent to give them to');
                return;
            }
            const skills = {...agentModel.getSkills()},
                {MAX_SKILL_VALUE} = pkg.cfg;
            for (const [skillId, amount] of bonuses) {
                if (pkg.isSkillId(skillId)) {
                    skills[skillId] = mathMax(-MAX_SKILL_VALUE, mathMin(MAX_SKILL_VALUE, (skills[skillId] ?? 0) + amount));
                } else {
                    console.warn(DATA_KEY, 'names no skill', skillId, '(ignoring it)');
                }
            }
            agentModel.setSkills(skills);
        },
        
        getHaunting,
        getGlitch,
        
        /*  What's accrued, for showing: {devoured, died, restarted, hauntedCount, 
            glitchedCount, pocketCount, agentModel, bonuses:[[skillId, amount],
            …], credits}. */
        getSummary: () => {
            const record = readRecord(),
                pockets = Object.values(record.pockets);
            return {
                devoured:record[LOSS_DEVOURED],
                died:record[LOSS_DIED],
                restarted:record[RESTARTED],
                hauntedCount:Object.keys(record.haunted).length,
                glitchedCount:Object.keys(record.glitched).length,
                pocketCount:pockets.length,
                agentModel:cfg ? pkg.model.getPlayerAgentModel() : undefined,
                bonuses:cfg ? getBonuses(record) : [],
                credits:cfg ? getCreditsBonus(record) : 0
            };
        },
        
        /*  What's accrued so far, stored or pending, for an exported save, as toRecord 
            gives it. */
        exportRecord: () => readRecord(),
        
        /*  Replaces everything accrued with an imported save's, from exportRecord, so 
            importing a save takes the legacy back to what it was when that save was 
            exported, and a loss can't be had again and again by importing the same save. */
        importRecord: record => {
            pending = null;
            writeRecord(toRecord(record));
        },
        
        /*  Forgets everything accrued, pending too. The game in progress keeps what it 
            started with. */
        clear: () => {
            pending = null;
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch {
                // Nothing to clear then.
            }
        },
        
        /*  The chronal pocket left at an Event by past games, still to be harvested, or 0. */
        getPocket: eventId => readRecord().pockets[eventId] ?? 0,
        
        LOSS_DEVOURED,
        LOSS_DIED,
        
        getLegacyDescriptionPartsForEventId: eventId => [getHaunting(eventId), getGlitch(eventId)].filter(Boolean)
    };
})(tc);
