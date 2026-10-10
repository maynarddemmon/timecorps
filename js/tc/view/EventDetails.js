(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {
            View, PaddedText, PaddedPlainText, SizeToParent, 
            Layout, SpacedLayout, ResizeLayout, WrappingLayout
        } = myt,
        
        {
            UnderlineBtn, UnderlineActionBtn, AgentBtn, SquareBtn, WideView, StatusAgentMarkerMedium,
            ContainerRow, Row, TextForFlow,
            theme:{
                spacing, padding, btnHeight,
                colorUltraLight, colorLight, colorMegaDark,
                fontSizeMedium, fontSizeLarge
            },
            cfg:{RELOAD_CHRONAL_AMOUNT},
            ICON_EVENT, ICON_SEPARATOR, ICON_NAV_FORWARD, ICON_VIEW, ICON_HQ,
            ICON_THE_VOID, ICON_NIL,
            STAT_ID_PARADOX, STAT_ID_ATTESTATION, STAT_ID_HISTORICITY
        } = pkg,
        
        // Agent Row
        MARKER_EXTENT = 2*btnHeight + spacing + padding,
        
        getInvestigateBtnInfo = (agentModel, eventModel, agentCantActHere) => {
            const easePhrase = agentModel.getSkillEasePhrase(
                    eventModel.getInvestigateSkillExpr(),
                    eventModel.getInvestigateDifficulty()
                ),
                label = 'Investigate';
            return {
                text:label,
                tooltip:label + ' / ' + easePhrase,
                disabled:agentCantActHere || eventModel.attestation.isAtMaxValue()
            };
        },
        
        getActionBtnInfo = (agentModel, actionModel, agentCantActHere) => {
            const easePhrase = agentModel.getSkillEasePhrase(
                    actionModel.getActionSkillExpr(),
                    actionModel.getActionSkillDifficulty()
                ),
                label = actionModel.label,
                name = actionModel.getActionSkillName(),
                effectsPhrase = agentModel.getEffectsPhrase(actionModel);
            
            return {
                text:label + pkg.formatAgentRisks(
                    agentModel.hasChronalChangeRiskFor(actionModel), 
                    agentModel.hasParadoxChangeRiskFor(actionModel), 
                    agentModel.hasHealthChangeRiskFor(actionModel)
                ),
                // An action without an actionType has no name to show.
                tooltip:label + ICON_SEPARATOR + (name ? name + ' / ' : '') + easePhrase + 
                    (effectsPhrase ? ICON_SEPARATOR + effectsPhrase : ''),
                disabled:agentCantActHere /*|| actionModel.done*/
            };
        },
        
        AgentExitBtn = new JS.Module('AgentExitBtn', {
            configure: function(agentModel, exitModel, showTargetName) {
                this.agentModel = agentModel;
                this.exitModel = exitModel;
                
                const toEvent = exitModel.getToEventModel();
                this.setText(
                    exitModel.getModePhrase() + 
                    (showTargetName ? ' ' + (toEvent?.name ?? exitModel.to) : '') + 
                    pkg.formatAgentRisks(
                        agentModel.hasChronalChangeRiskFor(exitModel), 
                        // The paradox for entering the Event, or else whether an effect changes it.
                        agentModel.calculateParadoxForEntry(toEvent) || agentModel.hasParadoxChangeRiskFor(exitModel), 
                        agentModel.hasHealthChangeRiskFor(exitModel)
                    )
                );
                this.setTooltip(agentModel.getEffectsPhrase(exitModel));
            },
            doActivated: function() {
                this.agentModel.doFollowExit(this.exitModel, this);
            }
        }),
        
        AgentRowFlow = new JSClass('AgentRowFlow', WideView, {
            initNode: function(parent, attrs) {
                attrs.x ??= MARKER_EXTENT;
                attrs.percentOfParentWidthOffset ??= -attrs.x;
                
                this.callSuper(parent, attrs);
                
                new WrappingLayout(this, {spacing, lineSpacing:-5, collapseParent:true});
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
                self.reloadChronalBtn = new UnderlineBtn(self, {align:'right', alignOffset:2*spacing, y:spacing, ignoreLayout:true, visible:false}, [{
                    doActivated: () => {self.agentModel.doReloadChronal();}
                }]);
                
                self.actionView = new AgentRowFlow(self);
                self.exitView = new AgentRowFlow(self);
                
                new SpacedLayout(self, {axis:'y', inset:26, spacing:-5, outset:spacing, collapseParent:true});
                
                self.update();
            },
            setHeight: function(v) {
                const markerView = this.markerView;
                this.callSuper(Math.max(v, markerView.height + 2*markerView.y));
            },
            update: function() {
                const self = this,
                    {agentModel, eventModel, markerView, vitaeBtn, recallBtn, reloadChronalBtn, actionView, exitView} = self,
                    agentCantActHere = !agentModel.canAct();
                
                markerView.setModel(agentModel);
                vitaeBtn.setText(agentModel.name);
                
                if (!agentModel.isPlayerControlled()) {
                    recallBtn.setVisible(false);
                    reloadChronalBtn.setVisible(false);
                    new TextForFlow(actionView, {paddingTop:3, text:'Not under Time Corps control'});
                    return;
                }
                
                // The dead can't act, travel or be resupplied.
                if (agentModel.isDead()) {
                    recallBtn.setVisible(false);
                    reloadChronalBtn.setVisible(false);
                    new TextForFlow(actionView, {paddingTop:3, text:'Deceased'});
                    return;
                }
                
                const isHQ = eventModel.isHQ();
                recallBtn.setVisible(!isHQ);
                reloadChronalBtn.setVisible(isHQ);
                
                if (isHQ) {
                    const reloadAmount = agentModel.getReloadChronalAmount() || RELOAD_CHRONAL_AMOUNT;
                    reloadChronalBtn.setText('Reload Agent Chronal +' + reloadAmount);
                    reloadChronalBtn.setDisabled(!agentModel.canReloadChronal());
                } else {
                    agentModel.updateBtnForTimeTravel(recallBtn, pkg.model.getHQEventModel());
                }
                
                // Update Actions
                new TextForFlow(actionView, {paddingTop:3, text:agentModel.getActionsPhrase()});
                new TextForFlow(actionView, {text:ICON_SEPARATOR});
                new UnderlineActionBtn(actionView, getInvestigateBtnInfo(agentModel, eventModel, agentCantActHere), [{
                    doActivated: function() {agentModel.doInvestigate(this);}
                }]);
                const actionModels = eventModel.getActionModels();
                for (const actionId in actionModels) {
                    const actionModel = actionModels[actionId];
                    if (!actionModel.isHidden()) {
                        new TextForFlow(actionView, {text:ICON_SEPARATOR});
                        new UnderlineActionBtn(actionView, getActionBtnInfo(agentModel, actionModel, agentCantActHere), [{
                            doActivated: function() {agentModel.doAction(actionModel, this);}
                        }]);
                    }
                }
                
                // Update Exits
                new TextForFlow(exitView, {text:'Exits:\u00A0'});
                const exitModels = eventModel.getExitModels();
                let addedCount = 0;
                for (const exitModel of exitModels) {
                    if (!exitModel.isHidden()) {
                        const toEventModel = exitModel.getToEventModel();
                        if (!toEventModel.isHidden()) {
                            if (addedCount > 0) new TextForFlow(exitView, {text:ICON_SEPARATOR});
                            const btn = new UnderlineBtn(exitView, {}, [AgentExitBtn, {
                                setMouseOver: function(v) {
                                    if (this.inited && this.mouseOver !== v) {
                                        this.callSuper(v);
                                        if (this.mouseOver) {
                                            pkg.app.scrollToDebounced(toEventModel);
                                        } else {
                                            pkg.app.scrollToEvent(eventModel, true);
                                        }
                                    }
                                }
                            }]);
                            btn.configure(agentModel, exitModel, true);
                            addedCount++;
                        }
                    }
                }
                
                if (addedCount === 0) new TextForFlow(exitView, {text:'No exits available.'});
            }
        }),
        
        /*  A button that selects another Event, and scrolls the timeline to it on hover. */
        makeEventNavBtn = (parent, toEventModel, fromEventModel) => new UnderlineBtn(parent, {
            text:toEventModel.name + ' ' + ICON_NAV_FORWARD
        }, [{
            setMouseOver: function(v) {
                if (this.inited && this.mouseOver !== v) {
                    this.callSuper(v);
                    if (this.mouseOver) {
                        pkg.app.scrollToDebounced(toEventModel);
                    } else {
                        pkg.app.scrollToEvent(fromEventModel, true);
                    }
                }
            },
            doActivated: () => {pkg.app.selectEventBox(toEventModel);}
        }]),
        
        CausatorLinkFlow = new JSClass('CausatorLinkFlow', WideView, {
            initNode: function(parent, attrs) {
                attrs.x ??= padding;
                attrs.percentOfParentWidthOffset ??= -2*padding;
                this.callSuper(parent, attrs);
                new WrappingLayout(this, {spacing, lineSpacing:-5, collapseParent:true});
            },
            
            /*  Shows the label and a nav button for each Event. Hides itself if there are none. */
            update: function(label, eventModels, fromEventModel) {
                const self = this;
                self.destroyAllSubviews();
                if (eventModels.length > 0) {
                    new TextForFlow(self, {text:label});
                    eventModels.forEach((eventModel, idx) => {
                        if (idx > 0) new TextForFlow(self, {text:ICON_SEPARATOR});
                        makeEventNavBtn(self, eventModel, fromEventModel);
                    });
                }
                self.setVisible(eventModels.length > 0);
            }
        }),
        
        CausatorRow = new JSClass('CausatorRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this;
                
                self.quickSet(['valueModel'], attrs);
                
                attrs.bgColor ??= colorMegaDark;
                
                self.callSuper(parent, attrs);
                
                self.nameTxt = new PaddedText(self, {padding, fontSize:fontSizeMedium, whiteSpace:'normal'});
                self.descriptionTxt = new PaddedText(self, {padding, whiteSpace:'normal'});
                
                // The links get their own container since the row's negative spacing, which
                // tightens up the text, would make the two flows overlap.
                const linksView = self.linksView = new WideView(self);
                self.precursorsFlow = new CausatorLinkFlow(linksView);
                self.descendantsFlow = new CausatorLinkFlow(linksView);
                new SpacedLayout(linksView, {axis:'y', inset:padding, spacing:-6, collapseParent:true});
                
                new SpacedLayout(self, {axis:'y', spacing:-2*padding, outset:spacing, collapseParent:true});
                
                self.update();
            },
            update: function() {
                const self = this,
                    valueModel = self.valueModel,
                    eventModel = valueModel.event;
                self.nameTxt.setText(valueModel.getName());
                self.descriptionTxt.setText(valueModel.getDescription());
                
                // Only show links the player is allowed to know about.
                self.precursorsFlow.update(
                    'Precursors:\u00A0',
                    [...valueModel.getPrecursors()].filter(precursor => !precursor.isHidden() && !eventModel.isAffectedByHidden(precursor)),
                    eventModel
                );
                self.descendantsFlow.update(
                    'Descendants:\u00A0',
                    [...valueModel.getDescendants()].filter(descendant => !descendant.isHidden() && !descendant.isAffectedByHidden(eventModel)),
                    eventModel
                );
                self.linksView.setVisible(self.precursorsFlow.visible || self.descendantsFlow.visible);
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
                percentOfParentHeight:100, visible:false
            });
            
            // Time & Place, Status Bars
            self.whereWhen = new PaddedPlainText(detailsContainer, {
                percentOfParentWidth:100,
                fontSize:fontSizeMedium, whiteSpace:'normal', paddingLeft:spacing, paddingRight:spacing
            }, [SizeToParent]);
            new View(detailsContainer, {height:2}); // Spacer.
            let row = new Row(detailsContainer, {height:18, inset:spacing});
            self.historicityBar = new pkg.HistoricityBar(row, {y:12, layoutHint:1});
            self.attestationBar = new pkg.AttestationBar(row, {y:12, layoutHint:1});
            self.paradoxBar = new pkg.ParadoxBar(row, {y:12, layoutHint:1});
            new View(detailsContainer, {height:2}); // Spacer.
            
            // Agents
            row = self.agentsRow = new ContainerRow(detailsContainer, {label:'Agent Activity'});
            const headerView = row.getHeaderView();
            new View(headerView, {layoutHint:1}); // Spacer
            self.followExitBtn = new AgentBtn(headerView, {y:1}, [AgentExitBtn]);
            self.agentsRowBtnSeparator = new TextForFlow(headerView, {text:ICON_SEPARATOR});
            self.deployAgentBtn = new AgentBtn(headerView, {y:1}, [{
                doActivated: () => {self.selectedAgentModel.doDeployToEvent(self.eventModel);}
            }]);
            self.recallAgentBtn = new AgentBtn(headerView, {y:1}, [{
                doActivated: () => {self.selectedAgentModel.doRecallToHQ();}
            }]);
            
            // Causators
            self.causatorsRow = new ContainerRow(detailsContainer, {label:'Causators'});
            
            // Description
            row = new ContainerRow(detailsContainer, {label:'Historical Account', layoutHint:2});
            self.descriptionTxt = new PaddedText(row, {padding, whiteSpace:'normal'});
            
            new ResizeLayout(detailsContainer, {axis:'y', inset:spacing, spacing:1});
            
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
                const isHQ = eventModel.isHQ();
                self.hqBtn.setDisabled(isHQ);
                self.theVoidBtn.setDisabled(eventModel.isTheVoid());
                
                Layout.incrementGlobalLock();
                
                self.historicityBar.updateForStat(eventModel[STAT_ID_HISTORICITY]);
                self.attestationBar.updateForStat(eventModel[STAT_ID_ATTESTATION]);
                self.paradoxBar.updateForStat(eventModel[STAT_ID_PARADOX]);
                
                self.whereWhen.setText(
                    (eventModel.getLocationModel()?.name ?? ICON_NIL) +
                    ICON_SEPARATOR + eventModel.formatAsTemporalExtent()
                );
                
                const descriptionTxt = self.descriptionTxt,
                    description = eventModel.getDescription();
                descriptionTxt.setText(description || 'The historical record is silent.');
                descriptionTxt.setFontStyle(description ? null : 'italic');
                
                const causatorsRow = self.causatorsRow;
                causatorsRow.getContentView().destroyAllSubviews();
                let addedCount = 0;
                for (const valueModel of Object.values(eventModel.getValueModels())) {
                    if (!valueModel.isHidden()) {
                        new CausatorRow(causatorsRow, {valueModel});
                        addedCount++;
                    }
                }
                if (addedCount === 0) {
                    new PaddedPlainText(causatorsRow, {
                        padding, whiteSpace:'normal', fontStyle:'italic', text:'No known causators for this event.'
                    });
                }
                
                const agentsRow = self.agentsRow;
                agentsRow.getContentView().destroyAllSubviews();
                addedCount = 0;
                for (const agentModel of eventModel.getAgentModels()) {
                    new AgentRow(agentsRow, {agentModel, eventModel});
                    addedCount++;
                }
                if (addedCount === 0) {
                    new PaddedPlainText(agentsRow, {
                        padding, whiteSpace:'normal', fontStyle:'italic', text:'No agents at this event.'
                    });
                }
                
                Layout.decrementGlobalLock();
            }
            
            self.updateTitle();
            self.updateForSelectedAgent();
        },
        
        updateForSelectedAgent: function() {
            const self = this,
                eventModel = self.eventModel,
                hasEventModel = eventModel != null;
            
            if (hasEventModel) {
                const {selectedAgentModel, followExitBtn, agentsRowBtnSeparator, deployAgentBtn, recallAgentBtn} = self,
                    isHQ = eventModel.isHQ(),
                    hasAgentModel = selectedAgentModel != null,
                    canDirectAgent = hasAgentModel && selectedAgentModel.isPlayerControlled() && !selectedAgentModel.isDead();
                
                // An exit from where the Agent is to this Event, offered alongside jumping here.
                const exitModel = self.followExitModel = canDirectAgent ? selectedAgentModel.getExitTo(eventModel) : null;
                followExitBtn.setVisible(exitModel != null);
                if (exitModel) {
                    followExitBtn.configure(selectedAgentModel, exitModel, false);
                    followExitBtn.setBtnModel(selectedAgentModel);
                }
                recallAgentBtn.setVisible(canDirectAgent && isHQ && !selectedAgentModel.isAtEvent(eventModel));
                deployAgentBtn.setVisible(canDirectAgent && !eventModel.isHidden());
                let sepIsVisible = false;
                if (canDirectAgent) {
                    let btn;
                    if (recallAgentBtn.visible) {
                        btn = recallAgentBtn;
                    } else if (deployAgentBtn.visible) {
                        btn = deployAgentBtn;
                    }
                    if (btn) {
                        sepIsVisible = followExitBtn.visible;
                        agentsRowBtnSeparator.setVisible();
                        
                        btn.setBtnModel(selectedAgentModel);
                        selectedAgentModel.updateBtnForTimeTravel(btn, eventModel);
                    }
                }
                
                agentsRowBtnSeparator.setVisible(sepIsVisible);
            }
        },
        
        updateTitle: function() {
            const eventName = this.eventModel?.name ?? 'none';
            this.setTitle(
                ICON_EVENT + ' ' + pkg.wrapInStyledSpan(eventName, colorUltraLight),
                'Historical Event : ' + eventName
            );
        }
    });
})(tc);
