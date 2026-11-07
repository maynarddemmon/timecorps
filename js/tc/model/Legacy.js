(pkg => {
    'use strict';
    
    // From init.json5's "legacy", once read. null until then, or if it's unusable, which
    // turns the whole thing off.
    let cfg = null,
        
        // Losses in the game in progress, not yet in storage, as {devoured, died, haunted}. 
        // They're stored when the game is saved, or abandoned for a new one, so reloading 
        // the page back to an earlier save, or to a new game, doesn't keep them, and a loss 
        // can't be had again and again for the advantages. See commit.
        pending = null;
    
    const {min:mathMin, max:mathMax} = Math,
        
        {isPlainObject} = pkg,
        
        // Kept apart from the save, so it outlasts every game.
        STORAGE_KEY = 'tc.legacy',
        
        DATA_KEY = 'legacy',
        
        // How a player-controlled agent can be lost: to chronovores, or to their wounds.
        LOSS_DEVOURED = 'devoured',
        LOSS_DIED = 'died',
        LOSS_KINDS = [LOSS_DEVOURED, LOSS_DIED],
        
        // Adjustment keys a loss can give the legacy agent.
        SKILL_KEY_PREFIX = 'agent.skills.',
        
        /*  Reads the legacy config, e.g. {"agent":"ME", "devoured":{"agent.skills.luck":1}, 
            "hauntings":["…"]}, into {agentId, amounts:{devoured:[[skillId, amount], …], 
            died:[…]}, hauntings:[…]}, warning about its problems. null if it has no agent. */
        readCfg = json => {
            const where = DATA_KEY;
            if (!isPlainObject(json)) {
                console.warn(where, 'must be an object, e.g. {"agent":"ME", "devoured":{"agent.skills.causalStability":3}} (ignoring it):', json);
                return null;
            }
            const {agent:agentId, hauntings=[], ...rest} = json,
                amounts = {};
            if (typeof agentId !== 'string' || agentId === '') {
                console.warn(where, 'agent must name the agent the losses help (ignoring it all):', agentId);
                return null;
            }
            for (const kind of LOSS_KINDS) {
                const kindCfg = rest[kind] ?? {};
                delete rest[kind];
                amounts[kind] = [];
                if (!isPlainObject(kindCfg)) {
                    console.warn(where, kind, 'must be an object of amounts by skill, e.g. {"agent.skills.luck":1} (ignoring it):', kindCfg);
                    continue;
                }
                for (const key in kindCfg) {
                    const amount = kindCfg[key];
                    if (!key.startsWith(SKILL_KEY_PREFIX)) {
                        console.warn(where, kind, key, 'must be a skill, e.g. "agent.skills.luck" (ignoring it)');
                    } else if (!Number.isFinite(amount)) {
                        console.warn(where, kind, key, 'must be a number (ignoring it):', amount);
                    } else {
                        amounts[kind].push([key.slice(SKILL_KEY_PREFIX.length), amount]);
                    }
                }
            }
            if (Object.keys(rest).length > 0) console.warn(where, 'has unknown keys', Object.keys(rest).join(', '), '(ignoring them)');
            
            let cleanHauntings = [];
            if (Array.isArray(hauntings)) {
                cleanHauntings = hauntings.filter(phrase => {
                    if (typeof phrase === 'string' && phrase.trim() !== '') return true;
                    console.warn(where, 'hauntings must be non-empty strings (ignoring it):', phrase);
                    return false;
                });
            } else {
                console.warn(where, 'hauntings must be an array of phrases (ignoring it):', hauntings);
            }
            return {agentId, amounts, hauntings:cleanHauntings};
        },
        
        makeEmptyRecord = () => ({[LOSS_DEVOURED]:0, [LOSS_DIED]:0, haunted:{}}),
        
        /*  A record as {devoured, died, haunted:{eventId:phraseIdx}}, with anything unusable 
            in it taken as nothing accrued. */
        toRecord = record => {
            return {
                [LOSS_DEVOURED]:Number.isInteger(record?.[LOSS_DEVOURED]) ? record[LOSS_DEVOURED] : 0,
                [LOSS_DIED]:Number.isInteger(record?.[LOSS_DIED]) ? record[LOSS_DIED] : 0,
                haunted:isPlainObject(record?.haunted) ? record.haunted : {}
            };
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
                for (const kind of LOSS_KINDS) record[kind] += pending[kind];
                record.haunted = {...pending.haunted, ...record.haunted};
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
        
        /*  A phrase for an Event, the same each time for the same Event and losses so far, 
            but varied between Events. No dice, so a loss never uses up a roll. */
        pickHauntingIdx = (eventId, lossCount) => {
            let hash = lossCount;
            for (const char of eventId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
            return hash % cfg.hauntings.length;
        },
        
        /*  The total each skill gains from what's accrued, as [[skillId, amount], …], leaving
            out any that add up to nothing. */
        getBonuses = record => {
            const totals = new Map();
            for (const kind of LOSS_KINDS) {
                for (const [skillId, amount] of cfg.amounts[kind]) totals.set(skillId, (totals.get(skillId) ?? 0) + record[kind] * amount);
            }
            return [...totals].filter(([, amount]) => amount !== 0);
        };
    
    /*  The first roguelike thread: what carries from one game to the next. Each player-
        controlled agent lost, devoured by chronovores or dead of their wounds, gives the 
        legacy agent (init.json5's "legacy" "agent", e.g. ME) a little more of some skills at
        the start of every new game, and leaves the Event they were lost at haunted, with a 
        line under its description, in every game. It's kept in its own storage key, apart 
        from any save, until the player clears it. Without a "legacy" in the data, none of
        it happens. */
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
                pending.haunted[eventId] = pickHauntingIdx(eventId, record[LOSS_DEVOURED] + record[LOSS_DIED] + 1);
            }
        },
        
        /*  Stores the pending losses, as the game is saved or abandoned for a new one. */
        commit: () => {
            if (!pending) return;
            writeRecord(readRecord());
            pending = null;
        },
        
        /*  Gives the legacy agent what's accrued, as a new game starts. Skills stay in the 
            skill range. */
        applyToNewGame: () => {
            if (!cfg) return;
            const agentModel = pkg.model.getAgentModel(cfg.agentId);
            if (!agentModel) {
                console.warn(DATA_KEY, 'agent', cfg.agentId, 'names no agent (giving no advantages)');
                return;
            }
            const bonuses = getBonuses(readRecord());
            if (bonuses.length === 0) return;
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
        
        /*  The line under an Event's description if an agent was lost there, in any game, or
            ''. */
        getHaunting: eventId => {
            if (!cfg || cfg.hauntings.length === 0) return '';
            const idx = readRecord().haunted[eventId];
            return idx === undefined ? '' : cfg.hauntings[idx % cfg.hauntings.length];
        },
        
        /*  What's accrued, for showing: {devoured, died, hauntedCount, agentModel, bonuses:
            [[skillId, amount], …]}. */
        getSummary: () => {
            const record = readRecord();
            return {
                devoured:record[LOSS_DEVOURED],
                died:record[LOSS_DIED],
                hauntedCount:Object.keys(record.haunted).length,
                agentModel:cfg ? pkg.model.getAgentModel(cfg.agentId) : undefined,
                bonuses:cfg ? getBonuses(record) : []
            };
        },
        
        /*  What's accrued so far, stored or pending, for an exported save: 
            {devoured, died, haunted:{eventId:phraseIdx}}. */
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
        
        LOSS_DEVOURED,
        LOSS_DIED
    };
})(tc);
