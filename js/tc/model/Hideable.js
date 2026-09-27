(pkg => {
    'use strict';
    
    const JSModule = JS.Module,
        
        NOOP = myt.NOOP,
        
        {setConstrainedValue} = pkg;
    
    pkg.ConstrainableAttrSupport = new JSModule('ConstrainableAttrSupport', {
        getConstraintScope: function() {return this;}
    });
    
    /*  Gives a model a "hidden" attribute that accepts a boolean or a constraint expression.
        A new value replaces any existing constraint, so a grant or reveal overrides an 
        expression from the data.
        
        Requires: ConstrainableAttrSupport as a sibling mixin.
        
        Hooks:
            getConstraintScope() - What "event..." resolves to in expressions. Defaults to the
                model itself.
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