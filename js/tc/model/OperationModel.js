(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {debounce, BaseModel} = myt,
        
        {
            ConstrainableAttrSupport, Describable, setConstrainedValue,
            cfg:{STANDARD_DEBOUNCE_MILLIS, MISSION_SCORE_MULTIPLIER},
            STAT_ID_CHRONAL, SCOPE_OPERATION
        } = pkg,
        
        /*  For models owned by an Operation. Expressions on them resolve against the
            Operation, so "operation..." refers to it. */
        ConstrainableToParentOperation = new JS.Module('ConstrainableToParentOperation', {
            include: [ConstrainableAttrSupport],
            
            /** @overrides ConstrainableAttrSupport */
            getConstraintScope: function() {return this.operation;},
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                this.operation = attrs.operation;
                delete attrs.operation;
                this.callSuper(attrs);
            }
        }),
        
        /*  Credits to award: a whole number of 0 or more. Anything else is 0, with a warning. */
        validateCredits = (v, label) => {
            if (v == null) return 0;
            if (Number.isInteger(v) && v >= 0) return v;
            console.warn(label, 'must be a whole number of 0 or more (using 0):', v);
            return 0;
        },
        
        validateAgentIdList = (list, label) => {
            if (list) {
                // Assume non-arrays are bare strings.
                list = Array.isArray(list) ? list : [list];
                
                return list.filter(agentId => {
                    if (typeof agentId === 'string') return true;
                    console.warn(label, 'non-string agent id. REMOVING:', agentId);
                    return false;
                });
            }
        },
        
        /*  Currently just a holder for a Descibable desription, no ID is even provided. If this is
            ever expanded we'll need to change OperationModel.setDebrief/getDebrief.
            
            The text shown when an Operation is completed. Constraints resolve against the 
            owning Operation, so phrases use "operation...", "events.<id>..." and "timeline..."
            to describe how the Operation was actually won. */
        DebriefModel = new JSClass('DebriefModel', BaseModel, {
            include: [ConstrainableToParentOperation, Describable]
        }),
        
        ObjectiveModel = new JSClass('ObjectiveModel', BaseModel, {
            include: [ConstrainableToParentOperation, Describable],
            
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name;},
            
            setSuccess: function(success, isActual) {
                if (isActual) {
                    this.set('success', success, true);
                    this.operation.notifyCollectionOfUpdate();
                    if (success) this.operation.determineSuccessfulCompletion();
                } else {
                    setConstrainedValue(this.getConstraintScope(), this, 'success', success);
                }
            },
            isSuccess: function() {return this.success;},
            
            /*  The parts of Events that the success expression reads, so the player can see
                what the Objective depends on. Each is {eventModel, valueModel, statId}: a
                Causator has a valueModel, an Event stat (e.g. attestation) has a statId, and
                anything else read from an Event has neither. One entry per Causator or stat,
                in the order the expression first reads them.
                
                Each also has "known", whether the player knows about it: false while its
                Event or Causator is hidden. Worked out when this is called, so call again
                after a reveal. */
            getPrecursors: function() {
                const EventModel = pkg.EventModel,
                    successFuncName = pkg.getConstraintFuncName('success'),
                    retval = [];
                // The constraint binds the expression's paths last to first, so reverse them.
                const observables = [...this.getAllObservables((_observable, funcName) => funcName === successFuncName)].reverse();
                const add = (eventModel, valueModel, statId) => {
                    retval.push({
                        eventModel, valueModel, statId,
                        known:eventModel.isNotHidden() && !valueModel?.isHidden()
                    });
                };
                for (const observable of observables) {
                    if (observable.isA(EventModel)) {
                        add(observable, null, null);
                    } else if (observable.event?.isA(EventModel)) {
                        add(observable.event, observable, null);
                    } else if (observable.notifyTargets?.isA?.(EventModel)) {
                        add(observable.notifyTargets, null, observable.id);
                    }
                }
                return retval;
            },
            
            /*  Whether the success expression reads anything from the Event. */
            dependsOnEvent: function(eventModel) {
                return this.getPrecursors().some(precursor => precursor.eventModel === eventModel);
            },
            
            /*  Whether the success expression reads a part of the Event the player knows
                about. */
            isEntangledWith: function(eventModel) {
                return this.getPrecursors().some(precursor => precursor.known && precursor.eventModel === eventModel);
            },
            
            doDescriptionChanged: function() {this.operation.notifyCollectionOfUpdate();}
        });
    
    pkg.OperationModel = new JSClass('OperationModel', BaseModel, {
        include: [ConstrainableAttrSupport, Describable, pkg.MediaSupport],
        
        /** @overrides ConstrainableAttrSupport */
        getConstraintScopeName: () => SCOPE_OPERATION,
        
        /** @overrides MediaSupport */
        getMediaFolder: () => 'mission',
        
        /*  Unlike Agents and Locations, an Operation's image is optional, so it only has one
            when the data says "image":true. Without one there's nothing to load, and no 
            failed request for a missing file. */
        setImage: function(v) {this.image = v === true;},
        hasImage: function() {return this.image === true;},
        
        /** @overrides MediaSupport */
        getMediaUrls: function() {
            return this.hasImage() ? this.callSuper() : [null, null];
        },
        
        
        // Life Cycle //////////////////////////////////////////////////////
        init: function(attrs) {
            const self = this;
            
            self.objectives = {};
            
            // We need to give the Objectives a chance to settle since events must propogate
            // to update success/failure.
            self.determineSuccessfulCompletion = debounce(() => {
                if (self.isCurrent() && self.getProgress().completed) self.doOnSuccess();
            }, STANDARD_DEBOUNCE_MILLIS);
            
            self.callSuper(attrs);
        },
        
        getAsObj: function(cfg) {
            // FIXME: this is not really correct.
            const retval = this.callSuper(cfg);
            for (const attrName of ['name']) {
                retval[attrName] = this[attrName];
            }
            return retval;
        },
        
        
        // Accessors ///////////////////////////////////////////////////////
        isCurrent: function() {return pkg.model.getCurrentOperation() === this;},
        
        setName: function(name) {this.set('name', name, true);},
        getName: function() {return this.name;},
        
        // Objectives
        setObjectives: function(objectives) {
            for (const id in objectives) {
                const datum = objectives[id];
                datum.id = id;
                datum.operation = this;
                this.objectives[id] = new ObjectiveModel(datum);
            }
        },
        getObjectiveModels: function() {return this.objectives;},
        getObjectiveModelsAsList: function() {
            return Object.values(this.getObjectiveModels());
        },
        
        // Progress
        getProgress: function() {
            let success = 0,
                fail = 0;
            for (const objectiveModel of this.getObjectiveModelsAsList()) {
                if (objectiveModel.isSuccess()) {
                    success++;
                } else {
                    fail++;
                }
            }
            return {success, fail, total:success + fail, completed:fail === 0};
        },
        
        /*  Whether any Objective's success expression reads anything from the Event. */
        dependsOnEvent: function(eventModel) {
            return this.getObjectiveModelsAsList().some(objectiveModel => objectiveModel.dependsOnEvent(eventModel));
        },

        /*  Whether any Objective is entangled with the Event, i.e. its success expression
            reads a part of the Event the player knows about. The timeline marks these
            Events. */
        isEntangledWith: function(eventModel) {
            return this.getObjectiveModelsAsList().some(objectiveModel => objectiveModel.isEntangledWith(eventModel));
        },
        
        canProceed: function() {
            return this.getNextOperation() != null && this.getProgress().completed;
        },
        
        proceed: function() {
            if (this.canProceed()) pkg.model.setCurrentOperation(this.getNextOperation());
        },
        
        
        // onSetup Config //////////////////////////////////////////////////////
        setHistoricityAdjustments: function(adjObj) {
            // Enforce numerical values for adjustments.
            if (adjObj) {
                for (const eventId in adjObj) {
                    const value = adjObj[eventId];
                    if (typeof value !== 'number') {
                        delete adjObj[eventId];
                        console.warn('historicityAdjustment:', eventId, 'NaN', value, 'REMOVING.');
                    } else if (value < 0) {
                        delete adjObj[eventId];
                        console.warn('historicityAdjustment:', eventId, 'negative', value, 'REMOVING.');
                    }
                }
            }
            this.set('historicityAdjustments', adjObj, true);
        },
        getHistoricityAdjustments: function() {return this.historicityAdjustments;},
        
        setInitialEventSelection: function(initialEventSelection) {
            this.set('initialEventSelection', initialEventSelection, true);
        },
        getInitialEventSelection: function() {return this.initialEventSelection;},
        
        setInitialAgentSelection: function(initialAgentSelection) {
            this.set('initialAgentSelection', initialAgentSelection, true);
        },
        getInitialAgentSelection: function() {return this.initialAgentSelection;},
        
        setAwardCreditsOnSetup: function(v) {this.set('awardCreditsOnSetup', validateCredits(v, 'onSetup.awardCredits'), true);},
        
        setRevealAgentsOnSetup: function(agentIds) {this.set('revealAgentsOnSetup', validateAgentIdList(agentIds, 'onSetup.revealAgents'), true);},
        setAwardAgentsOnSetup: function(agentIds) {this.set('awardAgentsOnSetup', validateAgentIdList(agentIds, 'onSetup.awardAgents'), true);},
        
        setOnSetup: function(onSetupCfg) {
            if (onSetupCfg) {
                this.setHistoricityAdjustments(onSetupCfg.historicityAdjustments);
                this.setRevealAgentsOnSetup(onSetupCfg.revealAgents);
                this.setAwardAgentsOnSetup(onSetupCfg.awardAgents);
                this.setInitialEventSelection(onSetupCfg.initialEventSelection);
                this.setInitialAgentSelection(onSetupCfg.initialAgentSelection);
                this.setAwardCreditsOnSetup(onSetupCfg.awardCredits);
            }
        },
        
        
        // onSuccess Config ////////////////////////////////////////////////
        setNextOperation: function(nextOperation) {this.set('nextOperation', nextOperation, true);},
        getNextOperation: function() {
            return pkg.model.getOperationModel(this.nextOperation);
        },
        
        setAwardScore: function(awardScore) {this.set('awardScore', awardScore, true);},
        grantScore: function() {
            pkg.model.adjScore((this.awardScore ?? 0) * MISSION_SCORE_MULTIPLIER);
        },
        
        setAwardCreditsOnSuccess: function(v) {this.set('awardCreditsOnSuccess', validateCredits(v, 'onSuccess.awardCredits'), true);},
        
        setAwardHQChronal: function(awardHQChronal) {this.set('awardHQChronal', awardHQChronal, true);},
        grantHQChronal: function() {
            pkg.model[STAT_ID_CHRONAL].adjValue(this.awardHQChronal ?? 0);
        },
        
        // onSuccess
        setRevealAgentsOnSuccess: function(agentIds) {this.set('revealAgentsOnSuccess', validateAgentIdList(agentIds, 'onSuccess.revealAgents'), true);},
        setAwardAgentsOnSuccess: function(agentIds) {this.set('awardAgentsOnSuccess', validateAgentIdList(agentIds, 'onSuccess.awardAgents'), true);},
        
        setDebrief: function(debrief) {
            this._debrief?.destroy();
            this._debrief = debrief == null ? null : new DebriefModel({operation:this, description:debrief});
        },
        getDebrief: function() {return this._debrief?.getDescription() ?? '';},
        
        setOnSuccess: function(onSuccessCfg) {
            if (onSuccessCfg) {
                this.setDebrief(onSuccessCfg.debrief);
                this.setNextOperation(onSuccessCfg.nextOperation);
                this.setAwardScore(onSuccessCfg.awardScore);
                this.setAwardHQChronal(onSuccessCfg.awardHQChronal);
                this.setAwardCreditsOnSuccess(onSuccessCfg.awardCredits);
                this.setRevealAgentsOnSuccess(onSuccessCfg.revealAgents);
                this.setAwardAgentsOnSuccess(onSuccessCfg.awardAgents);
            }
        },
        
        
        // Persistence /////////////////////////////////////////////////
        exportToObj: function() {
            return {setupApplied:!!this.setupApplied, successGranted:!!this.successGranted};
        },
        
        /*  Restoring these before the current Operation is set keeps doOnSetup and the success
            rewards from being applied a second time. */
        importFromObj: function(obj) {
            if ('setupApplied' in obj) this.setupApplied = obj.setupApplied;
            if ('successGranted' in obj) this.successGranted = obj.successGranted;
        },
        
        
        // Methods /////////////////////////////////////////////////////////
        reset: function() {
            this.setupApplied = this.successGranted = false;
        },
        
        // Notifications and Triggers
        notifyCollectionOfUpdate: function() {
            if (this.inited) {
                this.callSuper();
                this.fireEvent('updated');
            }
        },
        
        doOnSetup: function() {
            if (!this.setupApplied) {
                const rootModel = pkg.model;
                rootModel.adjustHistoricity(this.getHistoricityAdjustments());
                pkg.app.openMissionBrief(this);
                rootModel.revealAgents(this.revealAgentsOnSetup);
                rootModel.awardAgents(this.awardAgentsOnSetup);
                rootModel.adjCredits(this.awardCreditsOnSetup ?? 0);
                this.setupApplied = true;
            }
        },
        
        doOnSuccess: function() {
            if (!this.successGranted) {
                const rootModel = pkg.model;
                this.grantScore();
                this.grantHQChronal();
                rootModel.adjCredits(this.awardCreditsOnSuccess ?? 0);
                rootModel.revealAgents(this.revealAgentsOnSuccess);
                rootModel.awardAgents(this.awardAgentsOnSuccess);
                this.successGranted = true;
                pkg.app.notifyOperationCompleted(this);
            }
        },
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);
