(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        M = myt,
        
        {padding, cornerRadius, colorMegaDark} = pkg.theme,
        
        DEFAULT_TALL_DIALOG_WIDTH = 550;
    
    pkg.ModalDialog = new JSClass('ModalDialog', M.Dimmer, {
        initNode: function(parent, attrs) {
            const self = this;
            
            self.defaultPlacement = 'contentView._contentView';
            const sizingStrategy = attrs.sizingStrategy ??= 'tall',
                tallWidth = attrs.tallWidth ??= DEFAULT_TALL_DIALOG_WIDTH;
            delete attrs.sizingStrategy;
            delete attrs.tallWidth;
            
            self.callSuper(parent, attrs);
            
            let positionAttrs;
            switch (sizingStrategy) {
                case 'tall':
                default:
                    positionAttrs = {
                        align:'center', y:padding, width:tallWidth,
                        percentOfParentHeight:100,
                        percentOfParentHeightOffset:-2*padding
                    };
                    break;
            }
            
            const contentView = self.contentView = new pkg.Panel(self, {
                    roundedCorners:cornerRadius, bgColor:colorMegaDark, overflow:'hidden',
                    ...positionAttrs
                }, [M.SizeToParent]),
                header = contentView.getHeaderView();
            self.closeBtn = new pkg.SquareBtn(header, {
                y:1, text:pkg.ICON_CANCEL, tooltip:'Close'
            }, [{
                doActivated: function() {self.hide();}
            }]);
            header.getFirstLayout().setOutset(1);
            self.attachToDom(self, '_keyDown', 'keydown');
        },
        
        getContentView: function() {return this.contentView;},
        setTitle: function(v, tooltip) {this.getContentView().setTitle(v, tooltip);},
        
        _keyDown: function(event) {
            switch (M.KeyObservable.getCodeFromEvent(event)) {
                case M.global.keys.CODE_ESC:
                    this.closeBtn.doActivated();
                    break;
            }
        }
    });
})(tc);
