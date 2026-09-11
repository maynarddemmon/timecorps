(pkg => {
    const JSClass = JS.Class,
        
        {
            View, PaddedText, PaddedPlainText, PlainText, SimpleButton, SizeToParent, SpacedLayout
        } = myt,
        
        {
            WideView, timeUtil:{format},
            theme:{
                spacing, padding, cornerRadius, rowHeight, 
                colorUltraLight, colorLight, colorMedium, colorDark, colorUltraDark, colorMegaDark
            }
        } = pkg;
    
    pkg.EventDetails = new JSClass('EventDetails', pkg.Panel, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding:padding, whiteSpace:'normal', text:"Select a historical event in the timeline to see more about it here."
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {visible:false});
            self.actionsTxt = new PaddedText(detailsContainer, {padding:padding, whiteSpace:'normal'});
            self.valuesTxt = new PaddedText(detailsContainer, {padding:padding, whiteSpace:'normal'});
            new SpacedLayout(detailsContainer, {axis:'y', spacing:0, collapseParent:true});
            
            self.ready = true;
            
            // Apply Size
            self.setWidth(self.width);
            self.setHeight(self.height);
            
            self.updateTitle();
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setWidth: function(v) {
            this.callSuper(v);
            if (this.ready) {
                const width = this.width;
                this.noSelectionTxt.setWidth(width);
            }
        },
        
        setHeight: function(v) {
            this.callSuper(v);
            if (this.ready) {
                
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        notifyEventSelectedChanged: function(eventBox) {
            const self = this,
                {noSelectionTxt, detailsContainer} = self,
                model = self.model = eventBox?.model ?? null,
                hasModel = model != null;
            
            noSelectionTxt.setVisible(!hasModel);
            detailsContainer.setVisible(hasModel);
            
            if (hasModel) {
                let txt = 'Actions';
                const actionModels = model.getActionModels();
                for (const actionId in actionModels) {
                    const actionModel = actionModels[actionId];
                    txt += '<br>- ' + actionId + ': ' + actionModel.value;
                }
                self.actionsTxt.setText(txt);
                
                txt = 'Values';
                const valueModels = model.getValueModels();
                for (const valueId in valueModels) {
                    const valueModel = valueModels[valueId];
                    txt += '<br>- ' + valueId + ': ' + valueModel.value;
                }
                self.valuesTxt.setText(txt);
            }
            
            self.updateTitle();
        },
        
        updateTitle: function() {
            this.setTitle('Event : ' + (this.model?.name ?? 'none'));
        }
    });
})(tc);