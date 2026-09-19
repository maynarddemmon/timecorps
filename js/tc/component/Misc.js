(pkg => {
    const JSClass = JS.Class,
        
        M = myt,
        {View, SizeToParent} = M,
        
        {
            spacing, padding, layoutSpacing, btnHeight, rowHeight,
            colorUltraLight, colorMedium, colorDark, colorUltraDark, colorBtn,
            fontSizeMedium, fontSizeLarge, fontSizeVeryLarge, fontFamilyMono
        } = pkg.theme,
        
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
                (this._titleView = new M.PlainText(headerView, {text:title, tooltip:title, textColor:colorMedium, fontSize:fontSizeVeryLarge, y:1, layoutHint:1})).enableEllipsis();
                new M.ResizeLayout(headerView, {inset:padding, spacing:spacing, outset:padding});
                
                const y = headerView.y + headerView.height + layoutSpacing;
                this._contentView = new WideView(this, {
                    ignorePlacement:true, overflow:'auto', y, percentOfParentHeight:100, percentOfParentHeightOffset:-y,
                    bgColor:colorUltraDark, textColor:colorUltraLight
                });
            },
            
            setTitle: function(v) {
                this._titleView.setText(v);
                this._titleView.setTooltip(v);
            },
            
            getHeaderView: function() {return this._headerView;},
            getContentView: function() {return this._contentView;}
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
})(tc);
