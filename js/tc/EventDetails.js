(pkg => {
    const JSClass = JS.Class,
        
        {
            View, Text, PaddedText, PaddedPlainText, PlainText, SimpleButton, SizeToParent, 
            SpacedLayout, WrappingLayout
        } = myt,
        
        {
            Btn, WideView, MiniPanel, timeUtil:{format},
            theme:{
                spacing, padding, cornerRadius, rowHeight, 
                colorUltraLight, colorLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                fontSizeMedium
            },
            ICON_NAV_FORWARD
        } = pkg,
        
        LABEL_WIDTH = 75,
        ROW_PADDING_TOP = 3,
        GrandWidthMixin = new JS.Module('GrandWidthMixin', {
            initNode: function(parent, attrs) {
                // Compensate for parents x position
                attrs.x ??= -parent.x;
                attrs.percentOfParentWidthOffset = 2*parent.x;
                
                this.callSuper(parent, attrs);
            }
        }),
        DividerRow = new JSClass('DividerRow', WideView, {
            include: [GrandWidthMixin],
            
            initNode: function(parent, attrs) {
                const self = this,
                    label = attrs.label;
                delete attrs.label;
                
                attrs.height ??= rowHeight;
                attrs.bgColor ??= colorDark;
                attrs.textColor ??= colorMedium;
                
                self.callSuper(parent, attrs);
                
                self._label = new PlainText(self, {x:parent.x, valign:'middle', fontSize:fontSizeMedium, text:label});
            },
            setLabel: function(v) {this._label.setText(v);}
        }),
        DetailRow = new JSClass('DetailRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    label = attrs.label;
                delete attrs.label;
                
                self.callSuper(parent, attrs);
                
                self._label = new PaddedPlainText(self, {
                    width:LABEL_WIDTH, textColor:colorMedium, fontSize:fontSizeMedium, textAlign:'right',
                    paddingTop:ROW_PADDING_TOP, text:label
                });
                
                const valueX = LABEL_WIDTH + padding;
                self._value = new PaddedText(self, {
                    x:valueX, fontSize:fontSizeMedium,
                    percentOfParentWidth:100, percentOfParentWidthOffset:-valueX, whiteSpace:'normal',
                    paddingTop:ROW_PADDING_TOP, text:'–'
                }, [SizeToParent, {
                    sizeViewToDom: function() {
                        this.callSuper();
                        self.setHeight(this.height);
                    }
                }]);
            },
            setLabel: function(v) {this._label.setText(v);},
            setValue: function(v) {this._value.setText(v || '–');}
        }),
        DetailRowFlow = new JSClass('DetailRowFlow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    label = attrs.label;
                delete attrs.label;
                attrs.defaultPlacement = '_content';
                
                self.callSuper(parent, attrs);
                
                const labelView = self._label = new PaddedPlainText(self, {
                    width:LABEL_WIDTH, textColor:colorMedium, fontSize:fontSizeMedium, textAlign:'right',
                    paddingTop:ROW_PADDING_TOP, text:label
                });
                
                const contentX = LABEL_WIDTH + padding,
                    contentView = self._content = new View(self, {
                        x:contentX, percentOfParentWidth:100, percentOfParentWidthOffset:-contentX
                    }, [SizeToParent, {
                        setHeight: function(v) {
                            this.callSuper(v);
                            self.setHeight(Math.max(labelView.height, this.height));
                        }
                    }]);
                new WrappingLayout(contentView, {spacing:spacing, lineSpacing:spacing, collapseParent:true});
            },
            setLabel: function(v) {this._label.setText(v);},
            clearContent: function() {
                this._content.destroyAllSubviews();
            }
        }),
        AgentRow = new JSClass('AgentRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this;
                
                self.quickSet(['agentModel','eventModel'], attrs);
                
                attrs.bgColor ??= colorMegaDark;
                
                self.callSuper(parent, attrs);
                
                self.idTxt = new PaddedPlainText(self, {
                    paddingLeft:padding, paddingRight:padding, percentOfParentWidth:100
                }, [SizeToParent]);
                self.nameTxt = new PaddedPlainText(self, {
                    paddingLeft:padding, paddingRight:padding, percentOfParentWidth:100
                }, [SizeToParent]);
                self.actionView = new DetailRowFlow(self, {label:'Take Action'});
                
                new SpacedLayout(self, {axis:'y', inset:spacing, spacing:spacing, outset:spacing, collapseParent:true});
                
                self.update();
            },
            update: function() {
                const self = this,
                    {agentModel, eventModel, actionView} = self;
                
                self.idTxt.setText(agentModel.id);
                self.nameTxt.setText(agentModel.name);
                
                const actionModels = eventModel.getActionModels();
                for (const actionId in actionModels) {
                    const actionModel = actionModels[actionId];
                    new Btn(actionView, {buttonType:'solid', text:actionModel.label, disabled:actionModel.done}, [{
                        doActivated: () => {actionModel.doIt(agentModel);}
                    }]);
                }
            }
        });
    
    pkg.EventDetails = new JSClass('EventDetails', pkg.Panel, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding:padding, whiteSpace:'normal', text:"Select a historical event in the timeline to see more about it here."
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {
                x:padding, percentOfParentWidthOffset:-2*padding, visible:false
            });
            self.locationRow = new DetailRow(detailsContainer, {label:'Location'});
            self.startRow = new DetailRow(detailsContainer, {label:'Begins'});
            self.durationRow = new DetailRow(detailsContainer, {label:'Duration'});
            self.endRow = new DetailRow(detailsContainer, {label:'Ends'});
            self.precursorsRow = new DetailRowFlow(detailsContainer, {label:'Precursors'});
            self.descriptionRow = new DetailRow(detailsContainer, {label:'Description'});
            self.descendantsRow = new DetailRowFlow(detailsContainer, {label:'Descendants'});
            
            const agentsRow = self.agentsRow = new MiniPanel(detailsContainer, {
                title:'Agent Activity', percentOfParentWidth:100
            }, [GrandWidthMixin, SizeToParent, {
                clearContent: function() {
                    this.getContentView().destroyAllSubviews();
                }
            }]);
            self.deployAgentBtn = new Btn(agentsRow.getHeaderView(), {y:1, buttonType:'solid'}, [{
                doActivated: () => {
                    self.selectedAgentModel.doDeployToEvent(self.eventModel);
                }
            }]);
            new SpacedLayout(agentsRow, {axis:'y', spacing:1, outset:1, collapseParent:true});
            
            self.valuesTxt = new PaddedText(detailsContainer, {padding:padding, whiteSpace:'normal'});
            
            new SpacedLayout(detailsContainer, {axis:'y', spacing:spacing, collapseParent:true});
            
            self.ready = true;
            
            // Apply Size
            self.setWidth(self.width);
            self.setHeight(self.height);
            
            self.updateTitle();
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setWidth: function(v) {
            this.callSuper(v);
            if (this.ready) this.noSelectionTxt.setWidth(this.width);
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
                self.locationRow.setValue(eventModel.getLocationModel()?.name);
                self.startRow.setValue(eventModel.getStart(true));
                self.durationRow.setValue(eventModel.getDuration(true));
                self.endRow.setValue(eventModel.getEnd(true));
                self.descriptionRow.setValue();
                
                const precursorsRow = self.precursorsRow,
                    precursors = eventModel.getPrecursors();
                precursorsRow.clearContent();
                if (precursors.size > 0) {
                    for (const precursorEvent of precursors) {
                        new Btn(precursorsRow, {buttonType:'solid', text:precursorEvent.name + ' ' + ICON_NAV_FORWARD}, [{
                            doActivated: () => {
                                pkg.app.getTimelineView().doSelectEvent(precursorEvent, true);
                            }
                        }]);
                    }
                } else {
                    new PaddedPlainText(precursorsRow, {
                        fontSize:fontSizeMedium, paddingTop:ROW_PADDING_TOP, text:'–'
                    });
                }
                
                const descendantsRow = self.descendantsRow,
                    descendants = eventModel.getDescendants();
                descendantsRow.clearContent();
                if (descendants.size > 0) {
                    for (const descendantEvent of descendants) {
                        new Btn(descendantsRow, {buttonType:'solid', text:descendantEvent.name + ' ' + ICON_NAV_FORWARD}, [{
                            doActivated: () => {
                                pkg.app.getTimelineView().doSelectEvent(descendantEvent, true);
                            }
                        }]);
                    }
                } else {
                    new PaddedPlainText(descendantsRow, {
                        fontSize:fontSizeMedium, paddingTop:ROW_PADDING_TOP, text:'–'
                    });
                }
                
                const agentsRow = self.agentsRow;
                agentsRow.clearContent();
                for (const agentModel of eventModel.getAgentModels()) {
                    new AgentRow(agentsRow, {agentModel, eventModel});
                }
                
                txt = 'Values';
                const valueModels = eventModel.getValueModels();
                for (const valueId in valueModels) {
                    const valueModel = valueModels[valueId];
                    txt += '<br>- ' + valueId + ': ' + valueModel.value;
                }
                self.valuesTxt.setText(txt);
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
                deployAgentBtn.setVisible(hasModel && !selectedAgentModel.isAtEvent(eventModel));
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
