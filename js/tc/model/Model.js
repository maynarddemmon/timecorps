(pkg => {
    'use strict';
    
    const JSClass = JS.Class;
    
    let model,
        skillCfgs = {},
        skillIds = [],
        skillCheckDefaults = {};
    
    // The data key for default skill checks by action type.
    const DATA_KEY_SKILL_CHECKS = 'skillChecks';
    
    const {
            NotifyingNumericStatModel, AgentModel, LocationModel, EventModel, OperationModel,
            cfg:{
                EVENT_ID_THE_VOID, EVENT_ID_TIME_CORPS_HQ,
                TIMELINE_STARTING_CHRONAL, TIMELINE_CHRONAL_LIMIT,
                TIMELINE_STARTING_PARADOX, TIMELINE_PARADOX_LIMIT,
                AGENT_DEFAULT_STARTING_CHRONAL, DEFAULT_SKILL_DIFFICULTY, DEFAULT_SKILL_EXPR
            },
            SCOPE_AGENTS, SCOPE_LOCATIONS, SCOPE_EVENTS, SCOPE_OPERATIONS, SCOPE_SKILLS,
            STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HISTORICITY,
            CHECK_SKILL_EXPR_PREFIX
        } = pkg,
        
        STARTING_SCORE = 0,
        
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
        TIMELINE_STAT_IDS = [STAT_ID_PARADOX, STAT_ID_CHRONAL];
    
    pkg.Model = new JSClass('Model', myt.Node, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            model = this;
            
            model[STAT_ID_CHRONAL] = new NotifyingNumericStatModel({
                notifyTargets:model, id:STAT_ID_CHRONAL, absMin:0, min:0, value:0, max:TIMELINE_CHRONAL_LIMIT
            });
            model[STAT_ID_PARADOX] = new NotifyingNumericStatModel({
                notifyTargets:model, id:STAT_ID_PARADOX, absMin:0, min:0, value:0, max:TIMELINE_PARADOX_LIMIT
            }, [{
                triggerValueAtMax: function() {
                    this.callSuper();
                    // FIXME: perhaps provide a warning in the UI.
                    console.log('timeline max paradox reached.');
                },
                triggerValueClampedToMax: function() {
                    this.callSuper();
                    pkg.app.notifyTimelineParadoxExceeded();
                }
            }]);
            
            // Note: events, agents and locations are part of the external API.
            model[SCOPE_EVENTS]     = new TCModelCollection({modelClass:EventModel,     scopeId:SCOPE_EVENTS});
            model[SCOPE_AGENTS]     = new TCModelCollection({modelClass:AgentModel,     scopeId:SCOPE_AGENTS}, [{
                processDatum: function(datum, jsonContext) {
                    if (typeof datum.chronal !== 'number') {
                        datum.chronal = AGENT_DEFAULT_STARTING_CHRONAL;
                    }
                    
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
                    if (typeof datum.order !== 'number') {
                        console.warn(this.scopeId, datum.id, 'has no numeric order (', typeof datum.order, datum.order, ') defaulting to 0');
                        datum.order = 0;
                    }
                    
                    // Makes it easy to shift the order of all locations in a file by a fixed amount.
                    datum.order += jsonContext.locationsBaseOrder ?? 0;
                    this.callSuper(datum, jsonContext);
                }
            }]);
            model[SCOPE_OPERATIONS] = new TCModelCollection({modelClass:OperationModel, scopeId:SCOPE_OPERATIONS});
            
            model.callSuper(parent, attrs);
            
            model.reset(true);
        },
        
        
        // Events:Accessors & Methods //////////////////////////////////////////
        getEventModel: id => model[SCOPE_EVENTS].getById(id),
        getHQEventModel: () => model.getEventModel(EVENT_ID_TIME_CORPS_HQ),
        getTheVoidEventModel: () => model.getEventModel(EVENT_ID_THE_VOID),
        getEventModels: () => model[SCOPE_EVENTS].getAll(),
        
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
        
        
        // Agents:Accessors & Methods //////////////////////////////////////////
        getAgentModel: id => model[SCOPE_AGENTS].getById(id),
        getAgentModels: () => model[SCOPE_AGENTS].getAll(),
        getAgentModelsAsList: filterFunc => model[SCOPE_AGENTS].getAsList(filterFunc),
        getAgentModelsForEvent: eventId => model[SCOPE_AGENTS].getAsSortedList(
            (a, b) => b.getArrivalOrder() - a.getArrivalOrder(),
            agent => agent.getEvent() === eventId && !agent.isHidden()
        ),
        
        
        revealAgents: agentIds => {
            if (agentIds) {
                for (const agentId of agentIds) {
                    const agentModel = model.getAgentModel(agentId);
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
                    const agentModel = model.getAgentModel(agentId);
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
            model.currentOperationModel = operationModel;
            operationModel?.doOnSetup();
            pkg.app.getOpsView().notifyOperationSelectedChanged(model.getCurrentOperation());
            
            // Objectives may already be satisfied on arrival (e.g. the player completed
            // them while working an earlier op), so check now rather than waiting for
            // the next objective change.
            operationModel?.determineSuccessfulCompletion();
        },
        getCurrentOperation: () => model.currentOperationModel,
        
        
        // Score:Accessors & Methods ///////////////////////////////////////////
        setScore: function(v) {this.set('score', v, true);},
        adjScore: function(adj) {this.setScore(this.getScore() + adj);},
        getScore: function() {return this.score;},
        
        
        // Historicity:Accessors & Methods /////////////////////////////////////
        adjustHistoricity: function(adjObj) {
            if (adjObj) {
                for (const eventId in adjObj) {
                    const eventModel = this.getEventModel(eventId);
                    if (eventModel) {
                        const adjValue = adjObj[eventId];
                        eventModel[STAT_ID_HISTORICITY].adjValueToNoMoreThan(adjValue, adjValue);
                    } else {
                        console.warn('No event for id', eventId);
                    }
                }
            }
        },
        
        
        // Persistence //////////////////////////////////////////////////////////
        /*  The full saveable state. Locations are pure data so they are not included. The 
            PersistenceManager diffs this against a baseline so only changes get saved. */
        exportToObj: () => {
            const retval = {
                score:model.score,
                currentOperation:model.getCurrentOperation()?.id ?? null,
                selection:pkg.app.getSelectionForSave()
            };
            for (const statId of TIMELINE_STAT_IDS) retval[statId] = model[statId].exportToObj();
            for (const scope of PERSISTED_COLLECTION_SCOPES) retval[scope] = model[scope].exportToObj();
            return retval;
        },
        
        /*  First pass. Must run while constraint binding is paused (see PersistenceManager). */
        importFromObj: obj => {
            if ('score' in obj) model.setScore(obj.score);
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
                const operationModel = model.getOperationModel(obj.currentOperation);
                if (operationModel) {
                    timelineView.deselectAll();
                    model.setCurrentOperation(operationModel);
                } else {
                    console.warn('Save has unknown current operation', obj.currentOperation, '(keeping', model.getCurrentOperation()?.id, ')');
                }
            }
            
            // After the current Operation since setting it applies the Operation's initial
            // selection, which the saved selection should override.
            if (obj.selection) pkg.app.restoreSelectionForLoad(obj.selection);
            
            timelineView.notifyAgentLocOrVisChange();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*notifyStatChanged: function(statModel) {
            if (this.inited) console.log('Stat Changed', statModel);
        },*/
        
        reset: isInit => {
            model[STAT_ID_CHRONAL].setValue(TIMELINE_STARTING_CHRONAL);
            model[STAT_ID_PARADOX].setValue(TIMELINE_STARTING_PARADOX);
            model.setScore(STARTING_SCORE);
            
            if (!isInit) {
                for (const operationModel of model.getOperationModelsAsList()) operationModel.reset();
            }
        },
        
        processData: json => {
            // Load any skills configurations found. Later files can add skills or replace one.
            const moreSkillConfigs = json[SCOPE_SKILLS];
            if (moreSkillConfigs) {
                skillCfgs = {...skillCfgs, ...moreSkillConfigs};
                skillIds = Object.keys(skillCfgs);
            }
            
            // Default skill checks by action type, e.g. "social" or "investigate".
            const moreSkillChecks = json[DATA_KEY_SKILL_CHECKS];
            if (moreSkillChecks) skillCheckDefaults = {...skillCheckDefaults, ...moreSkillChecks};
            
            for (const dataKey of [SCOPE_LOCATIONS, SCOPE_EVENTS, SCOPE_AGENTS, SCOPE_OPERATIONS]) {
                const data = json[dataKey];
                if (data) {
                    const modelCol = model[dataKey];
                    for (const id in data) {
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
        }
    });
    
    /*  The IDs of the skills configured in the data, in the order they were defined. */
    pkg.getSkillIds = () => skillIds;
    
    /*  True if there's a skill with this ID. */
    pkg.isSkillId = skillId => pkg.getSkillConfig(skillId) != null;
    
    /*  A skill's config, {name, description}, or undefined if there's no such skill. */
    pkg.getSkillConfig = skillId => skillCfgs[skillId];
    
    /*  The IDs of the default skill checks (action types) configured in the data. */
    pkg.getSkillCheckIds = () => Object.keys(skillCheckDefaults);
    
    /*  The skill expression of a default skill check, by action type. If not found an attempt is
        made to return a simple skill check expression, otherwise a default expression
        is returned. */
    pkg.getSkillCheckExpr = actionType => {
        let expr = skillCheckDefaults[actionType]?.check;
        if (expr == null) {
            if (pkg.isSkillId(actionType)) {
                expr = CHECK_SKILL_EXPR_PREFIX + actionType;
            } else {
                expr = DEFAULT_SKILL_EXPR;
            }
        }
        return expr;
    };
    
    /*  The difficulty of a default skill check, by action type. */
    pkg.getSkillDifficulty = actionType => pkg.toDifficulty(skillCheckDefaults[actionType]?.difficulty ?? DEFAULT_SKILL_DIFFICULTY);
    
    /*  The display name of a default skill check, by action type. Falls back to the name of the
        skill with that ID, otherwise the action type itself. */
    pkg.getSkillName = actionType => {
        let name = skillCheckDefaults[actionType]?.name;
        if (name == null) {
            const skillCfg = pkg.getSkillConfig(actionType);
            if (skillCfg != null) {
                name = skillCfg.name;
            } else {
                name = actionType;
            }
        }
        return name;
    };
})(tc);
