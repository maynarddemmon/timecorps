(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {debounce, BaseModel} = myt,
        
        {
            ConstrainableAttrSupport, Describable, Hideable, setConstrainedValue,
            cfg:{STANDARD_DEBOUNCE_MILLIS},
            SCOPE_OPERATION
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
        
        /*  Reads an onSetup or onSuccess config's set and adj, which change the same things 
            as an action's, but name Events and agents by ID, since an Operation has no Event
            or agent of its own, e.g. "events.collision.historicity", "timeline.score" or 
            "agents.ME.chronal". */
        readChanges = (operationModel, where, cfg) => {
            const prefix = 'Operation ' + operationModel.id + ' ' + where;
            for (const oldKey of ['historicityAdjustments', 'awardScore', 'awardCredits', 'awardHQChronal']) {
                if (oldKey in cfg) console.warn(prefix, oldKey, 'is replaced by set and adj (ignoring it)');
            }
            return pkg.readSuccessChanges(prefix, cfg, 'an Operation');
        },
        
        // Where the player stands with an Operation. See OperationModel.getState.
        OPERATION_STATE_HIDDEN = pkg.OPERATION_STATE_HIDDEN = 'hidden',
        OPERATION_STATE_AVAILABLE = pkg.OPERATION_STATE_AVAILABLE = 'available',
        OPERATION_STATE_ACTIVE = pkg.OPERATION_STATE_ACTIVE = 'active',
        OPERATION_STATE_CURRENT = pkg.OPERATION_STATE_CURRENT = 'current',
        OPERATION_STATE_COMPLETED = pkg.OPERATION_STATE_COMPLETED = 'completed',
        
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
            
            setName: function(v) {this.set('name', v, true);},
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
                    } else if (observable.event?.isA?.(EventModel)) {
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
    
    /*  A mission. It's hidden until it becomes the current Operation, e.g. as the initial
        Operation or another's nextOperation, or until its "hidden" expression, if it has one,
        works out to false. Revealing it applies its onSetup, and it stays revealed from then
        on. While revealed and not yet completed it's active: it completes once all its
        Objectives are met, whether or not it's the current Operation. */
    pkg.OperationModel = new JSClass('OperationModel', BaseModel, {
        include: [ConstrainableAttrSupport, Hideable, Describable, pkg.MediaSupport],
        
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
            self.hidden = true;
            self.revealed = false;
            
            // Set here so expressions can observe them, e.g. "operations.first.successGranted".
            self.setupApplied = self.successGranted = false;
            
            // We need to give the Objectives a chance to settle since events must propogate
            // to update success/failure.
            self.determineSuccessfulCompletion = debounce(() => {
                if (self.isActive() && self.getProgress().completed) self.doOnSuccess();
            }, STANDARD_DEBOUNCE_MILLIS);
            
            // Applied after the other attrs so warnings about their set and adj can name the
            // Operation by its id.
            const {onSetup, onSuccess} = attrs;
            delete attrs.onSetup;
            delete attrs.onSuccess;
            
            self.callSuper(attrs);
            
            self.setOnSetup(onSetup);
            self.setOnSuccess(onSuccess);
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
        
        /*  Started and not yet completed, so progress can be made on it. */
        isActive: function() {return !!this.setupApplied && !this.successGranted;},
        
        /*  Revealed but not yet started, so the player can choose to start it. */
        isAvailable: function() {return this.isNotHidden() && !this.setupApplied;},
        
        /*  "hidden" until revealed, "available" until started, "completed" once its success 
            is granted, "current" while it's the Operation the player is focused on, and 
            "active" otherwise. */
        getState: function() {
            if (this.isHidden()) return OPERATION_STATE_HIDDEN;
            if (this.successGranted) return OPERATION_STATE_COMPLETED;
            if (!this.setupApplied) return OPERATION_STATE_AVAILABLE;
            return this.isCurrent() ? OPERATION_STATE_CURRENT : OPERATION_STATE_ACTIVE;
        },
        
        setName: function(v) {this.set('name', v, true);},
        getName: function() {return this.name;},
        
        setTitle: function(v) {this.set('title', v, true);},
        getTitle: function() {return this.title ?? 'Mission Brief';},
        
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
        
        
        // onSetup Config //////////////////////////////////////////////////////
        setInitialEventSelection: function(initialEventSelection) {
            this.set('initialEventSelection', initialEventSelection, true);
        },
        getInitialEventSelection: function() {return this.initialEventSelection;},
        
        setInitialAgentSelection: function(initialAgentSelection) {
            this.set('initialAgentSelection', initialAgentSelection, true);
        },
        getInitialAgentSelection: function() {return this.initialAgentSelection;},
        
        setRevealAgentsOnSetup: function(agentIds) {this.set('revealAgentsOnSetup', validateAgentIdList(agentIds, 'onSetup.revealAgents'), true);},
        setAwardAgentsOnSetup: function(agentIds) {this.set('awardAgentsOnSetup', validateAgentIdList(agentIds, 'onSetup.awardAgents'), true);},
        
        setOnSetup: function(onSetupCfg) {
            if (onSetupCfg) {
                this.setupChanges = readChanges(this, 'onSetup', onSetupCfg);
                this.setupPromptId = pkg.readPromptId('Operation ' + this.id + ' onSetup', onSetupCfg.prompt);
                this.setRevealAgentsOnSetup(onSetupCfg.revealAgents);
                this.setAwardAgentsOnSetup(onSetupCfg.awardAgents);
                this.setInitialEventSelection(onSetupCfg.initialEventSelection);
                this.setInitialAgentSelection(onSetupCfg.initialAgentSelection);
            }
        },
        
        
        // onSuccess Config ////////////////////////////////////////////////
        /*  An Operation's ID, or a check expression that works out to one when it's needed, 
            e.g. "agents.ME.faction === 'timecorps' ? 'titanic_noCollision' : 'syndicate_offer'",
            so how a mission was won can decide what comes next. */
        setNextOperation: function(nextOperation) {this.set('nextOperation', nextOperation, true);},
        getNextOperation: function() {
            const next = this.nextOperation;
            if (next == null) return null;
            
            const rootModel = pkg.model;
            let operationModel = rootModel.getOperationModel(next);
            if (!operationModel) {
                const nextId = pkg.checks.rollValue(next);
                operationModel = rootModel.getOperationModel(nextId);
                if (!operationModel) console.warn('Operation', this.id, 'nextOperation names no Operation:', next, '→', nextId);
            }
            return operationModel ?? null;
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
                this.successChanges = readChanges(this, 'onSuccess', onSuccessCfg);
                this.successPromptId = pkg.readPromptId('Operation ' + this.id + ' onSuccess', onSuccessCfg.prompt);
                this.setRevealAgentsOnSuccess(onSuccessCfg.revealAgents);
                this.setAwardAgentsOnSuccess(onSuccessCfg.awardAgents);
            }
        },
        
        
        // Persistence /////////////////////////////////////////////////
        exportToObj: function() {
            return {revealed:!!this.revealed, setupApplied:!!this.setupApplied, successGranted:!!this.successGranted};
        },
        
        /*  Restoring these before the current Operation is set keeps the setup and success
            rewards from being applied a second time, and a revealed Operation's brief from 
            being offered again. A started Operation was revealed, as saves from before
            "revealed" was kept don't say. */
        importFromObj: function(obj) {
            if (obj.revealed || obj.setupApplied) this.reveal();
            if ('setupApplied' in obj) this.setupApplied = obj.setupApplied;
            if ('successGranted' in obj) this.set('successGranted', obj.successGranted, true);
        },
        
        
        // Methods /////////////////////////////////////////////////////////
        reset: function() {
            this.setupApplied = false;
            this.set('successGranted', false, true);
        },
        
        // Notifications and Triggers
        notifyCollectionOfUpdate: function() {
            if (this.inited) {
                this.callSuper();
                this.fireEvent('updated');
            }
        },
        
        /*  Reveals the Operation for good, whatever its "hidden" expression works out to 
            from here on. Until it's started, it's available. */
        reveal: function() {
            if (!this.revealed) {
                this.revealed = true;
                this.setHidden(false);
                this.notifyCollectionOfUpdate();
            }
        },
        
        /*  A "hidden" expression revealing the Operation offers it to the player with its
            brief, once the campaign has started. Until then, Model.offerRevealedOperations 
            does. */
        doHiddenChanged: function(hidden) {
            if (!hidden && pkg.isAppReady()) this.offer();
        },
        
        /*  Reveals the Operation, if it wasn't yet, and opens its brief, from which the 
            player can accept it. */
        offer: function() {
            if (!this.revealed) {
                this.reveal();
                pkg.app.openMissionBrief(this);
            }
        },
        
        /*  Sets the Operation up, if it wasn't yet, and makes it current. The Mission Brief
            opens unless the player started the Operation from it. */
        start: function(fromBrief) {
            this.doOnSetup(fromBrief);
            pkg.model.setCurrentOperation(this);
        },
        
        /** @private */
        doOnSetup: function(fromBrief) {
            if (!this.setupApplied) {
                const rootModel = pkg.model;
                this.reveal();
                this.setupApplied = true;
                
                pkg.applySuccessChanges(this.setupChanges);
                if (!fromBrief) pkg.app.openMissionBrief(this);
                rootModel.revealAgents(this.revealAgentsOnSetup);
                rootModel.awardAgents(this.awardAgentsOnSetup);
                
                // After the Mission Brief and the dossiers of the Agents it reveals.
                pkg.openPrompt('Operation ' + this.id + ' onSetup', this.setupPromptId);
                
                this.notifyCollectionOfUpdate();
                
                // Its Objectives may already be met.
                this.determineSuccessfulCompletion();
            }
        },
        
        doOnSuccess: function() {
            const self = this;
            if (!self.successGranted) {
                const rootModel = pkg.model;
                pkg.applySuccessChanges(self.successChanges);
                rootModel.revealAgents(self.revealAgentsOnSuccess);
                rootModel.awardAgents(self.awardAgentsOnSuccess);
                self.set('successGranted', true, true);
                self.notifyCollectionOfUpdate();
                
                pkg.openPrompt('Operation ' + self.id + ' onSuccess', self.successPromptId, () => {
                    // The next Operation is available from now on, whether or not the player 
                    // goes on to it from the debrief. A check expression is worked out once, 
                    // here, so the prompt's answer can decide it.
                    const nextOperationModel = self.getNextOperation();
                    nextOperationModel?.reveal();
                    pkg.app.notifyOperationCompleted(self, nextOperationModel);
                });
            }
        },
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);
