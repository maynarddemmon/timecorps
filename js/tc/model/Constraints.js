(pkg => {
    const {resolveName, ExpressionParser, AccessorSupport:{generateName, generateSetterName}} = myt,
        
        {SCOPE_TIMELINE, SCOPE_EVENTS, SCOPE_EVENT} = pkg,
        
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
            
            const eventsById = pkg.model.getEventModels(),
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
                            resolveRoot = {[SCOPE_TIMELINE]:pkg.model};
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
                funcParams = [pkg.model, eventsById, resolveTarget];
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