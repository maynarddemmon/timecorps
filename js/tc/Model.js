(pkg => {
    let model;
    
    const JSClass = JS.Class,
        
        {min:mathMin, max:mathMax, abs:mathAbs} = Math,
        
        {
            Node, resolveName, stableStringify, ExpressionParser,
            BaseModel, BaseModelCollection,
            AccessorSupport:{generateName, generateSetterName}
        } = myt,
        
        {timeUtil:{durationToMillis, stringToMillis, format:formatDate, formatDuration}} = pkg,
        
        STARTING_CHRONAL = 16,
        STARTING_CHRONAL_LIMIT = 24,
        
        STARTING_PARADOX = 0,
        STARTING_PARADOX_LIMIT = 3,
        
        AGENT_PARADOX_LIMIT = 6,
        AGENT_CHRONAL_LIMIT = 15,
        
        // Constraints /////////////////////////////////////////////////////////
        SCOPE_TIMELINE = 'timeline',
        SCOPE_AGENTS = 'agents',
        SCOPE_LOCATIONS = 'locations',
        SCOPE_EVENTS = 'events',
        SCOPE_EVENT = 'event',
        PROP_PATHS = new Map(),
        CONFIG_ATTR_NAMES = new Map(),
        CONSTRAINT_NAMES = new Map(),
        CONSTRAINT_FUNCTIONS = new Map(),
        //REF_CONSTRAINTS = '_constraints',
        generateConfigAttrName = name => CONFIG_ATTR_NAMES.get(name) ?? (CONFIG_ATTR_NAMES.set(name, generateName(name, '_cfg')), CONFIG_ATTR_NAMES.get(name)),
        generateConstraintName = name => CONSTRAINT_NAMES.get(name) ?? (CONSTRAINT_NAMES.set(name, generateName(name, '_constrain')), CONSTRAINT_NAMES.get(name)),
        
        teardownConstraint = (target, name) => {
            const funcName = generateConstraintName(name);
            if (target[funcName]) {
                target.releaseConstraint(funcName);
                delete target[funcName];
                //delete target[REF_CONSTRAINTS][name];
            }
        },
        
        setupConstraint = (resolveTarget, target, name, constraintTxt) => {
            const cachedSerializedPropPaths = PROP_PATHS.get(constraintTxt);
            
            let propPaths;
            if (cachedSerializedPropPaths) {
                propPaths = JSON.parse(cachedSerializedPropPaths);
            } else {
                let parseTree;
                try {
                    parseTree = ExpressionParser.parse(constraintTxt);
                } catch(err) {
                    console.error(err);
                    return false;
                }
                
                // Extract referenced properties so they can be watched for changes and thus 
                // re-evaluate the constraint.
                propPaths = [];
                const stack = [],
                    walk = (node, parentNode) => {
                        if (node) {
                            const nodeType = node.type,
                                nodeName = node.name;
                            if (nodeType === 'This') {
                                // We constructed a stack to a "this" reference so save off the 
                                // current stack state as a property path
                                propPaths.push(stack.slice().reverse());
                            } else if (nodeType === 'Variable' && (nodeName === SCOPE_TIMELINE || nodeName === SCOPE_EVENTS || nodeName === SCOPE_EVENT)) {
                                propPaths.push(stack.concat([nodeName]).reverse());
                            } else if (nodeType === 'PropertyAccess') {
                                if (parentNode?.type === 'FunctionCall') {
                                    // If the property being accessed is being called as a function
                                    // then reset the stack since we can't guarantee we can monitor
                                    // that relationship for changes since the value is runtime
                                    // dependent.
                                    stack.length = 0;
                                    walk(node.base, node);
                                } else {
                                    // Anything else that looks like a property access gets pushed 
                                    // onto the stack.
                                    stack.push(typeof nodeName === 'object' ? nodeName.value : nodeName);
                                    walk(node.base, node);
                                    stack.pop();
                                }
                            } else {
                                for (const key in node) {
                                    if (typeof node[key] === 'object') walk(node[key], node);
                                }
                            }
                        }
                    };
                walk(parseTree, null);
                
                // Store propPaths in cache
                PROP_PATHS.set(constraintTxt, JSON.stringify(propPaths));
            }
            
            // Setup constraint function. Also try to get the javascript function from a cache.
            const funcName = generateConstraintName(name),
                funcCacheKey = funcName + ':' + constraintTxt;
            target[funcName] = CONSTRAINT_FUNCTIONS.get(funcCacheKey) ?? (CONSTRAINT_FUNCTIONS.set(
                funcCacheKey, 
                new Function(
                    [SCOPE_TIMELINE, SCOPE_EVENTS, SCOPE_EVENT].join(','),
                    'try{this.' + generateSetterName(name) + '(' + constraintTxt + ', true);' + '}catch(e){console.warn(e);}'
                )
            ),/* comma operator */ CONSTRAINT_FUNCTIONS.get(funcCacheKey));
            
            // Remember all constraints so they can be reapplied when necessary
            //target[REF_CONSTRAINTS][name] = constraintTxt;
            
            bindConstraint(resolveTarget, target, funcName, propPaths);
            
            return true;
        },
        
        bindConstraint = (resolveTarget, target, funcName, propPaths) => {
            if (target.destroyed || resolveTarget.destroyed) return;
            
            const eventsById = model.getEventModels(),
                observables = [];
            let i = propPaths.length;
            while (i) {
                const path = propPaths[--i],
                    observableVarName = path.pop();
                let scope;
                if (path.length > 0) {
                    let resolveRoot = resolveTarget;
                    switch (path[0]) {
                        case SCOPE_TIMELINE:
                            resolveRoot = {[SCOPE_TIMELINE]:model};
                            //path.shift();
                            break;
                        case SCOPE_EVENTS:
                            resolveRoot = eventsById
                            path.shift();
                            break;
                        case SCOPE_EVENT:
                            path.shift();
                            break;
                    }
                    scope = resolveName(path, resolveRoot);
                } else {
                    scope = resolveTarget;
                }
                
                if (!scope) return;
                
                // Prevent duplicate binding for the same constraint
                let j = observables.length,
                    scopeNotUsedYet = true;
                while (j) {
                    if (observableVarName === observables[--j] && scope === observables[--j]) {
                        scopeNotUsedYet = false;
                        break;
                    }
                }
                if (scopeNotUsedYet) {
                    // It's possible to capture something that can't be observed. If it doesn't
                    // have an attachTo function it's likely not an Eventable.
                    if (typeof scope.attachTo === 'function') {
                        // Lets also ensure the property we are going to observe exists on
                        // the scope object.
                        if (Object.hasOwn(scope, observableVarName)) {
                            observables.push(scope, observableVarName);
                        }
                    }
                }
            }
            
            // Wrap the function so we can provide common context
            const existingFunc = target[funcName],
                funcParams = [model, eventsById, resolveTarget];
            target[funcName] = _event => {existingFunc.apply(target, funcParams);};
            
            if (observables.length > 0) {
                try {
                    target.constrain(funcName, observables);
                } catch (e) {
                    console.warn('Error applying constraint', funcName, propPaths, observables, e);
                }
            } else {
                // Execute once only since there's nothing to observe
                target[funcName]();
            }
        },
        
        setConstrainedValue = (resolveTarget, target, name, constraintValue) => {
            const cfgName = generateConfigAttrName(name);
            if (target[cfgName] !== constraintValue) {
                //target[REF_CONSTRAINTS] ??= {};
                teardownConstraint(target, name);
                target[cfgName] = constraintValue;
                if (target.inited) target.fireEvent(cfgName, constraintValue);
                setupConstraint(resolveTarget, target, name, constraintValue);
            }
        },
        
        
        // Stat ////////////////////////////////////////////////////////////////
        /** A stat that maintains a numerical value bounded by a min, max, absolute min and
            absolute max. */
        NumericStatModel = pkg.NumericStatModel = new JSClass('NumericStatModel', BaseModel, {
            init: function(attrs) {
                const self = this,
                    {absMin, absMax, min, max, value} = attrs;
                delete attrs.absMin;
                delete attrs.absMax;
                delete attrs.min;
                delete attrs.max;
                delete attrs.value;
                
                // Need to set attrs in an exact order
                self.setAbsMin(absMin ?? Number. MIN_SAFE_INTEGER);
                self.setAbsMax(absMax ?? Number. MAX_SAFE_INTEGER);
                self.setMin(min ?? self.absMin);
                self.setMax(max ?? self.absMax);
                self.setValue(value ?? self.min);
                
                self.callSuper(attrs);
            },
            
            /*  The absolute minimum for the stat in the game. This value will never change 
                once set. */
            setAbsMin: function(v) {
                if (this.absMin == null) this.setAndNotifyCollection('absMin', v, true);
            },
            getAbsMin: function() {return this.absMin;},
            
            /*  The absolute maximum for the stat in the game. This value will never change 
                once set. */
            setAbsMax: function(v) {
                if (this.absMax == null) this.setAndNotifyCollection('absMax', v, true);
            },
            getAbsMax: function() {return this.absMax;},
            
            /*  The minimum value for the stat for the object it is attached to. */
            setMin: function(v) {
                const curMin = this.min,
                    newMin = mathMax(this.getAbsMin(), v);
                if (curMin !== newMin) {
                    this.set('min', newMin, true);
                    if (this.value < this.min && this.setValue(this.min)) return true;
                    if (this.inited) this.notifyCollectionOfUpdate();
                    return true;
                }
                return false;
            },
            getMin: function() {return this.min;},
            
            /* The minimum value for the stat for the object it is attached to. */
            setMax: function(v) {
                const curMax = this.max,
                    newMax = mathMin(this.getAbsMax(), v);
                if (curMax !== newMax) {
                    this.set('max', newMax, true);
                    if (this.value > this.max && this.setValue(this.max)) return true;
                    if (this.inited) this.notifyCollectionOfUpdate();
                    return true;
                }
                return false;
            },
            getMax: function() {return this.max;},
            
            /* The minimum value for the stat for the object it is attached to. */
            setValue: function(v) {
                const curValue = this.value,
                    newValue = mathMin(mathMax(v, this.getMin()), this.getMax());
                if (curValue !== newValue) {
                    this.setAndNotifyCollection('value', newValue, true);
                    return true;
                }
                return false;
            },
            getValue: function() {return this.value;},
            
            adjValue: function(adj, cfg) {
                if (adj === 0) return 0;
                
                const curValue = this.getValue();
                if (adj > 0) {
                    const max = this.getMax(),
                        allowedAdj = max - curValue;
                    if (adj <= allowedAdj) {
                        this.setValue(curValue + adj);
                        return adj;
                    } else {
                        if (cfg?.allOrNothing) {
                            // Change would exceed max so do not change.
                            return 0;
                        } else {
                            this.setValue(curValue + allowedAdj);
                            return allowedAdj;
                        }
                    }
                } else {
                    const min = this.getMin(),
                        allowedAdj = min - curValue;
                    if (adj >= allowedAdj) {
                        this.setValue(curValue + adj);
                        return adj;
                    } else {
                        if (cfg?.allOrNothing) {
                            // Change would exceed max so do not change.
                            return 0;
                        } else {
                            this.setValue(curValue + allowedAdj);
                            return allowedAdj;
                        }
                    }
                }
            },
            
            getValueToMin: function() {return this.getMin() - this.getValue();},
            isAtMinValue: function() {return this.getMin() === this.getValue();},
            
            getValueToMax: function() {return this.getMax() - this.getValue();},
            isAtMaxValue: function() {return this.getMax() === this.getValue();},
            
            getAsObj: function(cfg) {
                const self = this,
                    retval = self.callSuper(cfg);
                for (const key in ['absMin','min','value','max','absMax']) {
                    retval[key] = self[key];
                }
                return retval;
            }
        }),
        
        
        /** A stat that gets its value from other StatModels. */
        /*DerivedStatModelMixin = pkg.DerivedStatModelMixin = new JS.Module('DerivedStatModelMixin', {
            init: function(attrs) {
                const watch = attrs.watch;
                delete attrs.watch;
                
                this.callSuper(attrs);
                
                this.setValuesToWatch(watch);
            },
            
            setValuesToWatch: function(observables) {
                this.releaseConstraint('updateValue');
                this.constrain('updateValue', observables);
            },
            
            updateValue: function(ignoreEvent) {
                this.setValue(this.calculateValue());
            },
            
            calculateValue: () => {},
        }),*/
        
        
        // Agents //////////////////////////////////////////////////////////////
        AgentModel = pkg.AgentModel = new JSClass('AgentModel', BaseModel, {
            init: function(attrs) {
                this.log = [];
                this.paradox = new NumericStatModel({id:'paradox', absMin:0, min:0, value:0, max:AGENT_PARADOX_LIMIT});
                this.chronal = new NumericStatModel({id:'chronal', absMin:0, min:0, value:0, max:AGENT_CHRONAL_LIMIT});
                this.callSuper(attrs);
            },
            
            getAsObj: function(cfg) {
                const retval = this.callSuper(cfg);
                for (const attrName of ['name','event']) retval[attrName] = this[attrName];
                for (const attrName of ['paradox','chronal']) {
                    // Use stableStringify since similarTo uses shallowEqual. If this gets 
                    // unwieldy change similarTo to use deepEqual and drop the stableStringify.
                    retval[attrName] = stableStringify(this[attrName].getAsObj(cfg));
                }
                return retval;
            },
            
            setName: function(name) {this.setAndNotifyCollection('name', name, true);},
            
            setParadox: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('AgentModel.setParadox after init', this);
                } else {
                    this.paradox.setValue(v);
                }
            },
            setChronal: function(v) { // Used by instantiation only.
                if (this.inited) {
                    console.warn('AgentModel.setChronal after init', this);
                } else {
                    this.chronal.setValue(v);
                }
            },
            
            setEvent: function(event, logEntry) {
                if (this.event !== event) {
                    this._eventModel = null;
                    
                    this.setAndNotifyCollection('event', event, true);
                    this.accrueEntryParadox(this.getEventModel());
                    this.pushOntoLog(logEntry ?? {type:'origin', event:this.getEventModel()});
                }
            },
            getEvent: function() {return this.event;},
            getEventModel: function() {
                return this._eventModel ?? (this._eventModel = model.getEventModel(this.event));
            },
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
            
            // Movement and Actions
            doDeployToEvent: function(eventModel) {
                if (eventModel) {
                    const cost = pkg.getChronalToDeploy(this, eventModel);
                    if (cost <= -this.chronal.getValueToMin()) {
                        this.chronal.adjValue(-cost);
                        this.setEvent(eventModel.id, {type:'deploy', event:eventModel});
                        eventModel.notifyCollectionOfUpdate();
                    } else {
                        console.warn('insufficent chronal');
                    }
                } else {
                    console.warn('doDeployToEvent: no eventModel');
                }
            },
            doFollowExit: function(exitModel) {
                const exitEvent = exitModel.event;
                if (this.getEventModel() !== exitEvent) {
                    console.warn('Agent not at event for exit:', exitModel, this);
                    return;
                }
                
                const toEvent = exitModel.getToEventModel();
                if (toEvent) {
                    this.setEvent(toEvent.id, {type:'exit', exit:exitModel});
                    exitEvent.notifyCollectionOfUpdate();
                    toEvent.notifyCollectionOfUpdate();
                    pkg.app.getTimelineView().doSelectEvent(toEvent, true);
                }
            },
            doAction: function(actionModel) {
                if (actionModel.isDone()) {
                    console.warn('Attemp to do a done action.', actionModel, this);
                    return;
                }
                
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
                actionModel.setDone(true);
                
                this.pushOntoLog({type:'action', action:actionModel});
            },
            
            // Paradox
            calculateParadoxForEntry: function(eventModelOrId) {
                const eventModel = typeof eventModelOrId === 'string' ? model.getEventModel(eventId) : eventModelOrId;
                if (eventModel && this.hasBeenInEvent(eventModel)) return 1;
                return 0;
            },
            
            accrueEntryParadox: function(eventModelOrId) {
                const paradox = this.calculateParadoxForEntry(eventModelOrId);
                if (paradox > 0) {
                    this.paradox.adjValue(1);
                    // FIXME: deal with agent paradox max. Should be in setParadox function.
                    
                    model.timelineParadox.adjValue(1);
                    // FIXME: deal with timeline paradox max. Should be in setParadox function.
                }
            },
            
            // Life and Log
            pushOntoLog: function(logEntry) {
                this.log.push(logEntry);
            },
            getLog: function() {return this.log;},
            hasBeenInEvent: function(eventModel) {
                for (const entry of this.log) {
                    switch (entry.type) {
                        case 'exit':
                            if (entry.exit.getToEventModel() === eventModel) return true;
                            break;
                        case 'deploy':
                        case 'origin':
                            if (entry.event === eventModel) return true;
                            break;
                    }
                }
                return false;
            }
        }),
        
        
        // Locations ///////////////////////////////////////////////////////////
        TRAVEL_MODE_WAIT = 'wait',
        TRAVEL_MODE_WALK = 'walk',
        DEFAULT_TRAVEL_MODE = TRAVEL_MODE_WALK,
        
        LocationModel = pkg.LocationModel = new JSClass('LocationModel', BaseModel, {
            setName: function(name) {this.set('name', name, true);},
            setColor: function(color) {this.set('color', color, true);},
            setOrder: function(order) {this.set('order', order, true);}
        }),
        
        
        // Events //////////////////////////////////////////////////////////////
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
                return this._toEventModel ?? (this._toEventModel = model.getEventModel(this.to));
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
                this.actions = {};
                this.values = {};
                this.exits = [];
                this.callSuper(attrs);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setName: function(name) {this.set('name', name, true);},
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
            
            // Location
            setLocation: function(location) { // An ID string.
                if (this.location !== location) {
                    this._locModel = null;
                    this.set('location', location, true);
                }
            },
            getLocation: function() {return this.location;},
            getLocationModel: function() {
                return this._locModel ?? (this._locModel = model.getLocation(this.location));
            },
            
            // Agents
            getAgentModels: function() {
                return model.getAgentModelsForEvent(this.id);
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
            }
        });
    
    pkg.Model = new JSClass('Model', Node, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            model = this;
            
            model.timelineParadox = new NumericStatModel({id:'timelineParadox', absMin:0, min:0, value:STARTING_PARADOX, max:STARTING_PARADOX_LIMIT});
            
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
            
            model.callSuper(parent, attrs);
            
            model.reset();
        },
        
        // Accessors ///////////////////////////////////////////////////////////
        getChronal: () => model.chronal,
        setChronal: v => {model.set('chronal', v, true);},
        getChronalLimit: () => model.chronalLimit,
        setChronalLimit: v => {model.set('chronalLimit', v, true);},
        
        getEventModel: id => model[SCOPE_EVENTS].getById(id),
        getEventModels: () => model[SCOPE_EVENTS].getAll(),
        
        getAgentModel: id => model[SCOPE_AGENTS].getById(id),
        getAgentModels: () => model[SCOPE_AGENTS].getAll(),
        getAgentModelsForEvent: eventId => model[SCOPE_AGENTS].getAsList(agent => agent.getEvent() === eventId),
        
        getLocation: id => model[SCOPE_LOCATIONS].getById(id),
        getLocations: () => model[SCOPE_LOCATIONS].getAll(),
        getLocationsInOrder: () => model[SCOPE_LOCATIONS].getAsSortedList((a, b) => a.order - b.order),
        
        // Methods /////////////////////////////////////////////////////////////
        reset: () => {
            model.setChronal(STARTING_CHRONAL);
            model.setChronalLimit(STARTING_CHRONAL_LIMIT);
            
            model.timelineParadox.setMax(STARTING_PARADOX_LIMIT);
            model.timelineParadox.setValue(STARTING_PARADOX);
        },
        
        processData: json => {
            for (const dataKey of [SCOPE_LOCATIONS, SCOPE_EVENTS, SCOPE_AGENTS]) {
                const data = json[dataKey];
                if (data) {
                    for (const id in data) {
                        const datum = data[id];
                        datum.id = id;
                        model[dataKey].addModel(datum);
                    }
                }
            }
        }
    });
})(tc);