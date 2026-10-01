(pkg => {
    'use strict';
    
    let bindingPaused = false,
        pausedBinding = [];
    
    const {resolveName, ExpressionParser, AccessorSupport:{generateName, generateSetterName}} = myt,
        
        {
            SCOPE_TIMELINE, 
            SCOPE_EVENTS, SCOPE_AGENTS, SCOPE_OPERATIONS, 
            SCOPE_EVENT,  SCOPE_AGENT,  SCOPE_OPERATION
        } = pkg,
        
        /*  Scopes that name a collection. The next path segment is a model ID, e.g.
            "agents.VQ.paradox.value". */
        COLLECTION_SCOPE_NAMES = [SCOPE_EVENTS, SCOPE_AGENTS, SCOPE_OPERATIONS],
        getCollectionScope = name => {
            const rootModel = pkg.model;
            switch (name) {
                case SCOPE_EVENTS: return rootModel.getEventModels();
                case SCOPE_AGENTS: return rootModel.getAgentModels();
                case SCOPE_OPERATIONS: return rootModel.getOperationModels();
            }
        },
        
        /*  Scopes that name the model an expression belongs to, e.g. "agent.paradox.value".
            Only the one matching the resolve target's getConstraintScopeName() is defined in
            any given expression. */
        SELF_SCOPE_NAMES = [SCOPE_EVENT, SCOPE_AGENT, SCOPE_OPERATION],
        
        ALL_SCOPE_NAMES = [SCOPE_TIMELINE, ...COLLECTION_SCOPE_NAMES, ...SELF_SCOPE_NAMES],
        ALL_SCOPE_NAMES_SET = new Set(ALL_SCOPE_NAMES),
        FUNC_PARAMS = ALL_SCOPE_NAMES.join(','),
        
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
                            } else if (nodeType === 'Variable' && ALL_SCOPE_NAMES_SET.has(nodeName)) {
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
                    FUNC_PARAMS,
                    'try{this.' + generateSetterName(name) + '(' + constraintTxt + ',true);' + '}catch(e){console.warn(e);}'
                )
            ),/* comma operator */ CONSTRAINT_FUNCTIONS.get(funcCacheKey));
            
            // Remember all constraints so they can be reapplied when necessary
            //target[REF_CONSTRAINTS][name] = constraintTxt;
                
            if (bindingPaused) {
                pausedBinding.push(resolveTarget, target, funcName, propPaths);
            } else {
                bindConstraint(resolveTarget, target, funcName, propPaths);
            }
            
            return true;
        },
        
        bindConstraint = (resolveTarget, target, funcName, propPaths) => {
            if (target.destroyed || resolveTarget.destroyed) return;
            
            const selfScopeName = resolveTarget.getConstraintScopeName?.(),
                observables = [];
            let i = propPaths.length;
            while (i) {
                const path = propPaths[--i],
                    observableVarName = path.pop();
                let scope;
                if (path.length > 0) {
                    const scopeName = path[0];
                    let resolveRoot = resolveTarget;
                    if (scopeName === SCOPE_TIMELINE) {
                        resolveRoot = {[SCOPE_TIMELINE]:pkg.model};
                    } else if (COLLECTION_SCOPE_NAMES.includes(scopeName)) {
                        resolveRoot = getCollectionScope(scopeName);
                        path.shift();
                    } else if (SELF_SCOPE_NAMES.includes(scopeName)) {
                        if (scopeName !== selfScopeName) {
                            console.warn('Scope "' + scopeName + '" is not available here. Use "' + (selfScopeName ?? 'events/agents/operations') + '" instead:', funcName, resolveTarget);
                            return;
                        }
                        path.shift();
                    }
                    
                    // An empty path means the attribute is directly on the scope itself,
                    // e.g. "agent.event".
                    scope = path.length > 0 ? resolveName(path, resolveRoot) : resolveRoot;
                } else {
                    scope = resolveTarget;
                }
                
                
                if (!scope) {
                    console.warn('Could not resolve', path.join('.'), 'for', funcName, 'on', target);
                    return;
                }
                
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
                        if (Object.hasOwn(scope, observableVarName) || typeof scope[generateSetterName(observableVarName)] === 'function') {
                            observables.push(scope, observableVarName);
                        } else {
                            console.warn('Nothing to observe for: ' + observableVarName + ' on:', scope);
                        }
                    }
                }
            }
            
            // Wrap the function so we can provide common context. Params are in ALL_SCOPE_NAMES
            // order with only the matching self scope defined.
            const existingFunc = target[funcName],
                funcParams = ALL_SCOPE_NAMES.map(name => {
                    if (name === SCOPE_TIMELINE) return pkg.model;
                    if (COLLECTION_SCOPE_NAMES.includes(name)) return getCollectionScope(name);
                    return name === selfScopeName ? resolveTarget : undefined;
                });
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
        };
    
    pkg.pauseConstraintBinding = () => {bindingPaused = true;};
    pkg.resumeConstraintBinding = () => {
        bindingPaused = false;
        
        const refToPausedBindings = pausedBinding,
            len = refToPausedBindings.length;
        pausedBinding = []; // Assign a new accumulator before proceeding in case that triggers another pause.
        for (let i = 0; i < len;) {
            bindConstraint(refToPausedBindings[i++], refToPausedBindings[i++], refToPausedBindings[i++], refToPausedBindings[i++]);
        }
    };
    
    /*  The observer method name used for a constrained attribute, so code can pick out
        one constraint's dependencies in getAllObservables/getAllObservers. */
    pkg.getConstraintFuncName = generateConstraintName;

    /*  The value or expression last given to setConstrainedValue for an attribute. This is
        what gets saved, since re-applying it restores both literals and expressions. */
    pkg.getConstrainedValueCfg = (target, name) => target[generateConfigAttrName(name)];

    pkg.setConstrainedValue = (resolveTarget, target, name, constraintValue) => {
        const cfgName = generateConfigAttrName(name);
        if (target[cfgName] !== constraintValue) {
            //target[REF_CONSTRAINTS] ??= {};
            teardownConstraint(target, name);
            target[cfgName] = constraintValue;
            if (target.inited) target.fireEvent(cfgName, constraintValue);
            setupConstraint(resolveTarget, target, name, constraintValue);
        }
    };
})(tc);