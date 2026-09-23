(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {
            View, Text, PaddedText, PaddedPlainText, PlainText, SimpleButton, SizeToParent, 
            Layout, SpacedLayout, WrappingLayout, ResizeLayout
        } = myt,
        
        {
            Btn, UnderlineBtn, UnderlineActionBtn, AgentBtn, SquareBtn, WideView, MiniPanel, StatusAgentMarkerMedium, timeUtil:{format},
            GrandWidthMixin, Row, DividerRow, DetailRow, DetailRowFlow, TextForFlow, NoValueText,
            cfg:{EVENT_ID_TIME_CORPS_HQ, EVENT_ID_THE_VOID},
            theme:{
                spacing, padding, rowHeight, btnHeight,
                colorUltraLight, colorLight, colorMedium, colorDark, colorMegaDark,
                fontSizeMedium, fontSizeLarge
            },
            formatChronalAndParadox,
            ICON_SEPARATOR, ICON_NAV_FORWARD, ICON_ACTION, ICON_TRAVEL, ICON_VIEW, ICON_HQ,
            ICON_THE_VOID, ICON_SEARCH, ICON_NIL,
            STAT_ID_PARADOX, STAT_ID_ATTESTATION, STAT_ID_HISTORICITY
        } = pkg,
        
        // Agent Row
        MARKER_EXTENT = 2*btnHeight + spacing + padding,
        AgentRowFlow = new JSClass('AgentRowFlow', WideView, {
            initNode: function(parent, attrs) {
                attrs.x ??= MARKER_EXTENT;
                attrs.percentOfParentWidthOffset ??= -attrs.x;
                
                this.callSuper(parent, attrs);
                
                new WrappingLayout(this, {spacing:padding, lineSpacing:-5, collapseParent:true});
            },
            clearContent: function() {
                this.destroyAllSubviews();
            }
        }),
        AgentRow = new JSClass('AgentRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this;
                
                self.quickSet(['agentModel','eventModel'], attrs);
                
                attrs.bgColor ??= colorMegaDark;
                
                self.callSuper(parent, attrs);
                
                self.markerView = new StatusAgentMarkerMedium(self, {x:spacing, y:spacing, ignoreLayout:true});
                self.vitaeBtn = new UnderlineBtn(self, {x:MARKER_EXTENT, y:spacing, fontSize:fontSizeLarge, ignoreLayout:true}, [{
                    doActivated: () => pkg.app.selectAgentRow(self.agentModel)
                }]);
                self.recallBtn = new UnderlineBtn(self, {align:'right', alignOffset:2*spacing, y:spacing, ignoreLayout:true, visible:false}, [{
                    doActivated: () => {self.agentModel.doRecallToHQ();}
                }]);
                
                self.actionView = new AgentRowFlow(self);
                self.exitView = new AgentRowFlow(self);
                
                new SpacedLayout(self, {axis:'y', inset:26, spacing:-5, outset:spacing, collapseParent:true});
                
                self.update();
            },
            update: function() {
                const self = this,
                    {agentModel, eventModel, markerView, vitaeBtn, recallBtn, actionView, exitView} = self,
                    agentCantActHere = !agentModel.canAct();
                
                markerView.setModel(agentModel);
                vitaeBtn.setText(agentModel.name);
                
                if (eventModel.id !== EVENT_ID_TIME_CORPS_HQ) {
                    const info = agentModel.getInfoForTimeTravel(pkg.model.getHQEventModel());
                    recallBtn.setVisible(true);
                    recallBtn.setText(info.btnTxt);
                    recallBtn.setDisabled(info.disabled);
                } else {
                    recallBtn.setVisible(false);
                }
                
                new TextForFlow(actionView, {paddingTop:3, text:agentModel.getActionsPhrase()});
                new UnderlineActionBtn(actionView, {text:ICON_SEARCH + ' Investigate', disabled:agentCantActHere || eventModel.attestation.isAtMaxValue()}, [{
                    doActivated: () => {agentModel.doInvestigate();}
                }]);
                const actionModels = eventModel.getActionModels();
                for (const actionId in actionModels) {
                    const actionModel = actionModels[actionId];
                    if (!actionModel.isHidden()) {
                        new TextForFlow(actionView, {text:ICON_SEPARATOR});
                        new UnderlineActionBtn(actionView, {
                            text:ICON_ACTION + ' ' + actionModel.label, 
                            disabled:agentCantActHere /*|| actionModel.done*/
                        }, [{
                            doActivated: () => {agentModel.doAction(actionModel);}
                        }]);
                    }
                }
                
                new TextForFlow(exitView, {text:'Exits:'});
                const exitModels = eventModel.getExitModels();
                let addedCount = 0;
                for (const exitModel of exitModels) {
                    if (!exitModel.isHidden()) {
                        const toEventModel = exitModel.getToEventModel();
                        if (!toEventModel.isHidden()) {
                            const paradoxCost = agentModel.calculateParadoxForEntry(toEventModel);
                            if (addedCount > 0) new TextForFlow(exitView, {text:ICON_SEPARATOR});
                            new UnderlineBtn(exitView, {
                                text:exitModel.getBtnLabel() + (paradoxCost > 0 ? ' ' + formatChronalAndParadox(0, paradoxCost) : '')
                            }, [{
                                setMouseOver: function(v) {
                                    if (this.inited && this.mouseOver !== v) {
                                        this.callSuper(v);
                                        if (this.mouseOver) {
                                            pkg.app.scrollToDebounced(toEventModel);
                                        } else {
                                            pkg.app.scrollToEvent(eventModel, true);
                                        }
                                    }
                                },
                                doActivated: () => {agentModel.doFollowExit(exitModel);}
                            }]);
                            addedCount++;
                        }
                    }
                }
                
                if (addedCount === 0) new TextForFlow(exitView, {text:'No exits available.'});
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
            
            self.hqBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, text:ICON_HQ, tooltip:'Select HQ'
            }, [{doActivated: () => {pkg.app.selectEventBox(pkg.model.getHQEventModel());}}]);
            self.theVoidBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, text:ICON_THE_VOID, tooltip:'Select The Void'
            }, [{doActivated: () => {pkg.app.selectEventBox(pkg.model.getTheVoidEventModel());}}]);
            
            new View(header, {width:padding}); // Spacer
            
            self.histPrevBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, disabled:true,
                text:pkg.ICON_NAV_BACK, fontSize:fontSizeLarge, 
                tooltip:'Select the last Event you viewed.'
            }, [{doActivated: function() {timelineView.navigateHistory(-1);}}]);
            self.scrollToBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, text:ICON_VIEW, disabled:true
            }, [{doActivated: () => {timelineView.scrollToEventBox(self.eventModel);}}]);
            self.histNextBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, disabled:true,
                text:pkg.ICON_NAV_FORWARD, fontSize:fontSizeLarge, 
                tooltip:'Select the next Event you viewed.'
            }, [{doActivated: function() {timelineView.navigateHistory(1);}}]);
            
            
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding, whiteSpace:'normal', text:"Select a historical event in the timeline to see more about it here."
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {
                x:padding, percentOfParentWidthOffset:-2*padding, visible:false
            });
            
            self.whereWhen = new PaddedPlainText(detailsContainer, {
                percentOfParentWidth:100,
                fontSize:fontSizeMedium, whiteSpace:'normal', paddingLeft:spacing, paddingRight:spacing
            }, [GrandWidthMixin, SizeToParent]);
             
            const row = new Row(detailsContainer, {height:18, inset:spacing});
            self.historicityBar = new pkg.HistoricityBar(row, {y:12, layoutHint:1});
            self.attestationBar = new pkg.AttestationBar(row, {y:12, layoutHint:1});
            self.paradoxBar = new pkg.ParadoxBar(row, {y:12, layoutHint:1});
            
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
            self.deployAgentBtn = new AgentBtn(agentsRow.getHeaderView(), {y:1}, [{
                doActivated: () => {self.selectedAgentModel.doDeployToEvent(self.eventModel);}
            }]);
            self.recallAgentBtn = new AgentBtn(agentsRow.getHeaderView(), {y:1}, [{
                doActivated: () => {self.selectedAgentModel.doRecallToHQ();}
            }]);
            new SpacedLayout(agentsRow, {axis:'y', spacing:1, outset:1, collapseParent:true});
            
            self.valuesTxt = new PaddedText(detailsContainer, {padding:padding, whiteSpace:'normal'});
            
            new SpacedLayout(detailsContainer, {axis:'y', inset:spacing, spacing:spacing, collapseParent:true});
            
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
            this.eventModel = eventBox?.model ?? null;
            this.updateForEventModel();
        },
        
        notifyEventModelChanged: function(eventModel) {
            if (eventModel && this.eventModel === eventModel) this.updateForEventModel();
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
                const timelineView = pkg.app.getTimelineView(),
                    isHQ = eventModel.id === EVENT_ID_TIME_CORPS_HQ;
                self.hqBtn.setDisabled(isHQ);
                self.theVoidBtn.setDisabled(eventModel.id === EVENT_ID_THE_VOID);
                
                Layout.incrementGlobalLock();
                
                self.historicityBar.updateForStat(eventModel[STAT_ID_HISTORICITY]);
                self.attestationBar.updateForStat(eventModel[STAT_ID_ATTESTATION]);
                self.paradoxBar.updateForStat(eventModel[STAT_ID_PARADOX]);
                
                self.whereWhen.setText(
                    (eventModel.getLocationModel()?.name ?? ICON_NIL) +
                    ICON_SEPARATOR + eventModel.formatAsTemporalExtent()
                );
                
                self.descriptionRow.setValue();
                
                // Precursor Nav Buttons //
                const precursorsRow = self.precursorsRow,
                    precursors = eventModel.getPrecursors();
                precursorsRow.clearContent();
                let addedCount = 0;
                if (precursors.size > 0) {
                    for (const precursorEvent of precursors) {
                        if (!precursorEvent.isHidden() && !eventModel.isAffectedByHidden(precursorEvent)) {
                            if (addedCount > 0) new TextForFlow(precursorsRow, {text:ICON_SEPARATOR});
                            new UnderlineBtn(precursorsRow, {text:precursorEvent.name + ' ' + ICON_NAV_FORWARD}, [{
                                setMouseOver: function(v) {
                                    if (this.inited && this.mouseOver !== v) {
                                        this.callSuper(v);
                                        if (this.mouseOver) {
                                            pkg.app.scrollToDebounced(precursorEvent);
                                        } else {
                                            pkg.app.scrollToEvent(eventModel, true);
                                        }
                                    }
                                },
                                doActivated: () => {pkg.app.selectEventBox(precursorEvent);}
                            }]);
                            addedCount++;
                        }
                    }
                }
                if (addedCount === 0) new NoValueText(precursorsRow);
                
                // Descendant Nav Buttons //
                const descendantsRow = self.descendantsRow,
                    descendants = eventModel.getDescendants();
                descendantsRow.clearContent();
                addedCount = 0;
                if (descendants.size > 0) {
                    for (const descendantEvent of descendants) {
                        if (!descendantEvent.isHidden() && !descendantEvent.isAffectedByHidden(eventModel)) {
                            if (addedCount > 0) new TextForFlow(descendantsRow, {text:ICON_SEPARATOR});
                            new UnderlineBtn(descendantsRow, {text:descendantEvent.name + ' ' + ICON_NAV_FORWARD}, [{
                                setMouseOver: function(v) {
                                    if (this.inited && this.mouseOver !== v) {
                                        this.callSuper(v);
                                        if (this.mouseOver) {
                                            pkg.app.scrollToDebounced(descendantEvent);
                                        } else {
                                            pkg.app.scrollToEvent(eventModel, true);
                                        }
                                    }
                                },
                                doActivated: () => {pkg.app.selectEventBox(descendantEvent);}
                            }]);
                            addedCount++;
                        }
                    }
                }
                if (addedCount === 0) new NoValueText(descendantsRow);
                
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
                    deployAgentBtn.setBtnModel(selectedAgentModel);
                    recallAgentBtn.setBtnModel(selectedAgentModel);
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
            const eventName = (this.eventModel?.name ?? 'none'),
                prefix = 'Event : ',
                title = prefix + '<span style="color:' + colorUltraLight + ';">' + eventName + '</span>';
            this.setTitle(title, prefix + eventName);
        }
    });
})(tc);
