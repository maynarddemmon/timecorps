(pkg => {
    'use strict';
    
    let model;
    
    const BaseModelCollection = myt.BaseModelCollection,
        
        {
            NotifyingNumericStatModel, AgentModel, LocationModel, EventModel, OperationModel,
            cfg:{
                EVENT_ID_THE_VOID, EVENT_ID_TIME_CORPS_HQ,
                TIMELINE_STARTING_CHRONAL, TIMELINE_CHRONAL_LIMIT,
                TIMELINE_STARTING_PARADOX, TIMELINE_PARADOX_LIMIT
            },
            SCOPE_AGENTS, SCOPE_LOCATIONS, SCOPE_EVENTS, SCOPE_OPERATIONS,
            STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HISTORICITY
        } = pkg,
        
        STARTING_SCORE = 0;
    
    pkg.Model = new JS.Class('Model', myt.Node, {
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
            model[SCOPE_EVENTS] = new BaseModelCollection({modelClass:EventModel}, [{
                fireAddedEvent: function(model) {
                    this.callSuper(model);
                    pkg.app.notifyEventModelAdded(model);
                },
                fireUpdatedEvent: function(model) {
                    this.callSuper(model);
                    pkg.app.notifyEventModelUpdated(model);
                },
                fireRemovedEvent: function(model) {
                    this.callSuper(model);
                    pkg.app.notifyEventModelRemoved(model);
                }
            }]);
            model[SCOPE_AGENTS] = new BaseModelCollection({modelClass:AgentModel});
            model[SCOPE_LOCATIONS] = new BaseModelCollection({modelClass:LocationModel});
            model[SCOPE_OPERATIONS] = new BaseModelCollection({modelClass:OperationModel}, [{
                fireUpdatedEvent: function(model) {
                    this.callSuper(model);
                    pkg.app.notifyOperationModelUpdated(model);
                }
            }]);
            
            model.callSuper(parent, attrs);
            
            model.reset(true);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        getEventModel: id => model[SCOPE_EVENTS].getById(id),
        getHQEventModel: () => model.getEventModel(EVENT_ID_TIME_CORPS_HQ),
        getTheVoidEventModel: () => model.getEventModel(EVENT_ID_THE_VOID),
        getEventModels: () => model[SCOPE_EVENTS].getAll(),
        
        getAgentModel: id => model[SCOPE_AGENTS].getById(id),
        getAgentModels: () => model[SCOPE_AGENTS].getAll(),
        getAgentModelsAsList: filterFunc => model[SCOPE_AGENTS].getAsList(filterFunc),
        getAgentModelsForEvent: eventId => model[SCOPE_AGENTS].getAsList(agent => agent.getEvent() === eventId),
        
        getLocation: id => model[SCOPE_LOCATIONS].getById(id),
        getLocations: () => model[SCOPE_LOCATIONS].getAll(),
        getLocationsInOrder: () => model[SCOPE_LOCATIONS].getAsSortedList((a, b) => a.order - b.order),
        
        getOperationModel: id => model[SCOPE_OPERATIONS].getById(id),
        getOperationModels: () => model[SCOPE_OPERATIONS].getAll(),
        getOperationModelsAsList: filterFunc => model[SCOPE_OPERATIONS].getAsList(filterFunc),
        
        setInitialOperation: operationId => model.initialOperation = operationId,
        getInitialOperation: () => model.getOperationModel(model.initialOperation),
        
        setCurrentOperation: operationModel => {
            model.currentOperationModel = operationModel;
            pkg.app.getOpsView().notifyOperationSelectedChanged(model.getCurrentOperation());
            
            // Objectives may already be satisfied on arrival (e.g. the player completed
            // them while working an earlier op), so check now rather than waiting for
            // the next objective change.
            operationModel?.determineSuccessfulCompletion();
        },
        
        getCurrentOperation: () => model.currentOperationModel,
        
        setScore: function(v) {this.set('score', v, true);},
        adjScore: function(adj) {this.setScore(this.getScore() + adj);},
        getScore: function() {return this.score;},
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*notifyStatChanged: function(statModel) {
            if (this.inited) console.log('Stat Changed', statModel);
        },*/
        
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
                    const modelCol = model[dataKey],
                        isLocations = dataKey === SCOPE_LOCATIONS;
                    
                    // Makes it easy to shift the order of all locations in a file by a fixed amount.
                    let baseOrder;
                    if (isLocations) baseOrder = json.locationsBaseOrder ?? 0;
                    
                    for (const id in data) {
                        if (modelCol.getById(id)) console.warn('Duplicate', dataKey, 'id:', id, '(merging onto existing)');
                        
                        const datum = data[id];
                        datum.id = id;
                        if (isLocations) {
                            if (typeof datum.order !== 'number') {
                                console.warn(dataKey, id, 'has no numeric order, using 0');
                                datum.order = 0;
                            }
                            datum.order += baseOrder;
                        }
                        modelCol.addModel(datum);
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