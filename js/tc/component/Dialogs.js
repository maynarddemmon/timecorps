(pkg => {
    'use strict';
    
    let confirmMsgDialog,
        ackMsgDialog;
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        {min:mathMin, max:mathMax, floor:mathFloor} = Math,
        
        M = myt,
        PaddedText = M.PaddedText,
        
        {
            UnderlineBtn,
            theme:{
                spacing, padding, cornerRadius, btnHeight,
                colorDark, colorMegaDark, colorSuccess, colorError,
                fontSizeLarge,
                fontFamilyMono
            },
            cfg:{DEFAULT_TALL_DIALOG_WIDTH, DIALOG_FOOTER_HEIGHT}
        } = pkg,
        
        SPACER_CFG = {klass:pkg.Spacer},
        
        REF_ID_CANCEL_FUNC = 'cnclFunc',
        REF_ID_CONFIRM_FUNC = 'confFunc',
        
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
            getFooterView: function() {return this._footerView;},
            
            _keyDown: function(event) {
                switch (M.KeyObservable.getCodeFromEvent(event)) {
                    case M.global.keys.CODE_ESC:
                        this.getCloseBtn()?.doActivated();
                        break;
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
                        text:pkg.ICON_UNCHECKED + ' Cancel', textColor:colorError, 
                        fontSize:fontSizeLarge, valign:'middle'
                    }, mixins:[{doActivated:self.doCancel.bind(self)}]},
                    SPACER_CFG,
                    {klass:UnderlineBtn, attrs:{
                        text:pkg.ICON_CHECKED + ' Confirm', textColor:colorSuccess, 
                        fontSize:fontSizeLarge, valign:'middle'
                    }, mixins:[{doActivated:self.doConfirm.bind(self)}]}
                ];
                self.callSuper(parent, attrs);
            },
            
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
                    padding, whiteSpace:'pre-wrap', fontFamily:fontFamilyMono
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
                    fuzzyWidth = mathMin(500, mathMax(300, mathFloor(msg.length / 2)));
                panelView.setWidth(fuzzyWidth);
                msgTxt.sizeViewToDom();
                const idealHeight = this.getHeaderView().height + spacing + msgTxt.height + spacing + this.getFooterView().height;
                panelView.setHeight(mathMin(550, idealHeight));
            }
        }),
        
        AckDialog = pkg.AckDialog = new JSClass('AckDialog', ModalDialog, {
            include: [ThreeColFooter],
            
            initNode: function(parent, attrs) {
                const self = this;
                attrs.cancelable ??= false;
                attrs.centerItemCfgs ??= [
                    {klass:UnderlineBtn, attrs:{
                        text:'Acknowledge', fontSize:fontSizeLarge, valign:'middle'
                    }, mixins:[{doActivated:self.doConfirm.bind(self)}]}
                ];
                self.callSuper(parent, attrs);
            },
            
            doConfirm: function() {
                const doNotClose = this.getRef(REF_ID_CONFIRM_FUNC)?.() === true;
                if (!doNotClose) this.hide();
            }
        }),
        
        ConfirmMsgDialog = pkg.ConfirmMsgDialog = new JSClass('ConfirmMsgDialog', ConfirmDialog, {
            include: [MsgDialog]
        }),
        
        AckMsgDialog = pkg.AckMsgDialog = new JSClass('AckMsgDialog', AckDialog, {
            include: [MsgDialog]
        });
    
    pkg.dialogUtil = {
        openConfirmMsgDialog: (title, msg, confirmFunc, cancelFunc) => {
            confirmMsgDialog ??= new ConfirmMsgDialog(pkg.app);
            confirmMsgDialog.show(title, msg, confirmFunc, cancelFunc);
            return confirmMsgDialog;
        },
        openAckMsgDialog: (title, msg, confirmFunc, cancelFunc) => {
            ackMsgDialog ??= new AckMsgDialog(pkg.app);
            ackMsgDialog.show(title, msg, confirmFunc, cancelFunc);
            return ackMsgDialog;
        }
    }
})(tc);
