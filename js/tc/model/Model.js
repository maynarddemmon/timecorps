(pkg => {
    'use strict';
    
    let model,
        skillCfgs = {},
        skillIds = [],
        skillCheckDefaults = {},
        scenarioIds = [],
        
        // See getTimeTravelHazards.
        timeTravelHazards = null,
        
        // See getAgingSkillGains.
        agingSkillGains = null,
        
        // The skill tracks the data gives, by ID, and the one marked the default. See 
        // getSkillTrack.
        skillTracks = new Map(),
        defaultSkillTrack = null,
        
        // The phrase an exit's button starts with, by its mode. See getExitModePhrase.
        exitModes = new Map(),
        
        commonEventActions = {};
    
    pkg.registerEventForHiddenAttrSetup = eventModel => eventsForHiddenAttrSetup.push(eventModel);
    
    const JSClass = JS.Class,
        
        {floor:mathFloor} = Math,
        
        {
            NotifyingNumericStatModel, AgentModel, LocationModel, FactionModel, EventModel, OperationModel, PromptModel,
            isPlainObject,
            cfg:{
                EVENT_ID_THE_VOID,
                TIMELINE_STARTING_PARADOX, TIMELINE_PARADOX_LIMIT, TIMELINE_PARADOX_LIMIT_PER_EVENT,
                SCORE_TO_CREDITS_EARN_AMOUNT,
                DEFAULT_SKILL_DIFFICULTY, DEFAULT_SKILL_EXPR,
                DEFAULT_DESCENDANT_ATTESTATION_FOR_REVEAL, DEFAULT_PRECURSOR_ATTESTATION_FOR_REVEAL
            },
            SCOPE_AGENTS, SCOPE_LOCATIONS, SCOPE_FACTIONS, SCOPE_PROMPTS, SCOPE_EVENTS, SCOPE_EVENT, SCOPE_OPERATIONS, SCOPE_SKILLS, SCOPE_SCRATCH,
            STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_SCORE, STAT_ID_CREDITS
        } = pkg,
        
        CHECK_SKILL_EXPR_PREFIX = pkg.SCOPE_AGENT + '.' + SCOPE_SKILLS + '.',
        
        // The data key for default skill checks by action type.
        DATA_KEY_SKILL_CHECKS = 'skillChecks',
        DATA_KEY_ACTION_GROUPS = 'actionGroups',
        DATA_KEY_TIME_TRAVEL_ADJ = 'timeTravelAdj',
        DATA_KEY_AGING_SKILL_GAINS = 'agingSkillGains',
        DATA_KEY_SKILL_TRACKS = 'skillTracks',
        DATA_KEY_EXIT_MODES = 'exitModes',
        
        /*  The track for a skill no track is given for, when the data marks none the default:
            a credit for a point near 0, and one more for every 100 the skill is from 0. A 
            track leaving out either number takes it from here. */
        BUILT_IN_SKILL_TRACK = Object.freeze({id:'default', minCredits:1, pointsPerExtraCredit:100}),
        
        /*  Reads one skill track's config, e.g. {"label":"Affinity", "minCredits":1, 
            "pointsPerExtraCredit":200}, into {id, label, minCredits, pointsPerExtraCredit, 
            isDefault}, warning about its problems. A number that's left out or unusable is the
            built-in track's. The label is shown beside a skill on the track, unless it's the 
            default, and is undefined if left out or unusable. */
        readSkillTrack = (id, cfg) => {
            const where = 'Skill track ' + id;
            if (!isPlainObject(cfg)) {
                console.warn(where, 'must be an object, e.g. {"minCredits":1, "pointsPerExtraCredit":100} (ignoring it):', cfg);
                return null;
            }
            let {label, default:isDefault=false, minCredits=BUILT_IN_SKILL_TRACK.minCredits, pointsPerExtraCredit=BUILT_IN_SKILL_TRACK.pointsPerExtraCredit, ...unknown} = cfg;
            if (Object.keys(unknown).length > 0) console.warn(where, 'has unknown keys', Object.keys(unknown).join(', '), '(ignoring them)');
            if (label !== undefined && (typeof label !== 'string' || label.trim() === '')) {
                console.warn(where, 'label must be a non-empty string (ignoring it):', label);
                label = undefined;
            }
            if (typeof isDefault !== 'boolean') {
                console.warn(where, 'default must be true or false (using false):', isDefault);
                isDefault = false;
            }
            if (!(Number.isInteger(minCredits) && minCredits >= 0)) {
                console.warn(where, 'minCredits must be a whole number, 0 or more (using ' + BUILT_IN_SKILL_TRACK.minCredits + '):', minCredits);
                minCredits = BUILT_IN_SKILL_TRACK.minCredits;
            }
            if (!(Number.isInteger(pointsPerExtraCredit) && pointsPerExtraCredit > 0)) {
                console.warn(where, 'pointsPerExtraCredit must be a whole number above 0 (using ' + BUILT_IN_SKILL_TRACK.pointsPerExtraCredit + '):', pointsPerExtraCredit);
                pointsPerExtraCredit = BUILT_IN_SKILL_TRACK.pointsPerExtraCredit;
            }
            return {id, label, minCredits, pointsPerExtraCredit, isDefault};
        },
        
        /*  Reads the agingSkillGains config, e.g. {"monthsPerGain":1, "weights":{"luck":25, …}},
            into {monthsPerGain, weights:[[skillId, weight], …], totalWeight}, warning about its
            problems. Weights are whole numbers above 0 and name skills the data has given so 
            far. null if nothing usable is left. */
        readAgingSkillGains = cfg => {
            const where = DATA_KEY_AGING_SKILL_GAINS;
            if (!isPlainObject(cfg)) {
                console.warn(where, 'must be an object, e.g. {"monthsPerGain":1, "weights":{"luck":25}} (ignoring it):', cfg);
                return null;
            }
            const {monthsPerGain=1, weights, ...unknown} = cfg;
            if (Object.keys(unknown).length > 0) console.warn(where, 'has unknown keys', Object.keys(unknown).join(', '), '(ignoring them)');
            if (!(typeof monthsPerGain === 'number' && monthsPerGain > 0)) {
                console.warn(where, 'monthsPerGain must be a number above 0 (ignoring it all):', monthsPerGain);
                return null;
            }
            if (!isPlainObject(weights)) {
                console.warn(where, 'weights must be an object of whole numbers by skill ID (ignoring it all):', weights);
                return null;
            }
            const usable = [];
            for (const [skillId, weight] of Object.entries(weights)) {
                if (!pkg.isSkillId(skillId)) {
                    console.warn(where, 'weights names no skill', skillId, '(ignoring it)');
                } else if (!(Number.isInteger(weight) && weight > 0)) {
                    console.warn(where, 'weight for', skillId, 'must be a whole number above 0 (ignoring it):', weight);
                } else {
                    usable.push([skillId, weight]);
                }
            }
            return usable.length > 0 ? {monthsPerGain, weights:usable, totalWeight:usable.reduce((total, [, weight]) => total + weight, 0)} : null;
        },
        
        /*  Merges a config over a base: objects key by key, all the way down, and anything else,
            arrays included, replaces what's there. Changes and returns the base, or returns 
            the config if the base isn't an object. */
        mergeCfg = (base, cfg) => {
            if (cfg === undefined) return base;
            if (!isPlainObject(base) || !isPlainObject(cfg)) return cfg;
            for (const key in cfg) base[key] = mergeCfg(base[key], cfg[key]);
            return base;
        },
        
        eventsForHiddenAttrSetup = [],
        
        // The names of the scratch entries the data declares.
        scratchNames = new Set(),
        
        // The action groups the data declares, by ID, as {id, label, order}.
        actionGroups = new Map(),
        
        /*  Reads one action group's config, warning about its problems. */
        readActionGroup = (id, cfg) => {
            const where = 'Action group ' + id;
            if (!isPlainObject(cfg)) {
                console.warn(where, 'must be an object with a label and an order (ignoring it):', cfg);
                return null;
            }
            
            let {label, order, ...unknown} = cfg;
            const unknownKeys = Object.keys(unknown);
            if (unknownKeys.length > 0) console.warn(where, 'has keys other than label and order (ignoring them):', unknownKeys.join(', '));
            if (typeof label !== 'string' || label.trim() === '') {
                console.warn(where, 'label must be a non-empty string (using its id):', label);
                label = id;
            }
            if (!Number.isFinite(order)) {
                console.warn(where, 'order must be a number (using 0):', order);
                order = 0;
            } else if (order === 0) {
                // 0 is the ungrouped actions' place, so the group's line comes right after theirs.
                console.warn(where, 'order is 0, the ungrouped actions\' order, so it comes right after them. Use a negative order to come before them or a positive one to come after.');
            }
            return {id, label, order};
        },
        isScratchValue = value => typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value),
        
        STARTING_SCORE = 0,
        STARTING_CREDITS = 0,
        
        TCModelCollection = pkg.TCModelCollection = new JSClass('TCModelCollection', myt.BaseModelCollection, {
            setScopeId: function(scopeId) {this.scopeId = scopeId;},
            
            processDatum: function(datum, _jsonContext) {
                this.addModel(datum);
            },
            
            fireUpdatedEvent: function(model) {
                this.callSuper(model);
                pkg.app.notifyModelUpdated(model, this.scopeId);
            },
            
            // Persistence //
            exportToObj: function() {
                const retval = {},
                    models = this.getAll();
                for (const id in models) retval[id] = models[id].exportToObj();
                return retval;
            },
            
            /*  Update only. Models are never added or removed, and unknown IDs are skipped. */
            importFromObj: function(obj) {
                for (const id in obj) {
                    const model = this.getById(id);
                    if (model) {
                        model.importFromObj(obj[id]);
                    } else {
                        console.warn('Save has unknown', this.scopeId, 'id:', id, '(skipping)');
                    }
                }
            },
            
            /*  A second pass for models that must finish restoring after constraint binding
                resumes. */
            completeImportFromObj: function(obj) {
                for (const id in obj) this.getById(id)?.completeImportFromObj?.(obj[id]);
            }
        }),
        
        PERSISTED_COLLECTION_SCOPES = [SCOPE_EVENTS, SCOPE_AGENTS, SCOPE_OPERATIONS],
        TIMELINE_STAT_IDS = [STAT_ID_PARADOX];
    
    pkg.Model = new JSClass('Model', myt.Node, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            model = this;
            
            // Entries the data declares, e.g. "wireless_clearBacklogEarlier_flipCount", read and
            // set as "scratch.<name>". Setting one fires an event of its name, so constraints
            // see it change.
            model[SCOPE_SCRATCH] = new myt.Eventable();
            model[STAT_ID_PARADOX] = new NotifyingNumericStatModel({
                notifyTargets:model, id:STAT_ID_PARADOX, absMin:0, min:0, value:0, max:TIMELINE_PARADOX_LIMIT
            }, [{
                // Reaching the limit, however it happens, destabilizes the Timeline.
                triggerValueAtMax: function() {
                    this.callSuper();
                    pkg.app.notifyTimelineParadoxExceeded();
                }
            }]);
            
            // Note: events, agents and locations are part of the external API.
            model[SCOPE_EVENTS]     = new TCModelCollection({modelClass:EventModel,     scopeId:SCOPE_EVENTS});
            model[SCOPE_AGENTS]     = new TCModelCollection({modelClass:AgentModel,     scopeId:SCOPE_AGENTS}, [{
                processDatum: function(datum, jsonContext) {
                    // Every Agent gets the shared description phrases after their own. Cloned
                    // so each Agent's phrase models are built from their own data.
                    const defaultDescription = jsonContext.agentDefaults?.description;
                    if (defaultDescription) {
                        const ownDescription = datum.description ?? [];
                        datum.description = [
                            ...(Array.isArray(ownDescription) ? ownDescription : [ownDescription]),
                            ...structuredClone(defaultDescription)
                        ];
                    }
                    
                    this.callSuper(datum, jsonContext);
                }
            }]);
            model[SCOPE_LOCATIONS]  = new TCModelCollection({modelClass:LocationModel,  scopeId:SCOPE_LOCATIONS}, [{
                processDatum: function(datum, jsonContext) {
                    if (typeof datum.order !== 'number') datum.order = 0;
                    
                    // Makes it easy to shift the order of all locations in a file by a fixed amount.
                    datum.order += jsonContext.locationsBaseOrder ?? 0;
                    this.callSuper(datum, jsonContext);
                }
            }]);
            model[SCOPE_OPERATIONS] = new TCModelCollection({modelClass:OperationModel, scopeId:SCOPE_OPERATIONS});
            model[SCOPE_FACTIONS]   = new TCModelCollection({modelClass:FactionModel,   scopeId:SCOPE_FACTIONS});
            model[SCOPE_PROMPTS]    = new TCModelCollection({modelClass:PromptModel,    scopeId:SCOPE_PROMPTS});
            
            model.callSuper(parent, attrs);
            
            model.reset(true);
            
            // Exposes tc.cfg to constraints and expressions. We freeze it as well so gameplay
            // can't accidentally change the cfg.
            Object.freeze(tc.cfg);
            model.cfg = tc.cfg;
        },
        
        
        // Events:Accessors & Methods //////////////////////////////////////////
        getEventModel: id => model[SCOPE_EVENTS].getById(id),
        getTheVoidEventModel: () => model.getEventModel(EVENT_ID_THE_VOID),
        getEventModels: () => model[SCOPE_EVENTS].getAll(),
        getEventModelsAsList: filterFunc => model[SCOPE_EVENTS].getAsList(filterFunc),
        
        getEventModelsInTimeOrder: () => model[SCOPE_EVENTS].getAsSortedList((a, b) => a.start - b.start),
        getOrderedEventsAndLocationsForTimeline: () => {
            const eventsAccum = [],
                locationsUsed = {},
                orderedEventModels = model.getEventModelsInTimeOrder();
            let lastStart = -1,
                timeOrdering = -1;
            for (const eventModel of orderedEventModels) {
                if (eventModel.isHidden()) {
                    eventModel.setTimeOrdering(-1);
                } else {
                    const eventStart = eventModel.start;
                    if (eventStart !== lastStart) {
                        lastStart = eventStart;
                        timeOrdering++;
                    }
                    eventModel.setTimeOrdering(timeOrdering);
                    eventsAccum.push(eventModel);
                    
                    const locModel = eventModel.getLocationModel();
                    locationsUsed[locModel.id] = locModel;
                }
            }
            return {
                events:eventsAccum, 
                locations:Object.values(locationsUsed).sort((a, b) => a.order - b.order)
            };
        },
        
        
        // Factions:Accessors & Methods ////////////////////////////////////////
        getFactionModel: id => model[SCOPE_FACTIONS].getById(id),
        getFactionModels: () => model[SCOPE_FACTIONS].getAll(),
        
        /*  The Faction whose HQ the Event is, or null if it's no Faction's. */
        getFactionModelForHQ: eventModel => {
            const factions = model[SCOPE_FACTIONS].getAll();
            for (const id in factions) {
                const faction = factions[id];
                if (faction.hq === eventModel?.id) return faction;
            }
            return null;
        },
        
        /*  The action group with the ID, as {id, label, order}, or undefined. */
        getActionGroup: id => actionGroups.get(id),
        
        /*  What can happen to an agent who pays chronal to time travel, as a 
            TimeTravelHazardsModel set for that chronal, or null if there's nothing, either 
            because the data gives no "timeTravelAdj" or because the time travel is free. */
        getTimeTravelHazards: chronal => chronal > 0 && timeTravelHazards?.hasAdjustments() ? timeTravelHazards.forTimeTravel(chronal) : null,
        
        /*  The skills an agent gains with experience, from init.json5's "agingSkillGains": 
            {monthsPerGain, weights:[[skillId, weight], …], totalWeight}, or null if none. For 
            every monthsPerGain of lived age, a skill picked by weight gains a point. */
        getAgingSkillGains: () => agingSkillGains,
        
        /*  Puts each agent's randomSkillsByTrack skills on their tracks, as a new game 
            starts. */
        pickRandomSkillsByTrack: () => {
            for (const agentModel of model.getAgentModelsAsList()) agentModel.pickRandomSkillsByTrack();
        },
        
        /*  Warns if the data gives skill tracks but marks none the default, so skills an 
            agent's skillsByTrack leaves out are on the built-in one, and about each other 
            track without a label, which shows its ID instead. */
        validateSkillTracks: () => {
            if (skillTracks.size > 0 && !defaultSkillTrack) console.warn(DATA_KEY_SKILL_TRACKS, 'marks no track the default, with "default":true (using a credit, and one more for every 100 points from 0)');
            for (const track of skillTracks.values()) {
                if (track !== defaultSkillTrack && track.label === undefined) console.warn('Skill track', track.id, 'has no label (showing its ID)');
            }
        },
        
        /*  Warns about each action whose group names no action group. It's shown with the 
            ungrouped actions. */
        validateActionGroups: () => {
            for (const eventModel of model.getEventModelsAsList()) {
                const actionModels = eventModel.getActionModels();
                for (const actionId in actionModels) {
                    const group = actionModels[actionId].getGroup();
                    if (group != null && !actionGroups.has(group)) console.warn('Event', eventModel.id, 'action', actionId, 'group names no action group (showing it with the ungrouped actions):', group);
                }
            }
        },
        
        /*  Warns about each Faction whose hq names no Event. */
        validateFactionHQs: () => {
            const factions = model[SCOPE_FACTIONS].getAll();
            for (const id in factions) {
                const hq = factions[id].hq;
                if (hq != null && !model.getEventModel(hq)) console.warn('Faction', id, 'hq names no Event:', hq);
            }
        },
        getFactionModelsAsList: filterFunc => model[SCOPE_FACTIONS].getAsList(filterFunc),
        
        getPromptModel: id => model[SCOPE_PROMPTS].getById(id),
        
        
        // Agents:Accessors & Methods //////////////////////////////////////////
        getAgentModel: id => model[SCOPE_AGENTS].getById(id),
        getAgentModels: () => model[SCOPE_AGENTS].getAll(),
        
        /*  The player's own Agent, init.json5's "playerAgent", e.g. You. Only Agents in its 
            faction are the player's to direct. Undefined if the data names none. */
        getPlayerAgentModel: () => model.playerAgentId ? model.getAgentModel(model.playerAgentId) : undefined,
        
        /*  The player agent's ID, which "player" in expressions and keys names, or undefined. */
        getPlayerAgentId: () => model.playerAgentId,
        
        /*  An Agent ID from the data, where "player" names the player agent. */
        resolveAgentId: agentId => agentId === pkg.SCOPE_PLAYER ? model.playerAgentId : agentId,
        
        /*  Warns if "playerAgent" names no Agent. */
        validatePlayerAgent: () => {
            const playerAgentId = model.playerAgentId;
            if (playerAgentId && !model.getAgentModel(playerAgentId)) console.warn('playerAgent names no Agent:', playerAgentId, '(so no Agent is held back by faction)');
        },
        getAgentModelsAsList: filterFunc => model[SCOPE_AGENTS].getAsList(filterFunc),
        getAgentModelsForEvent: eventId => model[SCOPE_AGENTS].getAsSortedList(
            (a, b) => b.getArrivalOrder() - a.getArrivalOrder(),
            agent => agent.getEvent() === eventId && agent.isNotHidden()
        ),
        getActiveAgentsAsList: () => model.getAgentModelsAsList(
            agentModel => agentModel.isPlayerControlled() && agentModel.isNotHidden() && agentModel.isNotDead() && agentModel.isNotDevoured()
        ),
        
        revealAgents: agentIds => {
            if (agentIds) {
                for (const agentId of agentIds) {
                    const agentModel = model.getAgentModel(model.resolveAgentId(agentId));
                    if (agentModel) {
                        agentModel.setHidden(false);
                    } else {
                        console.warn('No agent for id', agentId);
                    }
                }
            }
        },
        
        /*  Puts the Agents under player control. Does not change whether they are hidden. */
        awardAgents: agentIds => {
            if (agentIds) {
                for (const agentId of agentIds) {
                    const agentModel = model.getAgentModel(model.resolveAgentId(agentId));
                    if (agentModel) {
                        agentModel.setPlayerControlled(true);
                    } else {
                        console.warn('No agent for id', agentId);
                    }
                }
            }
        },
        
        
        // Locations:Accessors & Methods ///////////////////////////////////////
        getLocation: id => model[SCOPE_LOCATIONS].getById(id),
        getLocations: () => model[SCOPE_LOCATIONS].getAll(),
        getLocationsInOrder: () => model[SCOPE_LOCATIONS].getAsSortedList((a, b) => a.order - b.order),
        
        
        // Operations:Accessors & Methods //////////////////////////////////////
        getOperationModel: id => model[SCOPE_OPERATIONS].getById(id),
        getOperationModels: () => model[SCOPE_OPERATIONS].getAll(),
        getOperationModelsAsList: filterFunc => model[SCOPE_OPERATIONS].getAsList(filterFunc),
        
        setInitialOperation: operationId => model.initialOperation = operationId,
        getInitialOperation: () => model.getOperationModel(model.initialOperation),
        
        setCurrentOperation: operationModel => {
            const previousOperationModel = model.currentOperationModel;
            model.currentOperationModel = operationModel;
            pkg.app.notifyCurrentOperationChanged(previousOperationModel, operationModel);
            
            // Objectives may already be satisfied on arrival (e.g. the player completed
            // them while working an earlier op), so check now rather than waiting for
            // the next objective change.
            operationModel?.determineSuccessfulCompletion();
        },
        getCurrentOperation: () => model.currentOperationModel,
        
        /*  Offers the Operations whose "hidden" expressions revealed them before the 
            campaign started. Once it has, a reveal offers the Operation as it happens. */
        offerRevealedOperations: () => {
            for (const operationModel of model.getOperationModelsAsList()) {
                if (operationModel.isNotHidden()) operationModel.offer();
            }
        },
        
        
        // Scratch:Accessors & Methods /////////////////////////////////////////
        isScratchName: name => scratchNames.has(name),
        
        /*  Sets a declared scratch entry. A name that isn't declared, or a value that isn't a
            finite number, a boolean or a string, is ignored with a warning. */
        setScratch: (name, value) => {
            if (!scratchNames.has(name)) {
                console.warn('No scratch entry', name, 'is declared (ignoring the set):', value);
            } else if (!isScratchValue(value)) {
                console.warn('Scratch entry', name, 'must be a number, a boolean or a string (ignoring the set):', value);
            } else {
                model[SCOPE_SCRATCH].set(name, value, true);
            }
        },
        
        
        // Score:Accessors & Methods ///////////////////////////////////////////
        /*  Raising the score past its highest so far earns a credit for each new multiple of 
            SCORE_TO_CREDITS_EARN_AMOUNT it reaches. Lowering it takes no credits away, and 
            raising it back up to a score already reached earns nothing again. */
        setScore: function(v) {
            this.set(STAT_ID_SCORE, v, true);
            
            const peakScore = this.peakScore;
            if (v > peakScore) {
                this.set('peakScore', v, true);
                const earned = mathFloor(v / SCORE_TO_CREDITS_EARN_AMOUNT) - mathFloor(peakScore / SCORE_TO_CREDITS_EARN_AMOUNT);
                if (earned > 0) this.adjCredits(earned);
            }
        },
        adjScore: function(adj) {this.setScore(this.getScore() + adj);},
        getScore: function() {return this.score;},
        
        /*  The highest the score has been, which credits have been earned up to. */
        getPeakScore: function() {return this.peakScore;},
        
        
        // Credits:Accessors & Methods /////////////////////////////////////////
        /*  Credits are spent on things such as HQ actions. Read as "timeline.credits". */
        setCredits: function(v) {this.set(STAT_ID_CREDITS, v, true);},
        adjCredits: function(adj) {this.setCredits(this.getCredits() + adj);},
        getCredits: function() {return this.credits;},
        
        
        // Persistence //////////////////////////////////////////////////////////
        /*  The full saveable state. Locations are pure data so they are not included. The 
            PersistenceManager diffs this against a baseline so only changes get saved. */
        exportToObj: () => {
            const scratch = {};
            for (const name of scratchNames) scratch[name] = model[SCOPE_SCRATCH][name];
            
            const retval = {
                score:model.score,
                peakScore:model.peakScore,
                credits:model.credits,
                scratch,
                currentOperation:model.getCurrentOperation()?.id ?? null,
                selection:pkg.app.getSelectionForSave()
            };
            for (const statId of TIMELINE_STAT_IDS) retval[statId] = model[statId].exportToObj();
            for (const scope of PERSISTED_COLLECTION_SCOPES) retval[scope] = model[scope].exportToObj();
            return retval;
        },
        
        /*  First pass. Must run while constraint binding is paused (see PersistenceManager). */
        importFromObj: obj => {
            // The peak first, so restoring the score earns nothing.
            if ('peakScore' in obj) model.set('peakScore', obj.peakScore, true);
            if (STAT_ID_CREDITS in obj) model.setCredits(obj.credits);
            if (STAT_ID_SCORE in obj) model.setScore(obj.score);
            for (const name in obj.scratch) model.setScratch(name, obj.scratch[name]);
            for (const statId of TIMELINE_STAT_IDS) {
                if (obj[statId]) model[statId].importFromObj(obj[statId]);
            }
            for (const scope of PERSISTED_COLLECTION_SCOPES) {
                if (obj[scope]) model[scope].importFromObj(obj[scope]);
            }
        },
        
        /*  Second pass. Runs after constraint binding resumes so restored constraints have 
            their values before the current Operation checks its objectives. */
        completeImportFromObj: obj => {
            for (const scope of PERSISTED_COLLECTION_SCOPES) {
                if (obj[scope]) model[scope].completeImportFromObj(obj[scope]);
            }
            
            const timelineView = pkg.app.getTimelineView();
            if ('currentOperation' in obj) {
                // Null when the player left no mission current.
                const operationId = obj.currentOperation,
                    operationModel = operationId === null ? null : model.getOperationModel(operationId);
                if (operationId === null || operationModel) {
                    timelineView.deselectAll();
                    model.setCurrentOperation(operationModel);
                } else {
                    console.warn('Save has unknown current operation', obj.currentOperation, '(keeping', model.getCurrentOperation()?.id, ')');
                }
            }
            
            // After the current Operation since setting it applies the Operation's initial
            // selection, which the saved selection should override.
            if (obj.selection) pkg.app.restoreSelectionForLoad(obj.selection);
            
            pkg.app.notifyAgentLocOrVisChange();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*notifyStatChanged: function(statModel) {
            if (this.inited) console.log('Stat Changed', statModel);
        },*/
        
        /*  Sets the Timeline's maximum paradox: TIMELINE_PARADOX_LIMIT plus 
            TIMELINE_PARADOX_LIMIT_PER_EVENT for each non-hub Event that isn't hidden. Lowering 
            it below the current paradox clamps the paradox, which destabilizes the Timeline. */
        updateTimelineParadoxMax: () => {
            if (pkg.isAppReady()) {
                const visCount = model.getEventModelsAsList(eventModel => eventModel.isNotHub() && eventModel.isNotHidden()).length;
                model[STAT_ID_PARADOX].setMax(
                    mathFloor(TIMELINE_PARADOX_LIMIT + TIMELINE_PARADOX_LIMIT_PER_EVENT * visCount)
                );
            }
        },
        
        reset: isInit => {
            model[STAT_ID_PARADOX].setValue(TIMELINE_STARTING_PARADOX);
            model.updateTimelineParadoxMax();
            // The peak and credits first, so setting the score earns nothing.
            model.set('peakScore', STARTING_SCORE, true);
            model.setCredits(STARTING_CREDITS);
            model.setScore(STARTING_SCORE);
            
            if (!isInit) {
                for (const operationModel of model.getOperationModelsAsList()) operationModel.reset();
            }
        },
        
        processData: json => {
            // The scenario files to load after this one, e.g. ["titanic_scenario"].
            const scenarios = json.scenarios;
            if (scenarios !== undefined) {
                if (Array.isArray(scenarios) && scenarios.every(id => typeof id === 'string' && id.trim() !== '')) {
                    scenarioIds = [...scenarios];
                } else {
                    console.warn('scenarios must be an array of file names, e.g. ["titanic_scenario"] (ignoring it):', scenarios);
                }
            }
            
            // Load any skills configurations found. Later files can add skills or replace one.
            const moreSkillConfigs = json[SCOPE_SKILLS];
            if (moreSkillConfigs) {
                skillCfgs = {...skillCfgs, ...moreSkillConfigs};
                skillIds = Object.keys(skillCfgs);
            }
            
            // Default skill checks by action type, e.g. "social" or "investigate".
            const moreSkillChecks = json[DATA_KEY_SKILL_CHECKS];
            if (moreSkillChecks) skillCheckDefaults = {...skillCheckDefaults, ...moreSkillChecks};
            
            // Scratch entries and their starting values, e.g. {"wireless_clearBacklogEarlier_flipCount":0}.
            const scratchCfg = json[SCOPE_SCRATCH];
            if (isPlainObject(scratchCfg)) {
                for (const name in scratchCfg) {
                    const value = scratchCfg[name];
                    if (!pkg.checkId('Scratch entry', name)) {
                        // Warned about.
                    } else if (!isScratchValue(value)) {
                        console.warn('Scratch entry', name, 'must start as a number, a boolean or a string (ignoring it):', value);
                    } else if (!scratchNames.has(name) && name in model[SCOPE_SCRATCH]) {
                        console.warn('Scratch entry name', name, 'is already in use (ignoring it)');
                    } else {
                        if (scratchNames.has(name)) console.warn('Duplicate scratch entry', name, '(using the later value)');
                        scratchNames.add(name);
                        model[SCOPE_SCRATCH].set(name, value, true);
                    }
                }
            } else if (scratchCfg !== undefined) {
                console.warn('scratch must be an object of starting values by name (ignoring it):', scratchCfg);
            }
            
            // Action groups, e.g. {"hq_pool":{"label":"HQ Chronal Pool", "order":1}}, which 
            // gather actions onto a line of their own where an agent's actions are shown.
            const actionGroupsCfg = json[DATA_KEY_ACTION_GROUPS];
            if (isPlainObject(actionGroupsCfg)) {
                for (const id in actionGroupsCfg) {
                    if (!pkg.checkId('Action group', id)) continue;
                    const actionGroup = readActionGroup(id, actionGroupsCfg[id]);
                    if (actionGroup) {
                        if (actionGroups.has(id)) console.warn('Duplicate action group', id, '(using the later one)');
                        actionGroups.set(id, actionGroup);
                    }
                }
            } else if (actionGroupsCfg !== undefined) {
                console.warn('actionGroups must be an object of groups by id (ignoring it):', actionGroupsCfg);
            }
            
            // What time travel can do to an agent, e.g. {"agent.health":{"actionType":"time_travel",
            // "difficulty":300, "onFailure":"-d(chronal)"}}. A later file's replaces an earlier's.
            const timeTravelAdj = json[DATA_KEY_TIME_TRAVEL_ADJ];
            if (timeTravelAdj !== undefined) {
                if (timeTravelHazards) console.warn(DATA_KEY_TIME_TRAVEL_ADJ, 'is given more than once (using the later one)');
                timeTravelHazards = new pkg.TimeTravelHazardsModel({adj:timeTravelAdj});
            }
            
            // How much training skills costs, by track, e.g. {"high":{"minCredits":1, 
            // "pointsPerExtraCredit":200}}. One is marked the default, with "default":true. A 
            // later file's track replaces an earlier one with the same ID.
            const skillTracksCfg = json[DATA_KEY_SKILL_TRACKS];
            if (isPlainObject(skillTracksCfg)) {
                for (const id in skillTracksCfg) {
                    if (!pkg.checkId('Skill track', id)) continue;
                    const track = readSkillTrack(id, skillTracksCfg[id]);
                    if (track) {
                        if (skillTracks.has(id)) console.warn('Duplicate skill track', id, '(using the later one)');
                        skillTracks.set(id, track);
                        if (track.isDefault) {
                            if (defaultSkillTrack && defaultSkillTrack.id !== id) console.warn('Skill track', id, 'is marked the default, as', defaultSkillTrack.id, 'is (using', id + ')');
                            defaultSkillTrack = track;
                        } else if (defaultSkillTrack?.id === id) {
                            defaultSkillTrack = null;
                        }
                    }
                }
            } else if (skillTracksCfg !== undefined) {
                console.warn(DATA_KEY_SKILL_TRACKS, 'must be an object of tracks by ID (ignoring it):', skillTracksCfg);
            }
            
            // The phrase an exit's button starts with, by its mode, e.g. {"walk":"Walk to"}, 
            // and "default" for any other. A later file's phrase replaces an earlier one for 
            // the same mode.
            const exitModesCfg = json[DATA_KEY_EXIT_MODES];
            if (isPlainObject(exitModesCfg)) {
                for (const mode in exitModesCfg) {
                    const phrase = exitModesCfg[mode];
                    if (typeof phrase === 'string' && phrase.trim() !== '') {
                        exitModes.set(mode, phrase);
                    } else {
                        console.warn(DATA_KEY_EXIT_MODES, mode, 'must be a phrase, e.g. "Walk to" (ignoring it):', phrase);
                    }
                }
            } else if (exitModesCfg !== undefined) {
                console.warn(DATA_KEY_EXIT_MODES, 'must be an object of phrases by mode (ignoring it):', exitModesCfg);
            }
            
            // The player agent, read first, since "player" in set and adj keys names it.
            const playerAgentId = json.playerAgent;
            if (playerAgentId !== undefined && pkg.checkId('playerAgent', playerAgentId)) model.playerAgentId = playerAgentId;
            
            // What carries from one game to the next. See pkg.legacy.
            pkg.legacy.readData(json);
            
            // Skills gained with experience. A later file's replaces an earlier's.
            const agingSkillGainsCfg = json[DATA_KEY_AGING_SKILL_GAINS];
            if (agingSkillGainsCfg !== undefined) {
                if (agingSkillGains) console.warn(DATA_KEY_AGING_SKILL_GAINS, 'is given more than once (using the later one)');
                agingSkillGains = readAgingSkillGains(agingSkillGainsCfg);
            }
            
            // Default Event Actions
            const defaultEventActions = json.defaultEventActions ?? {};
            for (const actionId in defaultEventActions) {
                commonEventActions[actionId] = defaultEventActions[actionId];
            }
            
            // Factions first, so Agents in the same file can be put in them.
            for (const dataKey of [SCOPE_FACTIONS, SCOPE_LOCATIONS, SCOPE_EVENTS, SCOPE_AGENTS, SCOPE_PROMPTS, SCOPE_OPERATIONS]) {
                const data = json[dataKey];
                if (data) {
                    const modelCol = model[dataKey];
                    for (const id in data) {
                        if (!pkg.checkId(dataKey, id)) continue;
                        if (modelCol.getById(id)) console.warn('Duplicate', dataKey, 'id:', id, '(merging onto existing)');
                        
                        const datum = data[id];
                        datum.id = id;
                        modelCol.processDatum(datum, json);
                    }
                }
            }
            
            const initialOperation = json.initialOperation;
            if (initialOperation !== undefined) model.setInitialOperation(initialOperation);
        },
        
        getScenarioIds: () => scenarioIds,
        
        validateAllEventDependencies: () => {
            const eventModels = model.getEventModels();
            let isValid = true;
            for (const eventId in eventModels) {
                if (!eventModels[eventId].validateEventDependencies()) isValid = false;
            }
            return isValid;
        },
        
        /*  Events in the same Location must not overlap in time. The timeline relies on this so
            an Event drawn across several tiers never covers another Event in its column. */
        validateNoLocationOverlaps: () => {
            const byLocation = {},
                eventModels = model.getEventModels();
            for (const eventId in eventModels) {
                const eventModel = eventModels[eventId];
                (byLocation[eventModel.getLocation()] ??= []).push(eventModel);
            }
            
            let isValid = true;
            for (const locationId in byLocation) {
                const list = byLocation[locationId].sort((a, b) => a.getStart() - b.getStart());
                for (let i = 1; i < list.length; i++) {
                    const prev = list[i - 1],
                        cur = list[i];
                    if (cur.getStart() < prev.getEnd()) {
                        isValid = false;
                        console.warn(
                            'Location Overlap: ' + locationId + ' : ' + prev.id + 
                            ' (' + prev.getStart(true) + ' → ' + prev.getEnd(true) + 
                            ') overlaps ' + cur.id + ' (' + cur.getStart(true) + ')'
                        );
                    }
                }
            }
            return isValid;
        },
        
        processHiddenAttrSetup: () => {
            const DOT = '.',
                ATTEST_DOT = STAT_ID_ATTESTATION + DOT,
                EVENT_DOT = SCOPE_EVENT + DOT,
                AND_EVENTS_DOT = ' && ' + SCOPE_EVENTS + '.',
                DESC_SUFFIX = DOT + ATTEST_DOT + 'value < ' + DEFAULT_DESCENDANT_ATTESTATION_FOR_REVEAL,
                PREC_SUFFIX = DOT + ATTEST_DOT + 'value < ' + DEFAULT_PRECURSOR_ATTESTATION_FOR_REVEAL,
                
                // Default to hidden if nothing is known about this Event.
                // event.attestation.value === 0 && event.historicty.value === 0
                BASE_HIDDEN_EXPR = EVENT_DOT + ATTEST_DOT + 'value === 0 && ' + EVENT_DOT + STAT_ID_HISTORICITY + '.value === 0';
            
            for (const eventModel of eventsForHiddenAttrSetup) {
                // If any descendants have an attestation of at least a minimum attestation the event
                // is unhidden.
                let hiddenExpr = BASE_HIDDEN_EXPR;
                for (const descendantEvent of eventModel.getDescendants()) {
                    // && events.<event_id>.attestation.value < <default_value>
                    hiddenExpr += AND_EVENTS_DOT + descendantEvent.id + DESC_SUFFIX;
                }
                for (const precursorEvent of eventModel.getPrecursors()) {
                    // && events.<event_id>.attestation.value < <default_value>
                    hiddenExpr += AND_EVENTS_DOT + precursorEvent.id + PREC_SUFFIX;
                }
                eventModel.setHidden(hiddenExpr);
            }
            eventsForHiddenAttrSetup.length = 0;
        },
        
        /*  An Event's actions from the data, with the default event actions first. An action
            with a default's ID is merged over that default, so it need only give what differs,
            e.g. {"_investigate":{"skillCheck":{"difficulty":150}}}, and null leaves the default
            out. Returns a new object, leaving the defaults and the given actions unchanged. */
        getEventActionsWithDefaults: actions => {
            const retval = {};
            for (const id in commonEventActions) {
                const override = actions?.[id];
                if (override !== null) retval[id] = mergeCfg(structuredClone(commonEventActions[id]), override);
            }
            for (const id in actions) {
                if (!Object.hasOwn(commonEventActions, id) && actions[id] != null) retval[id] = actions[id];
            }
            return retval;
        }
    });
    
    /*  The IDs of the skills configured in the data, in the order they were defined. */
    pkg.getSkillIds = () => skillIds;
    
    /*  True if there's a skill with this ID. */
    pkg.isSkillId = skillId => pkg.getSkillConfig(skillId) != null;
    
    /*  A skill's config, {name, description}, or undefined if there's no such skill. */
    pkg.getSkillConfig = skillId => skillCfgs[skillId];
    
    /*  Whether a skill can be trained at HQ: unless its config says "trainable":false, e.g. 
        luck, which only grows with experience. */
    pkg.isSkillTrainable = skillId => skillCfgs[skillId]?.trainable !== false;
    
    /*  A skill track by ID, as {id, label, minCredits, pointsPerExtraCredit, isDefault}, or 
        undefined.
        An agent's skillsByTrack puts their skills on tracks, which set what training costs: 
        minCredits for a point near 0, and one more for every pointsPerExtraCredit the skill
        is from 0. */
    pkg.getSkillTrack = trackId => skillTracks.get(trackId);
    
    /*  The track for skills an agent's skillsByTrack leaves out: the one the data marks the 
        default, or else the built-in one. */
    pkg.getDefaultSkillTrack = () => defaultSkillTrack ?? BUILT_IN_SKILL_TRACK;
    
    /*  The phrase an exit's button starts with, e.g. "Walk to", from init.json5's 
        "exitModes": the one for the exit's mode, or else the "default" one. "" if the data 
        gives neither. */
    pkg.getExitModePhrase = mode => exitModes.get(mode) ?? exitModes.get('default') ?? '';
    
    /*  The skill expression of a default skill check, by action type. If not found an attempt is
        made to return a simple skill check expression, otherwise a default expression
        is returned. */
    pkg.getSkillCheckExpr = actionType => {
        const expr = skillCheckDefaults[actionType]?.check;
        return expr == null ? 
            (pkg.isSkillId(actionType) ? CHECK_SKILL_EXPR_PREFIX + actionType : DEFAULT_SKILL_EXPR) 
            : expr;
    };
    
    /*  The difficulty of a default skill check, by action type. */
    pkg.getSkillDifficulty = actionType => pkg.checks.toNumericDifficulty(skillCheckDefaults[actionType]?.difficulty ?? DEFAULT_SKILL_DIFFICULTY);
    
    /*  The display name of a default skill check, by action type. Falls back to the name of the
        skill with that ID, otherwise the action type itself. */
    pkg.getSkillName = actionType => {
        const name = skillCheckDefaults[actionType]?.name;
        if (name == null) {
            const skillCfg = pkg.getSkillConfig(actionType);
            return skillCfg != null ? skillCfg.name : actionType;
        }
        return name;
    };
})(tc);
