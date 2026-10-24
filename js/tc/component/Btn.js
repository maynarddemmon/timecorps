(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        
        {btnHeight, colorBtnLight, colorAction} = pkg.theme,
        
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
                
                this.sizeViewToDom();
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
        }),
        
        UnderlineBtn = pkg.UnderlineBtn = new JSClass('UnderlineBtn', Btn, {
            initNode: function(parent, attrs) {
                attrs.buttonType ??= 'underline';
                attrs.textColor ??= colorBtnLight;
                attrs.paddingLeft ??= 0;
                attrs.paddingRight ??= 0;
                
                this.callSuper(parent, attrs);
            }
        });
        
    /*  Scrolls the timeline to an Event while the mouse is over the button, and back to the
        selected Event when it leaves. The Event comes from getNavEventModel.
        
        Attributes:
            navEventModel:EventModel - The Event to scroll to. */
    const EventNavHover = pkg.EventNavHover = new JS.Module('EventNavHover', {
        setNavEventModel: function(v) {this.navEventModel = v;},
        getNavEventModel: function() {return this.navEventModel;},
        
        setMouseOver: function(v) {
            if (this.inited && this.mouseOver !== v) {
                this.callSuper(v);
                const app = pkg.app;
                if (this.mouseOver) {
                    app.scrollTo(this.getNavEventModel());
                } else {
                    app.scrollToSelectedEvent(true);
                }
            }
        }
    });
    
    /*  A button that selects an Event, and scrolls the timeline to it on hover. The text
        defaults to the Event's name followed by a forward arrow.
        
        Attributes:
            navEventModel:EventModel - The Event to select. */
    pkg.EventNavBtn = new JSClass('EventNavBtn', UnderlineBtn, {
        include: [EventNavHover],
        
        initNode: function(parent, attrs) {
            attrs.text ??= attrs.navEventModel.name + ' ' + pkg.ICON_NAV_FORWARD;
            this.callSuper(parent, attrs);
        },
        
        doActivated: function() {pkg.app.selectEventBox(this.getNavEventModel());}
    });
    
    pkg.UnderlineActionBtn = new JSClass('UnderlineActionBtn', UnderlineBtn, {
        initNode: function(parent, attrs) {
            attrs.textColor ??= colorAction;
            this.callSuper(parent, attrs);
            this.addDomClass('action');
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
            
            const connectorLine = 10;
            self.btn = new UnderlineBtn(self, {paddingLeft:connectorLine, text, disabled}, [{doActivated: self.doActivated.bind(self)}]);
            self.agentIcon = new pkg.SimpleAgentMarker(self, {disabled, model:agentModel});
            
            new M.SpacedLayout(self, {spacing:2 - connectorLine, collapseParent:true, reverse:true});
        },
        
        doActivated: M.NOOP,
        
        setDisabled: function(v) {if (this.inited) this.btn.setDisabled(v);},
        setText: function(v) {if (this.inited) this.btn.setText(v);},
        // On the button itself, so it shows like the other buttons' tooltips rather than as a
        // browser title on the whole row.
        setTooltip: function(v) {if (this.inited) this.btn.setTooltip(v);},
        setBtnModel: function(v) {if (this.inited) this.agentIcon.setModel(v);}
    });
    
    pkg.SquareBtn = new JSClass('SquareBtn', Btn, {
        initNode: function(parent, attrs) {
            attrs.width ??= btnHeight;
            attrs.paddingLeft ??= 0;
            attrs.paddingRight ??= 0;
            attrs.lineHeight ??= '0px';
            
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.TabBtn = new JSClass('TabBtn', Btn, {
        include: [M.Selectable],
        
        initNode: function(parent, attrs) {
            attrs.y ??= 2;
            attrs.buttonType ??= 'tab';
            this.tabView = attrs.tabView ??= parent;
            delete attrs.tabView;
            
            this.callSuper(parent, attrs);
        },
        
        setSelected: function(v) {
            this.callSuper(v);
            this[v ? 'addDomClass' : 'removeDomClass']('at');
            this.setDisabled(v);
        },
        
        doActivated: function() {
            if (!this.selected) this.tabView.select(this);
        }
    });
})(tc);
