(pkg => {
    const JSClass = JS.Class,
        
        {
            View, Text, PaddedText, PaddedPlainText, PlainText, SimpleButton, SizeToParent, 
            Layout, SpacedLayout, WrappingLayout
        } = myt,
        
        {
            Btn, WideView, MiniPanel, timeUtil:{format},
            theme:{
                spacing, padding, cornerRadius, rowHeight, 
                colorUltraLight, colorLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                fontSizeMedium
            },
            ICON_NAV_FORWARD, ICON_ACTION, ICON_TRAVEL, ICON_VIEW, ICON_CHRONAL, ICON_PARADOX
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
                        if (self.height !== this.height) self.setHeight(this.height);
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
                            if (this.height !== v) {
                                this.callSuper(v);
                                const newHeight = Math.max(labelView.height, this.height);
                                if (self.height !== newHeight) self.setHeight(newHeight);
                            }
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
                
                self.vitaeView = new DetailRowFlow(self, {label:'Vitae'});
                self.actionView = new DetailRowFlow(self, {label:'Take Action'});
                self.exitView = new DetailRowFlow(self, {label:'Exit'});
                
                new SpacedLayout(self, {axis:'y', inset:spacing, spacing:spacing, outset:spacing, collapseParent:true});
                
                self.update();
            },
            update: function() {
                const self = this,
                    {agentModel, eventModel, vitaeView, actionView, exitView} = self;
                
                new Btn(vitaeView, {buttonType:'underline', textColor:colorLight, text:agentModel.name + ' (' + agentModel.id + ')'}, [{
                    doActivated: () => pkg.app.getTeamView().selectAgent(agentModel.id)
                }]);
                
                const actionModels = eventModel.getActionModels();
                let addedCount = 0;
                for (const actionId in actionModels) {
                    const actionModel = actionModels[actionId];
                    new Btn(actionView, {buttonType:'solid', text:ICON_ACTION + ' ' + actionModel.label, disabled:actionModel.done}, [{
                        doActivated: () => {agentModel.doAction(actionModel);}
                    }]);
                    addedCount++;
                }
                if (addedCount === 0) new PaddedPlainText(actionView, {text:'No actions available.', paddingTop:5, paddingBottom:5, whiteSpace:'normal'});
                
                const exitModels = eventModel.getExitModels();
                addedCount = 0;
                for (const exitId in exitModels) {
                    const exitModel = exitModels[exitId],
                        toEventModel = exitModel.getToEventModel(),
                        paradoxCost = agentModel.calculateParadoxForEntry(toEventModel);
                    new Btn(exitView, {buttonType:'solid', text:ICON_VIEW, layoutHint:'break'}, [{
                        doActivated: () => {pkg.app.getTimelineView().scrollToEventBox(toEventModel);}
                    }]);
                    new Btn(exitView, {
                        buttonType:'solid', 
                        text:ICON_TRAVEL + ' ' + exitModel.getBtnLabel() + (paradoxCost > 0 ? ' [' + paradoxCost + ICON_PARADOX + ']': '')
                    }, [{
                        doActivated: () => {agentModel.doFollowExit(exitModel);}
                    }]);
                    addedCount++;
                }
                if (addedCount === 0) new PaddedPlainText(exitView, {text:'No exits available.', paddingTop:5, paddingBottom:5, whiteSpace:'normal'});
            }
        });
    
    pkg.EventDetails = new JSClass('EventDetails', pkg.Panel, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            const header = self.getHeaderView();
            self.scrollToBtn = new Btn(header, {y:1, buttonType:'plain', textColor:colorLight, text:ICON_VIEW, visible:false}, [{
                doActivated: () => {
                    pkg.app.getTimelineView().scrollToEventBox(self.eventModel);
                }
            }]);
            
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
                {eventModel, detailsContainer} = self,
                hasModel = eventModel != null;
            
            self.noSelectionTxt.setVisible(!hasModel);
            detailsContainer.setVisible(hasModel);
            self.scrollToBtn.setVisible(hasModel);
            
            if (hasModel) {
                Layout.incrementGlobalLock();
                
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
                
                // FIXME: this goes away or is controlled by knowledge/attestation.
                let txt = 'Values';
                const valueModels = eventModel.getValueModels();
                for (const valueId in valueModels) {
                    const valueModel = valueModels[valueId];
                    txt += '<br>- ' + valueId + ': ' + valueModel.value;
                }
                self.valuesTxt.setText(txt);
                
                Layout.decrementGlobalLock();
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
                        chronalAvailable = -selectedAgentModel.chronal.getValueToMin(),
                        hasEnoughChronal = chronalNeeded <= chronalAvailable,
                        paradoxCost = selectedAgentModel.calculateParadoxForEntry(eventModel);
                    deployAgentBtn.setDisabled(!hasEnoughChronal || selectedAgentModel.isAtEvent(eventModel));
                    deployAgentBtn.setText(
                        'Deploy ' + selectedAgentModel.name + 
                        ' [' + chronalNeeded + ICON_CHRONAL + 
                        (paradoxCost > 0 ? ' + ' + paradoxCost + ICON_PARADOX : '') + ']'
                    );
                }
            }
        },
        
        updateTitle: function() {
            this.setTitle('Event : ' + (this.eventModel?.name ?? 'none'));
        }
    });
})(tc);
