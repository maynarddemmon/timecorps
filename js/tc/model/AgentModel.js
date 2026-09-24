(pkg => {
    'use strict';
    
    const {max:mathMax, min:mathMin} = Math,
        
        M = myt,
        {stableStringify, getRandomInt} = M,
        
        {
            NotifyingNumericStatModel,
            ICON_HQ, ICON_JUMP,
            cfg:{
                EVENT_ID_THE_VOID, EVENT_ID_TIME_CORPS_HQ,
                AGENT_CHRONAL_LIMIT, AGENT_PARADOX_LIMIT, MAX_DISCOVERY_PER_INVESTIGATE,
                SCORE_PER_ATTESTATION, PARADOX_SCORE_MULTIPLIER
            },
            theme:{colorAction, fontFamilyMono},
            formatChronalAndParadox,
            STAT_ID_PARADOX, STAT_ID_CHRONAL
        } = pkg,
        
        LOG_TYPE_ORIGIN = 'origin',
        LOG_TYPE_DEPLOY = 'deploy',
        LOG_TYPE_RECALL = 'recall',
        LOG_TYPE_EXIT = 'exit',
        LOG_TYPE_ACTION = 'action',
        LOG_TYPE_INVESTIGATE = 'investigate',
        LOG_TYPE_DEVOURED = 'devoured',
        
        accrueEntryParadox = (agentModel, eventModelOrId) => {
            const paradox = agentModel.calculateParadoxForEntry(eventModelOrId, -1); // -1 because we will have just pushed an entry event of some kind onto the log.
            if (paradox > 0) {
                // Accrue in Event first since the Agent might get sent to The Void.
                const eventModel = agentModel.getEventModel();
                if (eventModel) {
                    agentModel.getEventModel()[STAT_ID_PARADOX].adjValue(paradox);
                } else {
                    console.warn('accrueEntryParadox for timeline should be mediated by an event');
                }
                
                agentModel[STAT_ID_PARADOX].adjValue(paradox);
                
                // Adjust score for paradox generated.
                pkg.model.adjScore(paradox * PARADOX_SCORE_MULTIPLIER);
            }
        };
    
    pkg.AgentModel = new JS.Class('AgentModel', M.BaseModel, {
        // Life Cycle //////////////////////////////////////////////////////////
        init: function(attrs) {
            const self = this;
            
            self.log = [];
            
            // The number of actions the Agent has executed in the EventModel they are currently in.
            self.actionExecCount = 0;
            
            self[STAT_ID_PARADOX] = new NotifyingNumericStatModel({
                notifyTargets:self, id:STAT_ID_PARADOX, absMin:0, min:0, value:0, max:AGENT_PARADOX_LIMIT
            }, [{
                triggerValueAtMax: function() {
                    this.callSuper();
                    // FIXME: perhaps provide a warning in the UI.
                    console.log('agent max paradox reached.');
                },
                triggerValueClampedToMax: function() {
                    this.callSuper();
                    self.doDevouredByChronovores();
                }
            }]);
            
            self[STAT_ID_CHRONAL] = new NotifyingNumericStatModel({
                notifyTargets:self, id:STAT_ID_CHRONAL, absMin:0, min:0, value:0, max:AGENT_CHRONAL_LIMIT
            });
            
            // Nullish event during init is assumed to be the HQ.
            attrs.event ??= EVENT_ID_TIME_CORPS_HQ;
            
            self.callSuper(attrs);
        },
        
        getAsObj: function(cfg) {
            const retval = this.callSuper(cfg);
            for (const attrName of ['name','event','actionExecCount']) retval[attrName] = this[attrName];
            for (const attrName of [STAT_ID_PARADOX,STAT_ID_CHRONAL]) {
                // Use stableStringify since similarTo uses shallowEqual. If this gets 
                // unwieldy change similarTo to use deepEqual and drop the stableStringify.
                retval[attrName] = stableStringify(this[attrName].getAsObj(cfg));
            }
            return retval;
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setName: function(name) {this.setAndNotifyCollection('name', name, true);},
        
        setParadox: function(v) { // Used by instantiation only.
            if (this.inited) {
                console.warn('AgentModel.setParadox after init', this);
            } else {
                this[STAT_ID_PARADOX].setValue(v);
            }
        },
        
        setChronal: function(v) { // Used by instantiation only.
            if (this.inited) {
                console.warn('AgentModel.setChronal after init', this);
            } else {
                this[STAT_ID_CHRONAL].setValue(v);
            }
        },
        
        setActionExecCount: function(v, noEventUpdate) {
            if (this.actionExecCount !== v) {
                this.setAndNotifyCollection('actionExecCount', v, true);
                if (this.inited && !noEventUpdate) this.getEventModel()?.notifyCollectionOfUpdate();
            }
        },
        getActionExecCount: function() {return this.actionExecCount;},
        incrementActionExecCount: function() {this.setActionExecCount(this.actionExecCount + 1);},
        getEventActionLimit: function() {return this.getEventModel()?.getActionLimit() ?? 0;},
        getActionsRemaining: function() {return mathMax(0, this.getEventActionLimit() - this.getActionExecCount());},
        canAct: function() {return this.getActionsRemaining() > 0;},
        getActionsPhrase: function() {
            return 'Actions: <span style="color:' + colorAction + ';font-family:' + fontFamilyMono + ';">' + this.getActionsRemaining() + '</span>';
        },
        
        setEvent_Hard: function(event, logEntry) {
            this.setEvent(event, logEntry, true);
        },
        setEvent: function(event, logEntry, forceIt) {
            if (this.event !== event || forceIt) {
                const oldEventModel = this.getEventModel();
                
                this._eventModel = null;
                this.setActionExecCount(0, true);
                
                this.set('event', event, true);
                const newEventModel = this._eventModel = pkg.model.getEventModel(this.event); // Populate immediately
                this.notifyCollectionOfUpdate();
                
                this.pushOntoLog(logEntry ?? {type:LOG_TYPE_ORIGIN, event:this.getEventModel()});
                accrueEntryParadox(this, newEventModel);
                oldEventModel?.notifyCollectionOfUpdate();
                newEventModel?.notifyCollectionOfUpdate();
                pkg.app.getTimelineView().notifyAgentLocOrVisChange(this);
            }
        },
        
        getEvent: function() {return this.event;},
        getEventModel: function() {return this._eventModel;},
        isAtEvent: function(eventModelOrId) {
            switch (typeof eventModelOrId) {
                case 'string':
                    return this.event === eventModelOrId;
                case 'object':
                    return this.getEventModel() === eventModelOrId;
                default:
                    console.warn('Unexpected type in isAtEvent', typeof eventModelOrId);
                    return false;
            }
        },
        isAtHQ: function() {return this.event === EVENT_ID_TIME_CORPS_HQ;},
        isAtTheVoid: function() {return this.event === EVENT_ID_THE_VOID;},
        
        
        // Methods /////////////////////////////////////////////////////////////
        notifyCollectionOfUpdate: function() {
            if (this.inited) {
                this.callSuper();
                this.fireEvent('updated');
            }
        },
        
        /*notifyStatChanged: function(statModel) {
            if (this.inited) console.log('Stat Changed', statModel);
        },*/
        
        getInfoForTimeTravel: function(eventModel) {
            const isHQ = eventModel.isHQ(),
                chronalNeeded = isHQ ? pkg.getChronalToRecall(this) : pkg.getChronalToDeploy(this, eventModel),
                chronalAvailable = -this[STAT_ID_CHRONAL].getValueToMin(),
                hasEnoughChronal = chronalNeeded <= chronalAvailable,
                paradoxCost = this.calculateParadoxForEntry(eventModel);
            let disabled,
                btnTxt;
            if (isHQ) {
                disabled = !hasEnoughChronal;
                btnTxt = ICON_HQ + ' Recall to HQ ' + formatChronalAndParadox(chronalNeeded, paradoxCost);
            } else {
                const isAlreadyAtEvent = this.isAtEvent(eventModel);
                disabled = !hasEnoughChronal;
                btnTxt = (this.isAtHQ() ? 'Deploy' : (isAlreadyAtEvent ? 'Loop' : 'Jump')) + ' Here ' + formatChronalAndParadox(chronalNeeded, paradoxCost);
            }
            return {disabled, btnTxt};
        },
        
        doDeployToEvent: function(eventModel) {
            if (eventModel) {
                const cost = pkg.getChronalToDeploy(this, eventModel);
                if (cost <= -this[STAT_ID_CHRONAL].getValueToMin()) {
                    this[STAT_ID_CHRONAL].adjValue(-cost);
                    this.setEvent_Hard(eventModel.id, {type:LOG_TYPE_DEPLOY, event:eventModel});
                } else {
                    console.warn('insufficent chronal to deploy');
                }
            } else {
                console.warn('doDeployToEvent: no eventModel');
            }
        },
        doRecallToHQ: function() {
            const hqEventModel = pkg.model.getHQEventModel();
            if (hqEventModel) {
                const cost = pkg.getChronalToRecall(this);
                if (cost <= -this[STAT_ID_CHRONAL].getValueToMin()) {
                    this[STAT_ID_CHRONAL].adjValue(-cost);
                    this.setEvent(hqEventModel.id, {type:LOG_TYPE_RECALL, event:hqEventModel});
                } else {
                    console.warn('insufficent chronal to recall');
                }
            } else {
                console.warn('doRecallToHQ: no eventModel');
            }
        },
        doFollowExit: function(exitModel) {
            if (this.getEventModel() === exitModel.event) {
                const toEvent = exitModel.getToEventModel();
                if (toEvent) {
                    this.setEvent(toEvent.id, {type:LOG_TYPE_EXIT, exit:exitModel});
                    pkg.app.selectEventBox(toEvent);
                }
            } else {
                console.warn('Agent not at event for exit:', exitModel, this);
            }
        },
        doAction: function(actionModel) {
            if (!this.canAct()) return;
            
            /*if (actionModel.isDone()) {
                console.warn('Attemp to do a done action.', actionModel, this);
                return;
            }*/
            
            const eventModel = this.getEventModel(),
                {setObj, event} = actionModel;
            
            if (eventModel !== event) {
                console.warn('Agent not in same event as action.', actionModel, this);
                return;
            }
            
            for (const key in setObj) {
                const value = setObj[key],
                    eventValueModel = event.values[key];
                if (eventValueModel) {
                    eventValueModel.setValue(value, false);
                } else {
                    console.warn('Missing Value in doIt:' + key);
                }
            }
            //actionModel.setDone(true);
            
            this.incrementActionExecCount();
            this.pushOntoLog({type:LOG_TYPE_ACTION, action:actionModel});
        },
        doInvestigate: function() {
            if (this.canAct()) {
                const eventModel = this.getEventModel();
                if (eventModel) {
                    const attestationStat = eventModel.attestation,
                        discoverableAmt = mathMin(MAX_DISCOVERY_PER_INVESTIGATE, attestationStat.getValueToMax());
                    if (discoverableAmt > 0) {
                        let discovered = 1;
                        if (eventModel.isRegularEvent() && discoverableAmt > discovered) {
                            discovered = getRandomInt(discovered, discoverableAmt);
                        }
                        
                        const adj = attestationStat.adjValue(discovered);
                        pkg.model.adjScore(adj * SCORE_PER_ATTESTATION);
                        this.incrementActionExecCount();
                        this.pushOntoLog({type:LOG_TYPE_INVESTIGATE, event:eventModel, amount:adj});
                        
                        // FIXME: mechanism to trigger various fog-of-war changes based on attestation.
                    }
                }
            }
        },
        
        // Paradox
        calculateParadoxForEntry: function(eventModelOrId, visitsAdj=0) {
            const eventModel = typeof eventModelOrId === 'string' ? pkg.model.getEventModel(eventModelOrId) : eventModelOrId;
            if (eventModel) {
                // Paradox is only to enter regular events.
                if (eventModel.isRegularEvent()) {
                    const visits = this.countVisitsToEvent(eventModel) + visitsAdj;
                    // More paradox the more times the Agent has already been to the Event.
                    if (visits > 0) return visits;
                }
            }
            return 0;
        },
        
        doDevouredByChronovores: function() {
            this[STAT_ID_CHRONAL].setMax(0); // They have lost the ability to time travel.
            this.setEvent(EVENT_ID_THE_VOID, {type:LOG_TYPE_DEVOURED});
        },
        
        // Life and Log
        pushOntoLog: function(logEntry) {this.log.push(logEntry);},
        getLog: function() {return this.log;},
        countVisitsToEvent: function(eventModel) {
            let count = 0;
            for (const entry of this.getLog()) {
                switch (entry.type) {
                    case LOG_TYPE_EXIT:
                        if (entry.exit.getToEventModel() === eventModel) count++;
                        break;
                    case LOG_TYPE_DEPLOY:
                    case LOG_TYPE_RECALL:
                    case LOG_TYPE_ORIGIN:
                        if (entry.event === eventModel) count++;
                        break;
                }
            }
            return count;
        }
    });
})(tc);