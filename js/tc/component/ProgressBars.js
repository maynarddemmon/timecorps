(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        M = myt,
        
        {
            colorUltraLight, colorMedium, colorDark, colorMegaDark, colorHistoricity, colorAttestation, colorParadox, 
            colorChronal, colorHealth,
            fontSizeMicro
        } = pkg.theme,
        
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
    
    pkg.SkillBar = new JSClass('HealthBar', M.ProgressBar, {
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
            delete attrs.label;
            delete attrs.showLabel;
            delete attrs.labelX;
            delete attrs.labelY;
            delete attrs.labelFontSize;
            delete attrs.labelColor;
            
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
                gradient:['linear', isHorizontal ? 'right' : 'top', '#f00', '#ff0', '#0f0']
            });
            
            gradientView.sendToBack();
            
            if (showLabel) this.labelView = new M.PlainText(this, {x:labelX, y:labelY, text:label, textColor:labelColor, fontSize:labelFontSize});
            
            this.updateValueView();
        },
        
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
