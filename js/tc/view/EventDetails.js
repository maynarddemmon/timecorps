(pkg => {
    'use strict';
    
    let rootModel;
    
    const JSClass = JS.Class,
        
        {
            View, PaddedText, PaddedPlainText, SizeToParent, 
            Layout, SpacedLayout, ResizeLayout, WrappingLayout,
            debounce
        } = myt,
        
        {
            UnderlineBtn, UnderlineActionBtn, EventNavHover, AgentBtn, EventLinkFlow,
            SquareBtn, WideView, StatusAgentMarkerMedium,
            ContainerRow, TextForFlow,
            theme:{
                spacing, padding, btnHeight,
                colorUltraLight, colorLight, colorMegaDark,
                fontSizeMedium, fontSizeLarge
            },
            ICON_EVENT, ICON_SEPARATOR, ICON_VIEW, ICON_HQ,
            ICON_THE_VOID,
            STAT_ID_CHRONAL
        } = pkg,
        
        // Agent Row
        MARKER_EXTENT = 2*btnHeight + spacing + padding,
        
        getActionBtnInfo = (agentModel, actionModel) => {
            const easePhrase = agentModel.getSkillEasePhrase(
                    actionModel.getActionSkillExpr(),
                    actionModel.getActionSkillDifficulty()
                ),
                label = actionModel.label,
                name = actionModel.getActionSkillName(),
                costsPhrase = agentModel.getCostsPhrase(actionModel),
                adjustmentsPhrase = agentModel.getAdjustmentsPhrase(actionModel),
                blockedByFlood = agentModel.isActionBlockedByFlood(actionModel);
            
            return {
                text:label + pkg.formatAgentRisks(
                    agentModel.hasChronalChangeRiskFor(actionModel), 
                    agentModel.hasParadoxChangeRiskFor(actionModel), 
                    agentModel.hasHealthChangeRiskFor(actionModel)
                ),
                // An action without an actionType has no name to show.
                tooltip:label + ICON_SEPARATOR + (name ? name + ' / ' : '') + easePhrase + 
                    (costsPhrase ? ICON_SEPARATOR + costsPhrase : '') + 
                    (adjustmentsPhrase ? ICON_SEPARATOR + adjustmentsPhrase : '') +
                    (blockedByFlood ? ICON_SEPARATOR + 'Could generate paradox, which a flooded event can\'t hold' : ''),
                disabled:blockedByFlood || !agentModel.canPayCostsFor(actionModel) || !actionModel.isAvailableFor(agentModel)
            };
        },
        
        AgentExitBtn = new JS.Module('AgentExitBtn', {
            configure: function(agentModel, exitModel, showTargetName) {
                this.agentModel = agentModel;
                this.exitModel = exitModel;
                
                const toEvent = exitModel.getToEventModel();
                this.setText(
                    exitModel.getModePhrase() + 
                    (showTargetName ? ' ' + exitModel.getDestinationPhrase() : '') + 
                    pkg.formatAgentRisks(
                        agentModel.hasChronalChangeRiskFor(exitModel), 
                        // The paradox for entering the Event, or else whether an adjustment changes it.
                        agentModel.calculateParadoxForEntry(toEvent) || agentModel.hasParadoxChangeRiskFor(exitModel), 
                        agentModel.hasHealthChangeRiskFor(exitModel)
                    )
                );
                const costsPhrase = agentModel.getCostsPhrase(exitModel),
                    adjustmentsPhrase = agentModel.getAdjustmentsPhrase(exitModel);
                this.setTooltip([costsPhrase, adjustmentsPhrase].filter(phrase => phrase).join(ICON_SEPARATOR));
                this.setDisabled(!agentModel.canPayCostsFor(exitModel));
            },
            doActivated: function() {
                this.agentModel.selectRow();
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
                    doActivated: () => self.agentModel.selectRow()
                }]);
                self.recallBtn = new UnderlineBtn(self, {align:'right', alignOffset:2*spacing, y:spacing, ignoreLayout:true, visible:false}, [{
                    doActivated: () => {
                        self.agentModel.selectRow();
                        self.agentModel.doRecallToHQ();
                    }
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
                    {agentModel, eventModel, markerView, vitaeBtn, recallBtn, actionView, exitView} = self;
                
                markerView.setModel(agentModel);
                vitaeBtn.setText(agentModel.name);
                
                if (!agentModel.isPlayerControlled()) {
                    recallBtn.setVisible(false);
                    new TextForFlow(actionView, {paddingTop:3, text:'Not taking direction from you'});
                    return;
                }
                
                // The dead can't act, travel or be resupplied.
                if (agentModel.isDead()) {
                    recallBtn.setVisible(false);
                    new TextForFlow(actionView, {paddingTop:3, text:'Deceased'});
                    return;
                }
                
                // A recall to the HQ of the Agent's Faction, if it has one and isn't this Event.
                const hqEventModel = agentModel.getHQEventModel();
                if (hqEventModel && hqEventModel !== eventModel) {
                    agentModel.updateBtnForTimeTravel(recallBtn, hqEventModel);
                } else {
                    recallBtn.setVisible(false);
                }
                
                // Update Actions
                const actionModels = eventModel.getActionModels();
                if (Object.keys(actionModels).length > 0) {
                    new TextForFlow(actionView, {paddingTop:3, text:agentModel.getActionsPhrase()});
                    
                    for (const actionId in actionModels) {
                        const actionModel = actionModels[actionId];
                        if (actionModel.isNotHidden()) {
                            new TextForFlow(actionView, {text:ICON_SEPARATOR});
                            new UnderlineActionBtn(actionView, getActionBtnInfo(agentModel, actionModel), [{
                                doActivated: function() {
                                    agentModel.selectRow();
                                    agentModel.doAction(actionModel, this);
                                }
                            }]);
                        }
                    }
                }
                
                // Update Exits
                new TextForFlow(exitView, {text:'Exits:\u00A0'});
                const exitModels = eventModel.getExitModels();
                let addedCount = 0;
                for (const exitModel of exitModels) {
                    if (exitModel.isNotHidden() && exitModel.isDestinationOffered()) {
                        const toEventModel = exitModel.getToEventModel();
                        if (addedCount > 0) new TextForFlow(exitView, {text:ICON_SEPARATOR});
                        // An unknown destination isn't shown on hover.
                        const btn = new UnderlineBtn(exitView, {navEventModel:toEventModel.isNotHidden() ? toEventModel : null}, [AgentExitBtn, EventNavHover]);
                        btn.configure(agentModel, exitModel, true);
                        addedCount++;
                    }
                }
                
                exitView.setVisible(addedCount > 0);
            }
        }),
        
        CausatorRow = new JSClass('CausatorRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this;
                
                self.quickSet(['valueModel'], attrs);
                
                attrs.bgColor ??= colorMegaDark;
                
                self.callSuper(parent, attrs);
                
                const txtAttrs = {paddingLeft:padding, paddingRight:padding, whiteSpace:'normal'};
                self.nameTxt = new PaddedText(self, {...txtAttrs, fontSize:fontSizeMedium});
                self.descriptionTxt = new PaddedText(self, {...txtAttrs});
                self.precursorsFlow = new EventLinkFlow(self);
                self.descendantsFlow = new EventLinkFlow(self);
                new SpacedLayout(self, {axis:'y', inset:padding, outset:padding, collapseParent:true});
                
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
                    [...valueModel.getPrecursors()].filter(precursor => precursor.isNotHidden() && !eventModel.isAffectedByHidden(precursor))
                );
                self.descendantsFlow.update(
                    'Descendants:\u00A0',
                    [...valueModel.getDescendants()].filter(descendant => descendant.isNotHidden() && !descendant.isAffectedByHidden(eventModel))
                );
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
                y:1, buttonType:'plain', visible:false, textColor:colorLight, text:ICON_HQ, tooltip:'Select HQ'
            }, [{doActivated: () => {pkg.app.selectEventBox(self.selectedAgentModel.getHQEventModel());}}]);
            self.theVoidBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', visible:false, textColor:colorLight, text:ICON_THE_VOID, tooltip:'Select The Void'
            }, [{doActivated: () => {pkg.app.selectEventBox(rootModel.getTheVoidEventModel());}}]);
            
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
            
            // The title opens the Event Brief.
            const titleView = self.getTitleView();
            titleView.setCursor('pointer');
            self.attachToDom(titleView, '_doTitleClick', 'click');
            
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding, whiteSpace:'normal', text:"Select a historical event in the timeline to see more about it here."
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {
                percentOfParentHeight:100, visible:false
            });
            
            // Time & Place, Status Bars
            self.eventFacts = new pkg.EventFacts(detailsContainer);
            
            self.chronalBar = new pkg.ChronalBar(detailsContainer, {
                x:spacing, percentOfParentWidth:100, percentOfParentWidthOffset:-2*spacing,
                labelTemplate:'HQ {label} Pool', visible:false
            }, [SizeToParent, pkg.BigStatBar]);
            
            new View(detailsContainer, {height:2}); // Spacer.
            
            // Agents
            let row = self.agentsRow = new ContainerRow(detailsContainer, {label:'Agent Activity'});
            const headerView = row.getHeaderView();
            new View(headerView, {layoutHint:1}); // Spacer
            self.followExitBtn = new AgentBtn(headerView, {y:1}, [AgentExitBtn]);
            self.agentsRowBtnSeparator = new TextForFlow(headerView, {text:ICON_SEPARATOR});
            self.deployAgentBtn = new AgentBtn(headerView, {y:1}, [{
                doActivated: () => {self.selectedAgentModel.doDeployToEvent(self.eventModel);}
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
        
        /*  The HQ and The Void buttons show once those Events are revealed, so a change to
            either updates them too. */
        notifyEventModelChanged: function(eventModel) {
            if (eventModel && (this.eventModel === eventModel || eventModel.isHQ() || eventModel.isTheVoid())) this.updateForEventModel();
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
        
        updateForEventModel: debounce(function() {
            const self = this,
                {eventModel, detailsContainer} = self,
                hasModel = eventModel != null;
            
            self.noSelectionTxt.setVisible(!hasModel);
            detailsContainer.setVisible(hasModel);
            self.scrollToBtn.setDisabled(!hasModel || eventModel.isHidden());
            
            if (hasModel) {
                self.chronalBar.setVisible(eventModel.isHQ());
                
                self.theVoidBtn.setDisabled(eventModel.isTheVoid());
                self.theVoidBtn.setVisible(!rootModel.getTheVoidEventModel().isHidden());
                
                Layout.incrementGlobalLock();
                
                self.eventFacts.update(eventModel);
                
                const descriptionTxt = self.descriptionTxt,
                    description = eventModel.getDescription();
                descriptionTxt.setText(description || 'The historical record is silent.');
                descriptionTxt.setFontStyle(description ? null : 'italic');
                
                const causatorsRow = self.causatorsRow;
                causatorsRow.getContentView().destroyAllSubviews();
                let addedCount = 0;
                for (const valueModel of Object.values(eventModel.getValueModels())) {
                    if (valueModel.isNotHidden()) {
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
        }, 5),
        
        updateForSelectedAgent: debounce(function() {
            const self = this,
                eventModel = self.eventModel;
            if (eventModel != null) {
                // An exit from where the Agent is to this Event, offered alongside jumping here.
                const {selectedAgentModel, followExitBtn, deployAgentBtn, hqBtn} = self,
                    canDirectAgent = selectedAgentModel != null && selectedAgentModel.isPlayerControlled() && !selectedAgentModel.isDead(),
                    exitModel = self.followExitModel = canDirectAgent ? selectedAgentModel.getExitTo(eventModel) : null;
                followExitBtn.setVisible(exitModel != null);
                if (exitModel) {
                    followExitBtn.configure(selectedAgentModel, exitModel, false);
                    followExitBtn.setBtnModel(selectedAgentModel);
                }
                
                deployAgentBtn.setBtnModel(selectedAgentModel);
                if (canDirectAgent) {
                    selectedAgentModel.updateBtnForTimeTravel(deployAgentBtn, eventModel);
                } else {
                    deployAgentBtn.setVisible(false);
                }
                self.agentsRowBtnSeparator.setVisible(followExitBtn.visible && deployAgentBtn.visible);
                
                // Selects the selected Agent's HQ, once it's known.
                const hqEventModel = selectedAgentModel?.getHQEventModel();
                hqBtn.setDisabled(eventModel === hqEventModel);
                hqBtn.setVisible(hqEventModel?.isNotHidden() ?? false);
            }
        }, 25),
        
        updateTitle: function() {
            const eventName = this.eventModel?.name ?? 'none';
            this.setTitle(
                ICON_EVENT + ' ' + pkg.wrapInStyledSpan(eventName, colorUltraLight),
                'Open the event brief for: ' + eventName
            );
        },
        
        /** @private */
        _doTitleClick: function(_event) {
            if (this.eventModel) pkg.app.openEventBrief(this.eventModel);
        },
        
        setup: function(model) {
            rootModel = model;
            this.chronalBar.watchStatModel(rootModel[STAT_ID_CHRONAL]);
        }
    });
})(tc);
