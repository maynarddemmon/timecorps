(pkg => {
    'use strict';
    
    const {formatAsPercentage, interpolateString} = myt,
        
        {min:mathMin, max:mathMax} = Math,
        
        {
            STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HEALTH, STAT_ID_HISTORICITY, STAT_ID_ATTESTATION,
            I18N_PARADOX, I18N_CHRONAL, I18N_HEALTH, I18N_HISTORICITY, I18N_ATTESTATION,
            ICON_SEPARATOR, ICON_NIL
        } = pkg,
        
        /** A stat that maintains a numerical value bounded by a min, max, absolute min and
            absolute max. */
        NumericStatModel = pkg.NumericStatModel = new JS.Class('NumericStatModel', myt.BaseModel, {
            // Life Cycle //////////////////////////////////////////////////////
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
            
            
            // Accessors ///////////////////////////////////////////////////////
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
            
            
            // Methods /////////////////////////////////////////////////////////
            adjValueToNoMoreThan: function(adj, upperLimit, cfg) {
                if (upperLimit == null) {
                    console.warn('No upperLimit provided to adjValueToNoMoreThan', this);
                } else {
                    // We don't want to modify the provided config
                    cfg = cfg ? {...cfg} : {};
                    cfg.upperLimit = upperLimit;
                }
                return this.adjValue(adj, cfg);
            },
            
            /*  How much of adj would actually apply, without changing anything. Returns 
                {adj, clamp} where clamp is 'max' or 'min' if the stat's own limit cut it 
                short (not a caller's upperLimit), else null. */
            getAllowedAdj: function(adj, cfg) {
                // NaN would otherwise fall through to the clamp to min.
                if (adj === 0 || Number.isNaN(adj)) return {adj:0, clamp:null};
                
                const curValue = this.getValue();
                if (adj > 0) {
                    const realMax = this.getMax(),
                        upperLimit = cfg?.upperLimit,
                        max = upperLimit != null ? mathMax(mathMin(realMax, upperLimit), this.getMin()) : realMax,
                        allowedAdj = mathMax(0, max - curValue);
                    if (adj <= allowedAdj) return {adj, clamp:null};
                    if (cfg?.allOrNothing) return {adj:0, clamp:null};
                    return {adj:allowedAdj, clamp:max === realMax ? 'max' : null};
                } else {
                    const allowedAdj = this.getMin() - curValue;
                    if (adj >= allowedAdj) return {adj, clamp:null};
                    if (cfg?.allOrNothing) return {adj:0, clamp:null};
                    return {adj:allowedAdj, clamp:'min'};
                }
            },
            
            adjValue: function(adj, cfg) {
                const allowed = this.getAllowedAdj(adj, cfg);
                if (allowed.adj !== 0) this.setValue(this.getValue() + allowed.adj);
                if (allowed.clamp === 'max') this.triggerValueClampedToMax();
                if (allowed.clamp === 'min') this.triggerValueClampedToMin();
                return allowed.adj;
            },
            
            getValueToMin: function() {return this.getMin() - this.getValue();},
            isAtMinValue: function() {return this.getMin() === this.getValue();},
            triggerValueAtMin: function() {this.fireEvent('valueAtMin', true);},
            triggerValueClampedToMin: function() {this.fireEvent('valueClampedToMin', true);},
            
            getValueToMax: function() {return this.getMax() - this.getValue();},
            isAtMaxValue: function() {return this.getMax() === this.getValue();},
            triggerValueAtMax: function() {this.fireEvent('valueAtMax', true);},
            triggerValueClampedToMax: function() {this.fireEvent('valueClampedToMax', true);},
            
            format: function(format, template) {
                const value = this.getValue(),
                    max = this.getMax(),
                    id = this.id;
                switch (format) {
                    case 'label':
                        switch (id) {
                            case STAT_ID_PARADOX: return I18N_PARADOX;
                            case STAT_ID_CHRONAL: return I18N_CHRONAL;
                            case STAT_ID_HEALTH: return I18N_HEALTH;
                            case STAT_ID_HISTORICITY: return I18N_HISTORICITY;
                            case STAT_ID_ATTESTATION: return I18N_ATTESTATION;
                            default: return id;
                        }
                    case '%':
                    case 'percent':
                        return max ? formatAsPercentage(value / max, 0) : ICON_NIL ;
                    case 'verbose':
                        return interpolateString(
                            template ?? 'Current Value: {value}{ICON_SEPARATOR}Max Value: {max}',
                            {ICON_SEPARATOR, value, max}
                        );
                    case 'tooltip':
                        return interpolateString(
                            template ?? '{label}{ICON_SEPARATOR}{percent}{ICON_SEPARATOR}{fraction}',
                            {
                                ICON_SEPARATOR,
                                label:this.formatAsLabel(),
                                percent:this.formatAsPercent(),
                                fraction:this.formatAsBracketFraction()
                            }
                        );
                    case '[/]':
                    case 'bracketFraction':
                        return '[' + value + '/' + max + ']';
                    case '/':
                    case 'fraction':
                    default:
                        return value + '/' + max;
                }
            },
            formatVerbose: function(template) {return this.format('verbose', template);},
            formatAsPercent: function(template) {return this.format('%', template);},
            formatAsFraction: function(template) {return this.format('/', template);},
            formatAsBracketFraction: function(template) {return this.format('[/]', template);},
            formatAsLabel: function(template) {return this.format('label', template);},
            formatAsTooltip: function(template) {return this.format('tooltip', template);},
            
            getAsObj: function(cfg) {
                const self = this,
                    retval = self.callSuper(cfg);
                for (const key of ['absMin','min','value','max','absMax']) {
                    retval[key] = self[key];
                }
                return retval;
            },
            
            // Persistence /////////////////////////////////////////////////////
            /*  absMin and absMax never change after init so they are not saved. */
            exportToObj: function() {
                return {min:this.min, max:this.max, value:this.value};
            },
            
            /*  Restores bounds before the value so the value isn't clamped by stale bounds. Uses
                setValue rather than adjValue so nothing is forwarded (e.g. Event paradox to the
                timeline). */
            importFromObj: function(obj) {
                if ('min' in obj) this.setMin(obj.min);
                if ('max' in obj) this.setMax(obj.max);
                if ('value' in obj) this.setValue(obj.value);
            }
        }),
        
        NotifyingStatModelMixin = pkg.NotifyingStatModelMixin = new JS.Module('NotifyingStatModelMixin', {
            init: function(attrs) {
                this.quickSet(['notifyTargets'], attrs);
                this.callSuper(attrs);
            },
            
            notifyCollectionOfUpdate: function() {
                if (this.inited) {
                    this.callSuper();
                    
                    const notifyTargets = this.notifyTargets;
                    if (Array.isArray(notifyTargets)) {
                        for (const notifyTarget of notifyTargets) notifyTarget.notifyStatChanged?.(this);
                    } else {
                        notifyTargets.notifyStatChanged?.(this);
                    }
                }
            },
        });
    
    pkg.NotifyingNumericStatModel = new JS.Class('NotifyingNumericStatModel', NumericStatModel, {
        include: [NotifyingStatModelMixin]
    });
})(tc);