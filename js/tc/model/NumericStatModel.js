(pkg => {
    const {min:mathMin, max:mathMax} = Math;
    
    /** A stat that maintains a numerical value bounded by a min, max, absolute min and
        absolute max. */
    pkg.NumericStatModel = new JS.Class('NumericStatModel', myt.BaseModel, {
        // Life Cycle //////////////////////////////////////////////////////////
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
        
        
        // Accessors ///////////////////////////////////////////////////////////
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
        
        /*  The minimum value. */
        setMin: function(v) {
            const curMin = this.min,
                newMin = mathMax(this.getAbsMin(), v);
            if (curMin !== newMin) {
                this.set('min', newMin, true);
                if (this.value < this.min && this.setValue(this.min)) {
                    this.triggerValueClampedToMin();
                    return true;
                }
                if (this.inited) this.notifyCollectionOfUpdate();
                return true;
            }
            return false;
        },
        getMin: function() {return this.min;},
        
        /* The maximum value for the stat. */
        setMax: function(v) {
            const curMax = this.max,
                newMax = mathMin(this.getAbsMax(), v);
            if (curMax !== newMax) {
                this.set('max', newMax, true);
                if (this.value > this.max && this.setValue(this.max)) {
                    this.triggerValueClampedToMax();
                    return true;
                }
                if (this.inited) this.notifyCollectionOfUpdate();
                return true;
            }
            return false;
        },
        getMax: function() {return this.max;},
        
        /* The value for the stat. */
        setValue: function(v) {
            const curValue = this.value,
                newValue = mathMin(mathMax(v, this.getMin()), this.getMax()),
                changed = curValue !== newValue;
            if (changed) {
                this.setAndNotifyCollection('value', newValue, true);
                if (this.isAtMinValue()) this.triggerValueAtMin();
                if (this.isAtMaxValue()) this.triggerValueAtMax();
            }
            if (newValue < v) this.triggerValueClampedToMax();
            if (newValue > v) this.triggerValueClampedToMin();
            return changed;
        },
        getValue: function() {return this.value;},
        
        
        // Methods /////////////////////////////////////////////////////////////
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
                        this.triggerValueClampedToMax();
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
                        // Change would preceed min so do not change.
                        return 0;
                    } else {
                        this.setValue(curValue + allowedAdj);
                        this.triggerValueClampedToMin();
                        return allowedAdj;
                    }
                }
            }
        },
        
        getValueToMin: function() {return this.getMin() - this.getValue();},
        isAtMinValue: function() {return this.getMin() === this.getValue();},
        triggerValueAtMin: function() {this.fireEvent('valueAtMin', true);},
        triggerValueClampedToMin: function() {this.fireEvent('valueClampedToMin', true);},
        
        getValueToMax: function() {return this.getMax() - this.getValue();},
        isAtMaxValue: function() {return this.getMax() === this.getValue();},
        triggerValueAtMax: function() {this.fireEvent('valueAtMax', true);},
        triggerValueClampedToMax: function() {this.fireEvent('valueClampedToMax', true);},
        
        getAsObj: function(cfg) {
            const self = this,
                retval = self.callSuper(cfg);
            for (const key of ['absMin','min','value','max','absMax']) {
                retval[key] = self[key];
            }
            return retval;
        }
    });
    
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
})(tc);