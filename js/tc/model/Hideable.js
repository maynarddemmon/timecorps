(pkg => {
    'use strict';
    
    const JSModule = JS.Module,
        
        NOOP = myt.NOOP,
        
        {setConstrainedValue} = pkg;
    
    /*  Hooks:
            getConstraintScope() - The model that expressions on this model resolve against.
                Defaults to the model itself.
            getConstraintScopeName() - Implemented by models that can BE a constraint scope.
                Names the variable ("event", "agent", "operation") that refers to the scope
                in expressions. Without one, only "timeline", "events", "agents" and
                "operations" are available. */
    pkg.ConstrainableAttrSupport = new JSModule('ConstrainableAttrSupport', {
        getConstraintScope: function() {return this;}
    });
    
    /*  Gives a model a "hidden" attribute that accepts a boolean or a constraint expression.
        A new value replaces any existing constraint, so a grant or reveal overrides an 
        expression from the data.
        
        Requires: ConstrainableAttrSupport as a sibling mixin.
        
        Hooks:
            getConstraintScope() - See ConstrainableAttrSupport.
            doHiddenChanged(hidden) - Called after the value actually changes. */
    pkg.Hideable = new JSModule('Hideable', {
        setHidden: function(value, isActual) {
            if (isActual) {
                value = !!value;
                if (this.hidden !== value) {
                    this.set('hidden', value, true);
                    this.doHiddenChanged(value);
                }
            } else {
                setConstrainedValue(this.getConstraintScope(), this, 'hidden', String(value));
            }
        },
        isHidden: function() {return this.hidden;},
        
        doHiddenChanged: NOOP // function(hidden) {}
    });
})(tc);