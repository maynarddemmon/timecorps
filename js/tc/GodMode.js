(pkg => {
    'use strict';

    /*  Testing aids for the browser console, as tc.GODMODE: inspect the game with the same
        expressions the data uses, and change it with the same keys as the data's "set" and
        "adj" blocks. For example:
            tc.GODMODE.dump('agents.AL')                    // Alpha, as a plain object.
            tc.GODMODE.dump('events.marathon.values')       // An Event's Values.
            tc.GODMODE.dump('agent.skills.stealth')         // The selected agent's skill.
            tc.GODMODE.set('agents.AL.health', 10)          // Within the stat's limits.
            tc.GODMODE.set('events.marathon_council.values.forBattle', true)
            tc.GODMODE.set('scratch.job_timecorps', 'salamis_fight')
            tc.GODMODE.set('agents.AL.event', 'aftermath')  // Moves Alpha there.
            tc.GODMODE.set('operations.salamis_fight.hidden', false)
            tc.GODMODE.adj('player.chronal', 5)
            tc.GODMODE.adj('event.attestation', '10 + d(6)') // An expression, worked out once.
        "agent" and "event" are the selected agent and Event, or the ones named in a last
        argument, e.g. {agent:'AL', event:'origin'}. "player" is the player agent.

        A change goes through the game's own rules, as an action's would: stats stay within
        their limits, and reaching one triggers what it always does, e.g. an agent devoured
        at the paradox limit. set and adj return the target as dump shows it afterwards.
        Problems warn on the console, as they do for the data. */

    const isPlainObject = myt.isObject ?? (v => v != null && typeof v === 'object' && !Array.isArray(v)),

        MAX_DEPTH = 4,

        /*  The selected agent and Event, unless named in opts by ID. */
        getContext = (opts={}) => {
            const rootModel = pkg.model,
                app = pkg.app;
            return {
                agentModel:opts.agent != null ? rootModel.getAgentModel(opts.agent) : app?.getEventDetailsView()?.selectedAgentModel ?? null,
                eventModel:opts.event != null ? rootModel.getEventModel(opts.event) : app?.getTimelineView()?.getSelectedEventBox()?.model ?? null
            };
        },

        klassName = obj => obj?.klass?.__displayName,

        /*  A stat as {value, min, max}. */
        statToPlain = stat => ({value:stat.value, min:stat.getMin(), max:stat.getMax()}),

        /*  The game's objects as plain data, deep enough to read: models summarized by what
            matters for testing, collections by ID. */
        toPlain = (thing, depth=0) => {
            if (thing == null || typeof thing !== 'object') return thing;
            if (depth > MAX_DEPTH) return '…';

            const name = klassName(thing);
            if (thing instanceof pkg.NumericStatModel) return statToPlain(thing);
            if (name === 'EventValueModel') return thing.value;
            if (thing instanceof pkg.AgentModel) {
                return {
                    id:thing.id, name:thing.name, faction:thing.getFaction(), role:thing.getRole(),
                    event:thing.event, hidden:thing.hidden, playerControlled:thing.isPlayerControlled(),
                    dead:thing.isDead(), devoured:thing.isDevoured(),
                    health:statToPlain(thing.health), chronal:statToPlain(thing.chronal), paradox:statToPlain(thing.paradox),
                    age:thing.getAge(), effectiveAge:thing.getEffectiveAge(), actionsRemaining:thing.getActionsRemaining(),
                    skills:{...thing.getSkills()}
                };
            }
            if (thing instanceof pkg.EventModel) {
                const values = {};
                for (const [id, valueModel] of Object.entries(thing.getValueModels() ?? {})) values[id] = valueModel.value;
                return {
                    id:thing.id, name:thing.name, location:thing.getLocation(),
                    start:new Date(thing.getStart()).toISOString(), end:new Date(thing.getEnd()).toISOString(),
                    hidden:thing.hidden, chronoLocked:!!thing.chronoLocked, hub:!!thing.hub, flooded:thing.isFlooded(),
                    historicity:statToPlain(thing.historicity), attestation:statToPlain(thing.attestation),
                    paradox:statToPlain(thing.paradox), chronal:statToPlain(thing.chronal),
                    values,
                    actions:Object.keys(thing.getActionModels()),
                    exits:thing.getExitModels().map(exitModel => exitModel.to),
                    agents:thing.getAgentModels().map(agentModel => agentModel.id)
                };
            }
            if (thing instanceof pkg.OperationModel) {
                return {
                    id:thing.id, name:thing.name, state:thing.getState(), hidden:thing.hidden, revealed:!!thing.revealed,
                    objectives:Object.fromEntries(thing.getObjectiveModelsAsList().map(objectiveModel => [objectiveModel.id, objectiveModel.isSuccess?.()]))
                };
            }
            if (Array.isArray(thing)) return thing.map(item => toPlain(item, depth + 1));
            if (thing === pkg.model) return {score:thing.score, credits:thing.credits, paradox:statToPlain(thing.paradox)};

            // Anything else, e.g. a collection by ID or the scratch: its own enumerable
            // entries, skipping functions and myt's bookkeeping (inited, and private "_" ones).
            const retval = {};
            for (const key of Object.keys(thing)) {
                const v = thing[key];
                if (typeof v !== 'function' && key !== 'inited' && !key.startsWith('_')) retval[key] = toPlain(v, depth + 1);
            }
            return retval;
        },

        /*  Reads a set or adj block of one entry, as the data's own blocks are read, and
            applies it as a success. Returns false if it was refused (it warns why). */
        apply = (block, key, expr, opts) => {
            const where = 'GODMODE ' + block,
                changes = pkg.readSuccessChanges(where, {[block]:{[key]:{onSuccess:expr}}}, 'GODMODE'),
                entries = changes[block];
            if (Object.keys(entries).length === 0) return false;

            const {agentModel, eventModel} = getContext(opts);
            if (block === 'set') {
                pkg.applySetEntries(entries, agentModel, eventModel, true, {agent:agentModel, event:eventModel});
            } else {
                pkg.applyAdjEntries(entries, agentModel, eventModel, true, {agent:agentModel, event:eventModel});
            }
            return true;
        },

        /*  A value as an expression that gives it: numbers and booleans as they are, strings
            quoted. */
        toLiteral = value => JSON.stringify(value),

        GODMODE = pkg.GODMODE = {
            /*  Evaluates an expression, as the data's check expressions are, and returns the
                result as plain data, e.g. dump('events.origin'). Any dice in it are rolled. */
            dump: (expr, opts) => {
                const {agentModel, eventModel} = getContext(opts),
                    result = pkg.checks.rollValue(expr, {agent:agentModel, event:eventModel});
                return toPlain(result);
            },

            /*  Sets what a "set" key names to a value: a number, boolean or string, e.g.
                set('events.origin.values.struck', false). Returns it afterwards, as dump does. */
            set: (key, value, opts) => {
                if (!apply('set', key, toLiteral(value), opts)) return;
                return GODMODE.peek(key, opts);
            },

            /*  Sets what a "set" key names to what an expression works out to, once, e.g.
                setExpr('agents.AL.health', 'agents.AL.health.max'). */
            setExpr: (key, expr, opts) => {
                if (!apply('set', key, String(expr), opts)) return;
                return GODMODE.peek(key, opts);
            },

            /*  Adds an amount, or what an expression works out to, to what an "adj" key names,
                e.g. adj('timeline.credits', 100). Returns it afterwards, as dump does. */
            adj: (key, amount, opts) => {
                if (!apply('adj', key, String(amount), opts)) return;
                return GODMODE.peek(key, opts);
            },

            /*  What a set or adj key names, as dump shows it, or undefined if no expression
                can name it, e.g. operations' hidden. Used by set and adj to show the result. */
            peek: (key, opts) => {
                const {agentModel, eventModel} = getContext(opts);
                if (key.includes('[')) return; // e.g. "operations[scratch.x].hidden"
                try {
                    return toPlain(pkg.checks.rollValue(key, {agent:agentModel, event:eventModel}));
                } catch {
                    return;
                }
            },

            /*  A reminder of what's here. */
            help: () => {
                console.log([
                    'tc.GODMODE.dump(expr, {agent, event})       e.g. dump("agents.AL"), dump("event.values")',
                    'tc.GODMODE.set(key, value, {agent, event})  e.g. set("events.origin.values.struck", false)',
                    'tc.GODMODE.setExpr(key, expr, {agent, event})',
                    'tc.GODMODE.adj(key, amount, {agent, event}) e.g. adj("player.chronal", 5)',
                    'Keys are the data\'s set/adj keys. "agent" and "event" are the selected ones unless named.'
                ].join('\n'));
            }
        };

    // Not used for anything else: keeps isPlainObject from looking unused if myt lacks it.
    void isPlainObject;
})(tc);
