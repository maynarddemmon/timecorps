(pkg => {
    'use strict';
    
    const JSClass = JS.Class;
    
    let model;
    
    const {
            NotifyingNumericStatModel, AgentModel, LocationModel, EventModel, OperationModel,
            cfg:{
                EVENT_ID_THE_VOID, EVENT_ID_TIME_CORPS_HQ,
                TIMELINE_STARTING_CHRONAL, TIMELINE_CHRONAL_LIMIT,
                TIMELINE_STARTING_PARADOX, TIMELINE_PARADOX_LIMIT,
                AGENT_DEFAULT_STARTING_CHRONAL
            },
            SCOPE_AGENTS, SCOPE_LOCATIONS, SCOPE_EVENTS, SCOPE_OPERATIONS,
            STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HISTORICITY
        } = pkg,
        
        STARTING_SCORE = 0,
        
        TCModelCollection = pkg.TCModelCollection = new JSClass('TCModelCollection', myt.BaseModelCollection, {
            setScopeId: function(scopeId) {this.scopeId = scopeId;},
            
            processDatum: function(datum, jsonContext) {
                this.addModel(datum);
            },
            
            fireUpdatedEvent: function(model) {
                this.callSuper(model);
                pkg.app.notifyModelUpdated(model, this.scopeId);
            }
        });
    
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
        putEventModelsInTieredTimeOrder: () => {
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
            return {events:eventsAccum, locations:Object.values(locationsUsed).sort((a, b) => a.order - b.order)};
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
            operationModel?.doSetup();
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
                model.setCurrentOperation(model.getInitialOperation());
            }
        },
        
        processData: json => {
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
        }
    });
})(tc);
