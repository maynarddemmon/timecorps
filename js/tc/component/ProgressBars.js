(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        M = myt,
        
        {
            colorMegaDark, colorHistoricity, colorAttestation, colorParadox, colorChronal,
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
                    labelFontSize = attrs.labelFontSize ??= fontSizeMicro;
                delete attrs.showLabel;
                delete attrs.labelX;
                delete attrs.labelY;
                delete attrs.labelFontSize;
                
                this.callSuper(parent, attrs);
                
                if (showLabel) this.labelView = new M.PlainText(this, {x:labelX, y:labelY, fontSize:labelFontSize});
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
        _update: function(v) {
            this.updateForStat(this.statModel);
        }
    });
})(tc);
