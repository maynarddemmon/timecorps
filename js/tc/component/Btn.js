(pkg => {
    const JSClass = JS.Class,
        
        M = myt,
        
        {btnHeight} = pkg.theme,
        
        updateBtnIcon = btn => {
            const {icon, iconSize, iconX, iconY} = btn;
            let iconView = btn.getIconView();
            if (icon) {
                if (!iconView) iconView = btn.__iconView = new M.PlainText(btn);
                iconView.setX(iconX);
                iconView.setY(iconY);
                iconView.setText(icon);
                iconView.setFontSize(iconSize);
                iconView.setVisible(true);
            } else {
                iconView?.setVisible(false);
            }
            btn.sizeViewToDom();
        },
        
        Btn = pkg.Btn = new JSClass('Btn', M.PaddedText, {
            include: [M.Button],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            initNode: function(parent, attrs) {
                // Do disabled late since domClass will step on it.
                this.appendToLateAttrs('disabled');
                
                attrs.userUnselectable ??= true;
                attrs.tagName ??= 'button';
                attrs.focusable ??= true;
                attrs.focusIndicator ??= false;
                attrs.height ??= btnHeight;
                
                attrs.paddingLeft ??= 8;
                attrs.paddingRight ??= 8;
                
                const buttonType = attrs.buttonType || '';
                delete attrs.buttonType;
                
                this.callSuper(parent, attrs);
                this.addDomClass('tc-Btn', buttonType);
                
                updateBtnIcon(this);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setButtonType: function(v) {
                this.setDomClass('tc-Btn ' + (v || ''));
                if (this.disabled) this.addDomClass('disabled');
            },
            
            /** @overrides */
            setDisabled: function(v) {
                if (this.disabled !== v) {
                    this.callSuper(v);
                    
                    this.removeDomClass('disabled');
                    if (this.disabled) this.addDomClass('disabled');
                }
            },
            
            setIcon: function(v) {
                this.set('icon', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            setIconSize: function(v) {
                this.set('iconSize', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            setIconX: function(v) {
                this.set('iconX', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            setIconY: function(v) {
                this.set('iconY', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            getIconView: function() {
                return this.__iconView;
            }
        });
    
    pkg.SquareBtn = new JSClass('SquareBtn', Btn, {
        initNode: function(parent, attrs) {
            attrs.width ??= btnHeight;
            attrs.paddingLeft ??= 0;
            attrs.paddingRight ??= 0;
            
            this.callSuper(parent, attrs);
        }
    });
})(tc);
