(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        {max:mathMax, round:mathRound} = Math,
        
        M = myt,
        BaseModel = M.BaseModel,
        
        {
            NotifyingNumericStatModel, setConstrainedValue, getConstrainedValueCfg,
            timeUtil:{durationToMillis, stringToMillis, format:formatDate, formatCompactRange, formatDuration},
            STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_HEALTH, STAT_ID_CHRONAL, STAT_ID_EFFECTIVE_AGE,
            cfg:{
                EVENT_ID_TIME_CORPS_HQ, EVENT_ID_THE_VOID,
                EVENT_PARADOX_LIMIT, DEFAULT_ACTION_LIMIT, SCORE_PER_ATTESTATION
            },
            ICON_SEPARATOR, ICON_NIL, getStatName,
            SCOPE_AGENT, SCOPE_AGENTS, SCOPE_EVENT, SCOPE_EVENTS, SCOPE_TIMELINE, SCOPE_SKILLS, SCOPE_SCRATCH,
            DIFFICULTY_NO_ROLL, toDifficulty
        } = pkg,
        
        getTravelModePhrase = mode => {
            switch (mode) {
                case 'wait':     return 'Wait til';
                case 'jump':     return 'Jump to';
                case 'pulled':   return 'Pulled to';
                case 'enter':    return 'Enter';
                case 'board':    return 'Board';
                case 'walk':     return 'Walk to';
                case 'swim':     return 'Swim to';
                case 'bike':     return 'Bike to';
                case 'lifeboat': return 'Lifeboat to';
                case 'survive': return 'Survive to';
            }
            return 'To';
        },
        
        ACTION_TYPE_SINGULAR = '', // Empty so data will be stored under the raw prefixes.
        PREFIX_SKILL_DIFF = '_SkDff_',
        PREFIX_SKILL_TYPE = '_SkTyp_',
        PREFIX_SKILL_EXPR = '_SkExp_',
        
        /*  Skill checks for an action, exit or adjustment. Checks are stored by action ID, so a model
            could have one per action it offers. */
        ActionCheckSupport = new JSModule('ActionCheckSupport', {
            /*  Sets the skill check for an action. An actionId of null is the model's own check,
                as for an EventActionModel. cfg is optional and so is each part of it:
                    {difficulty:<integer>, check:<skill expression>, actionType:<skill check id>}
                A part left out comes from the actionType's default skill check. A part that's the
                wrong type is ignored, with a warning. */
            addSkillCheck: function(actionId, cfg) {
                const self = this;
                actionId ??= ACTION_TYPE_SINGULAR;
                
                const diffId = PREFIX_SKILL_DIFF + actionId,
                    typeId = PREFIX_SKILL_TYPE + actionId,
                    exprId = PREFIX_SKILL_EXPR + actionId,
                    owner = self.getSkillCheckOwner(actionId),
                    warn = msg => console.warn(owner, 'skill check', msg + ':', cfg);
                
                self[diffId] = self[typeId] = self[exprId] = undefined;
                if (cfg == null) return;
                if (typeof cfg !== 'object' || Array.isArray(cfg)) {
                    warn('must be an object');
                    return false;
                }
                
                const {difficulty, check, actionType, ...unknown} = cfg;
                
                if (difficulty !== undefined) {
                    if (Number.isInteger(difficulty) || difficulty === DIFFICULTY_NO_ROLL) {
                        self[diffId] = toDifficulty(difficulty);
                    } else {
                        warn('difficulty must be an integer or "' + DIFFICULTY_NO_ROLL + '"');
                    }
                }
                
                if (actionType !== undefined) {
                    if (typeof actionType === 'string' && actionType.trim() !== '') {
                        self[typeId] = actionType;
                    } else {
                        warn('actionType must be a non-empty string');
                    }
                }
                
                if (check !== undefined) {
                    if (typeof check === 'string' && check.trim() !== '') {
                        self[exprId] = check;
                    } else {
                        warn('check must be a non-empty string');
                    }
                }
                
                const unknownKeys = Object.keys(unknown);
                if (unknownKeys.length > 0) warn('has unknown keys ' + unknownKeys.join(', '));
                return true;
            },
            /*  Names the model in warnings about its skill checks. */
            getSkillCheckOwner: function(actionId) {
                return this.event ? 'Event ' + this.event.id + ' action ' + this.id : 'Event ' + this.id + ' ' + actionId;
            },
            getActionSkillDifficulty: function(actionId=ACTION_TYPE_SINGULAR) {
                return this[PREFIX_SKILL_DIFF + actionId] ?? pkg.getSkillDifficulty(this.getActionSkillType(actionId));
            },
            getActionSkillExpr: function(actionId=ACTION_TYPE_SINGULAR) {
                return this[PREFIX_SKILL_EXPR + actionId] ?? pkg.getSkillCheckExpr(this.getActionSkillType(actionId));
            },
            getActionSkillName: function(actionId=ACTION_TYPE_SINGULAR) {
                return pkg.getSkillName(this.getActionSkillType(actionId));
            },
            getActionSkillType: function(actionId=ACTION_TYPE_SINGULAR) {
                return this[PREFIX_SKILL_TYPE + actionId] ?? actionId;
            }
        }),
        
        // What set, but not adj, can change about an agent: the Event they're at and the
        // Faction they're in, e.g. "agents.ME.faction".
        SET_ONLY_AGENT_KEYS = [SCOPE_EVENT, 'faction'],
        
        // The timeline's score and credits, which set and adj can change like stats.
        STAT_ID_SCORE = 'score',
        STAT_ID_CREDITS = 'credits',
        
        /*  The stats set and adj can change, by the scope that has them: the agent taking the 
            action or exit, any agent by ID ("agents.<id>.<stat>"), its Event, any Event by ID 
            ("events.<id>.<stat>"), or the timeline. */
        ADJUSTMENT_STAT_IDS = pkg.ADJUSTMENT_STAT_IDS = {
            [SCOPE_AGENT]:[STAT_ID_HEALTH, STAT_ID_CHRONAL, STAT_ID_PARADOX, STAT_ID_EFFECTIVE_AGE],
            [SCOPE_AGENTS]:[STAT_ID_HEALTH, STAT_ID_CHRONAL, STAT_ID_PARADOX, STAT_ID_EFFECTIVE_AGE],
            [SCOPE_EVENT]:[STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION],
            [SCOPE_EVENTS]:[STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION],
            [SCOPE_TIMELINE]:[STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_SCORE, STAT_ID_CREDITS]
        },
        
        /*  What a parsed key changes, as something stat-like: {value, getAllowedAdj(adj), 
            adjValue(adj)}. A stat is its NumericStatModel. Score and credits can't go below 0.
            A Value or scratch entry has no limits, but only changes while it's a number; 
            otherwise nothing is allowed and a warning names it. Undefined when there's nothing 
            to change, e.g. no such Event or Value. eventModel is the action's or exit's own 
            Event, and agentModel the agent taking it, for keys that don't name one. */
        getChangeTarget = (parsed, agentModel, eventModel) => {
            if (parsed.agentId !== undefined) {
                agentModel = pkg.model.getAgentModel(parsed.agentId);
                if (!agentModel) {
                    console.warn('No agent', parsed.agentId, 'to change');
                    return;
                }
            }
            if (parsed.eventId !== undefined) {
                eventModel = pkg.model.getEventModel(parsed.eventId);
                if (!eventModel) {
                    console.warn('No Event', parsed.eventId, 'to change');
                    return;
                }
            }
            const rootModel = pkg.model,
                atLeastZero = (getValue, adjValue) => ({
                    get value() {return getValue();},
                    getAllowedAdj: adj => ({adj:mathMax(adj, -getValue())}),
                    adjValue: adj => {
                        if (adj !== 0) adjValue(adj);
                    }
                }),
                numericOnly = (getValue, setValue, what) => ({
                get value() {return getValue();},
                getAllowedAdj: adj => {
                    if (Number.isFinite(getValue())) return {adj};
                    console.warn(what, 'is not a number, so adj can\'t change it:', getValue());
                    return {adj:0};
                },
                adjValue: adj => {
                    if (adj !== 0) setValue(getValue() + adj);
                }
            });
            switch (parsed.kind) {
                case 'stat':
                    switch (parsed.scopeName) {
                        case SCOPE_AGENT:
                        case SCOPE_AGENTS:
                            // In whole years. Treatments wind it back, but not below the minimum.
                            if (parsed.statId === STAT_ID_EFFECTIVE_AGE) return agentModel && {
                                get value() {return agentModel.getEffectiveAge();},
                                getAllowedAdj: adj => ({adj:agentModel.getAllowedEffectiveAgeAdj(adj)}),
                                adjValue: adj => {
                                    if (adj !== 0) agentModel.adjEffectiveAge(adj);
                                }
                            };
                            return agentModel?.[parsed.statId];
                        case SCOPE_EVENT:
                        case SCOPE_EVENTS: return eventModel?.[parsed.statId];
                        case SCOPE_TIMELINE:
                            switch (parsed.statId) {
                                case STAT_ID_SCORE: return atLeastZero(() => rootModel.getScore(), adj => rootModel.adjScore(adj));
                                case STAT_ID_CREDITS: return atLeastZero(() => rootModel.getCredits(), adj => rootModel.adjCredits(adj));
                                default: return rootModel[parsed.statId];
                            }
                    }
                    return;
                case 'skill':
                    return agentModel?.getSkillStat(parsed.skillId);
                case 'scratch':
                    return numericOnly(() => pkg.model.scratch[parsed.name], v => pkg.model.setScratch(parsed.name, v), 'scratch.' + parsed.name);
                case 'value': {
                    const valueModel = eventModel?.values?.[parsed.valueId];
                    if (!valueModel) {
                        console.warn('Event', eventModel?.id, 'has no Value', parsed.valueId);
                        return;
                    }
                    return numericOnly(() => valueModel.value, v => valueModel.setValueByAction(JSON.stringify(v)), 'Event ' + eventModel.id + ' Value ' + parsed.valueId);
                }
            }
        },
        
        /*  Reads one entry of a set or adj block, warning about problems with "where" at the
            front, e.g. "Event origin action toss set outcome". The key must name something 
            that can change. The entry is a string or an object with
            onSuccess and/or onFailure expressions, or onBoth, which is the same expression for
            either result. onSuccess or onFailure beside onBoth is ignored, as is an expression
            that isn't a non-empty string.
            
            Options:
                keepString - True to return a string entry as {parsedKey, string}. Otherwise 
                    a string is short for {onSuccess:<string>}.
                readRest(rest, warn) - Reads the entry's other keys. Returns false if the 
                    entry can't be used. Without one, other keys make the entry unusable.
                isSet - True for a set block, which can also put an agent at an Event 
                    ("agent.event" or "agents.<id>.event") or in a Faction ("agent.faction" or
                    "agents.<id>.faction"). Those can't be adjusted.
            
            Returns {parsedKey, onSuccess, onFailure}, at least one of the two set, or null if
            the entry can't be used. */
        readChangeEntry = (where, key, cfg, {keepString=false, readRest, isSet=false}={}) => {
            const warn = msg => console.warn(where + ' ' + msg + ':', cfg);
            
            /*  Parse change key. What a set or adj key names, or why it names nothing:
                {kind:'stat', scopeName, statId} - e.g. "agent.health". See ADJUSTMENT_STAT_IDS.
                {kind:'skill', scopeName:'agent', statId:'skills.<skill>', skillId} - e.g. 
                    "agent.skills.agl".
                {kind:'scratch', statId:'scratch.<name>', name} - e.g. "scratch.origin_knocks".
                {kind:'value', statId:'values.<id>', valueId} - a Value of the action's or exit's
                    own Event, by its ID, e.g. "bus_arrives".
                {kind:'stat', scopeName:'events', eventId, statId} - a stat of any Event, e.g. 
                    "events.collision.historicity".
                {kind:'stat', scopeName:'agents', agentId, statId} - a stat of any agent, e.g.
                    "agents.ME.chronal".
                {kind:'skill', scopeName:'agents', agentId, statId:'skills.<skill>', skillId} - a
                    skill of any agent, e.g. "agents.ME.skills.chronogation".
                {kind:'event', scopeName, agentId} - the Event an agent is at, theirs 
                    ("agent.event") or any agent's ("agents.ME.event"). Set only.
                {kind:'faction', scopeName, agentId} - the Faction an agent is in, theirs 
                    ("agent.faction") or any agent's ("agents.ME.faction"). Set only.
                {kind:'value', eventId, statId:'values.<id>', valueId} - a Value of any Event,
                    e.g. "events.collision.values.struck".
                {error} - a phrase for a warning. */
            let parsedKey;
            const [scopeName, statId, ...rest] = String(key).split('.');
            if (statId === undefined) {
                parsedKey = {kind:'value', statId:'values.' + scopeName, valueId:scopeName};
            } else if (scopeName === SCOPE_SCRATCH && rest.length === 0) {
                parsedKey = {kind:'scratch', statId:key, name:statId};
            } else if (scopeName === SCOPE_AGENT && statId === SCOPE_SKILLS && rest.length === 1) {
                if (pkg.isSkillId(rest[0])) {
                    parsedKey = {kind:'skill', scopeName, statId:SCOPE_SKILLS + '.' + rest[0], skillId:rest[0]};
                } else {
                    warn('names no skill (ignoring it)');
                    return null;
                }
            } else if (scopeName === SCOPE_AGENTS && rest.length === 2 && rest[0] === SCOPE_SKILLS) {
                if (pkg.isSkillId(rest[1])) {
                    parsedKey = {kind:'skill', scopeName, agentId:statId, statId:SCOPE_SKILLS + '.' + rest[1], skillId:rest[1]};
                } else {
                    warn('names no skill (ignoring it)');
                    return null;
                }
            } else if ((scopeName === SCOPE_AGENT && rest.length === 0 && SET_ONLY_AGENT_KEYS.includes(statId)) || (scopeName === SCOPE_AGENTS && rest.length === 1 && SET_ONLY_AGENT_KEYS.includes(rest[0]))) {
                if (!isSet) {
                    warn('can only be set, not adjusted (ignoring it)');
                    return null;
                }
                const kind = scopeName === SCOPE_AGENTS ? rest[0] : statId;
                parsedKey = {kind, scopeName, agentId:scopeName === SCOPE_AGENTS ? statId : undefined, statId:kind};
            } else if (scopeName === SCOPE_AGENTS && rest.length === 1 && ADJUSTMENT_STAT_IDS[SCOPE_AGENTS].includes(rest[0])) {
                parsedKey = {kind:'stat', scopeName, agentId:statId, statId:rest[0]};
            } else if (scopeName === SCOPE_EVENTS && rest.length === 1 && ADJUSTMENT_STAT_IDS[SCOPE_EVENTS].includes(rest[0])) {
                parsedKey = {kind:'stat', scopeName, eventId:statId, statId:rest[0]};
            } else if (scopeName === SCOPE_EVENTS && rest.length === 2 && rest[0] === 'values') {
                parsedKey = {kind:'value', eventId:statId, statId:'values.' + rest[1], valueId:rest[1]};
            } else if (scopeName !== SCOPE_EVENTS && scopeName !== SCOPE_AGENTS && rest.length === 0 && Object.hasOwn(ADJUSTMENT_STAT_IDS, scopeName) && ADJUSTMENT_STAT_IDS[scopeName].includes(statId)) {
                parsedKey = {kind:'stat', scopeName, statId};
            } else {
                warn('must be named for a stat of the agent, event or timeline, e.g. "agent.health", a skill of the agent, e.g. "agent.skills.agl", a Value of the Event, a stat or Value of another Event, e.g. "events.collision.historicity" or "events.collision.values.struck", a stat, skill, Event or Faction of another agent, e.g. "agents.ME.chronal", "agents.ME.skills.agl", "agents.ME.event" or "agents.ME.faction", or "scratch.<name>" (ignoring it)');
                return null;
            }
            
            if (typeof cfg === 'string') {
                if (keepString) return {parsedKey, string:cfg};
                cfg = {onSuccess:cfg};
            } else if (cfg == null || typeof cfg !== 'object' || Array.isArray(cfg)) {
                warn('must be a string or an object (ignoring it)');
                return null;
            }
            
            const {onBoth, onSuccess, onFailure, ...restOfCfg} = cfg,
                toExpr = (name, expr) => {
                    if (expr === undefined || (typeof expr === 'string' && expr.trim() !== '')) return expr;
                    warn(name + ' must be a non-empty string (ignoring it)');
                },
                retval = {parsedKey};
            if (onBoth === undefined) {
                retval.onSuccess = toExpr('onSuccess', onSuccess);
                retval.onFailure = toExpr('onFailure', onFailure);
            } else {
                if (onSuccess !== undefined || onFailure !== undefined) warn('has onBoth, so its onSuccess and onFailure are ignored');
                retval.onSuccess = retval.onFailure = toExpr('onBoth', onBoth);
            }
            
            if (readRest) {
                if (readRest(restOfCfg, warn) === false) return null;
            } else if (Object.keys(restOfCfg).length > 0) {
                warn('has keys other than onSuccess, onFailure and onBoth (ignoring it)');
                return null;
            }
            
            if (retval.onSuccess === undefined && retval.onFailure === undefined) {
                warn('needs an onSuccess, onFailure or onBoth (ignoring it)');
                return null;
            }
            return retval;
        },
        
        /*  Reads a set or adj block into its usable entries by key. See readChangeEntry. */
        readChangeEntries = pkg.readChangeEntries = (where, block, options) => {
            const retval = {};
            for (const key in block ?? {}) {
                const entry = readChangeEntry(where + ' ' + key, key, block[key], options);
                if (entry) retval[key] = entry;
            }
            return retval;
        },
        
        /*  Applies a set block's entries for a result: a string entry sets on success and an
            {onSuccess, onFailure} entry for either result. rollCfg is what the expressions see
            (agent, event, difficulty, margin). agentModel and eventModel are whose stats and
            Values keys like "agent.health" and "foundBadge" name; either may be null, e.g. for
            an Operation. */
        applySetEntries = pkg.applySetEntries = (entries, agentModel, eventModel, success, rollCfg) => {
            const {rollValue} = pkg.checks;
            for (const key in entries) {
                const {parsedKey, string, onSuccess, onFailure} = entries[key],
                    isPerResult = string === undefined,
                    expr = isPerResult ? (success ? onSuccess : onFailure) : (success ? string : undefined);
                if (expr === undefined) continue;
                
                switch (parsedKey.kind) {
                    case 'scratch': {
                        // Worked out once, now, rather than kept up to date like a Causator,
                        // so "scratch.x + 1" counts. Dice roll.
                        const result = rollValue(expr, rollCfg);
                        if (result !== undefined) pkg.model.setScratch(parsedKey.name, result);
                        break;
                    }
                    case 'stat':
                    case 'skill': {
                        // Worked out once, now, and set within the stat's limits, by adjusting it
                        // so the stat's own rules apply, e.g. reaching a paradox limit.
                        const result = rollValue(expr, rollCfg),
                            target = getChangeTarget(parsedKey, agentModel, eventModel);
                        if (target && Number.isFinite(result)) {
                            target.adjValue(target.getAllowedAdj(mathRound(result) - target.value).adj);
                        }
                        break;
                    }
                    case 'event': {
                        // Worked out once, now, to an Event's ID, e.g. "'lgv_announcement'", and 
                        // the agent time travels there as if deployed or jumping, paying the 
                        // chronal and gaining any paradox, if they can.
                        const result = rollValue(expr, rollCfg),
                            travelerModel = parsedKey.agentId === undefined ? agentModel : pkg.model.getAgentModel(parsedKey.agentId),
                            destinationEventModel = typeof result === 'string' ? pkg.model.getEventModel(result) : null;
                        if (!travelerModel) {
                            console.warn('No agent', parsedKey.agentId ?? '', 'to move for', key);
                        } else if (!destinationEventModel) {
                            console.warn(key, 'is not an Event ID:', result);
                        } else {
                            travelerModel.doDeployToEvent(destinationEventModel);
                        }
                        break;
                    }
                    case 'faction': {
                        // Worked out once, now, to a Faction's ID, e.g. "'timecorps'".
                        const result = rollValue(expr, rollCfg),
                            memberModel = parsedKey.agentId === undefined ? agentModel : pkg.model.getAgentModel(parsedKey.agentId);
                        if (!memberModel) {
                            console.warn('No agent', parsedKey.agentId ?? '', 'to put in a Faction for', key);
                        } else if (typeof result !== 'string' || !pkg.model.getFactionModel(result)) {
                            console.warn(key, 'is not a Faction ID:', result);
                        } else {
                            memberModel.setFaction(result);
                        }
                        break;
                    }
                    case 'value': {
                        const valueEventModel = parsedKey.eventId === undefined ? eventModel : pkg.model.getEventModel(parsedKey.eventId),
                            valueModel = valueEventModel?.values[parsedKey.valueId];
                        if (!valueModel) {
                            console.warn('No Value', key, 'to set');
                        } else if (isPerResult) {
                            // Set as a literal, so it stays what it was worked out to be.
                            const result = rollValue(expr, rollCfg);
                            if (result !== undefined) valueModel.setValueByAction(JSON.stringify(result));
                        } else {
                            // A constraint expression, kept up to date. It's the Value's own
                            // expression, so "event" means the Value's Event.
                            valueModel.setValueByAction(expr);
                        }
                        break;
                    }
                }
            }
        },
        
        ADJUSTMENT_WHEN_SUCCESS = 'success',
        ADJUSTMENT_WHEN_FAILURE = 'failure',
        ADJUSTMENT_WHEN_BOTH = 'both',
        
        /*  The average margin of the check that decides it, for a pass or a failure: its own
            check, or else its action's. 0 if nothing is rolled, as for an exit without a 
            check of its own or a no-roll check. */
        getAvrgMargin = (statAdjModel, agentModel, success) => {
            const decider = statAdjModel.hasOwnCheck() ? statAdjModel : (statAdjModel.owner.isGatedByActionSkillCheck() ? statAdjModel.owner : null);
            if (decider) {
                const difficulty = decider.getActionSkillDifficulty();
                if (!pkg.isNoRollDifficulty(difficulty)) {
                    return pkg.checks.getAverageMargin(agentModel.getSkillExpressionEase(decider.getActionSkillExpr(), difficulty), success);
                }
            }
            return 0;
        },
        
        /*  One adjustment of an action or exit: an amount added to what its key names: a stat, 
            e.g. "agent.health", "event.attestation" or "timeline.paradox", a skill of the agent, 
            e.g. "agent.skills.agl", a Value of its Event, e.g. "bus_arrives", or a scratch entry, 
            e.g. "scratch.origin_knocks". Only stats and skills show in tooltips, flags and 
            floating text. Configured as:
                onSuccess, onFailure - Amount expressions, e.g. "-d(6, 2)". At least one. A 
                    positive amount raises the stat and a negative one lowers it, within the 
                    stat's limits. An amount sees the same parameters as a check expression.
                onBoth - Instead of onSuccess and onFailure, one amount for either result.
                A string alone is short for {onSuccess:<string>}, as a string set is.
                difficulty, check, actionType - Optional. The adjustment's own skill check, as for 
                    an action. With one, the adjustment rolls it and uses onSuccess or onFailure by
                    its result. Without one, it follows the action's own check, and taking an 
                    exit counts as a success.
                enabledForActionSkillCheck - Actions only. Whether the adjustment applies when the
                    action's own check is a "success", a "failure" or "both", the default. */
        StatAdjustmentModel = pkg.StatAdjustmentModel = new JSClass('StatAdjustmentModel', BaseModel, {
            include: [ActionCheckSupport],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const {owner, key, cfg} = attrs;
                delete attrs.owner;
                delete attrs.key;
                delete attrs.cfg;
                
                this.owner = owner;
                this.key = key;
                this.callSuper(attrs);
                
                this.valid = this.configure(cfg);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            /** @overrides ActionCheckSupport */
            getSkillCheckOwner: function() {
                return this.owner.getSkillCheckOwner() + ' adj ' + this.key;
            },
            
            hasOwnCheck: function() {return this.ownCheck;},
            
            /*  The amount expression for a result, or undefined if nothing happens then. */
            getAmountExpr: function(success) {return success ? this.onSuccess : this.onFailure;},
            
            /*  What changes, as something stat-like. See getChangeTarget. */
            getStat: function(agentModel) {return getChangeTarget(this.parsedKey, agentModel, this.owner.event);},
            
            /*  Whether the player sees the adjustment: stats and skills, not Values or scratch. */
            isShown: function() {return this.kind === 'stat' || this.kind === 'skill';},
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  Returns true if the config is usable. Problems are warned about. */
            configure: function(cfg) {
                const self = this;
                self.enabledForActionSkillCheck = ADJUSTMENT_WHEN_BOTH;
                
                // A string applies on success, like a string set. Any other keys are the 
                // adjustment's own check, which warns about unknown ones.
                const entry = readChangeEntry(self.getSkillCheckOwner(), self.key, cfg, {
                    readRest: ({enabledForActionSkillCheck, ...checkCfg}, warn) => {
                        self.ownCheck = ['difficulty', 'check', 'actionType'].some(name => name in checkCfg);
                        if (Object.keys(checkCfg).length > 0) self.addSkillCheck(null, checkCfg);
                        
                        if (enabledForActionSkillCheck !== undefined) {
                            if (!self.owner.isGatedByActionSkillCheck()) {
                                warn('enabledForActionSkillCheck only applies to actions (ignoring it)');
                            } else if ([ADJUSTMENT_WHEN_SUCCESS, ADJUSTMENT_WHEN_FAILURE, ADJUSTMENT_WHEN_BOTH].includes(enabledForActionSkillCheck)) {
                                self.enabledForActionSkillCheck = enabledForActionSkillCheck;
                            } else {
                                warn('enabledForActionSkillCheck must be "success", "failure" or "both" (using "both")');
                            }
                        }
                    }
                });
                if (entry) {
                    const parsedKey = self.parsedKey = entry.parsedKey;
                    self.kind = parsedKey.kind;
                    self.scopeName = parsedKey.scopeName;
                    self.statId = parsedKey.statId;
                    self.skillId = parsedKey.skillId ?? null;
                    self.onSuccess = entry.onSuccess;
                    self.onFailure = entry.onFailure;
                    return true;
                } else {
                    return false;
                }
            },
            
            /*  Whether the adjustment applies given the action's own check result, if any. */
            appliesFor: function(actionCheck) {
                if (actionCheck) {
                    switch (this.enabledForActionSkillCheck) {
                        case ADJUSTMENT_WHEN_SUCCESS: return actionCheck.success === true;
                        case ADJUSTMENT_WHEN_FAILURE: return actionCheck.success === false;
                    }
                }
                return true;
            },
            
            /*  Whether it changes the agent's health. */
            isHealth: function() {return this.scopeName === SCOPE_AGENT && this.statId === STAT_ID_HEALTH;},
            
            /*  Names the stat it changes, e.g. "Health" or "Event Attestation". */
            getStatDescription: function() {
                const name = getStatName(this.statId);
                switch (this.scopeName) {
                    case SCOPE_AGENT: return name;
                    case SCOPE_EVENT: return 'Event ' + name;
                    case SCOPE_AGENTS: return (pkg.model.getAgentModel(this.parsedKey.agentId)?.getName() ?? this.parsedKey.agentId) + ' ' + name;
                    case SCOPE_EVENTS: return (pkg.model.getEventModel(this.parsedKey.eventId)?.name ?? this.parsedKey.eventId) + ' ' + name;
                    default: return 'Timeline ' + name;
                }
            },
            
            /*  Its amount for an agent when its check passes or fails, given that check's margin,
                by amountFunc: rolled (checks.rollAmount) or averaged (checks.getAverageAmount).
                Undefined if nothing happens in that case. */
            getAmount: function(agentModel, success, amountFunc, margin) {
                const expr = this.getAmountExpr(success);
                if (expr) {
                    return amountFunc(expr, {
                        agent:agentModel, 
                        event:agentModel.getEventModel(), 
                        difficulty:(this.hasOwnCheck() ? this : this.owner).getActionSkillDifficulty(),
                        margin
                    });
                }
            },
            
            /*  Its average amount for an agent for a pass or a failure, without rolling. */
            getAvrgAmount: function(agentModel, success) {
                return this.getAmount(agentModel, success, pkg.checks.getAverageAmount, getAvrgMargin(this, agentModel, success));
            },
            
            /*  Rolls it for an agent, given the action's own check if it has one, without applying
                it. Returns {adjustment, key, statId, stat, amount, check, shown}, where amount is 
                what the stat will actually change by, in whole points within its limits, and 
                check is its own check if it has one. Null if it doesn't apply, or has nothing to
                do in its case and has no check of its own. */
            roll: function(agentModel, actionCheck) {
                if (!this.appliesFor(actionCheck)) return null;
                
                const check = this.hasOwnCheck() ? agentModel.checkSkillExpression(this.getActionSkillExpr(), this.getActionSkillDifficulty()) : null,
                    // Without its own check it follows the action, and an exit succeeds. The
                    // margin is that of whichever check decided it, or 0 if none.
                    decidingCheck = check ?? actionCheck,
                    success = decidingCheck ? decidingCheck.success : true,
                    amount = this.getAmount(agentModel, success, pkg.checks.rollAmount, decidingCheck?.result ?? 0);
                if (amount === undefined && !check) return null;
                
                // A broken expression (NaN) does nothing. || 0 so it's never -0.
                const stat = this.getStat(agentModel),
                    adj = (stat && Number.isFinite(amount) ? stat.getAllowedAdj(mathRound(amount)).adj : 0) || 0;
                return {adjustment:this, key:this.key, statId:this.statId, stat, amount:adj, check, shown:this.isShown()};
            }
        }),
        
        /*  Gives an action or exit its adjustments, configured in the data as "adj", for the 
            adjustments it makes to stats: an object of StatAdjustmentModel configs by key. Unlike
            set, which replaces what it sets, adj adds to it. */
        AdjustmentSupport = new JSModule('AdjustmentSupport', {
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const adj = attrs.adj,
                    hasInjurySkillCheck = 'injurySkillCheck' in attrs;
                delete attrs.adj;
                delete attrs.injurySkillCheck;
                
                // Applied after the other attrs so any warnings can name the owner.
                this.callSuper(attrs);
                
                if (hasInjurySkillCheck) console.warn(this.getSkillCheckOwner(), 'injurySkillCheck is replaced by adj, e.g. {"agent.health":{"onFailure":"-5"}} (ignoring it)');
                this.setAdjustments(adj);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setAdjustments: function(cfg) {
                const adjustments = this.adjustments = [];
                if (cfg == null) return;
                if (typeof cfg !== 'object' || Array.isArray(cfg)) {
                    console.warn(this.getSkillCheckOwner(), 'adj must be an object of adjustments by stat, e.g. "agent.health" (ignoring them):', cfg);
                    return;
                }
                for (const key in cfg) {
                    // Null leaves an adjustment out, e.g. to drop one from a default action.
                    if (cfg[key] === null) continue;
                    
                    const adjustmentModel = new StatAdjustmentModel({owner:this, key, cfg:cfg[key]});
                    if (adjustmentModel.valid) adjustments.push(adjustmentModel);
                }
            },
            getAdjustments: function() {return this.adjustments;},
            hasAdjustments: function() {return this.adjustments.length > 0;},
            
            /*  Rolls the adjustments that apply for an agent, given the action's own check if 
                there is one, without applying them. See StatAdjustmentModel.roll. */
            rollAdjustments: function(agentModel, actionCheck) {
                return this.adjustments.map(adjustmentModel => adjustmentModel.roll(agentModel, actionCheck)).filter(Boolean);
            },
            
            /*  True if the adjustments can depend on the result of the owner's own check. */
            isGatedByActionSkillCheck: () => false
        }),
        
        /*  The model whose stat a cost or adjustment of an action changes: the agent, the action's
            Event or the timeline. */
        getScopeStat = (statId, scopeName, agentModel, actionModel) => {
            let target;
            switch (scopeName) {
                case SCOPE_AGENT:    target = agentModel; break;
                case SCOPE_EVENT:    target = actionModel.event; break;
                case SCOPE_TIMELINE: target = pkg.model; break;
            }
            return target?.[statId];
        },
        
        /*  A cost paid in a stat. Paying lowers it, except paradox, which a cost adds to. Either
            way a cost can't take the stat past its limits, so it's only payable while there's
            room. reserve is held back from what can be paid, e.g. so a health cost can't kill,
            and a paradox cost can't reach the limit, which devours an agent, floods an Event or
            destabilizes the timeline. */
        makeStatCost = (scopeName, statId, reserve=0) => {
            const accrues = statId === STAT_ID_PARADOX,
                name = (scopeName === SCOPE_EVENT ? 'Event ' : scopeName === SCOPE_TIMELINE ? 'Timeline ' : '') + getStatName(statId);
            return {
                scopeName,
                statId,
                getName: () => name,
                getAvailable: (agentModel, actionModel) => {
                    const stat = getScopeStat(statId, scopeName, agentModel, actionModel);
                    return stat ? (accrues ? stat.getValueToMax() : -stat.getValueToMin()) - reserve : 0;
                },
                pay: (agentModel, actionModel, amount) => {
                    getScopeStat(statId, scopeName, agentModel, actionModel).adjValue(accrues ? amount : -amount);
                }
            };
        },
        
        COST_KEY_ACTION = SCOPE_AGENT + '.action',
        
        /*  What an action can cost, by key: "<scope>.<resource>". Each says how much of it can
            be paid, and pays it. */
        COSTS = pkg.COSTS = {
            // The agent's actions at its Event. Every action costs one unless it says otherwise.
            [COST_KEY_ACTION]:{
                getName: amount => amount === 1 ? 'Action' : 'Actions',
                getAvailable: agentModel => agentModel.getActionsRemaining(),
                pay: (agentModel, _actionModel, amount) => {agentModel.setActionExecCount(agentModel.getActionExecCount() + amount);}
            },
            // A health cost can't take the agent's last point of health.
            [SCOPE_AGENT + '.' + STAT_ID_HEALTH]:makeStatCost(SCOPE_AGENT, STAT_ID_HEALTH, 1),
            [SCOPE_AGENT + '.' + STAT_ID_CHRONAL]:makeStatCost(SCOPE_AGENT, STAT_ID_CHRONAL),
            [SCOPE_AGENT + '.' + STAT_ID_PARADOX]:makeStatCost(SCOPE_AGENT, STAT_ID_PARADOX, 1),
            [SCOPE_EVENT + '.' + STAT_ID_ATTESTATION]:makeStatCost(SCOPE_EVENT, STAT_ID_ATTESTATION),
            [SCOPE_EVENT + '.' + STAT_ID_HISTORICITY]:makeStatCost(SCOPE_EVENT, STAT_ID_HISTORICITY),
            [SCOPE_EVENT + '.' + STAT_ID_PARADOX]:makeStatCost(SCOPE_EVENT, STAT_ID_PARADOX, 1),
            [SCOPE_TIMELINE + '.' + STAT_ID_CHRONAL]:makeStatCost(SCOPE_TIMELINE, STAT_ID_CHRONAL),
            [SCOPE_TIMELINE + '.' + STAT_ID_PARADOX]:makeStatCost(SCOPE_TIMELINE, STAT_ID_PARADOX, 1),
            // The player's score. It can't be spent below 0.
            [SCOPE_TIMELINE + '.score']:{
                getName: () => 'Score',
                getAvailable: () => pkg.model.getScore(),
                pay: (_agentModel, _actionModel, amount) => {pkg.model.adjScore(-amount);}
            },
            // The Corps' credits, earned from score and missions.
            [SCOPE_TIMELINE + '.credits']:{
                getName: amount => amount === 1 ? 'Credit' : 'Credits',
                getAvailable: () => pkg.model.getCredits(),
                pay: (_agentModel, _actionModel, amount) => {pkg.model.adjCredits(-amount);}
            }
        },
        
        /*  The costs of an action when it doesn't give its own. */
        DEFAULT_ACTION_COSTS = {[COST_KEY_ACTION]:'1'},
        
        /*  The costs of an exit when it doesn't give its own: none. */
        DEFAULT_EXIT_COSTS = {},
        
        /*  One cost of an action: something the agent must pay to take it, named by its key,
            e.g. "agent.action" or "timeline.score". See COSTS. Configured as an amount
            expression, e.g. "2" or "100 + 100 * event.paradox.value", worked out like an
            available condition: when it's needed, without rolling, so any d() is its average.
            It's rounded to whole points, and can't be negative. */
        ActionCostModel = pkg.ActionCostModel = new JSClass('ActionCostModel', BaseModel, {
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const {owner, key, expr} = attrs;
                delete attrs.owner;
                delete attrs.key;
                delete attrs.expr;
                
                this.owner = owner;
                this.key = key;
                this.callSuper(attrs);
                
                this.valid = this.configure(expr);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            getExpr: function() {return this.expr;},
            
            isActionCost: function() {return this.key === COST_KEY_ACTION;},
            
            /*  Names what's paid, e.g. "Actions" or "Timeline Chr⏲nal". */
            getName: function(amount) {return COSTS[this.key].getName(amount);},
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  Returns true if the config is usable. Problems are warned about. */
            configure: function(expr) {
                const warn = msg => console.warn(this.owner.getSkillCheckOwner() + ' cost ' + this.key, msg + ':', expr);
                if (!Object.hasOwn(COSTS, this.key)) {
                    warn('must be one of ' + Object.keys(COSTS).join(', ') + ' (ignoring it)');
                    return false;
                }
                if (typeof expr !== 'string' || expr.trim() === '') {
                    warn('must be a non-empty string (ignoring it)');
                    return false;
                }
                this.expr = expr;
                
                // The stat it's paid in, if it's one, named as for an adjustment.
                this.scopeName = COSTS[this.key].scopeName;
                this.statId = COSTS[this.key].statId;
                return true;
            },
            
            /*  What the agent would pay now, in whole points. NaN, with a warning, if the
                expression is broken. A negative amount is a gain, which is what adjustments are
                for, so it's 0, with a warning the first time. */
            getAmount: function(agentModel) {
                const amount = mathRound(pkg.checks.getAverageAmount(this.expr, {agent:agentModel, event:this.owner.event}));
                if (amount < 0) {
                    if (!this.warnedNegative) {
                        this.warnedNegative = true;
                        console.warn(this.owner.getSkillCheckOwner() + ' cost ' + this.key + ' is negative (paying nothing):', this.expr);
                    }
                    return 0;
                }
                return amount === 0 ? 0 : amount; // Never -0, and NaN stays NaN.
            },
            
            /*  How much of it the agent has to pay with. */
            getAvailable: function(agentModel) {return COSTS[this.key].getAvailable(agentModel, this.owner);},
            
            /*  Whether the agent can pay an amount of it. A broken amount can't be paid. */
            canPay: function(agentModel, amount) {
                return Number.isFinite(amount) && (amount === 0 || amount <= this.getAvailable(agentModel));
            },
            
            pay: function(agentModel, amount) {
                if (amount > 0) COSTS[this.key].pay(agentModel, this.owner, amount);
            }
        }),
        
        /*  Gives an action "costs": an object of amount expressions by key, which the agent must
            be able to pay to take it. They're merged over the default of one action, so
            {"timeline.score":"100"} costs an action and 100 score. null leaves a cost out, e.g.
            {"agent.action":null} for an action that uses no action, and "costs":null leaves
            them all out. */
        CostsSupport = new JSModule('CostsSupport', {
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const costs = attrs.costs;
                delete attrs.costs;
                
                // Applied after the other attrs so any warnings can name the owner.
                this.callSuper(attrs);
                
                this.setCosts(costs);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setCosts: function(cfg) {
                const costs = this.costs = [];
                if (cfg === null) return;
                if (cfg !== undefined && (typeof cfg !== 'object' || Array.isArray(cfg))) {
                    console.warn(this.getSkillCheckOwner(), 'costs must be an object of amounts by key, e.g. {"agent.action":"2"} (using the default):', cfg);
                    cfg = undefined;
                }
                if (this.isA(EventActionModel)) {
                    cfg = {...DEFAULT_ACTION_COSTS, ...cfg};
                } else if (this.isA(EventExitModel)) {
                    cfg = {...DEFAULT_EXIT_COSTS, ...cfg};
                }
                for (const key in cfg) {
                    if (cfg[key] === null) continue;
                    
                    const costModel = new ActionCostModel({owner:this, key, expr:cfg[key]});
                    if (costModel.valid) costs.push(costModel);
                }
            },
            getCosts: function() {return this.costs;}
        }),
        
        /*  Reduces a set of observables or observers to the EventModels they belong to. */
        toEventModels = (things, excludeEventModel) => {
            const retval = new Set();
            for (const thing of things) {
                const eventModel = thing.isA(EventModel) ? thing : thing.event?.isA(EventModel) ? thing.event : null;
                if (eventModel && eventModel !== excludeEventModel) retval.add(eventModel);
            }
            return retval;
        },
        
        EVENT_STAT_IDS = [STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION],
        
        updateEndAttr = eventModel => {
            const {start, duration} = eventModel;
            if (start != null && duration != null) eventModel.set('end', start + duration);
        },
        
        ConstrainableToParentEvent = new JSModule('ConstrainableToParentEvent', {
            include: [pkg.ConstrainableAttrSupport],
            
            init: function(attrs) {
                this.event = attrs.event;
                delete attrs.event;
                this.callSuper(attrs);
            },
            
            getConstraintScope: function() {return this.event;}
        }),
        
        HideableEventPart = new JSModule('HideableEventPart', {
            include: [pkg.Hideable],
            
            init: function(attrs) {
                this.hidden = false;
                this.callSuper(attrs);
            },
            
            doHiddenChanged: function(_hidden) {this.event.notifyCollectionOfUpdate();}
        }),
        
        DescribableEventPart = new JSModule('DescribableEventPart', {
            include: [pkg.Describable],
            
            doDescriptionChanged: function() {this.event.notifyCollectionOfUpdate();}
        }),
        
        /*  What an action or exit sets when it's taken. Expects ActionCheckSupport. */
        SetSupport = new JSModule('SetSupport', {
            /*  What it sets, by key: a Value of its Event, or "scratch.<name>", or any other 
                key set and adj share. An entry is either:
                    - a string, set when the check passes. A Value gets it as a constraint 
                      expression, kept up to date, and scratch as a check expression, worked 
                      out once.
                    - {onSuccess, onFailure}, either optional: check expressions worked out 
                      once, when it's taken, for the result the check had. They see margin, and
                      set a Value to a literal. {onBoth} is one for either result.
                Entries that are neither are left out, with a warning. See readChangeEntry, and
                applySetEntries for how each kind of key is set. */
            setSet: function(set) {
                this.set('setObj', readChangeEntries(this.getSkillCheckOwner() + ' set', set, {keepString:true, isSet:true}), true);
            },
            
            /*  Sets what it sets, by key, for an agent's check result. Margin is how well the 
                check went. */
            applySets: function(agentModel, success, margin) {
                applySetEntries(this.setObj, agentModel, this.event, success, {agent:agentModel, event:this.event, difficulty:this.getActionSkillDifficulty(), margin});
            }
        }),
        
        /*  The prompt an action or exit opens when it's taken and its check passes, by ID, 
            e.g. "recruit". Expects ActionCheckSupport. */
        PromptSupport = new JSModule('PromptSupport', {
            setPrompt: function(promptId) {this.promptId = pkg.readPromptId(this.getSkillCheckOwner(), promptId);},
            
            /*  Opens its prompt, if it has one and it isn't hidden. */
            openPrompt: function(finallyCallback) {pkg.openPrompt(this.getSkillCheckOwner(), this.promptId, finallyCallback);}
        }),
        
        EventActionModel = new JSClass('EventActionModel', BaseModel, {
            include: [
                ConstrainableToParentEvent, HideableEventPart, ActionCheckSupport, AdjustmentSupport, 
                CostsSupport, SetSupport, PromptSupport
            ],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                // How many times the action has been attempted, pass or fail. Expressions read it as
                // e.g. "event.actions.recover.attemptCount".
                this.attemptCount = 0;
                
                // How many times the action has been performed successfully. Expressions read it as
                // e.g. "event.actions.recover.doneCount".
                this.doneCount = 0;
                
                // Applied after the other attrs so any warnings can name the action and its Event.
                const {skillCheck, available, set, prompt} = attrs;
                delete attrs.skillCheck;
                delete attrs.available;
                delete attrs.set;
                delete attrs.prompt;
                
                this.callSuper(attrs);
                
                this.setSkillCheck(skillCheck);
                this.setAvailable(available);
                this.setSet(set);
                this.setPrompt(prompt);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setLabel: function(label) {this.set('label', label, true);},
            
            /*  An optional condition on the agent who'd take the action, e.g.
                "agent.health.value < agent.health.max". Unlike hidden, which is the same for
                everyone at the Event, it's a check expression worked out per agent, so the
                button can be disabled for one agent and not another. null for none. */
            setAvailable: function(expr) {
                if (expr == null || (typeof expr === 'string' && expr.trim() !== '')) {
                    this.available = expr ?? null;
                } else {
                    console.warn('Event ' + this.event?.id + ' action ' + this.id + ': available must be a non-empty string (ignoring it):', expr);
                    this.available = null;
                }
            },
            getAvailable: function() {return this.available ?? null;},
            
            /*  Whether the agent can take the action, by its available condition. Doesn't
                look at whether the agent can pay its costs. */
            isAvailableFor: function(agentModel) {
                const expr = this.getAvailable();
                return expr == null || pkg.checks.isTrue(expr, {agent:agentModel, event:this.event});
            },
            
            setSkillCheck: function(cfg) {
                this.addSkillCheck(null, cfg);
            },
            
            /** @overrides AdjustmentSupport */
            isGatedByActionSkillCheck: () => true,
            
            setDoneCount: function(v) {
                if (this.doneCount !== v) {
                    this.set('doneCount', v, true);
                    this.event.notifyCollectionOfUpdate();
                }
            },
            getDoneCount: function() {return this.doneCount;},
            
            setAttemptCount: function(v) {
                if (this.attemptCount !== v) {
                    this.set('attemptCount', v, true);
                    this.event.notifyCollectionOfUpdate();
                }
            },
            getAttemptCount: function() {return this.attemptCount;},
            
            
            // Persistence /////////////////////////////////////////////////////
            exportToObj: function() {
                return {
                    doneCount:this.doneCount, 
                    attemptCount:this.attemptCount
                };
            },
            importFromObj: function(obj) {
                if ('doneCount' in obj) this.setDoneCount(obj.doneCount);
                if ('attemptCount' in obj) this.setAttemptCount(obj.attemptCount);
            }
        }),
        
        EventValueModel = new JSClass('EventValueModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart, DescribableEventPart],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                // How many times an action has changed the value. Changes that follow from other
                // Values don't count. Expressions read it as e.g.
                // "event.values.relayToBridge.flipCount".
                this.flipCount = 0;
                this.callSuper(attrs);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setValue: function(value, isActual) {
                if (isActual) {
                    // Lets views react to a Value actually changing, e.g. the timeline animating
                    // the Event's box. Not fired while the Value is first being set up. Fired
                    // before the new value is set because setting it updates any dependent 
                    // Values right away, so listeners hear about changes in causal order.
                    if (this.inited && this.value !== value) this.event.fireEvent('valueChanged', this);
                    
                    this.set('value', value, true);
                    this.event.notifyCollectionOfUpdate();
                } else {
                    setConstrainedValue(this.getConstraintScope(), this, 'value', value);
                }
            },
            getValue: function() {return this.value;},
            
            /*  Sets the value as an action does, counting a flip if that changes it. */
            setValueByAction: function(value) {
                const before = this.value;
                this.setValue(value, false);
                if (this.value !== before) this.setFlipCount(this.flipCount + 1);
            },
            
            setFlipCount: function(v) {
                if (this.flipCount !== v) {
                    this.set('flipCount', v, true);
                    this.event.notifyCollectionOfUpdate();
                }
            },
            getFlipCount: function() {return this.flipCount;},
            
            /*  A player-facing name. Falls back to the id so unnamed Values still display. */
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name ?? this.id;},
            
            getDescription: function(joiner) {
                return this.callSuper(joiner) || String(this.getValue() ?? ICON_NIL);
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  Other Events whose Causators this Causator's value is computed from. Only the
                value constraint counts, not the hidden constraint. */
            getPrecursors: function() {
                const valueFuncName = pkg.getConstraintFuncName('value');
                return toEventModels(
                    this.getAllObservables((_observable, funcName) => funcName === valueFuncName),
                    this.event
                );
            },
            
            /*  Other Events with anything (a Causator, Action, Exit, etc.) that depends on this
                Causator's value. */
            getDescendants: function() {
                return toEventModels(
                    this.getAllObservers((_observer, _funcName, type) => type === 'value'),
                    this.event
                );
            },
            
            
            // Persistence /////////////////////////////////////////////////////
            /*  Saves the literal or expression last given to setValue rather than the actual 
                value, since an Action may have replaced a literal with an expression. */
            exportToObj: function() {
                return {value:getConstrainedValueCfg(this, 'value'), flipCount:this.flipCount};
            },
            importFromObj: function(obj) {
                if ('value' in obj) this.setValue(obj.value, false);
                if ('flipCount' in obj) this.setFlipCount(obj.flipCount);
            }
        }),
        
        /*  A way out of an Event into another, taken by an agent there. Taking it always 
            succeeds; its adj and set apply on the way. An exit with "toHidden":true is offered
            even while the Event it leads to is hidden, without naming it, so the player can
            go somewhere unknown. Its set, or anything else, can reveal that Event by changing 
            what its hidden expression reads, e.g. "set":{"scratch.vault_found":"true"}. */
        EventExitModel = new JSClass('EventExitModel', BaseModel, {
            include: [
                ConstrainableToParentEvent, HideableEventPart, ActionCheckSupport, AdjustmentSupport, 
                CostsSupport, SetSupport, PromptSupport
            ],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                // Applied after the other attrs so any warnings can name the exit by where it goes.
                const {set, prompt} = attrs;
                delete attrs.set;
                delete attrs.prompt;
                this.callSuper(attrs);
                this.setSet(set);
                this.setPrompt(prompt);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            /** @overrides ActionCheckSupport */
            getSkillCheckOwner: function() {
                // Not the default, which names an action.
                return 'Event ' + this.event?.id + ' exit to ' + this.to;
            },
            
            setMode: function(mode) {this.set('mode', mode, true);},
            
            /*  Whether taking the exit is time travel, as "jump" and "pulled" are, rather than
                living through the time between the Events. */
            isTimeTravel: function() {return this.mode === 'jump' || this.mode === 'pulled';},
            
            setTo: function(to) {
                if (this.to !== to) {
                    this._toEventModel = null;
                    this.set('to', to, true); // An Event ID
                }
            },
            getToEventModel: function() {
                return this._toEventModel ?? (this._toEventModel = pkg.model.getEventModel(this.to));
            },
            
            setToHidden: function(v) {this.toHidden = v === true;},
            isToHidden: function() {return this.toHidden === true;},
            
            /*  Whether the exit can be offered, as far as where it leads goes: the Event is 
                known, or the exit is allowed to lead somewhere unknown. Its own hidden is 
                separate. */
            isDestinationOffered: function() {
                const toEventModel = this.getToEventModel();
                return toEventModel != null && (toEventModel.isNotHidden() || this.isToHidden());
            },
            
            /*  Where the exit leads, for a button: the Event's name. */
            getDestinationPhrase: function() {
                return this.getToEventModel().name;
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  How the exit is taken, as the start of a button label, e.g. "Walk to". */
            getModePhrase: function() {return getTravelModePhrase(this.mode);}
        }),
        
        HideAffectedByModel = new JSClass('HideAffectedByModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart]
        }),
        
        EventModel = pkg.EventModel = new JSClass('EventModel', BaseModel, {
            include: [pkg.DescribableHideable, pkg.MediaSupport],
            
            /** @overrides ConstrainableAttrSupport */
            getConstraintScopeName: () => SCOPE_EVENT,
            
            /** @overrides MediaSupport */
            getMediaFolder: () => 'event',
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const self = this;
                self.chronoLocked = self.hub = self.hidden = self.flooded = self._beenVisited = false;
                self.actionLimit = DEFAULT_ACTION_LIMIT;
                
                self[STAT_ID_HISTORICITY] = new NotifyingNumericStatModel({notifyTargets:self, id:STAT_ID_HISTORICITY, absMin:0, min:0, value:0, max:100, absMax:100});
                self[STAT_ID_ATTESTATION] = new NotifyingNumericStatModel({notifyTargets:self, id:STAT_ID_ATTESTATION, absMin:0, min:0, value:0, max:100, absMax:100}, [{
                    adjValue: function(adj, cfg) {
                        const retval = this.callSuper(adj, cfg);
                        // Score is adjusted when attestation increases and taken away when it drops.
                        if (retval !== 0) pkg.model.adjScore(retval * SCORE_PER_ATTESTATION);
                        return retval;
                    }
                }]);
                self[STAT_ID_PARADOX] =     new NotifyingNumericStatModel({notifyTargets:self, id:STAT_ID_PARADOX,     absMin:0, min:0, value:0, max:EVENT_PARADOX_LIMIT}, [{
                    adjValue: function(adj, cfg) {
                        const retval = this.callSuper(adj, cfg);
                        pkg.model[STAT_ID_PARADOX].adjValue(retval);
                        return retval;
                    },
                    // Reaching the limit, however it happens, floods the Event.
                    triggerValueAtMax: function() {
                        this.callSuper();
                        self.doFlood();
                    }
                }]);
                
                self.actions = {};
                self.values = {};
                self.exits = [];
                self.hideAffectedBy = {};
                
                if (attrs.hidden == null) {
                    pkg.registerEventForHiddenAttrSetup(self);
                    delete attrs.hidden;
                }
                
                // Applied after the other attrs so any warnings, including those about the skill 
                // checks of actions and exits, can name the Event by its id.
                const {actions, exits} = attrs;
                delete attrs.actions;
                delete attrs.exits;
                
                self.callSuper(attrs);
                
                self.setActions(pkg.model.getEventActionsWithDefaults(actions));
                if (exits) self.setExits(exits);
            },
            
            getAsObj: function(cfg) {
                // FIXME: this is not really correct. We will fix once it's clear how EventModel
                // will be serialized both for Save and for an Event grid (once it is introduced).
                const retval = this.callSuper(cfg);
                for (const attrName of [
                    'name','hub','chronoLocked','start','duration','hidden','actionLimit','actions','values',
                    'exits','hideAffectedBy'
                ]) {
                    retval[attrName] = this[attrName];
                }
                for (const attrName of EVENT_STAT_IDS) {
                    // Use stableStringify since similarTo uses shallowEqual. If this gets 
                    // unwieldy change similarTo to use deepEqual and drop the stableStringify.
                    retval[attrName] = M.stableStringify(this[attrName].getAsObj(cfg));
                }
                return retval;
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            /*  An Event's image and Event Brief report are optional, so it only has them when
                the data says "image":true or "brief":true. Without one there's nothing to load,
                and no failed request for a missing file. */
            setImage: function(v) {this.image = v === true;},
            hasImage: function() {return this.image === true;},
            setBrief: function(v) {this.brief = v === true;},
            hasBrief: function() {return this.brief === true;},
            
            /** @overrides MediaSupport */
            getMediaUrls: function() {
                return this.hasImage() ? this.callSuper() : [null, null];
            },
            
            isHQ: function() {return this.id === EVENT_ID_TIME_CORPS_HQ;},
            isTheVoid: function() {return this.id === EVENT_ID_THE_VOID;},
            
            // Hubs are free from paradox. Events like the HQ and The Void are hubs.
            setHub: function(v) {this.set('hub', v, true);},
            isHub: function() {return this.hub;},
            isNotHub: function() {return !this.isHub();},
            
            // Chrono Locked Events do not ordinarily allow time travel into or out of them.
            setChronoLocked: function(v) {this.set('chronoLocked', v, true);},
            isChronoLocked: function() {return this.chronoLocked;},
            isNotChronoLocked: function() {return !this.isChronoLocked();},
            
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name;},
            
            // Time
            setTimeOrdering: function(v) {this._tiOr = v;},
            getTimeOrdering: function() {return this._tiOr;},
            
            setStart: function(start) {
                if (typeof start !== 'number') start = stringToMillis(start);
                if (this.start !== start) {
                    this.set('start', start, true);
                    updateEndAttr(this);
                }
            },
            getStart: function(formatted) {return formatted ? formatDate(this.start) : this.start;},
            getEnd: function(formatted) {return formatted ? formatDate(this.end) : this.end;},
            setDuration: function(duration) {
                if (typeof duration !== 'number') duration = durationToMillis(duration);
                if (this.duration !== duration) {
                    this.set('duration', duration, true);
                    updateEndAttr(this);
                }
            },
            getDuration: function(formatted) {return formatted ? formatDuration(this.duration) : this.duration;},
            
            // Hidden
            doHiddenChanged: function(hidden) {
                this.notifyCollectionOfUpdate();
                pkg.app.getTimelineView().notifyEventVisibilityChange(this);
                
                // Each known Event raises the Timeline's paradox limit.
                pkg.model.updateTimelineParadoxMax();
                
                // An agent already here when it's revealed counts as its first visit.
                if (!hidden) pkg.model.getAgentModelsForEvent(this.id)[0]?.tryToOpenEventBrief();
            },
            
            // Description
            doDescriptionChanged: function() {this.notifyCollectionOfUpdate();},
            
            // Visited by Agent Status
            setBeenVisited: function(v) {this.set('_beenVisited', v, true);},
            hasBeenVisited: function() {return this._beenVisited;},
            
            // Flooded
            /*  An Event floods when its paradox reaches its limit. Read as 
                "event.flooded". Setting it has none of the consequences of doFlood, e.g. when
                restoring a save. */
            setFlooded: function(v) {
                v = !!v;
                if (this.flooded !== v) {
                    this.set('flooded', v, true);
                    this.notifyCollectionOfUpdate();
                }
            },
            isFlooded: function() {return this.flooded;},
            
            // Action Limits
            setActionLimit: function(actionLimit) {this.set('actionLimit', actionLimit, true);},
            getActionLimit: function() {return this.actionLimit;},
            
            setParadox: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('EventModel.setParadox after init', this);
                } else {
                    this[STAT_ID_PARADOX].setValue(v);
                }
            },
            
            setHistoricity: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('EventModel.setHistoricity after init', this);
                } else {
                    this[STAT_ID_HISTORICITY].setValue(v);
                }
            },
            
            setAttestation: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('EventModel.setAttestation after init', this);
                } else {
                    this[STAT_ID_ATTESTATION].setValue(v);
                }
            },
            
            // Location
            setLocation: function(location) { // An ID string.
                if (this.location !== location) {
                    this._locModel = null;
                    this.set('location', location, true);
                }
            },
            getLocation: function() {return this.location;},
            getLocationModel: function() {
                return this._locModel ?? (this._locModel = pkg.model.getLocation(this.location));
            },
            
            // Agents
            getAgentModels: function() {
                return pkg.model.getAgentModelsForEvent(this.id);
            },
            
            // Actions
            setActions: function(actions, clone=false) {
                for (const id in actions) this.addAction(id, actions[id], clone);
            },
            addAction: function(id, actionDatum, clone=true) {
                const actions = this.actions;
                if (actions[id] == null) {
                    if (clone) actionDatum = structuredClone(actionDatum);
                    actionDatum.id = id;
                    actionDatum.event = this;
                    actions[id] = new EventActionModel(actionDatum);
                } else {
                    console.warn('Attempt to clobber existing event action', id);
                }
            },
            getActionModels: function() {return this.actions;},
            
            // Values
            setValues: function(values) {
                for (const id in values) {
                    const datum = values[id];
                    datum.id = id;
                    datum.event = this;
                    this.values[id] = new EventValueModel(datum);
                }
            },
            getValueModels: function() {return this.values;},
            
            // Exits
            setExits: function(newExits) {
                const exits = this.exits;
                
                // Clear existing exits
                if (this.inited) {
                    for (const exit of exits) exit.destroy();
                    exits.length = 0;
                }
                
                for (const datum of newExits) {
                    datum.event = this;
                    exits.push(new EventExitModel(datum));
                }
            },
            getExitModels: function() {return this.exits;},
            
            getVisibleExitAndEntrances: function() {
                const accum = [];
                if (this.isNotHidden()) {
                    const eventModels = pkg.model.getEventModels();
                    for (const eventId in eventModels) {
                        const eventModel = eventModels[eventId];
                        if (eventModel === this) {
                            for (const exitModel of eventModel.getExitModels()) {
                                const toModel = exitModel.getToEventModel();
                                if (toModel && toModel !== this && toModel.isNotHidden() && exitModel.isNotHidden()) {
                                    accum.push(exitModel);
                                }
                            }
                        } else if (eventModel.isNotHidden()) {
                            for (const exitModel of eventModel.getExitModels()) {
                                if (exitModel.getToEventModel() === this) {
                                    if (exitModel.isNotHidden()) accum.push(exitModel);
                                }
                            }
                        }
                    }
                }
                return accum;
            },
            
            // Hide Affected By (hides the connections to precursors)
            setHideAffectedBy: function(hideAffectedBy) {
                for (const id in hideAffectedBy) {
                    this.hideAffectedBy[id] = new HideAffectedByModel({
                        id, 
                        event:this, 
                        hidden:hideAffectedBy[id]
                    });
                }
            },
            getHideAffectedByModels: function() {return this.hideAffectedBy;},
            getHideAffectedByModel: function(affectorEventModelOrId) {
                return this.hideAffectedBy[typeof affectorEventModelOrId === 'string' ? affectorEventModelOrId : affectorEventModelOrId?.id];
            },
            isAffectedByHidden: function(affectorEventModelOrId) {
                return this.getHideAffectedByModel(affectorEventModelOrId)?.isHidden() ?? false;
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            notifyCollectionOfUpdate: function() {
                if (this.inited) {
                    this.callSuper();
                    this.fireEvent('updated');
                }
            },
            
            notifyStatChanged: function(_statModel) {
                if (this.inited) this.notifyCollectionOfUpdate();
            },
            
            getPrecursors: function(noSelf=true) {
                const accum = new Set();
                for (const valueModel of Object.values(this.values)) valueModel.getAllObservables(null, accum);
                return toEventModels(accum, noSelf ? this : null);
            },
            
            getDescendants: function(noSelf=true) {
                const accum = new Set();
                for (const valueModel of Object.values(this.values)) valueModel.getAllObservers(null, accum);
                return toEventModels(accum, noSelf ? this : null);
            },
            
            // Persistence /////////////////////////////////////////////////////
            exportToObj: function() {
                const retval = {},
                    valuesObj = retval.values = {},
                    values = this.values;
                for (const statId of EVENT_STAT_IDS) retval[statId] = this[statId].exportToObj();
                for (const id in values) valuesObj[id] = values[id].exportToObj();
                if (this.flooded) retval.flooded = true;
                if (this._beenVisited) retval.beenVisited = true;
                if (this.hub) retval.hub = true;
                if (this.chronoLocked) retval.chronoLocked = true;
                
                const actionsObj = retval.actions = {},
                    actions = this.actions;
                for (const id in actions) actionsObj[id] = actions[id].exportToObj();
                return retval;
            },
            
            /*  Update only. Keys that are absent are left alone and unknown Values are skipped. */
            importFromObj: function(obj) {
                for (const statId of EVENT_STAT_IDS) {
                    if (obj[statId]) this[statId].importFromObj(obj[statId]);
                }
                if ('flooded' in obj) this.setFlooded(obj.flooded);
                if ('beenVisited' in obj) this.setBeenVisited(obj.beenVisited);
                if ('hub' in obj) this.setHub(obj.hub);
                if ('chronoLocked' in obj) this.setChronoLocked(obj.chronoLocked);
                
                const valuesObj = obj.values;
                if (valuesObj) {
                    const values = this.values;
                    for (const id in valuesObj) {
                        const valueModel = values[id];
                        if (valueModel) {
                            valueModel.importFromObj(valuesObj[id]);
                        } else {
                            console.warn('Save has unknown Value', id, 'for Event', this.id, '(skipping)');
                        }
                    }
                }
                
                const actionsObj = obj.actions;
                if (actionsObj) {
                    const actions = this.actions;
                    for (const id in actionsObj) {
                        const actionModel = actions[id];
                        if (actionModel) {
                            actionModel.importFromObj(actionsObj[id]);
                        } else {
                            console.warn('Save has unknown action', id, 'for Event', this.id, '(skipping)');
                        }
                    }
                }
            },
            
            /*  Called whenever the Event's paradox reaches its limit. The first time, the Event
                floods with paradox:
                    - No agent can time travel into or out of it. Its exits still work.
                    - Every agent who has ever been there gains a paradox per visit, which may 
                      devour them.
                    - Every descendant Event, known or not, gains a paradox, which may flood it
                      in turn. */
            doFlood: function() {
                if (this.flooded) return;
                this.setFlooded(true);
                
                // FIXME: once there's an event log we should be able to search that to count
                // Agent visits.
                for (const agentModel of pkg.model.getAgentModelsAsList()) {
                    const visits = agentModel.countVisitsToEvent(this);
                    agentModel[STAT_ID_PARADOX].adjValue(visits);
                }
                
                for (const descendant of this.getDescendants()) descendant[STAT_ID_PARADOX].adjValue(1);
            },
            
            formatAsTemporalExtent: function() {
                return formatCompactRange(this.getStart(), this.getEnd()) + ICON_SEPARATOR + '(' + this.getDuration(true) + ')';
            },
            
            validateEventDependencies: function() {
                let isValid = true;
                const start = this.getStart();
                for (const precursorEventModel of this.getPrecursors()) {
                    if (precursorEventModel.getEnd() > start) {
                        isValid = false;
                        console.warn(
                            'Event Ordering Issues: ' + precursorEventModel.id + ' ends ' + precursorEventModel.getEnd(true) +
                            ' after ' + this.id + ' starts ' + this.getStart(true)
                        );
                    }
                }
                return isValid;
            }
        });
    
    /*  Applies an adj block's entries, read with readChangeEntries, for a result, without 
        checks of their own, e.g. for an Operation. Each amount is rolled and added within 
        its target's limits. See applySetEntries for the other parameters. Action and exit 
        adjustments are StatAdjustmentModels instead, since they can have checks of their 
        own and show in tooltips. */
    pkg.applyAdjEntries = (entries, agentModel, eventModel, success, rollCfg) => {
        for (const key in entries) {
            const entry = entries[key],
                expr = success ? entry.onSuccess : entry.onFailure;
            if (expr === undefined) continue;
            
            const amount = pkg.checks.rollAmount(expr, rollCfg),
                target = getChangeTarget(entry.parsedKey, agentModel, eventModel);
            if (target && Number.isFinite(amount)) target.adjValue(target.getAllowedAdj(mathRound(amount)).adj);
        }
    };
    
    /*  Reads the set and adj blocks of something with no agent or Event of its own, e.g. an
        Operation's onSetup or a prompt button's onClick, so they name Events and agents by
        ID, e.g. "events.collision.historicity" or "agents.ME.faction". They're applied as a
        success, so an onFailure warns, naming what never uses it, e.g. "an Operation". */
    pkg.readSuccessChanges = (where, cfg, owner) => {
        const changes = {
            set:readChangeEntries(where + ' set', cfg.set, {keepString:true, isSet:true}),
            adj:readChangeEntries(where + ' adj', cfg.adj)
        };
        for (const block of ['set', 'adj']) {
            for (const key in changes[block]) {
                const {onSuccess, onFailure} = changes[block][key];
                if (onFailure !== undefined && onFailure !== onSuccess) console.warn(where, block, key, 'has onFailure, which ' + owner + ' never uses');
            }
        }
        return changes;
    };
    
    /*  Applies changes read by readSuccessChanges: the adjustments, then the sets, as for an
        action. Expressions see no agent or event, just "timeline", "scratch" and dice. */
    pkg.applySuccessChanges = changes => {
        if (changes) {
            const rollCfg = {};
            pkg.applyAdjEntries(changes.adj, null, null, true, rollCfg);
            applySetEntries(changes.set, null, null, true, rollCfg);
        }
    };
})(tc);
