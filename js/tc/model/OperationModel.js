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
            
            doDescriptionChanged: function() {this.operation.notifyCollectionOfUpdate();}
        });
    
    pkg.OperationModel = new JSClass('OperationModel', BaseModel, {
        include: [ConstrainableAttrSupport, Describable],
        
        /** @overrides ConstrainableAttrSupport */
        getConstraintScopeName: () => SCOPE_OPERATION,
        
        
        // Life Cycle //////////////////////////////////////////////////////
        init: function(attrs) {
            const self = this;
            
            self.objectives = {};
            
            // We need to give the Objectives a chance to settle since events must propogate
            // to update success/failure.
            self.determineSuccessfulCompletion = debounce(() => {
                if (self.isCurrent() && self.getProgress().completed) self.doCompletedSuccessfully();
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
        
        canProceed: function() {
            return this.getNextOperation() != null && this.getProgress().completed;
        },
        
        proceed: function() {
            if (this.canProceed()) pkg.model.setCurrentOperation(this.getNextOperation());
        },
        
        
        // Setup Config ////////////////////////////////////////////////////
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
        
        setRevealAgentsOnSetup: function(agentIds) {this.set('revealAgentsOnSetup', validateAgentIdList(agentIds, 'setup.revealAgents'), true);},
        setAwardAgentsOnSetup: function(agentIds) {this.set('awardAgentsOnSetup', validateAgentIdList(agentIds, 'setup.awardAgents'), true);},
        
        setSetup: function(setupCfg) {
            if (setupCfg) {
                this.setHistoricityAdjustments(setupCfg.historicityAdjustments);
                this.setRevealAgentsOnSetup(setupCfg.revealAgents);
                this.setAwardAgentsOnSetup(setupCfg.awardAgents);
                this.setInitialEventSelection(setupCfg.initialEventSelection);
                this.setInitialAgentSelection(setupCfg.initialAgentSelection);
            }
        },
        
        doSetup: function() {
            if (!this.setupApplied) {
                const rootModel = pkg.model;
                rootModel.adjustHistoricity(this.getHistoricityAdjustments());
                rootModel.revealAgents(this.revealAgentsOnSetup);
                rootModel.awardAgents(this.awardAgentsOnSetup);
                this.setupApplied = true;
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
                this.setRevealAgentsOnSuccess(onSuccessCfg.revealAgents);
                this.setAwardAgentsOnSuccess(onSuccessCfg.awardAgents);
            }
        },
        
        doCompletedSuccessfully: function() {
            if (!this.successGranted) {
                const rootModel = pkg.model;
                this.grantScore();
                this.grantHQChronal();
                rootModel.revealAgents(this.revealAgentsOnSuccess);
                rootModel.awardAgents(this.awardAgentsOnSuccess);
                this.successGranted = true;
                pkg.app.notifyOperationCompleted(this);
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////
        reset: function() {
            this.setupApplied = this.successGranted = false;
        },
        
        notifyCollectionOfUpdate: function() {
            if (this.inited) {
                this.callSuper();
                this.fireEvent('updated');
            }
        },
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);