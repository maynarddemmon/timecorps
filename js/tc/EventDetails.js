(pkg => {
    const JSClass = JS.Class,
        
        {
            View, Text, PaddedText, PaddedPlainText, PlainText, SimpleButton, SizeToParent, 
            Layout, SpacedLayout, WrappingLayout
        } = myt,
        
        {
            Btn, SquareBtn, WideView, MiniPanel, timeUtil:{format},
            cfg:{
                EVENT_ID_TIME_CORPS_HQ, EVENT_ID_THE_VOID
            },
            theme:{
                spacing, padding, cornerRadius, rowHeight, 
                colorUltraLight, colorLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                fontSizeMedium, fontSizeLarge
            },
            ICON_NAV_FORWARD, ICON_ACTION, ICON_TRAVEL, ICON_VIEW, ICON_PARADOX, ICON_HQ, 
            ICON_THE_VOID, ICON_SEARCH,
            I18N_PARADOX,
            STAT_ID_PARADOX, STAT_ID_ATTESTATION, STAT_ID_HISTORICITY
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
                    {agentModel, eventModel, vitaeView, actionView, exitView} = self,
                    agentCantActHere = !agentModel.canAct();
                
                new Btn(vitaeView, {buttonType:'underline', textColor:colorLight, text:agentModel.name + ' (' + agentModel.id + ')'}, [{
                    doActivated: () => pkg.app.getTeamView().selectAgent(agentModel.id)
                }]);
                
                new Btn(actionView, {buttonType:'solid', text:ICON_SEARCH + ' Investigate', disabled:agentCantActHere || eventModel.attestation.isAtMaxValue()}, [{
                    doActivated: () => {agentModel.doInvestigate();}
                }]);
                const actionModels = eventModel.getActionModels();
                for (const actionId in actionModels) {
                    const actionModel = actionModels[actionId];
                    
                    if (actionModel.isHidden()) continue;
                    
                    new Btn(actionView, {buttonType:'solid', text:ICON_ACTION + ' ' + actionModel.label, disabled:agentCantActHere || actionModel.done}, [{
                        doActivated: () => {agentModel.doAction(actionModel);}
                    }]);
                }
                
                const exitModels = eventModel.getExitModels();
                let addedCount = 0;
                for (const exitModel of exitModels) {
                    if (exitModel.isHidden()) continue;
                    
                    const toEventModel = exitModel.getToEventModel();
                    if (!toEventModel.isHidden()) {
                        const paradoxCost = agentModel.calculateParadoxForEntry(toEventModel);
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
                }
                // Also try to add a recall exit.
                if (eventModel.id !== EVENT_ID_TIME_CORPS_HQ) {
                    const info = agentModel.getInfoForTimeTravel(pkg.model.getHQEventModel());
                    new Btn(exitView, {buttonType:'solid', text:info.btnTxt, disabled:info.disabled, layoutHint:'break'}, [{
                        doActivated: () => {agentModel.doRecallToHQ();}
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
            const header = self.getHeaderView(),
                timelineView = pkg.app.getTimelineView();
            
            self.hqBtn = new Btn(header, {
                y:1, buttonType:'plain', textColor:colorLight, text:ICON_HQ,
                tooltip:'Select HQ'
            }, [{doActivated: () => {timelineView.doSelectEvent(pkg.model.getHQEventModel());}}]);
            self.theVoidBtn = new Btn(header, {
                y:1, buttonType:'plain', textColor:colorLight, text:ICON_THE_VOID,
                tooltip:'Select The Void'
            }, [{doActivated: () => {timelineView.doSelectEvent(pkg.model.getTheVoidEventModel());}}]);
            
            new View(header, {width:2*padding}); // Spacer
            
            self.histPrevBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, disabled:true,
                icon:pkg.ICON_NAV_BACK, iconSize:fontSizeLarge, iconX:6, iconY:1, 
                tooltip:'Select the last Event you viewed.'
            }, [{doActivated: function() {timelineView.navigateHistory(-1);}}]);
            self.scrollToBtn = new Btn(header, {
                y:1, buttonType:'plain', textColor:colorLight, text:ICON_VIEW, disabled:true
            }, [{doActivated: () => {timelineView.scrollToEventBox(self.eventModel);}}]);
            self.histNextBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, disabled:true,
                icon:pkg.ICON_NAV_FORWARD, iconSize:fontSizeLarge, iconX:8, iconY:1, 
                tooltip:'Select the next Event you viewed.'
            }, [{doActivated: function() {timelineView.navigateHistory(1);}}]);
            
            
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding:padding, whiteSpace:'normal', text:"Select a historical event in the timeline to see more about it here."
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {
                x:padding, percentOfParentWidthOffset:-2*padding, visible:false
            });
            self.locationRow = new DetailRow(detailsContainer, {label:'Location'});
            self.historicityRow = new DetailRow(detailsContainer, {label:'Historicity'});
            self.attestationRow = new DetailRow(detailsContainer, {label:'Attestation'});
            self.paradoxRow = new DetailRow(detailsContainer, {label:I18N_PARADOX});
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
                doActivated: () => {self.selectedAgentModel.doDeployToEvent(self.eventModel);}
            }]);
            self.recallAgentBtn = new Btn(agentsRow.getHeaderView(), {y:1, buttonType:'solid'}, [{
                doActivated: () => {self.selectedAgentModel.doRecallToHQ();}
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
        
        updateHistoryBtns: function(prevDisabled, prevBtnTooltip, nextDisabled, nextBtnTooltip) {
            const {histPrevBtn, histNextBtn} = this;
            histPrevBtn.setDisabled(prevDisabled);
            histPrevBtn.setTooltip(prevBtnTooltip);
            histNextBtn.setDisabled(nextDisabled);
            histNextBtn.setTooltip(nextBtnTooltip);
        },
        
        updateForEventModel: function() {
            const self = this,
                {eventModel, detailsContainer} = self,
                hasModel = eventModel != null;
            
            self.noSelectionTxt.setVisible(!hasModel);
            detailsContainer.setVisible(hasModel);
            self.scrollToBtn.setDisabled(!hasModel || eventModel.isHidden());
            
            if (hasModel) {
                const isHQ = eventModel.id === EVENT_ID_TIME_CORPS_HQ;
                self.hqBtn.setDisabled(isHQ);
                self.theVoidBtn.setDisabled(eventModel.id === EVENT_ID_THE_VOID);
                
                Layout.incrementGlobalLock();
                
                self.locationRow.setValue(eventModel.getLocationModel()?.name);
                for (const statId of [STAT_ID_HISTORICITY,STAT_ID_ATTESTATION,STAT_ID_PARADOX]) {
                    // FIXME: lets do these as progress bars.
                    const stat = eventModel[statId];
                    self[statId + 'Row'].setValue('[' + stat.value + '/' + stat.max + ']');
                }
                self.startRow.setValue(eventModel.getStart(true));
                self.durationRow.setValue(eventModel.getDuration(true));
                self.endRow.setValue(eventModel.getEnd(true));
                self.descriptionRow.setValue();
                
                // Precursor Nav Buttons //
                const precursorsRow = self.precursorsRow,
                    precursors = eventModel.getPrecursors();
                precursorsRow.clearContent();
                let addedCount = 0;
                if (precursors.size > 0) {
                    for (const precursorEvent of precursors) {
                        if (!precursorEvent.isHidden() && !eventModel.isAffectedByHidden(precursorEvent)) {
                            new Btn(precursorsRow, {buttonType:'solid', text:precursorEvent.name + ' ' + ICON_NAV_FORWARD}, [{
                                doActivated: () => {
                                    pkg.app.getTimelineView().doSelectEvent(precursorEvent, true);
                                }
                            }]);
                            addedCount++;
                        }
                    }
                }
                if (addedCount === 0) new PaddedPlainText(precursorsRow, {fontSize:fontSizeMedium, paddingTop:ROW_PADDING_TOP, text:'–'});
                
                // Descendant Nav Buttons //
                const descendantsRow = self.descendantsRow,
                    descendants = eventModel.getDescendants();
                descendantsRow.clearContent();
                addedCount = 0;
                if (descendants.size > 0) {
                    for (const descendantEvent of descendants) {
                        if (!descendantEvent.isHidden() && !descendantEvent.isAffectedByHidden(eventModel)) {
                            new Btn(descendantsRow, {buttonType:'solid', text:descendantEvent.name + ' ' + ICON_NAV_FORWARD}, [{
                                doActivated: () => {
                                    pkg.app.getTimelineView().doSelectEvent(descendantEvent, true);
                                }
                            }]);
                            addedCount++;
                        }
                    }
                }
                if (addedCount === 0) new PaddedPlainText(descendantsRow, {fontSize:fontSizeMedium, paddingTop:ROW_PADDING_TOP, text:'–'});
                
                // Agent Information //
                const agentsRow = self.agentsRow;
                agentsRow.clearContent();
                for (const agentModel of eventModel.getAgentModels()) {
                    new AgentRow(agentsRow, {agentModel, eventModel});
                }
                
                // FIXME: this goes away or is controlled by knowledge/attestation.
                let txt = '';
                const valueModels = eventModel.getValueModels();
                for (const valueId in valueModels) {
                    const valueModel = valueModels[valueId];
                    txt += '<br>- ' + valueId + ': ' + valueModel.value;
                }
                self.valuesTxt.setText(txt ? 'Values' + txt : '');
                
                Layout.decrementGlobalLock();
            }
            
            self.updateTitle();
            self.updateForSelectedAgent();
        },
        
        updateForSelectedAgent: function() {
            const self = this,
                {selectedAgentModel, eventModel, deployAgentBtn, recallAgentBtn} = self,
                hasEventModel = eventModel != null,
                hasAgentModel = selectedAgentModel != null;
            
            if (hasEventModel) {
                const isHQ = eventModel.id === EVENT_ID_TIME_CORPS_HQ;
                recallAgentBtn.setVisible(hasAgentModel && isHQ && !selectedAgentModel.isAtEvent(eventModel));
                deployAgentBtn.setVisible(hasAgentModel && !selectedAgentModel.isAtEvent(eventModel) && !eventModel.isHidden());
                if (hasAgentModel) {
                    const info = selectedAgentModel.getInfoForTimeTravel(eventModel);
                    if (isHQ) {
                        recallAgentBtn.setDisabled(info.disabled);
                        recallAgentBtn.setText(info.btnTxt);
                    } else {
                        deployAgentBtn.setDisabled(info.disabled);
                        deployAgentBtn.setText(info.btnTxt);
                    }
                }
            }
        },
        
        updateTitle: function() {
            this.setTitle('Event : ' + (this.eventModel?.name ?? 'none'));
        }
    });
})(tc);
