(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        M = myt,
        {View, Text, PaddedText, PlainText, PaddedPlainText, SpacedLayout, ResizeLayout, SizeToParent} = M,
        
        {
            theme:{
                spacing, padding, layoutSpacing, rowHeight,
                colorUltraLight, colorMedium, colorDarkMedium, colorDark, colorUltraDark, colorBtn,
                fontSizeMicro, fontSizeMedium, fontSizeLarge, fontSizeVeryLarge, fontFamilyMono
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
                
                const headerView = this._headerView = new WideView(this, {
                    ignorePlacement:true, height:rowHeight, bgColor:colorDarkMedium
                });
                (this._titleView = new Text(headerView, {
                    text:title, tooltip:title, textColor:colorMedium, fontSize:fontSizeVeryLarge, y:1, layoutHint:1
                })).enableEllipsis();
                new ResizeLayout(headerView, {inset:padding/2, spacing:spacing, outset:padding/2});
                
                const y = headerView.y + headerView.height + layoutSpacing;
                this._contentView = new WideView(this, {
                    ignorePlacement:true, overflow:'auto', y, percentOfParentHeight:100, percentOfParentHeightOffset:-y,
                    bgColor:colorUltraDark, textColor:colorUltraLight
                });
            },
            
            setTitle: function(v, tooltip) {
                const titleView = this.getTitleView();
                titleView.setText(v);
                titleView.setTooltip(tooltip ?? pkg.stripMarkup(v));
            },
            
            getHeaderView: function() {return this._headerView;},
            getTitleView: function() {return this._titleView;},
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
                
                new ResizeLayout(this, {inset:inset, spacing:spacing, outset:inset});
            }
        }),
        DividerRow = pkg.DividerRow = new JSClass('DividerRow', Row, {
            initNode: function(parent, attrs) {
                const self = this,
                    label = attrs.label;
                delete attrs.label;
                
                attrs.bgColor ??= colorDark;
                
                self.callSuper(parent, attrs);
                
                self._label = new PlainText(self, {y:4, fontSize:fontSizeMedium, text:label});
            },
            setLabel: function(v) {this._label.setText(v);}
        }),
        TextForFlow = pkg.TextForFlow = new JSClass('TextForFlow', PaddedText, {
            initNode: function(parent, attrs) {
                attrs.paddingTop ??= 5;
                attrs.paddingBottom ??= 5;
                attrs.whiteSpace ??= 'normal';
                this.callSuper(parent, attrs);
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
            this.getHeaderView().setBgColor(colorDark);
            const titleView = this.getTitleView();
            titleView.setY(4);
            titleView.setFontSize(fontSizeMedium);
            this.syncTo(this._contentView, '_updateHeight', 'height');
        },
        _updateHeight: function(_event) {
            const contentView = this.getContentView();
            this.setHeight(contentView.y + contentView.height);
        }
    });
    
    pkg.LabeledValue = new JSClass('LabeledValue', PaddedText, {
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
            this.setText(this.label + ' : ' + pkg.wrapInStyledSpan(this.value, this.valueTextColor, this.valueFontFamily));
        }
    });
    
    /*  A titled, collapsible section. Clicking the header toggles it, except on buttons placed
        in the header. Expanded, it takes a share of its parent's height by layoutHint and 
        scrolls its content. Collapsed, it shrinks to just the header.
        
        Attributes:
            label:string - The header text. A +/- icon is shown in front of it.
            expanded:boolean - Defaults to true. */
    pkg.ContainerRow = new JSClass('ContainerRow', WideView, {
        initNode: function(parent, attrs) {
            const self = this;
            
            self.label = attrs.label ?? '';
            delete attrs.label;
            
            self.layoutWeight = attrs.layoutHint ??= 1;
            attrs.defaultPlacement = '_contentView';
            
            attrs.expanded ??= true;
            
            self.callSuper(parent, attrs);
            
            const header = self._headerView = new DividerRow(self, {inset:padding}, [M.Button, {
                    doActivated: function() {self.setExpanded(!self.expanded);}
                }]),
                wrapper = self._wrapperView = new WideView(self, {y:header.height, overflow:'autoy'}),
                content = self._contentView = new WideView(wrapper);
            new SpacedLayout(content, {axis:'y', spacing:1, outset:1, collapseParent:true});
            
            wrapper.addDomClass('hideScrollbar');
            wrapper.getIDS().overscrollBehavior = 'none';
            
            // Apply the initial state, which also sets the header text.
            self._applyExpanded();
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setHeight: function(v) {
            this.callSuper(v);
            if (this.inited) {
                const wrapper = this.getWrapperView();
                wrapper.setHeight(this.height - wrapper.y);
            }
        },
        setLabel: function(v) {
            this.label = v;
            if (this.inited) this._updateHeaderLabel();
        },
        getHeaderView: function() {return this._headerView;},
        getWrapperView: function() {return this._wrapperView;},
        getContentView: function() {return this._contentView;},
        
        setExpanded: function(expanded) {
            this.set('expanded', expanded, true);
            if (this.inited) {
                this._applyExpanded();
                this.parent.getFirstLayout().update();
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /** @private */
        _applyExpanded: function() {
            const self = this,
                expanded = self.expanded;
            if (expanded) {
                self.setLayoutHint(self.layoutWeight);
            } else {
                self.setLayoutHint(null);
                self.setHeight(self.getHeaderView().height);
            }
            self.getWrapperView().setVisible(expanded);
            self._updateHeaderLabel();
        },
        
        /** @private */
        _updateHeaderLabel: function() {
            this.getHeaderView().setLabel((this.expanded ? pkg.ICON_EXPANDED : pkg.ICON_COLLAPSED) + ' ' + this.label);
        }
    });
    
    pkg.DetailRow = new JSClass('DetailRow', WideView, {
        initNode: function(parent, attrs) {
            const self = this,
                label = attrs.label,
                labelWidth = attrs.labelWidth ?? LABEL_WIDTH,
                vertical = attrs.vertical ?? false;
            delete attrs.label;
            delete attrs.labelWidth;
            delete attrs.vertical;
            
            self.callSuper(parent, attrs);
            
            const labelView = self._label = new PaddedPlainText(self, {
                width:labelWidth, textColor:colorMedium, fontSize:fontSizeMedium, textAlign:vertical ? 'left' : 'right',
                paddingTop:ROW_PADDING_TOP, text:label
            });
            
            const valueX = vertical ? 0 : labelWidth + padding;
            self._value = new TextForFlow(self, {
                x:valueX, y:vertical ? labelView.y + labelView.height : 0,
                percentOfParentWidth:100, percentOfParentWidthOffset:-valueX, text:ICON_NIL
            }, [SizeToParent, {
                sizeViewToDom: function() {
                    this.callSuper();
                    const yExtent = this.y + this.height;
                    if (self.height !== yExtent) self.setHeight(yExtent);
                }
            }]);
        },
        setLabel: function(v) {this._label.setText(v);},
        setValue: function(v) {this.getValueView().setText(v || ICON_NIL);},
        getValueView: function() {return this._value;}
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
            new M.WrappingLayout(contentView, {spacing, lineSpacing:-5, collapseParent:true});
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
    
    pkg.CompactField = new JSClass('CompactField', View, {
        initNode: function(parent, attrs) {
            const self = this,
                label = attrs.label ??= '',
                value = attrs.value ??= '',
                labelFontSize = attrs.labelFontSize ??= fontSizeMicro;
            delete attrs.label;
            delete attrs.value;
            delete attrs.labelFontSize;
            
            self.callSuper(parent, attrs);
            
            self._lv = new PlainText(self, {
                x:1, text:label, textColor:colorMedium, fontSize:labelFontSize});
            const vv = self._vv = new Text(self, {
                x:1, y:12, text:value, whiteSpace:'normal'
            });
            
            self.constrain('_updateHeight', [vv, 'y', vv, 'height']);
            self.setWidth(self.width);
        },
        
        _updateHeight: function(_event) {
            const vv = this._vv;
            this.setHeight(vv.y + vv.height);
        },
        
        setWidth: function(v) {
            this.callSuper(v);
            if (this.inited) {
                const w = this.width - 2;
                this._lv.setWidth(w);
                this._vv.setWidth(w);
            }
        },
        
        setLabel: function(v) {this._lv.setText(v);},
        setValue: function(v) {this._vv.setText(v);}
    });
    
    pkg.CompactFieldRow = new JSClass('CompactFieldRow', WideView, {
        initNode: function(parent, attrs) {
            this.callSuper(parent, attrs);
            
            new ResizeLayout(this, {inset:spacing, spacing, outset:spacing});
            new M.SizeToChildren(this, {axis:'y'});
        }
    });
    
    pkg.TallView = new JSClass('TallView', View, {
        include: [SizeToParent],
        
        initNode: function(parent, attrs) {
            attrs.percentOfParentHeight ??= 100;
            this.callSuper(parent, attrs);
        }
    });
})(tc);
