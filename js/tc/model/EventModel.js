(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        {stableStringify, BaseModel, BaseModelCollection} = myt,
        
        {
            NotifyingNumericStatModel, setConstrainedValue, ConstrainableAttrSupport, Hideable, Describable,
            timeUtil:{durationToMillis, stringToMillis, format:formatDate, formatCompactRange, formatDuration},
            STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION,
            cfg:{
                EVENT_ID_TIME_CORPS_HQ, EVENT_ID_THE_VOID,
                EVENT_PARADOX_LIMIT, DEFAULT_ACTION_LIMIT,
                TRAVEL_MODE_WAIT, TRAVEL_MODE_WALK
            },
            ICON_SEPARATOR, ICON_TRAVEL, ICON_NIL,
            SCOPE_EVENT
        } = pkg,
        
        /*  Reduces a set of observables or observers to the EventModels they belong to. */
        toEventModels = (things, excludeEventModel) => {
            const retval = new Set();
            for (const thing of things) {
                const eventModel = thing.isA(EventModel) ? thing : thing.event?.isA(EventModel) ? thing.event : null;
                if (eventModel && eventModel !== excludeEventModel) retval.add(eventModel);
            }
            return retval;
        },
        
        updateEndAttr = eventModel => {
            const {start, duration} = eventModel;
            if (start != null && duration != null) eventModel.set('end', start + duration);
        },
        
        ConstrainableToParentEvent = new JSModule('ConstrainableToParentEvent', {
            include: [ConstrainableAttrSupport],
            
            init: function(attrs) {
                this.event = attrs.event;
                delete attrs.event;
                this.callSuper(attrs);
            },
            
            getConstraintScope: function() {return this.event;}
        }),
        
        HideableEventPart = new JSModule('HideableEventPart', {
            include: [Hideable],
            
            init: function(attrs) {
                this.hidden = false;
                this.callSuper(attrs);
            },
            
            doHiddenChanged: function(_hidden) {this.event.notifyCollectionOfUpdate();}
        }),
        
        DescribableEventPart = new JSModule('DescribableEventPart', {
            include: [Describable],
            
            doDescriptionChanged: function() {this.event.notifyCollectionOfUpdate();}
        }),
        
        EventActionModel = new JSClass('EventActionModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                //this.done = false;
                this.callSuper(attrs);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setLabel: function(label) {this.set('label', label, true);},
            
            setSet: function(set) {this.set('setObj', set, true);}
            
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
            }
        }),
        
        EventExitModel = new JSClass('EventExitModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart],
            
            
            // Accessors ///////////////////////////////////////////////////////
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
            getBtnLabel: function() {
                const toEvent = this.getToEventModel(),
                    toEventName = toEvent ? toEvent.name : this.to;
                switch (this.mode) {
                    case TRAVEL_MODE_WAIT: return 'Wait' + ICON_TRAVEL + toEventName;
                    case TRAVEL_MODE_WALK: return 'Walk' + ICON_TRAVEL + toEventName;
                    default: return 'To ' + toEventName;
                }
            }
        }),
        
        HideAffectedByModel = new JSClass('HideAffectedByModel', BaseModel, {
            include: [ConstrainableToParentEvent, HideableEventPart]
        }),
        
        EventModel = pkg.EventModel = new JSClass('EventModel', BaseModel, {
            include: [ConstrainableAttrSupport, Hideable, Describable],
            
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
                
                // Default to hidden if nothing is known about this Event.
                // FIXME: ideally this will take into account the descendant Events with a default
                // attestation/historicty check of say 15.
                attrs.hidden ??= "event.attestation.value === 0 && event.historicity.value === 0";
                
                self.callSuper(attrs);
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
                for (const attrName of [STAT_ID_PARADOX,STAT_ID_HISTORICITY,STAT_ID_ATTESTATION]) {
                    // Use stableStringify since similarTo uses shallowEqual. If this gets 
                    // unwieldy change similarTo to use deepEqual and drop the stableStringify.
                    retval[attrName] = stableStringify(this[attrName].getAsObj(cfg));
                }
                return retval;
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setTimeOrdering: function(v) {this._tiOr = v;},
            getTimeOrdering: function() {return this._tiOr;},
            
            isHQ: function() {return this.id === EVENT_ID_TIME_CORPS_HQ;},
            isTheVoid: function() {return this.id === EVENT_ID_THE_VOID;},
            isNotRegularEvent: function() {return this.isHQ() || this.isTheVoid();},
            isRegularEvent: function() {return !this.isNotRegularEvent();},
            
            setName: function(name) {this.set('name', name, true);},
            getName: function() {return this.name;},
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
            
            doHiddenChanged: function(hidden) {
                this.notifyCollectionOfUpdate();
                pkg.app.getTimelineView().notifyEventVisibilityChange(this);
            },
            
            doDescriptionChanged: function() {this.notifyCollectionOfUpdate();},
            
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
            setActions: function(actions) {
                for (const id in actions) {
                    const datum = actions[id];
                    datum.id = id;
                    datum.event = this;
                    this.actions[id] = new EventActionModel(datum);
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
            
            // Hide Affected By
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
            
            notifyStatChanged: function(statModel) {
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