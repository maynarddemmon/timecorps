(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        {stableStringify, BaseModel} = myt,
        
        {
            NotifyingNumericStatModel, setConstrainedValue, getConstrainedValueCfg,
            timeUtil:{durationToMillis, stringToMillis, format:formatDate, formatCompactRange, formatDuration},
            STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_HEALTH, STAT_ID_CHRONAL,
            cfg:{
                EVENT_ID_TIME_CORPS_HQ, EVENT_ID_THE_VOID,
                EVENT_PARADOX_LIMIT, DEFAULT_ACTION_LIMIT
            },
            ICON_SEPARATOR, ICON_NIL,
            SCOPE_AGENT, SCOPE_EVENT, SCOPE_TIMELINE,
            DIFFICULTY_NO_ROLL, toDifficulty
        } = pkg,
        
        TRAVEL_MODE_WAIT ='wait',
        TRAVEL_MODE_WALK ='walk',
        TRAVEL_MODE_SWIM ='swim',
        TRAVEL_MODE_LIFEBOAT = 'lifeboat',
        
        ACTION_TYPE_SINGULAR = '', // Empty so data will be stored under the raw prefixes.
        PREFIX_SKILL_DIFF = '_SkDff_',
        PREFIX_SKILL_TYPE = '_SkTyp_',
        PREFIX_SKILL_EXPR = '_SkExp_',
        
        /*  Skill checks for an action, exit or effect. Checks are stored by action ID, so a model
            could have one per action it offers. */
        ActionCheckSupport = new JSModule('ActionCheckSupport', {
            /*  Sets the skill check for an action. An actionId of null is the model's own check,
                as for an EventActionModel. cfg is optional and so is each part of it:
                    {difficulty:<integer>, check:<skill expression>, actionType:<skill check id>}
                A part left out comes from the actionType's default skill check. A part that's the
                wrong type is ignored, with a warning. */
            addSkillCheck: function(actionId, cfg) {
                const self = this;
                actionId ??= ACTION_TYPE_SINGULAR;
                
                const diffId = PREFIX_SKILL_DIFF + actionId,
                    typeId = PREFIX_SKILL_TYPE + actionId,
                    exprId = PREFIX_SKILL_EXPR + actionId,
                    owner = self.getSkillCheckOwner(actionId),
                    warn = msg => console.warn(owner, 'skill check', msg + ':', cfg);
                
                self[diffId] = self[typeId] = self[exprId] = undefined;
                if (cfg == null) return;
                if (typeof cfg !== 'object' || Array.isArray(cfg)) {
                    warn('must be an object');
                    return false;
                }
                
                const {difficulty, check, actionType, ...unknown} = cfg;
                
                if (difficulty !== undefined) {
                    if (Number.isInteger(difficulty) || difficulty === DIFFICULTY_NO_ROLL) {
                        self[diffId] = toDifficulty(difficulty);
                    } else {
                        warn('difficulty must be an integer or "' + DIFFICULTY_NO_ROLL + '"');
                    }
                }
                
                if (actionType !== undefined) {
                    if (typeof actionType === 'string' && actionType.trim() !== '') {
                        self[typeId] = actionType;
                    } else {
                        warn('actionType must be a non-empty string');
                    }
                }
                
                if (check !== undefined) {
                    if (typeof check === 'string' && check.trim() !== '') {
                        self[exprId] = check;
                    } else {
                        warn('check must be a non-empty string');
                    }
                }
                
                const unknownKeys = Object.keys(unknown);
                if (unknownKeys.length > 0) warn('has unknown keys ' + unknownKeys.join(', '));
                return true;
            },
            /*  Names the model in warnings about its skill checks. */
            getSkillCheckOwner: function(actionId) {
                return this.event ? 'Event ' + this.event.id + ' action ' + this.id : 'Event ' + this.id + ' ' + actionId;
            },
            getActionSkillDifficulty: function(actionId=ACTION_TYPE_SINGULAR) {
                return this[PREFIX_SKILL_DIFF + actionId] ?? pkg.getSkillDifficulty(this.getActionSkillType(actionId));
            },
            getActionSkillExpr: function(actionId=ACTION_TYPE_SINGULAR) {
                return this[PREFIX_SKILL_EXPR + actionId] ?? pkg.getSkillCheckExpr(this.getActionSkillType(actionId));
            },
            getActionSkillName: function(actionId=ACTION_TYPE_SINGULAR) {
                return pkg.getSkillName(this.getActionSkillType(actionId));
            },
            getActionSkillType: function(actionId=ACTION_TYPE_SINGULAR) {
                return this[PREFIX_SKILL_TYPE + actionId] ?? actionId;
            }
        }),
        
        /*  The stats an effect can change, by the scope that has them: the agent taking the 
            action or exit, its Event, or the timeline. */
        EFFECT_STAT_IDS = pkg.EFFECT_STAT_IDS = {
            [SCOPE_AGENT]:[STAT_ID_HEALTH, STAT_ID_CHRONAL, STAT_ID_PARADOX],
            [SCOPE_EVENT]:[STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION],
            [SCOPE_TIMELINE]:[STAT_ID_PARADOX, STAT_ID_CHRONAL]
        },
        
        EFFECT_WHEN_SUCCESS = 'success',
        EFFECT_WHEN_FAILURE = 'failure',
        EFFECT_WHEN_BOTH = 'both',
        
        /*  One effect of an action or exit: a change to a stat, named by its key as 
            "<scope>.<stat>", e.g. "agent.health", "event.attestation" or "timeline.paradox". 
            See EFFECT_STAT_IDS. Configured as:
                onSuccess, onFailure - Amount expressions, e.g. "-d(6, 2)". At least one. A 
                    positive amount raises the stat and a negative one lowers it, within the 
                    stat's limits. An amount sees the same parameters as a check expression.
                difficulty, check, actionType - Optional. The effect's own skill check, as for 
                    an action. With one, the effect rolls it and uses onSuccess or onFailure by
                    its result. Without one, it follows the action's own check, and taking an 
                    exit counts as a success.
                enabledForActionSkillCheck - Actions only. Whether the effect applies when the
                    action's own check is a "success", a "failure" or "both", the default. */
        StatEffectModel = pkg.StatEffectModel = new JSClass('StatEffectModel', BaseModel, {
            include: [ActionCheckSupport],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const {owner, key, cfg} = attrs;
                delete attrs.owner;
                delete attrs.key;
                delete attrs.cfg;
                
                this.owner = owner;
                this.key = key;
                this.callSuper(attrs);
                
                this.valid = this.configure(cfg);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            /** @overrides ActionCheckSupport */
            getSkillCheckOwner: function() {
                return this.owner.getSkillCheckOwner() + ' effect ' + this.key;
            },
            
            hasOwnCheck: function() {return this.ownCheck;},
            
            /*  The amount expression for a result, or undefined if nothing happens then. */
            getAmountExpr: function(success) {return success ? this.onSuccess : this.onFailure;},
            
            /*  The model whose stat changes: the agent, the owner's Event or the timeline. */
            getTarget: function(agentModel) {
                switch (this.scopeName) {
                    case SCOPE_AGENT: return agentModel;
                    case SCOPE_EVENT: return this.owner.event;
                    case SCOPE_TIMELINE: return pkg.model;
                }
            },
            getStat: function(agentModel) {return this.getTarget(agentModel)?.[this.statId];},
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  Returns true if the config is usable. Problems are warned about. */
            configure: function(cfg) {
                const self = this,
                    warn = msg => console.warn(self.getSkillCheckOwner(), msg + ':', cfg),
                    [scopeName, statId, ...rest] = String(self.key).split('.');
                
                if (rest.length > 0 || !Object.hasOwn(EFFECT_STAT_IDS, scopeName) || !EFFECT_STAT_IDS[scopeName].includes(statId)) {
                    warn('must be named for a stat of the agent, event or timeline, e.g. "agent.health" (ignoring it)');
                    return false;
                }
                if (cfg == null || typeof cfg !== 'object' || Array.isArray(cfg)) {
                    warn('must be an object (ignoring it)');
                    return false;
                }
                self.scopeName = scopeName;
                self.statId = statId;
                
                const {onSuccess, onFailure, enabledForActionSkillCheck, ...checkCfg} = cfg,
                    toAmount = (name, amount) => {
                        if (amount === undefined) return undefined;
                        if (typeof amount === 'string' && amount.trim() !== '') return amount;
                        warn(name + ' must be a non-empty string (ignoring it)');
                    };
                self.onSuccess = toAmount('onSuccess', onSuccess);
                self.onFailure = toAmount('onFailure', onFailure);
                
                // Any other keys are the effect's own check, which warns about unknown ones.
                self.ownCheck = ['difficulty', 'check', 'actionType'].some(name => name in checkCfg);
                if (Object.keys(checkCfg).length > 0) self.addSkillCheck(null, checkCfg);
                
                self.enabledForActionSkillCheck = EFFECT_WHEN_BOTH;
                if (enabledForActionSkillCheck !== undefined) {
                    if (!self.owner.isGatedByActionSkillCheck()) {
                        warn('enabledForActionSkillCheck only applies to actions (ignoring it)');
                    } else if ([EFFECT_WHEN_SUCCESS, EFFECT_WHEN_FAILURE, EFFECT_WHEN_BOTH].includes(enabledForActionSkillCheck)) {
                        self.enabledForActionSkillCheck = enabledForActionSkillCheck;
                    } else {
                        warn('enabledForActionSkillCheck must be "success", "failure" or "both" (using "both")');
                    }
                }
                
                if (self.onSuccess == null && self.onFailure == null) {
                    warn('needs an onSuccess or onFailure amount (ignoring it)');
                    return false;
                }
                return true;
            },
            
            /*  Whether the effect applies given the action's own check result, if any. */
            appliesFor: function(actionCheck) {
                if (actionCheck) {
                    switch (this.enabledForActionSkillCheck) {
                        case EFFECT_WHEN_SUCCESS: return actionCheck.success === true;
                        case EFFECT_WHEN_FAILURE: return actionCheck.success === false;
                    }
                }
                return true;
            }
        }),
        
        /*  Gives an action or exit "effects": an object of StatEffectModel configs by key. */
        EffectsSupport = new JSModule('EffectsSupport', {
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const effects = attrs.effects,
                    hasInjurySkillCheck = 'injurySkillCheck' in attrs;
                delete attrs.effects;
                delete attrs.injurySkillCheck;
                
                // Applied after the other attrs so any warnings can name the owner.
                this.callSuper(attrs);
                
                if (hasInjurySkillCheck) console.warn(this.getSkillCheckOwner(), 'injurySkillCheck is replaced by effects, e.g. {"agent.health":{"onFailure":"-5"}} (ignoring it)');
                this.setEffects(effects);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setEffects: function(cfg) {
                const effects = this.effects = [];
                if (cfg == null) return;
                if (typeof cfg !== 'object' || Array.isArray(cfg)) {
                    console.warn(this.getSkillCheckOwner(), 'effects must be an object of effects by stat, e.g. "agent.health" (ignoring them):', cfg);
                    return;
                }
                for (const key in cfg) {
                    // Null leaves an effect out, e.g. to drop one from a default action.
                    if (cfg[key] === null) continue;
                    
                    const effectModel = new StatEffectModel({owner:this, key, cfg:cfg[key]});
                    if (effectModel.valid) effects.push(effectModel);
                }
            },
            getEffects: function() {return this.effects;},
            hasEffects: function() {return this.effects.length > 0;},
            
            /*  True if the effects can depend on the result of the owner's own check. */
            isGatedByActionSkillCheck: () => false
        }),
        
        /*  Reduces a set of observables or observers to the EventModels they belong to. */
        toEventModels = (things, excludeEventModel) => {
            const retval = new Set();
            for (const thing of things) {
                const eventModel = thing.isA(EventModel) ? thing : thing.event?.isA(EventModel) ? thing.event : null;
                if (eventModel && eventModel !== excludeEventModel) retval.add(eventModel);
            }
            return retval;
        },
        
        EVENT_STAT_IDS = [STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION],
        
        updateEndAttr = eventModel => {
            const {start, duration} = eventModel;
            if (start != null && duration != null) eventModel.set('end', start + duration);
        },
        
        ConstrainableToParentEvent = new JSModule('ConstrainableToParentEvent', {
            include: [pkg.ConstrainableAttrSupport],
            
            init: function(attrs) {
                this.event = attrs.event;
                delete attrs.event;
                this.callSuper(attrs);
            },
            
            getConstraintScope: function() {return this.event;}
        }),
        
        HideableEventPart = new JSModule('HideableEventPart', {
            include: [pkg.Hideable],
            
            init: function(attrs) {
                this.hidden = false;
                this.callSuper(attrs);
            },
            
            doHiddenChanged: function(_hidden) {this.event.notifyCollectionOfUpdate();}
        }),
        
        DescribableEventPart = new JSModule('DescribableEventPart', {
            include: [pkg.Describable],
            
            doDescriptionChanged: function() {this.event.notifyCollectionOfUpdate();}
        }),
        
        EventActionModel = new JSClass('EventActionModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart, ActionCheckSupport, EffectsSupport],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                //this.done = false;
                
                // Applied after the other attrs so any warnings can name the action and its Event.
                const skillCheck = attrs.skillCheck;
                delete attrs.skillCheck;
                
                this.callSuper(attrs);
                
                this.setSkillCheck(skillCheck);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setLabel: function(label) {this.set('label', label, true);},
            
            setSet: function(set) {this.set('setObj', set, true);},
            
            setSkillCheck: function(cfg) {
                this.addSkillCheck(null, cfg);
            },
            
            /** @overrides EffectsSupport */
            isGatedByActionSkillCheck: () => true,
            
            /*setDone: function(done) {
                this.set('done', done, true);
                this.event.notifyCollectionOfUpdate();
            },
            isDone: function() {return this.done;},*/
        }),
        
        EventValueModel = new JSClass('EventValueModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart, DescribableEventPart],
            
            
            // Accessors ///////////////////////////////////////////////////////
            setValue: function(value, isActual) {
                if (isActual) {
                    // Lets views react to a Value actually changing, e.g. the timeline animating
                    // the Event's box. Not fired while the Value is first being set up. Fired
                    // before the new value is set because setting it updates any dependent 
                    // Values right away, so listeners hear about changes in causal order.
                    if (this.inited && this.value !== value) this.event.fireEvent('valueChanged', this);
                    
                    this.set('value', value, true);
                    this.event.notifyCollectionOfUpdate();
                } else {
                    setConstrainedValue(this.getConstraintScope(), this, 'value', value);
                }
            },
            getValue: function() {return this.value;},
            
            /*  A player-facing name. Falls back to the id so unnamed Values still display. */
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name ?? this.id;},
            
            getDescription: function(joiner) {
                return this.callSuper(joiner) || String(this.getValue() ?? ICON_NIL);
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  Other Events whose Causators this Causator's value is computed from. Only the
                value constraint counts, not the hidden constraint. */
            getPrecursors: function() {
                const valueFuncName = pkg.getConstraintFuncName('value');
                return toEventModels(
                    this.getAllObservables((_observable, funcName) => funcName === valueFuncName),
                    this.event
                );
            },
            
            /*  Other Events with anything (a Causator, Action, Exit, etc.) that depends on this
                Causator's value. */
            getDescendants: function() {
                return toEventModels(
                    this.getAllObservers((_observer, _funcName, type) => type === 'value'),
                    this.event
                );
            },
            
            
            // Persistence /////////////////////////////////////////////////////
            /*  Saves the literal or expression last given to setValue rather than the actual 
                value, since an Action may have replaced a literal with an expression. */
            exportToObj: function() {
                return {value:getConstrainedValueCfg(this, 'value')};
            },
            importFromObj: function(obj) {
                if ('value' in obj) this.setValue(obj.value, false);
            }
        }),
        
        EventExitModel = new JSClass('EventExitModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart, ActionCheckSupport, EffectsSupport],
            
            
            // Accessors ///////////////////////////////////////////////////////
            /** @overrides ActionCheckSupport */
            getSkillCheckOwner: function() {
                // Not the default, which names an action.
                return 'Event ' + this.event?.id + ' exit to ' + this.to;
            },
            
            setMode: function(mode) {this.set('mode', mode, true);},
            
            setTo: function(to) {
                if (this.to !== to) {
                    this._toEventModel = null;
                    this.set('to', to, true); // An Event ID
                }
            },
            getToEventModel: function() {
                return this._toEventModel ?? (this._toEventModel = pkg.model.getEventModel(this.to));
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  How the exit is taken, as the start of a button label, e.g. "Walk to". */
            getModePhrase: function() {
                switch (this.mode) {
                    case TRAVEL_MODE_WAIT:     return 'Wait til';
                    case TRAVEL_MODE_WALK:     return 'Walk to';
                    case TRAVEL_MODE_SWIM:     return 'Swim to';
                    case TRAVEL_MODE_LIFEBOAT: return 'Lifeboat to';
                    default: return 'To';
                }
            }
        }),
        
        HideAffectedByModel = new JSClass('HideAffectedByModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart]
        }),
        
        EventModel = pkg.EventModel = new JSClass('EventModel', BaseModel, {
            include: [pkg.DescribableHideable],
            
            /** @overrides ConstrainableAttrSupport */
            getConstraintScopeName: () => SCOPE_EVENT,
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                const self = this;
                self.hidden = false;
                self.actionLimit = DEFAULT_ACTION_LIMIT;
                
                self[STAT_ID_HISTORICITY] = new NotifyingNumericStatModel({notifyTargets:self, id:STAT_ID_HISTORICITY, absMin:0, min:0, value:0, max:100, absMax:100});
                self[STAT_ID_ATTESTATION] = new NotifyingNumericStatModel({notifyTargets:self, id:STAT_ID_ATTESTATION, absMin:0, min:0, value:0, max:100, absMax:100});
                self[STAT_ID_PARADOX] =     new NotifyingNumericStatModel({notifyTargets:self, id:STAT_ID_PARADOX,     absMin:0, min:0, value:0, max:EVENT_PARADOX_LIMIT}, [{
                    adjValue: function(adj, cfg) {
                        const retval = this.callSuper(adj, cfg);
                        if (retval !== 0) pkg.model[STAT_ID_PARADOX].adjValue(retval);
                        return retval;
                    },
                    triggerValueAtMax: function() {
                        this.callSuper();
                        // FIXME: perhaps provide a warning in the UI.
                        console.log('event max paradox reached.');
                    },
                    triggerValueClampedToMax: function() {
                        this.callSuper();
                        self.doDevouredByChronovores();
                    }
                }]);
                
                self.actions = {};
                self.values = {};
                self.exits = [];
                self.hideAffectedBy = {};
                
                if (attrs.hidden == null) {
                    pkg.registerEventForHiddenAttrSetup(self);
                    delete attrs.hidden;
                }
                
                // Applied after the other attrs so any warnings, including those about the skill 
                // checks of actions and exits, can name the Event by its id.
                const {actions, exits} = attrs;
                delete attrs.actions;
                delete attrs.exits;
                
                self.callSuper(attrs);
                
                self.setActions(pkg.model.getEventActionsWithDefaults(actions));
                if (exits) self.setExits(exits);
            },
            
            getAsObj: function(cfg) {
                // FIXME: this is not really correct. We will fix once it's clear how EventModel
                // will be serialized both for Save and for an Event grid (once it is introduced).
                const retval = this.callSuper(cfg);
                for (const attrName of [
                    'name','start','duration','hidden','actionLimit','actions','values',
                    'exits','hideAffectedBy'
                ]) {
                    retval[attrName] = this[attrName];
                }
                for (const attrName of EVENT_STAT_IDS) {
                    // Use stableStringify since similarTo uses shallowEqual. If this gets 
                    // unwieldy change similarTo to use deepEqual and drop the stableStringify.
                    retval[attrName] = stableStringify(this[attrName].getAsObj(cfg));
                }
                return retval;
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            isHQ: function() {return this.id === EVENT_ID_TIME_CORPS_HQ;},
            isTheVoid: function() {return this.id === EVENT_ID_THE_VOID;},
            isNotRegularEvent: function() {return this.isHQ() || this.isTheVoid();},
            isRegularEvent: function() {return !this.isNotRegularEvent();},
            
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name;},
            
            // Time
            setTimeOrdering: function(v) {this._tiOr = v;},
            getTimeOrdering: function() {return this._tiOr;},
            
            setStart: function(start) {
                if (typeof start !== 'number') start = stringToMillis(start);
                if (this.start !== start) {
                    this.set('start', start, true);
                    updateEndAttr(this);
                }
            },
            getStart: function(formatted) {return formatted ? formatDate(this.start) : this.start;},
            getEnd: function(formatted) {return formatted ? formatDate(this.end) : this.end;},
            setDuration: function(duration) {
                if (typeof duration !== 'number') duration = durationToMillis(duration);
                if (this.duration !== duration) {
                    this.set('duration', duration, true);
                    updateEndAttr(this);
                }
            },
            getDuration: function(formatted) {return formatted ? formatDuration(this.duration) : this.duration;},
            
            // Hidden
            doHiddenChanged: function(_hidden) {
                this.notifyCollectionOfUpdate();
                pkg.app.getTimelineView().notifyEventVisibilityChange(this);
                
                // Each known Event raises the Timeline's paradox limit.
                pkg.model.updateTimelineParadoxMax();
            },
            
            // Description
            doDescriptionChanged: function() {this.notifyCollectionOfUpdate();},
            
            // Action Limits
            setActionLimit: function(actionLimit) {this.set('actionLimit', actionLimit, true);},
            getActionLimit: function() {return this.actionLimit;},
            
            setParadox: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('EventModel.setParadox after init', this);
                } else {
                    this[STAT_ID_PARADOX].setValue(v);
                }
            },
            
            setHistoricity: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('EventModel.setHistoricity after init', this);
                } else {
                    this[STAT_ID_HISTORICITY].setValue(v);
                }
            },
            
            setAttestation: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('EventModel.setAttestation after init', this);
                } else {
                    this[STAT_ID_ATTESTATION].setValue(v);
                }
            },
            
            // Location
            setLocation: function(location) { // An ID string.
                if (this.location !== location) {
                    this._locModel = null;
                    this.set('location', location, true);
                }
            },
            getLocation: function() {return this.location;},
            getLocationModel: function() {
                return this._locModel ?? (this._locModel = pkg.model.getLocation(this.location));
            },
            
            // Agents
            getAgentModels: function() {
                return pkg.model.getAgentModelsForEvent(this.id);
            },
            
            // Actions
            setActions: function(actions, clone=false) {
                for (const id in actions) this.addAction(id, actions[id], clone);
            },
            addAction: function(id, actionDatum, clone=true) {
                const actions = this.actions;
                if (actions[id] == null) {
                    if (clone) actionDatum = structuredClone(actionDatum);
                    actionDatum.id = id;
                    actionDatum.event = this;
                    actions[id] = new EventActionModel(actionDatum);
                } else {
                    console.warn('Attempt to clobber existing event action', id);
                }
            },
            getActionModels: function() {return this.actions;},
            
            // Values
            setValues: function(values) {
                for (const id in values) {
                    const datum = values[id];
                    datum.id = id;
                    datum.event = this;
                    this.values[id] = new EventValueModel(datum);
                }
            },
            getValueModels: function() {return this.values;},
            
            // Exits
            setExits: function(newExits) {
                const exits = this.exits;
                
                // Clear existing exits
                if (this.inited) {
                    for (const exit of exits) exit.destroy();
                    exits.length = 0;
                }
                
                for (const datum of newExits) {
                    datum.event = this;
                    exits.push(new EventExitModel(datum));
                }
            },
            getExitModels: function() {return this.exits;},
            
            getVisibleExitAndEntrances: function() {
                const accum = [];
                if (!this.isHidden()) {
                    const eventModels = pkg.model.getEventModels();
                    for (const eventId in eventModels) {
                        const eventModel = eventModels[eventId];
                        if (eventModel === this) {
                            for (const exitModel of eventModel.getExitModels()) {
                                const toModel = exitModel.getToEventModel();
                                if (toModel && toModel !== this && !toModel.isHidden() && !exitModel.isHidden()) {
                                    accum.push(exitModel);
                                }
                            }
                        } else if (!eventModel.isHidden()) {
                            for (const exitModel of eventModel.getExitModels()) {
                                if (exitModel.getToEventModel() === this) {
                                    if (!exitModel.isHidden()) accum.push(exitModel);
                                }
                            }
                        }
                    }
                }
                return accum;
            },
            
            // Hide Affected By (hides the connections to precursors)
            setHideAffectedBy: function(hideAffectedBy) {
                for (const id in hideAffectedBy) {
                    this.hideAffectedBy[id] = new HideAffectedByModel({
                        id, 
                        event:this, 
                        hidden:hideAffectedBy[id]
                    });
                }
            },
            getHideAffectedByModels: function() {return this.hideAffectedBy;},
            getHideAffectedByModel: function(affectorEventModelOrId) {
                return this.hideAffectedBy[typeof affectorEventModelOrId === 'string' ? affectorEventModelOrId : affectorEventModelOrId?.id];
            },
            isAffectedByHidden: function(affectorEventModelOrId) {
                return this.getHideAffectedByModel(affectorEventModelOrId)?.isHidden() ?? false;
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            notifyCollectionOfUpdate: function() {
                if (this.inited) {
                    this.callSuper();
                    this.fireEvent('updated');
                }
            },
            
            notifyStatChanged: function(_statModel) {
                if (this.inited) this.notifyCollectionOfUpdate();
            },
            
            getPrecursors: function(noSelf=true) {
                const accum = new Set();
                for (const valueModel of Object.values(this.values)) valueModel.getAllObservables(null, accum);
                return toEventModels(accum, noSelf ? this : null);
            },
            
            getDescendants: function(noSelf=true) {
                const accum = new Set();
                for (const valueModel of Object.values(this.values)) valueModel.getAllObservers(null, accum);
                return toEventModels(accum, noSelf ? this : null);
            },
            
            // Persistence /////////////////////////////////////////////////////
            exportToObj: function() {
                const retval = {},
                    valuesObj = retval.values = {},
                    values = this.values;
                for (const statId of EVENT_STAT_IDS) retval[statId] = this[statId].exportToObj();
                for (const id in values) valuesObj[id] = values[id].exportToObj();
                return retval;
            },
            
            /*  Update only. Keys that are absent are left alone and unknown Values are skipped. */
            importFromObj: function(obj) {
                for (const statId of EVENT_STAT_IDS) {
                    if (obj[statId]) this[statId].importFromObj(obj[statId]);
                }
                
                const valuesObj = obj.values;
                if (valuesObj) {
                    const values = this.values;
                    for (const id in valuesObj) {
                        const valueModel = values[id];
                        if (valueModel) {
                            valueModel.importFromObj(valuesObj[id]);
                        } else {
                            console.warn('Save has unknown Value', id, 'for Event', this.id, '(skipping)');
                        }
                    }
                }
            },
            
            doDevouredByChronovores: function() {
                console.log('Event devoured by chronovores', this);
                // FIXME: disable the event or in some other way indicate the Event has been devoured.
            },
            
            formatAsTemporalExtent: function() {
                return formatCompactRange(this.getStart(), this.getEnd()) + ICON_SEPARATOR + '(' + this.getDuration(true) + ')';
            },
            
            validateEventDependencies: function() {
                let isValid = true;
                const start = this.getStart();
                for (const precursorEventModel of this.getPrecursors()) {
                    if (precursorEventModel.getEnd() > start) {
                        isValid = false;
                        console.warn(
                            'Event Ordering Issues: ' + precursorEventModel.id + ' ends ' + precursorEventModel.getEnd(true) +
                            ' after ' + this.id + ' starts ' + this.getStart(true)
                        );
                    }
                }
                return isValid;
            }
        });
})(tc);
