(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        
        {spacing, btnHeight, colorLight} = pkg.theme,
        
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
            }
        });
    
    pkg.AgentBtn = new JSClass('AgentBtn', M.View, {
        initNode: function(parent, attrs) {
            const self = this,
                disabled = attrs.disabled,
                text = attrs.text,
                agentModel = attrs.agentModel;
            delete attrs.agentModel;
            
            attrs.height ??= btnHeight;
            
            self.callSuper(parent, attrs);
            
            self.agentIcon = new pkg.SimpleAgentMarker(self, {disabled, model:agentModel});
            self.btn = new Btn(self, {
                buttonType:'underline', textColor:colorLight, text, disabled
            }, [{doActivated: self.doActivated}]);
            
            new M.SpacedLayout(self, {spacing:-5, collapseParent:true});
        },
        
        doActivated: M.NOOP,
        
        setDisabled: function(v) {if (this.inited) this.btn.setDisabled(v);},
        setText: function(v) {if (this.inited) this.btn.setText(v);},
        setBtnModel: function(v) {if (this.inited) this.agentIcon.setModel(v);}
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
