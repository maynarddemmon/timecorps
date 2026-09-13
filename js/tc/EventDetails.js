(pkg => {
    const JSClass = JS.Class,
        
        {
            View, PaddedText, PaddedPlainText, PlainText, SimpleButton, SizeToParent, SpacedLayout
        } = myt,
        
        {
            Btn, WideView, timeUtil:{format},
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
            self.agentsTxt = new PaddedText(detailsContainer, {padding:padding, whiteSpace:'normal'});
            self.deployAgentBtn = new Btn(detailsContainer, {buttonType:'solid'}, [{
                doActivated: () => {
                    self.selectedAgentModel.doDeployToEvent(self.eventModel);
                }
            }]);
            
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
            const newEventModel = this.eventModel = eventBox?.model ?? null;
            this.updateForEventModel();
        },
        
        notifyEventModelChanged: function(eventModel) {
            if (eventModel && this.eventModel === eventModel) {
                this.updateForEventModel();
            }
        },
        
        notifyAgentSelectedChanged: function(agentModel) {
            this.selectedAgentModel = agentModel;
            this.updateForSelectedAgent();
        },
        
        updateForEventModel: function() {
            const self = this,
                {eventModel, noSelectionTxt, detailsContainer} = self,
                hasModel = eventModel != null;
            
            noSelectionTxt.setVisible(!hasModel);
            detailsContainer.setVisible(hasModel);
            
            if (hasModel) {
                let txt = 'Actions';
                const actionModels = eventModel.getActionModels();
                for (const actionId in actionModels) {
                    const actionModel = actionModels[actionId];
                    txt += '<br>- ' + actionId + ': ' + actionModel.value;
                }
                self.actionsTxt.setText(txt);
                
                txt = 'Values';
                const valueModels = eventModel.getValueModels();
                for (const valueId in valueModels) {
                    const valueModel = valueModels[valueId];
                    txt += '<br>- ' + valueId + ': ' + valueModel.value;
                }
                self.valuesTxt.setText(txt);
                
                txt = 'Agents';
                for (const agentModel of eventModel.getAgentModels()) {
                    txt += '<br>- ' + agentModel.id + ': ' + agentModel.name;
                }
                self.agentsTxt.setText(txt);
            }
            
            self.updateTitle();
            self.updateForSelectedAgent();
        },
        
        updateForSelectedAgent: function() {
            const self = this,
                {selectedAgentModel, eventModel, deployAgentBtn} = self,
                hasEventModel = eventModel != null,
                hasModel = selectedAgentModel != null;
            
            if (hasEventModel) {
                deployAgentBtn.setVisible(hasModel);
                if (hasModel) {
                    const chronalNeeded = pkg.getChronalToDeploy(selectedAgentModel, eventModel),
                        chronalAvailable = selectedAgentModel.chronal,
                        hasEnoughChronal = chronalNeeded <= chronalAvailable;
                    deployAgentBtn.setDisabled(!hasEnoughChronal || selectedAgentModel.isAtEvent(eventModel));
                    deployAgentBtn.setText('Deploy ' + selectedAgentModel.name + ' [' + chronalNeeded + '/' + chronalAvailable + ']');
                }
            }
        },
        
        updateTitle: function() {
            this.setTitle('Event : ' + (this.eventModel?.name ?? 'none'));
        }
    });
})(tc);