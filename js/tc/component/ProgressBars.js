(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        M = myt,
        
        {
            colorUltraLight, colorMedium, colorDark, colorMegaDark, colorHistoricity, colorAttestation, colorParadox, 
            colorChronal, colorHealth,
            fontSizeMicro
        } = pkg.theme,
        
        updateValueViewForRounding = progressBar => {
            const {valueView, trackInset, axis} = progressBar,
                size = progressBar.convertValueToPixels(progressBar.value) - trackInset,
                isXAxis = axis === 'x',
                crossDimension = isXAxis ? 'height' : 'width',
                crossFullSize = progressBar[crossDimension],
                crossSize = Math.min(size, crossFullSize - 2*trackInset);
            valueView.setBgColor(progressBar.valueColor);
            valueView.set(isXAxis ? 'width' : 'height', size);
            valueView.set(crossDimension, crossSize);
            valueView.set(isXAxis ? 'y' : 'x', (crossFullSize - crossSize)/2);
        },
        
        StatProgressBar = new JSClass('StatProgressBar', M.ProgressBar, {
            initNode: function(parent, attrs) {
                attrs.bgColor ??= colorMegaDark;
                attrs.height ??= 6;
                attrs.roundedCorners ??= 3;
                attrs.trackOutset ??= 1;
                attrs.trackInset ??= 1;
                
                attrs.labelTemplate ??= '{label}';
                
                const showLabel = attrs.showLabel ??= true,
                    labelX = attrs.labelX ??= attrs.trackInset,
                    labelY = attrs.labelY ??= -12,
                    labelFontSize = attrs.labelFontSize ??= fontSizeMicro,
                    labelColor = attrs.labelColor ??= colorMedium;
                delete attrs.showLabel;
                delete attrs.labelX;
                delete attrs.labelY;
                delete attrs.labelFontSize;
                delete attrs.labelColor;
                
                this.callSuper(parent, attrs);
                
                if (showLabel) this.labelView = new M.PlainText(this, {x:labelX, y:labelY, textColor:labelColor, fontSize:labelFontSize});
            },
            
            setLabelTemplate: function(v) {
                this.set('labelTemplate', v, true);
            },
            
            updateForStat: function(statModel) {
                const self = this,
                    labelView = self.labelView,
                    label = M.interpolateString(self.labelTemplate, {label:statModel.formatAsLabel()}),
                    tooltip = label + statModel.formatAsTooltip('{ICON_SEPARATOR}{percent}{ICON_SEPARATOR}{fraction}');
                labelView?.setText(label);
                labelView?.setTooltip(tooltip);
                self.setMinValue(statModel.getMin());
                self.setMaxValue(statModel.getMax());
                self.setValue(statModel.getValue());
                self.setTooltip(tooltip);
            },
            
            /** @overrides M.ProgressBar */
            updateValueView: function() {
                updateValueViewForRounding(this);
            }
        });
    
    pkg.HistoricityBar = new JSClass('HistoricityBar', StatProgressBar, {
        initNode: function(parent, attrs) {
            attrs.valueColor ??= colorHistoricity;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.AttestationBar = new JSClass('AttestationBar', StatProgressBar, {
        initNode: function(parent, attrs) {
            attrs.valueColor ??= colorAttestation;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.ParadoxBar = new JSClass('ParadoxBar', StatProgressBar, {
        initNode: function(parent, attrs) {
            attrs.valueColor ??= colorParadox;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.ChronalBar = new JSClass('ChronalBar', StatProgressBar, {
        initNode: function(parent, attrs) {
            attrs.valueColor ??= colorChronal;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.HealthBar = new JSClass('HealthBar', StatProgressBar, {
        initNode: function(parent, attrs) {
            attrs.valueColor ??= colorHealth;
            this.callSuper(parent, attrs);
        }
    });
    
    /*  A skill's value on a bar from red to green, labeled above. With showIncreaseBtn, a
        button at the right of the label calls doIncrease, e.g. to buy points. */
    pkg.SkillBar = new JSClass('SkillBar', M.ProgressBar, {
        initNode: function(parent, attrs) {
            attrs.valueColor ??= colorUltraLight;
            attrs.bgColor ??= colorDark;
            attrs.height ??= 6;
            const roundedCorners = attrs.roundedCorners ??= 3;
            attrs.trackOutset ??= 1;
            attrs.trackInset ??= 1;
            
            const showLabel = attrs.showLabel ??= true,
                label = attrs.label ??= '',
                labelX = attrs.labelX ??= attrs.trackInset,
                labelY = attrs.labelY ??= -12,
                labelFontSize = attrs.labelFontSize ??= fontSizeMicro,
                labelColor = attrs.labelColor ??= colorMedium;
            const showIncreaseBtn = attrs.showIncreaseBtn;
            delete attrs.label;
            delete attrs.showLabel;
            delete attrs.labelX;
            delete attrs.labelY;
            delete attrs.labelFontSize;
            delete attrs.labelColor;
            delete attrs.showIncreaseBtn;
            
            this.callSuper(parent, attrs);
            
            const isHorizontal = this.axis === 'x',
                trackInset = this.trackInset,
                size = 2*roundedCorners,
                valueView = this.valueView;
            valueView.setWidth(size);
            valueView.setHeight(size);
            valueView.setRoundedCorners(roundedCorners + trackInset);
            valueView.setBgColor(this.valueColor);
            valueView.setBorder([trackInset, 'solid', colorDark]);
            
            const gradientView = this.gradientView = new M.View(this, {
                x:trackInset, y:trackInset,
                width:this.width - 2*trackInset,
                height:this.height - 2*trackInset,
                roundedCorners:roundedCorners - trackInset,
                gradient:['linear', isHorizontal ? 'right' : 'top', '#f00c', '#ff06', '#0f0c']
            });
            
            gradientView.sendToBack();
            
            if (showLabel) this.labelView = new M.PlainText(this, {x:labelX, y:labelY, text:label, textColor:labelColor, fontSize:labelFontSize});
            
            if (showIncreaseBtn) {
                // Not focusable, since it can become disabled by its own click, e.g. when the
                // last credit is spent, and focus would then jump elsewhere in the dialog.
                this.increaseBtn = new pkg.UnderlineBtn(this, {
                    align:'right', alignOffset:2*labelX, y:labelY - 1, height:14, fontSize:labelFontSize, text:'+', focusable:false
                }, [{doActivated: () => {this.doIncrease();}}]);
            }
            
            this.updateValueView();
        },
        
        setLabelText: function(text) {this.labelView?.setText(text);},
        
        /*  Sets the increase button's text, whether it's disabled and its tooltip. */
        updateIncreaseBtn: function(text, disabled, tooltip) {
            const btn = this.increaseBtn;
            if (btn) {
                btn.setText(text);
                btn.setDisabled(disabled);
                btn.setTooltip(tooltip);
            }
        },
        
        /*  Called when the increase button is clicked. */
        doIncrease: M.NOOP,
        
        updateValueView: function() {
            const isHorizontal = this.axis === 'x',
                {trackInset, valueView} = this;
            valueView.set(isHorizontal ? 'y' : 'x', -trackInset);
            valueView.set(isHorizontal ? 'x' : 'y', this.convertValueToPixels(this.value) - valueView.width / 2 - trackInset);
        }
    });
    
    pkg.MiniStatBar = new JSModule('MiniStatBar', {
        initNode: function(parent, attrs) {
            attrs.showLabel ??= false;
            attrs.height ??= 5;
            attrs.roundedCorners ??= 0;
            
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.BigStatBar = new JSModule('BigStatBar', {
        initNode: function(parent, attrs) {
            attrs.showLabel ??= true;
            attrs.width ??= 150;
            attrs.height ??= 18;
            attrs.roundedCorners ??= 9;
            attrs.labelY ??= 3;
            attrs.labelX ??= 8;
            
            this.callSuper(parent, attrs);
        },
        
        watchStatModel: function(statModel) {
            this.statModel = statModel;
            this.constrain('_update', [statModel, 'value', statModel, 'max']);
        },
        _update: function(_event) {
            this.updateForStat(this.statModel);
        }
    });
})(tc);
