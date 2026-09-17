(pkg => {
    const JSClass = JS.Class,
        
        {stableStringify, BaseModel, BaseModelCollection} = myt,
        
        {
            NotifyingNumericStatModel, setConstrainedValue,
            timeUtil:{durationToMillis, stringToMillis, format:formatDate, formatDuration},
            STAT_ID_PARADOX, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION,
            EVENT_ID_TIME_CORPS_HQ, EVENT_ID_THE_VOID
        } = pkg,
        
        EVENT_PARADOX_LIMIT = 4,
        DEFAULT_ACTION_LIMIT = 1,
        
        TRAVEL_MODE_WAIT = 'wait',
        TRAVEL_MODE_WALK = 'walk',
        
        updateEndAttr = eventModel => {
            const {start, duration} = eventModel;
            if (start != null && duration != null) eventModel.set('end', start + duration);
        },
        
        EventActionModel = new JSClass('EventActionModel', BaseModel, {
            init: function(attrs) {
                this.done = false;
                this.event = attrs.event;
                delete attrs.event;
                this.callSuper(attrs);
            },
            setLabel: function(label) {this.set('label', label, true);},
            setSet: function(set) {this.set('setObj', set, true);},
            setDone: function(done) {
                this.set('done', done, true);
                this.event.notifyCollectionOfUpdate();
            },
            isDone: function() {return this.done;}
        }),
        
        EventValueModel = new JSClass('EventValueModel', BaseModel, {
            init: function(attrs) {
                this.event = attrs.event;
                delete attrs.event;
                this.callSuper(attrs);
            },
            setValue: function(value, isActual) {
                if (isActual) {
                    this.set('value', value, true);
                    this.event.notifyCollectionOfUpdate();
                } else {
                    setConstrainedValue(this.event, this, 'value', value);
                }
            }
        }),
        
        EventExitModel = new JSClass('EventExitModel', BaseModel, {
            init: function(attrs) {
                this.event = attrs.event;
                delete attrs.event;
                this.callSuper(attrs);
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
            
            getBtnLabel: function() {
                const toEvent = this.getToEventModel(),
                    toEventName = toEvent ? toEvent.name : this.to;
                switch (this.mode) {
                    case TRAVEL_MODE_WAIT: return 'Wait for "' + toEventName + '"';
                    case TRAVEL_MODE_WALK: return 'Walk to "' + toEventName + '"';
                    default: return 'To "' + toEventName + '"';
                }
            }
        }),
        
        EventModel = pkg.EventModel = new JSClass('EventModel', BaseModel, {
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
                self.callSuper(attrs);
            },
            
            getAsObj: function(cfg) {
                // FIXME: this is not really correct. We will fix once it's clear how EventModel
                // will be serialized both for Save and for an Event grid (once it is introduced).
                const retval = this.callSuper(cfg);
                for (const attrName of ['name','start','duration','hidden','actionLimit','actions','values','exits']) {
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
            isHQ: function() {return this.id === EVENT_ID_TIME_CORPS_HQ},
            isTheVoid: function() {return this.id === EVENT_ID_THE_VOID},
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
            
            setHidden: function(value, isActual) {
                if (isActual) {
                    this.set('hidden', value, true);
                    this.notifyCollectionOfUpdate();
                } else {
                    setConstrainedValue(this, this, 'hidden', value);
                }
            },
            
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
            
            
            // Methods /////////////////////////////////////////////////////////
            notifyCollectionOfUpdate: function() {
                if (this.inited) this.callSuper();
            },
            
            notifyStatChanged: function(statModel) {
                if (this.inited) this.notifyCollectionOfUpdate();
            },
            
            getPrecursors: function(noSelf=true) {
                // Accumulate Observables
                const self = this,
                    accum = new Set();
                for (const valueModel of Object.values(self.values)) valueModel.getAllObservables(null, accum);
                
                // Filter them down to EventModels
                const filtered = new Set();
                for (const obs of accum) {
                    const event = obs.isA(EventModel) ? obs : obs.event?.isA(EventModel) ? obs.event : null;
                    if (event && (!noSelf || event !== self)) filtered.add(event);
                }
                return filtered;
            },
            
            getDescendants: function(noSelf=true) {
                // Accumulate Observables
                const self = this,
                    accum = new Set();
                for (const valueModel of Object.values(self.values)) valueModel.getAllObservers(null, accum);
                
                // Filter them down to EventModels
                const filtered = new Set();
                for (const obs of accum) {
                    const event = obs.isA(EventModel) ? obs : obs.event?.isA(EventModel) ? obs.event : null;
                    if (event && (!noSelf || event !== self)) filtered.add(event);
                }
                return filtered;
            },
            
            doDevouredByChronovores: function() {
                console.log('Event devoured by chronovores', this);
                // FIXME: disable the event or in some other way indicate the Event has been devoured.
            }
        });
})(tc);