(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {BaseModel, BaseModelCollection} = myt,
        
        {
            setConstrainedValue,
            cfg:{}
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
            setInitialEventSelection: function(initialEventSelection) {this.set('initialEventSelection', initialEventSelection, true);},
            getInitialEventSelection: function() {return this.initialEventSelection;},
            
            setInitialAgentSelection: function(initialAgentSelection) {this.set('initialAgentSelection', initialAgentSelection, true);},
            getInitialAgentSelection: function() {return this.initialAgentSelection;},
            
            setSetup: function(setupCfg) {
                if (setupCfg) {
                    this.setInitialEventSelection(setupCfg.initialEventSelection);
                    this.setInitialAgentSelection(setupCfg.initialAgentSelection);
                }
            },
            
            // onSuccess Config
            setNextOperation: function(nextOperation) {this.set('nextOperation', nextOperation, true);},
            getNextOperation: function() {
                return pkg.model.getOperationModel(this.nextOperation);
            },
            
            setOnSuccess: function(onSuccessCfg) {
                if (onSuccessCfg) {
                    this.setNextOperation(onSuccessCfg.nextOperation);
                }
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            notifyCollectionOfUpdate: function() {
                if (this.inited) {
                    this.callSuper();
                    this.fireEvent('updated');
                }
            }
        });
})(tc);