(pkg => {
    'use strict';
    
    const {Text, Checkbox, SpacedLayout} = myt,
        
        {
            WideView, settings,
            theme:{spacing, padding, fontSizeLarge, fontFamilyMono}
        } = pkg,
        
        PANEL_WIDTH = 440,
        DESCRIPTION_INDENT = 24;
    
    /*  Edits pkg.settings. Changes apply as soon as they are made, so there is no footer,
        just the close button (or Esc). */
    pkg.SettingsDialog = new JS.Class('SettingsDialog', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy = 'simpleCentered';
            attrs.cancelable = true;
            
            self.callSuper(parent, attrs);
            
            self.setTitle(pkg.ICON_SETTINGS + ' Settings');
            self.getPanelView().setWidth(PANEL_WIDTH);
            
            self.getFooterView().ackBtn.setText(pkg.ICON_CANCEL + ' Close');
            
            const container = self.getContentView(),
                checkboxes = self._checkboxes = {};
            for (const def of settings.getDefinitions()) {
                switch (def.type) {
                    case 'boolean': {
                        const row = new WideView(container);
                        checkboxes[def.id] = new Checkbox(row, {
                            x:padding, label:def.label, fontSize:fontSizeLarge, value:settings.get(def.id)
                        }, [{
                            setValue: function(v) {
                                this.callSuper(v);
                                if (this.inited) settings.set(def.id, this.value);
                            }
                        }]);
                        new Text(row, {
                            x:padding + DESCRIPTION_INDENT, width:PANEL_WIDTH - DESCRIPTION_INDENT - 3*padding,
                            text:def.description, whiteSpace:'normal', fontFamily:fontFamilyMono
                        });
                        new SpacedLayout(row, {axis:'y', spacing, collapseParent:true});
                        break;
                    }
                    default:
                        console.warn('Unsupported setting type', def.type, 'for', def.id);
                }
            }
            new SpacedLayout(container, {axis:'y', inset:padding, spacing:2*spacing, outset:padding, collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        show: function() {
            const self = this;
            self.callSuper();
            
            // Settings could have changed elsewhere since the dialog was built.
            const checkboxes = self._checkboxes;
            for (const id in checkboxes) checkboxes[id].setValue(settings.get(id));
            
            const idealHeight = self.getHeaderView().height + spacing + self.getContentView().height + spacing + this.getFooterView().height;
            self.getPanelView().setHeight(Math.min(550, idealHeight));
        }
    });
})(tc);
