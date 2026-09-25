(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {debounce, BaseModel, BaseModelCollection} = myt,
        
        {
            setConstrainedValue,
            cfg:{STANDARD_DEBOUNCE_MILLIS, MISSION_SCORE_MULTIPLIER},
            STAT_ID_CHRONAL
        } = pkg,
        
        ObjectiveModel = new JSClass('ObjectiveModel', BaseModel, {
            init: function(attrs) {
                this.operation = attrs.operation;
                delete attrs.operation;
                this.callSuper(attrs);
            },
            
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name;},
            
            setDescription: function(description) {this.set('description', description, true);},
            getDescription: function() {return this.description;},
            
            setSuccess: function(success, isActual) {
                if (isActual) {
                    this.set('success', success, true);
                    this.operation.notifyCollectionOfUpdate();
                    if (success) this.operation.determineSuccessfulCompletion();
                } else {
                    setConstrainedValue(this.operation, this, 'success', success);
                }
            },
            isSuccess: function() {return this.success;}
        }),
        
        OperationModel = pkg.OperationModel = new JSClass('OperationModel', BaseModel, {
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
                for (const attrName of [
                    'name','description'
                ]) {
                    retval[attrName] = this[attrName];
                }
                return retval;
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            isCurrent: function() {return pkg.model.getCurrentOperation() === this;},
            
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name;},
            
            setDescription: function(description) {this.set('description', description, true);},
            getDescription: function() {return this.description;},
            
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
            
            // Setup Config
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
            
            setSetup: function(setupCfg) {
                if (setupCfg) {
                    this.setHistoricityAdjustments(setupCfg.historicityAdjustments);
                    this.setInitialEventSelection(setupCfg.initialEventSelection);
                    this.setInitialAgentSelection(setupCfg.initialAgentSelection);
                }
            },
            
            // onSuccess Config
            setNextOperation: function(nextOperation) {this.set('nextOperation', nextOperation, true);},
            getNextOperation: function() {
                return pkg.model.getOperationModel(this.nextOperation);
            },
            
            setAwardScore: function(awardScore) {this.set('awardScore', awardScore, true);},
            grantScore: function() {
                if (!this.awardScoreGranted) {
                    pkg.model.adjScore((this.awardScore ?? 0) * MISSION_SCORE_MULTIPLIER);
                    this.awardScoreGranted = true;
                }
            },
            
            setAwardHQChronal: function(awardHQChronal) {this.set('awardHQChronal', awardHQChronal, true);},
            grantHQChronal: function() {
                if (!this.awardHQChronalGranted) {
                    pkg.model[STAT_ID_CHRONAL].adjValue(this.awardHQChronal ?? 0);
                    this.awardHQChronalGranted = true;
                }
            },
            
            setOnSuccess: function(onSuccessCfg) {
                if (onSuccessCfg) {
                    this.setNextOperation(onSuccessCfg.nextOperation);
                    this.setAwardScore(onSuccessCfg.awardScore);
                    this.setAwardHQChronal(onSuccessCfg.awardHQChronal);
                }
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            reset: function() {
                this.awardScoreGranted = this.awardHQChronalGranted = false;
            },
            
            doCompletedSuccessfully: function() {
                this.grantScore();
                this.grantHQChronal();
            },
            
            notifyCollectionOfUpdate: function() {
                if (this.inited) {
                    this.callSuper();
                    this.fireEvent('updated');
                }
            }
        });
})(tc);