(pkg => {
    'use strict';
    
    let confirmMsgDialog,
        ackMsgDialog;
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        {min:mathMin, max:mathMax, floor:mathFloor} = Math,
        
        M = myt,
        {PaddedText, global:{keys:globalKeys}} = M,
        
        {
            UnderlineBtn,
            theme:{
                spacing, padding, cornerRadius,
                colorDark, colorMegaDark, colorSuccess, colorError,
                fontSizeMedium, fontSizeLarge, fontFamilyMono
            },
            cfg:{DEFAULT_TALL_DIALOG_WIDTH, DIALOG_FOOTER_HEIGHT}
        } = pkg,
        
        SPACER_CFG = {klass:pkg.Spacer},
        
        REF_ID_CANCEL_FUNC = 'cnclFunc',
        REF_ID_CONFIRM_FUNC = 'confFunc',
        
        DEFAULT_CONFIRM_LABEL = pkg.ICON_CHECKED + ' Confirm',
        DEFAULT_CANCEL_LABEL = pkg.ICON_UNCHECKED + ' Cancel',
        DEFAULT_ACK_LABEL = 'Acknowledge',
        
        ModalDialog = pkg.ModalDialog = new JSClass('ModalDialog', M.Dimmer, {
            initNode: function(parent, attrs) {
                const self = this;
                
                self.defaultPlacement = '_panelView._contentView';
                const hasFooter = attrs.hasFooter ??= false,
                    cancelable = attrs.cancelable ??= true,
                    sizingStrategy = attrs.sizingStrategy ??= 'tall',
                    tallWidth = attrs.tallWidth ??= DEFAULT_TALL_DIALOG_WIDTH;
                delete attrs.hasFooter;
                delete attrs.cancelable;
                delete attrs.sizingStrategy;
                delete attrs.tallWidth;
                
                self.callSuper(parent, attrs);
                
                let positionAttrs;
                switch (sizingStrategy) {
                    case 'simpleCentered':
                        positionAttrs = {align:'center', valign:'middle'};
                        break;
                    case 'tall':
                    default:
                        positionAttrs = {
                            align:'center', y:padding, width:tallWidth,
                            percentOfParentHeight:100,
                            percentOfParentHeightOffset:-2*padding
                        };
                        break;
                }
                
                const panelView = self._panelView = new pkg.Panel(self, {
                    roundedCorners:cornerRadius, bgColor:colorMegaDark, overflow:'hidden',
                    ...positionAttrs
                }, [M.SizeToParent]);
                
                if (cancelable) {
                    const header = self.getHeaderView();
                    self._closeBtn = new pkg.SquareBtn(header, {
                        y:1, text:pkg.ICON_CANCEL, tooltip:'Close'
                    }, [{
                        doActivated: function() {self.doClose();}
                    }]);
                    header.getFirstLayout().setOutset(1);
                }
                self.attachToDom(self, '_keyDownCapture', 'keydown', true);
                self.attachToDom(self, '_keyDown', 'keydown');
                
                if (hasFooter) {
                    const contentView = self.getContentView();
                    self._footerView = new pkg.WideView(panelView, {
                        height:DIALOG_FOOTER_HEIGHT, valign:'bottom',
                        bgColor:colorDark,
                        ignorePlacement:true
                    });
                    contentView.setPercentOfParentHeightOffset(
                        contentView.percentOfParentHeightOffset - DIALOG_FOOTER_HEIGHT
                    );
                }
            },
            
            getPanelView: function() {return this._panelView;},
            getContentView: function() {return this.getPanelView().getContentView();},
            getHeaderView: function() {return this.getPanelView().getHeaderView();},
            setTitle: function(v, tooltip) {this.getPanelView().setTitle(v, tooltip);},
            getCloseBtn: function() {return this._closeBtn;},
            getDefaultBtn: M.NOOP,
            getFooterView: function() {return this._footerView;},
            
            /*  Esc is handled in the capture phase because myt buttons (and checkboxes) stop 
                keydown from bubbling, so a focused one would otherwise swallow it. Returning 
                true lets every other key carry on to its target. */
            _keyDownCapture: function(event) {
                if (M.KeyObservable.getCodeFromEvent(event) === globalKeys.CODE_ESC) {
                    this.getCloseBtn()?.doActivated();
                    return false;
                }
                return true;
            },
            
            /*  Enter is handled in the bubble phase so a focused button gets it first and 
                activates itself, e.g. Enter on a focused Cancel cancels. This only runs when 
                nothing focused inside the dialog handled it. */
            _keyDown: function(event) {
                if (M.KeyObservable.getCodeFromEvent(event) === globalKeys.CODE_ENTER) {
                    this.getDefaultBtn()?.doActivated();
                }
            },
            
            /*  Provides a hook for overriding close behavior. */
            doClose: function() {
                this.hide();
            }
        }),
        
        ThreeColFooter = new JSModule('ThreeColFooter', {
            initNode: function(parent, attrs) {
                attrs.hasFooter ??= true;
                
                const leftItemCfgs = attrs.leftItemCfgs ??= [], 
                    centerItemCfgs = attrs.centerItemCfgs ??= [], 
                    rightItemCfgs = attrs.rightItemCfgs ??= [];
                delete attrs.leftItemCfgs;
                delete attrs.centerItemCfgs;
                delete attrs.rightItemCfgs;
                
                this.callSuper(parent, attrs);
                
                const footer = this.getFooterView();
                for (const itemCfgs of [leftItemCfgs, [SPACER_CFG], centerItemCfgs, [SPACER_CFG], rightItemCfgs]) {
                    for (const itemCfg of itemCfgs) {
                        new itemCfg.klass(footer, itemCfg.attrs, itemCfg.mixins);
                    }
                }
                
                new M.ResizeLayout(footer, {inset:padding, spacing, outset:padding});
            }
        }),
        
        ConfirmDialog = pkg.ConfirmDialog = new JSClass('ConfirmDialog', ModalDialog, {
            include: [ThreeColFooter],
            
            initNode: function(parent, attrs) {
                const self = this;
                attrs.centerItemCfgs ??= [
                    {klass:UnderlineBtn, attrs:{
                        name:'cancelBtn', text:DEFAULT_CANCEL_LABEL, textColor:colorError, 
                        fontSize:fontSizeLarge, valign:'middle'
                    }, mixins:[{doActivated:self.doCancel.bind(self)}]},
                    SPACER_CFG,
                    {klass:UnderlineBtn, attrs:{
                        name:'confirmBtn', text:DEFAULT_CONFIRM_LABEL, textColor:colorSuccess, 
                        fontSize:fontSizeLarge, valign:'middle'
                    }, mixins:[{doActivated:self.doConfirm.bind(self)}]}
                ];
                self.callSuper(parent, attrs);
            },
            
            getDefaultBtn: function() {return this.getFooterView().confirmBtn;},
            
            doClose: function() {
                this.doCancel();
            },
            
            doConfirm: function() {
                const doNotClose = this.getRef(REF_ID_CONFIRM_FUNC)?.() === true;
                if (!doNotClose) this.hide();
            },
            
            doCancel: function() {
                const doNotClose = this.getRef(REF_ID_CANCEL_FUNC)?.() === true;
                if (!doNotClose) this.hide();
            }
        }),
        
        MsgDialog = new JSModule('MsgDialog', {
            initNode: function(parent, attrs) {
                const self = this;
                
                attrs.sizingStrategy ??= 'simpleCentered';
                
                self.callSuper(parent, attrs);
                
                self._msgTxt = new PaddedText(self, {
                    padding, whiteSpace:'pre-wrap', fontSize:fontSizeMedium, fontFamily:fontFamilyMono
                });
            },
            
            getMsgTxt: function() {return this._msgTxt;},
            setMsg: function(msg) {this.getMsgTxt().setText(msg);},
            
            show: function(title, msg, confirmFunc, cancelFunc) {
                this.callSuper();
                
                this.setTitle(title);
                this.setMsg(msg);
                this.addRef(REF_ID_CONFIRM_FUNC, confirmFunc);
                this.addRef(REF_ID_CANCEL_FUNC, cancelFunc);
                
                const panelView = this.getPanelView(),
                    msgTxt = this.getMsgTxt(),
                    fuzzyWidth = mathMin(550, mathMax(350, mathFloor(msg.length)));
                panelView.setWidth(fuzzyWidth);
                msgTxt.sizeViewToDom();
                const idealHeight = this.getHeaderView().height + spacing + msgTxt.height + spacing + this.getFooterView().height;
                panelView.setHeight(mathMin(650, idealHeight));
            }
        }),
        
        AckDialog = pkg.AckDialog = new JSClass('AckDialog', ModalDialog, {
            include: [ThreeColFooter],
            
            initNode: function(parent, attrs) {
                const self = this;
                attrs.cancelable ??= false;
                attrs.centerItemCfgs ??= [
                    {klass:UnderlineBtn, attrs:{
                        name:'ackBtn', text:DEFAULT_ACK_LABEL, fontSize:fontSizeLarge, valign:'middle'
                    }, mixins:[{doActivated:self.doConfirm.bind(self)}]}
                ];
                self.callSuper(parent, attrs);
            },
            
            getDefaultBtn: function() {return this.getFooterView().ackBtn;},
            
            doConfirm: function() {
                const doNotClose = this.getRef(REF_ID_CONFIRM_FUNC)?.() === true;
                if (!doNotClose) this.hide();
            },
            
            hide: function(ignoreRestoreFocus) {
                this.callSuper(ignoreRestoreFocus);
                
                // Drain queue
                if (ackMsgQueue.length > 0) {
                    pkg.dialogUtil.openAckMsgDialog(...ackMsgQueue.shift());
                }
            }
        }),
        
        ConfirmMsgDialog = pkg.ConfirmMsgDialog = new JSClass('ConfirmMsgDialog', ConfirmDialog, {
            include: [MsgDialog]
        }),
        
        AckMsgDialog = pkg.AckMsgDialog = new JSClass('AckMsgDialog', AckDialog, {
            include: [MsgDialog]
        }),
        
        ackMsgQueue = [];
    
    pkg.dialogUtil = {
        openConfirmMsgDialog: (title, msg, confirmFunc, cancelFunc, confirmLabel=DEFAULT_CONFIRM_LABEL, cancelLabel=DEFAULT_CANCEL_LABEL) => {
            confirmMsgDialog ??= new ConfirmMsgDialog(pkg.app);
            confirmMsgDialog.show(title, msg, confirmFunc, cancelFunc);
            // Always set both labels since the dialog is shared.
            const footer = confirmMsgDialog.getFooterView();
            footer.confirmBtn.setText(confirmLabel);
            footer.cancelBtn.setText(cancelLabel);
            return confirmMsgDialog;
        },
        openAckMsgDialog: (title, msg, confirmFunc, cancelFunc, btnLabel=DEFAULT_ACK_LABEL) => {
            ackMsgDialog ??= new AckMsgDialog(pkg.app);
            if (ackMsgDialog.visible) {
                ackMsgQueue.push([title, msg, confirmFunc, cancelFunc, btnLabel]);
            } else {
                ackMsgDialog.show(title, msg, confirmFunc, cancelFunc);
                if (btnLabel) ackMsgDialog.getFooterView().ackBtn.setText(btnLabel);
                return ackMsgDialog;
            }
        }
    }
})(tc);
