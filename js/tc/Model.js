(pkg => {
    let model;
    
    const JSClass = JS.Class,
        
        {
            Node, resolveName, ExpressionParser,
            BaseModel, BaseModelCollection,
            AccessorSupport:{generateName, generateSetterName}
        } = myt,
        
        {timeUtil:{durationToMillis, stringToMillis, format:formatDate, formatDuration}} = pkg,
        
        STARTING_CHRONAL = 16,
        STARTING_CHRONAL_LIMIT = 24,
        
        STARTING_PARADOX = 0,
        STARTING_PARADOX_LIMIT = 18,
        
        // Constraints /////////////////////////////////////////////////////////
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
                            } else if (nodeType === 'Variable' && (nodeName === SCOPE_EVENTS || nodeName === SCOPE_EVENT)) {
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
                    [SCOPE_EVENTS, SCOPE_EVENT].join(','),
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
                    if (path[0] === SCOPE_EVENTS) {
                        resolveRoot = eventsById
                        path.shift();
                    } else if (path[0] === SCOPE_EVENT) {
                        path.shift();
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
                funcParams = [eventsById, resolveTarget];
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
        
        
        // Agents //////////////////////////////////////////////////////////////
        AgentModel = pkg.AgentModel = new JSClass('AgentModel', BaseModel, {
            init: function(attrs) {
                this.paradox = this.chronal = 0;
                this.callSuper(attrs);
            },
            
            getAsObj: function(cfg) {
                const retval = this.callSuper(cfg);
                for (const attrName of ['name','paradox','chronal','event']) retval[attrName] = this[attrName];
                return retval;
            },
            
            setName: function(name) {this.setAndNotifyCollection('name', name, true);},
            setParadox: function(paradox) {this.setAndNotifyCollection('paradox', paradox, true);},
            setChronal: function(chronal) {this.setAndNotifyCollection('chronal', chronal, true);},
            
            setEvent: function(event) {
                if (this.event !== event) {
                    this._eventModel = null;
                    this.setAndNotifyCollection('event', event, true);
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
            
            // Actions
            doDeployToEvent: function(eventModel) {
                if (eventModel) {
                    const cost = pkg.getChronalToDeploy(this, eventModel);
                    if (cost <= this.chronal) {
                        this.setChronal(this.chronal - cost);
                        this.setEvent(eventModel.id);
                        eventModel.notifyCollectionOfUpdate();
                    } else {
                        console.warn('insufficent chronal');
                    }
                } else {
                    console.warn('doDeployToEvent: no eventModel');
                }
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
            
            doIt: function(agentModel) {
                if (this.done) {
                    console.warn('Attemp to do a done action.', this);
                    return;
                }
                
                const {setObj, event} = this;
                for (const key in setObj) {
                    const value = setObj[key],
                        eventValueModel = event.values[key];
                    if (eventValueModel) {
                        eventValueModel.setValue(value, false);
                    } else {
                        console.warn('Missing Value in doIt:' + key);
                    }
                }
                this.setDone(true);
            }
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
            getExits: function() {return this.exits;},
            
            
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
        getTimelineParadox: () => model.timelineParadox,
        setTimelineParadox: v => {model.set('timelineParadox', v, true);},
        getTimelineParadoxLimit: () => model.timelineParadoxLimit,
        setTimelineParadoxLimit: v => {model.set('timelineParadoxLimit', v, true);},
        
        getChronal: () => model.chronal,
        setChronal: v => {model.set('chronal', v, true);},
        getChronalLimit: () => model.chronalLimit,
        setChronalLimit: v => {model.set('chronalLimit', v, true);},
        
        getEventModel: id => model[SCOPE_EVENTS].getById(id),
        getEventModels: () => model[SCOPE_EVENTS].getAll(),
        
        getAgentModel: id => model[SCOPE_AGENTS].getById(id),
        getAgentModels: () => model[SCOPE_AGENTS].getAll(),
        getAgentModelsForEvent: eventId => model[SCOPE_AGENTS].getAsList(agent => agent.event === eventId),
        
        getLocation: id => model[SCOPE_LOCATIONS].getById(id),
        getLocations: () => model[SCOPE_LOCATIONS].getAll(),
        getLocationsInOrder: () => model[SCOPE_LOCATIONS].getAsSortedList((a, b) => a.order - b.order),
        
        // Methods /////////////////////////////////////////////////////////////
        reset: () => {
            model.setChronal(STARTING_CHRONAL);
            model.setChronalLimit(STARTING_CHRONAL_LIMIT);
            
            model.setTimelineParadox(STARTING_PARADOX);
            model.setTimelineParadoxLimit(STARTING_PARADOX_LIMIT);
        },
        
        processData: json => {
            for (const dataKey of [SCOPE_LOCATIONS,SCOPE_EVENTS,SCOPE_AGENTS]) {
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
    
    // FIXME: testing
    /*setInterval(() => {
        const agents = model[SCOPE_AGENTS].getAsList(),
            len = agents.length;
        for (let i = 0; i < len; i++) {
            const agent = agents[i];
            agent.setParadox(myt.getRandomInt(0, 25));
            agent.setChronal(myt.getRandomInt(10, 25));
        }
        
        model[SCOPE_AGENTS].removeById(agents[myt.getRandomInt(0, len - 1)].id, true);
        
        const guid = myt.generateGuid();
        model[SCOPE_AGENTS].addModel({id:'id-' + guid, name:'name-' + guid, paradox:0, chronal:10});
    }, 1000);*/
    
})(tc);