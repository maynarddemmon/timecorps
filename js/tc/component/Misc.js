(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, Text, PlainText, SizeToParent} = M,
        
        {
            theme:{
                spacing, padding, layoutSpacing, btnHeight, rowHeight,
                colorUltraLight, colorMedium, colorDark, colorUltraDark, colorMegaDark, colorBtn,
                fontSizeMicro, fontSizeMedium, fontSizeLarge, fontSizeVeryLarge, fontFamilyMono,
                colorHistoricity, colorAttestation, colorParadox
            }
        } = pkg,
        
        WideView = pkg.WideView = new JSClass('WideView', View, {
            include: [SizeToParent],
            
            initNode: function(parent, attrs) {
                attrs.percentOfParentWidth ??= 100;
                this.callSuper(parent, attrs);
            }
        }),
        
        Panel = pkg.Panel = new JSClass('Panel', View, {
            initNode: function(parent, attrs) {
                attrs.defaultPlacement = '_contentView';
                
                const title = attrs.title ?? '';
                delete attrs.title
                
                this.callSuper(parent, attrs);
                
                const headerView = this._headerView = new WideView(this, {ignorePlacement:true, height:rowHeight, bgColor:colorDark});
                (this._titleView = new Text(headerView, {text:title, tooltip:title, textColor:colorMedium, fontSize:fontSizeVeryLarge, y:1, layoutHint:1})).enableEllipsis();
                new M.ResizeLayout(headerView, {inset:padding, spacing:spacing, outset:padding});
                
                const y = headerView.y + headerView.height + layoutSpacing;
                this._contentView = new WideView(this, {
                    ignorePlacement:true, overflow:'auto', y, percentOfParentHeight:100, percentOfParentHeightOffset:-y,
                    bgColor:colorUltraDark, textColor:colorUltraLight
                });
            },
            
            setTitle: function(v, tooltip) {
                this._titleView.setText(v);
                this._titleView.setTooltip(tooltip ?? v);
            },
            
            getHeaderView: function() {return this._headerView;},
            getContentView: function() {return this._contentView;}
        }),
        
        StatProgressBar = pkg.StatProgressBar = new JSClass('StatProgressBar', M.ProgressBar, {
            initNode: function(parent, attrs) {
                attrs.bgColor ??= colorMegaDark;
                attrs.height ??= 6;
                attrs.roundedCorners ??= 3;
                attrs.trackOutset ??= 1;
                const trackInset = attrs.trackInset ??= 1,
                    showLabel = attrs.showLabel ??= true,
                    labelY = attrs.labelY ??= -12,
                    labelFontSize = attrs.labelFontSize ??= fontSizeMicro;
                
                this.callSuper(parent, attrs);
                
                if (showLabel) {
                    this.labelView = new PlainText(this, {x:trackInset, y:labelY, fontSize:labelFontSize});
                }
            },
            
            updateForStat: function(statModel) {
                const self = this,
                    labelView = self.labelView,
                    tooltip = statModel.formatAsTooltip();
                labelView?.setText(statModel.formatAsLabel());
                labelView?.setTooltip(tooltip);
                self.setMinValue(statModel.getMin());
                self.setMaxValue(statModel.getMax());
                self.setValue(statModel.getValue());
                self.setTooltip(tooltip);
            }
        });
    
    pkg.Spacer = new JSClass('Spacer', View, {
        initNode: function(parent, attrs) {
            attrs.layoutHint ??= 1;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.MiniPanel = new JSClass('MiniPanel', Panel, {
        initNode: function(parent, attrs) {
            this.callSuper(parent, attrs);
            this._titleView.setY(4);
            this._titleView.setFontSize(fontSizeMedium);
            this.syncTo(this._contentView, '_updateHeight', 'height');
        },
        _updateHeight: function(_event) {
            const contentView = this.getContentView();
            this.setHeight(contentView.y + contentView.height);
        }
    });
    
    pkg.LabeledValue = new JSClass('LabeledValue', M.PaddedText, {
        initNode: function(parent, attrs) {
            attrs.paddingLeft ??= padding;
            attrs.paddingRight ??= spacing;
            attrs.textColor ??= colorMedium;
            attrs.valueTextColor ??= colorBtn;
            attrs.valueFontFamily ??= fontFamilyMono;
            attrs.fontSize ??= fontSizeLarge;
            attrs.y ??= 1;
            
            this.callSuper(parent, attrs);
            this.update();
        },
        
        setLabel: function(v) {
            this.set('label', v, true);
            if (this.inited) this.updateText();
        },
        
        setValue: function(v) {
            this.set('value', v, true);
            if (this.inited) this.updateText();
        },
        
        setValueTextColor: function(v) {
            this.set('valueTextColor', v, true);
            if (this.inited) this.updateText();
        },
        
        setValueFontFamily: function(v) {
            this.set('valueFontFamily', v, true);
            if (this.inited) this.updateText();
        },
        
        update: function(v) {
            this.setValue(v ?? '-');
        },
        
        updateText: function() {
            this.setText(this.label + ' : <span style="color:' + this.valueTextColor + '; font-family:' + this.valueFontFamily + ';">' + this.value + '</span>');
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
    pkg.MiniStatBar = new JS.Module('MiniStatBar', {
        initNode: function(parent, attrs) {
            attrs.showLabel ??= false;
            attrs.height ??= 5;
            attrs.roundedCorners ??= 0;
            //attrs.trackOutset ??= 0;
            //attrs.trackInset ??= 0;
            
            this.callSuper(parent, attrs);
        }
    });
})(tc);
