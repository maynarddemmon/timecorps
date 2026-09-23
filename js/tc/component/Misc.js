(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        M = myt,
        {
            View, Text, PaddedText, PlainText, PaddedPlainText, 
            ResizeLayout, WrappingLayout, SizeToParent, interpolateString
        } = M,
        
        {
            theme:{
                spacing, padding, layoutSpacing, btnHeight, rowHeight,
                colorUltraLight, colorMedium, colorDark, colorUltraDark, colorMegaDark, colorBtn,
                fontSizeMicro, fontSizeMedium, fontSizeLarge, fontSizeVeryLarge, fontFamilyMono,
                colorHistoricity, colorAttestation, colorParadox, colorChronal
            },
            ICON_NIL
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
                new M.ResizeLayout(headerView, {inset:padding/2, spacing:spacing, outset:padding/2});
                
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
        
        
        // Details Row Classes
        LABEL_WIDTH = 75,
        ROW_PADDING_TOP = 3,
        
        GrandWidthMixin = pkg.GrandWidthMixin = new JSModule('GrandWidthMixin', {
            initNode: function(parent, attrs) {
                // Compensate for parents x position
                attrs.x ??= -parent.x;
                attrs.percentOfParentWidthOffset = 2*parent.x;
                
                this.callSuper(parent, attrs);
            }
        }),
        Row = pkg.Row = new JSClass('Row', WideView, {
            include: [GrandWidthMixin],
            
            initNode: function(parent, attrs) {
                attrs.height ??= rowHeight;
                attrs.textColor ??= colorMedium;
                
                const inset = attrs.inset ?? parent.x;
                delete attrs.inset;
                
                this.callSuper(parent, attrs);
                
                new ResizeLayout(this, {inset:inset, spacing:spacing, outset:inset})
            }
        }),
        TextForFlow = pkg.TextForFlow = new JSClass('TextForFlow', PaddedText, {
            initNode: function(parent, attrs) {
                attrs.paddingTop ??= 5;
                attrs.paddingBottom ??= 5;
                attrs.whiteSpace ??= 'normal';
                this.callSuper(parent, attrs);
            }
        }),
        
        
        // Progress Bar Classes
        StatProgressBar = pkg.StatProgressBar = new JSClass('StatProgressBar', M.ProgressBar, {
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
                
                if (showLabel) this.labelView = new PlainText(this, {x:labelX, y:labelY, fontSize:labelFontSize});
            },
            
            setLabelTemplate: function(v) {
                this.set('labelTemplate', v, true);
            },
            
            updateForStat: function(statModel) {
                const self = this,
                    labelView = self.labelView,
                    label = interpolateString(self.labelTemplate, {label:statModel.formatAsLabel()}),
                    tooltip = label + statModel.formatAsTooltip('{ICON_SEPARATOR}{percent}{ICON_SEPARATOR}{fraction}');
                labelView?.setText(label);
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
    
    pkg.DividerRow = new JSClass('DividerRow', Row, {
        initNode: function(parent, attrs) {
            const self = this,
                label = attrs.label;
            delete attrs.label;
            
            attrs.bgColor ??= colorDark;
            
            self.callSuper(parent, attrs);
            
            self._label = new PlainText(self, {valign:'middle', fontSize:fontSizeMedium, text:label});
        },
        setLabel: function(v) {this._label.setText(v);}
    });
    
    pkg.DetailRow = new JSClass('DetailRow', WideView, {
        initNode: function(parent, attrs) {
            const self = this,
                label = attrs.label,
                labelWidth = attrs.labelWidth ?? LABEL_WIDTH;
            delete attrs.label;
            delete attrs.labelWidth;
            
            self.callSuper(parent, attrs);
            
            self._label = new PaddedPlainText(self, {
                width:labelWidth, textColor:colorMedium, fontSize:fontSizeMedium, textAlign:'right',
                paddingTop:ROW_PADDING_TOP, text:label
            });
            
            const valueX = labelWidth + padding;
            self._value = new TextForFlow(self, {
                x:valueX, percentOfParentWidth:100, percentOfParentWidthOffset:-valueX, text:ICON_NIL
            }, [SizeToParent, {
                sizeViewToDom: function() {
                    this.callSuper();
                    if (self.height !== this.height) self.setHeight(this.height);
                }
            }]);
        },
        setLabel: function(v) {this._label.setText(v);},
        setValue: function(v) {this._value.setText(v || ICON_NIL);}
    });
    
    pkg.DetailRowFlow = new JSClass('DetailRowFlow', WideView, {
        initNode: function(parent, attrs) {
            const self = this,
                label = attrs.label,
                labelWidth = attrs.labelWidth ?? LABEL_WIDTH;
            delete attrs.label;
            delete attrs.labelWidth;
            attrs.defaultPlacement = '_content';
            
            self.callSuper(parent, attrs);
            
            const labelView = self._label = new PaddedPlainText(self, {
                width:labelWidth, textColor:colorMedium, fontSize:fontSizeMedium, textAlign:'right',
                paddingTop:ROW_PADDING_TOP, text:label
            });
            
            const contentX = labelWidth + padding,
                contentView = self._content = new View(self, {
                    x:contentX, percentOfParentWidth:100, percentOfParentWidthOffset:-contentX
                }, [SizeToParent, {
                    setHeight: function(v) {
                        if (this.height !== v) {
                            this.callSuper(v);
                            const newHeight = Math.max(labelView.height, this.height);
                            if (self.height !== newHeight) self.setHeight(newHeight);
                        }
                    }
                }]);
            new WrappingLayout(contentView, {spacing:padding, lineSpacing:-5, collapseParent:true});
        },
        setLabel: function(v) {this._label.setText(v);},
        clearContent: function() {
            this._content.destroyAllSubviews();
        }
    });
    
    pkg.NoValueText = new JSClass('NoValueText', TextForFlow, {
        initNode: function(parent, attrs) {
            attrs.text ??= ICON_NIL;
            this.callSuper(parent, attrs);
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
            //attrs.trackOutset ??= 0;
            //attrs.trackInset ??= 0;
            
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
