(pkg => {
    'use strict';
    
    let rootModel;
    
    const JSClass = JS.Class,
        
        mathMax = Math.max,
        
        {
            I18N:{get:i18n},
            View, PaddedPlainText,
            Layout, SpacedLayout, ResizeLayout, SizeHeightToDom,
            debounceMicrotask
        } = myt,
        
        {
            UnderlineBtn, EventNavHover, AgentBtn, DescPart, 
            InlineSeparator, InlinePlainText, InlineText, InlineUnderlineBtn,
            SquareBtn, WideView, StatusAgentMarkerMedium, ContainerRow, wrapInStyledSpan,
            theme:{
                spacing, padding, btnHeight,
                colorUltraLight, colorLight, colorMegaDark, colorAction,
                fontSizeLarge
            },
            ICON_SEPARATOR
        } = pkg,
        
        // Agent Row
        MARKER_EXTENT = 2*btnHeight + spacing + padding,
        
        ORDER_SORT_FUNC = (a, b) => a.order - b.order,
        EXIT_MODELS_SORT_FUNC = (a, b) => {
            const aTravelTime = a.getTravelTime(),
                bTravelTime = b.getTravelTime();
            return aTravelTime === bTravelTime ? a.to.localeCompare(b.to) : aTravelTime - bTravelTime;
        },
        
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
                tooltip:label + ICON_SEPARATOR + (name ? name + i18n('check-skill-separator') : '') + easePhrase + 
                    (costsPhrase ? ICON_SEPARATOR + costsPhrase : '') + 
                    (adjustmentsPhrase ? ICON_SEPARATOR + adjustmentsPhrase : '') +
                    (blockedByFlood ? ICON_SEPARATOR + i18n('problem-flood-blocks-action') : ''),
                disabled:blockedByFlood || !agentModel.canPayCostsFor(actionModel) || !actionModel.isAvailableFor(agentModel)
            };
        },
        
        /*  An action previewed for an agent who isn't at its Event: just its label and the 
            skill it checks, since its ease, costs and risks are worked out for the Event the 
            agent is at. Always disabled. */
        getPreviewActionBtnInfo = actionModel => {
            const label = actionModel.label,
                name = actionModel.getActionSkillName();
            return {text:label, tooltip:label + (name ? ICON_SEPARATOR + name : ''), disabled:true};
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
                        agentModel.hasHealthChangeRiskFor(exitModel),
                        exitModel.getTravelTime()
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
        
        UnderlineActionBtn = new JSClass('UnderlineActionBtn', InlineUnderlineBtn, {
            initNode: function(parent, attrs) {
                attrs.textColor ??= colorAction;
                this.callSuper(parent, attrs);
                this.addDomClass('action');
            }
        }),
        
        UnderlineExitBtn = new JSClass('UnderlineExitBtn', InlineUnderlineBtn, {
            include: [AgentExitBtn, EventNavHover]
        }),
        
        /*  Adds the lines of an agent's actions at an Event to linesView: a line led by the 
            actions the agent has left, with the ungrouped actions, and a line for each action
            group with visible actions, led by its label. The lines go in order, the ungrouped 
            one's being 0, so a group with a negative order comes before it and one with a 
            positive order after. As a preview, of what the agent could do if they were there,
            every action is disabled and shows only its label (see getPreviewActionBtnInfo), 
            and the ungrouped line, with no actions left to count, is only shown with actions 
            in it. Returns how many actions were added. */
        addActionLines = (linesView, agentModel, eventModel, isPreview) => {
            const actionModels = Object.values(eventModel.getActionModels());
            if (actionModels.length === 0) return 0;
            
            const ungroupedLine = {
                    order:0, 
                    label:isPreview ? i18n('event-preview-actions') : i18n('agent-actions', wrapInStyledSpan(agentModel.getActionsRemaining(), colorAction)), 
                    actionModels:[]
                },
                lines = [ungroupedLine],
                linesByGroupId = {};
            for (const actionModel of actionModels) {
                const actionGroup = rootModel.getActionGroup(actionModel.getGroup());
                let line;
                if (actionGroup) {
                    line = linesByGroupId[actionGroup.id];
                    if (!line) {
                        lines.push(line = linesByGroupId[actionGroup.id] = {
                            order:actionGroup.order,
                            label:actionGroup.label,
                            actionModels:[]
                        });
                    }
                } else {
                    line = ungroupedLine;
                }
                if (!actionModel.isHiddenFor(agentModel)) line.actionModels.push(actionModel);
            }
            
            // The sort is stable, so a group with an order of 0 comes after the ungrouped line.
            lines.sort(ORDER_SORT_FUNC);
            let addedCount = 0;
            for (const line of lines) {
                if ((line === ungroupedLine && !isPreview) || line.actionModels.length > 0) {
                    new InlineText(linesView, {text:line.label});
                    for (const actionModel of line.actionModels) {
                        new InlineSeparator(linesView);
                        new UnderlineActionBtn(linesView, isPreview ? getPreviewActionBtnInfo(actionModel) : getActionBtnInfo(agentModel, actionModel), [{
                            doActivated: function() {
                                agentModel.selectRow();
                                agentModel.doAction(actionModel, this);
                            }
                        }]);
                        addedCount++;
                    }
                    new View(linesView, {tagName:'br'}, [pkg.InlineMixin]);
                }
            }
            return addedCount;
        },
        
        /*  Shown when no agents are at an Event: says so, and lists the actions the selected 
            agent could take if they were there, all disabled, so a player can see what an 
            Event offers after leaving it. Just the message when there's no agent to ask about,
            or nothing they could do. */
        NoAgentsPreview = new JSClass('NoAgentsPreview', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    {agentModel, eventModel} = attrs;
                delete attrs.agentModel;
                delete attrs.eventModel;
                
                self.callSuper(parent, attrs);
                
                const linesView = self.linesView = new WideView(self, {
                        x:padding, y:padding, percentOfParentWidthOffset:-2*padding
                    }, [SizeHeightToDom]),
                    msgTxt = new InlinePlainText(linesView, {fontStyle:'italic', text:i18n('event-no-agents')});
                
                if (agentModel?.isPlayerControlled() && !agentModel.isDead()) {
                    msgTxt.setText(i18n('event-no-agents') + ' ' + i18n('event-preview-intro', agentModel.name));
                    new View(linesView, {tagName:'br'}, [pkg.InlineMixin]);
                    if (addActionLines(linesView, agentModel, eventModel, true) === 0) {
                        // Nothing to show after all.
                        linesView.destroyAllSubviews();
                        new InlinePlainText(linesView, {fontStyle:'italic', text:i18n('event-no-agents')});
                    }
                }
                self.updateHeight();
            },
            setWidth: function(v) {
                this.callSuper(v);
                if (this.inited) this.updateHeight();
            },
            updateHeight: function() {
                const linesView = this.linesView;
                linesView.sizeViewToDom();
                this.setHeight(linesView.y + linesView.height + padding);
            }
        }),
        
        AgentRow = new JSClass('AgentRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this;
                
                self.quickSet(['agentModel','eventModel'], attrs);
                
                attrs.bgColor ??= colorMegaDark;
                
                self.callSuper(parent, attrs);
                
                self.markerView = new StatusAgentMarkerMedium(self, {x:spacing, y:spacing});
                self.nameBtn = new UnderlineBtn(self, {x:MARKER_EXTENT, y:spacing, fontSize:fontSizeLarge}, [{
                    doActivated: () => self.agentModel.selectRow()
                }]);
                self.recallBtn = new UnderlineBtn(self, {align:'right', alignOffset:2*spacing, y:spacing, visible:false}, [{
                    doActivated: () => {
                        self.agentModel.selectRow();
                        self.agentModel.doRecallToHQ(self.recallBtn);
                    }
                }]);
                self.linesView = new WideView(self, {x:MARKER_EXTENT, y:23, percentOfParentWidthOffset:-MARKER_EXTENT}, [SizeHeightToDom]);
                
                self.update();
            },
            setWidth: function(v) {
                this.callSuper(v);
                if (this.inited) this.updateHeight();
            },
            updateHeight: function() {
                const self = this,
                    {linesView, markerView} = self;
                linesView.sizeViewToDom();
                self.setHeight(mathMax(markerView.y + markerView.height, linesView.y + linesView.height) + spacing);
            },
            update: function() {
                const self = this,
                    {agentModel, eventModel, markerView, nameBtn, recallBtn, linesView} = self;
                
                markerView.setModel(agentModel);
                nameBtn.setText(agentModel.name);
                
                let noControlMsg;
                if (!agentModel.isPlayerControlled()) {
                    noControlMsg = i18n('problem-not-player-controlled');
                } else if (agentModel.isDead()) {
                    // The dead can't act, travel or be resupplied.
                    noControlMsg = i18n('problem-deceased');
                }
                
                if (noControlMsg) {
                    recallBtn.setVisible(false);
                    new InlinePlainText(linesView, {text:noControlMsg});
                } else {
                    // A recall to the HQ of the Agent's Faction, if it has one and isn't this Event.
                    const hqEventModel = agentModel.getHQEventModel();
                    if (hqEventModel && hqEventModel !== eventModel) {
                        agentModel.updateBtnForTimeTravel(recallBtn, hqEventModel);
                    } else {
                        recallBtn.setVisible(false);
                    }
                    
                    addActionLines(linesView, agentModel, eventModel, false);
                    
                    // Update Exits
                    const exitLabelView = new InlinePlainText(linesView, {text:i18n('event-exits') + '\u00A0', visible:false}),
                        // Sorted by travel time, then destination. A copy, since the agent log saves
                        // exits by their index in the Event's own list.
                        exitModels = [...eventModel.getExitModels()].sort(EXIT_MODELS_SORT_FUNC);
                    let addedCount = 0;
                    for (const exitModel of exitModels) {
                        // An exit the agent has lived past is gone for them.
                        if (exitModel.isNotHidden() && exitModel.isDestinationOffered() && !exitModel.isPassedFor(agentModel)) {
                            const toEventModel = exitModel.getToEventModel();
                            if (addedCount > 0) new InlineSeparator(linesView);
                            // An unknown destination isn't shown on hover.
                            const btn = new UnderlineExitBtn(linesView, {navEventModel:toEventModel.isNotHidden() ? toEventModel : null});
                            btn.configure(agentModel, exitModel, true);
                            addedCount++;
                        }
                    }
                    exitLabelView.setVisible(addedCount > 0);
                }
                
                self.updateHeight();
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
                y:1, buttonType:'plain', visible:false, textColor:colorLight, text:pkg.ICON_HQ, tooltip:i18n('tip-select-hq')
            }, [{doActivated: () => {pkg.app.selectEventBox(self.selectedAgentModel.getHQEventModel());}}]);
            self.theVoidBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', visible:false, textColor:colorLight, text:pkg.ICON_THE_VOID, tooltip:i18n('tip-select-the-void')
            }, [{doActivated: () => {pkg.app.selectEventBox(rootModel.getTheVoidEventModel());}}]);
            
            new View(header, {width:padding}); // Spacer
            
            self.histPrevBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, disabled:true,
                text:pkg.ICON_NAV_BACK, fontSize:fontSizeLarge, 
                tooltip:i18n('tip-select-last-event')
            }, [{doActivated: function() {timelineView.navigateHistory(-1);}}]);
            self.scrollToBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, text:pkg.ICON_VIEW, disabled:true
            }, [{doActivated: () => {timelineView.scrollToEventBox(self.eventModel);}}]);
            self.histNextBtn = new SquareBtn(header, {
                y:1, buttonType:'plain', textColor:colorLight, disabled:true,
                text:pkg.ICON_NAV_FORWARD, fontSize:fontSizeLarge, 
                tooltip:i18n('tip-select-next-event')
            }, [{doActivated: function() {timelineView.navigateHistory(1);}}]);
            
            // The title opens the Event Brief.
            const titleView = self.getTitleView();
            titleView.setCursor('pointer');
            self.attachToDom(titleView, '_doTitleClick', 'click');
            
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding, whiteSpace:'normal', text:i18n('event-none-selected')
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {
                percentOfParentHeight:100, visible:false
            });
            
            // Time & Place, Status Bars
            self.eventFacts = new pkg.EventFacts(detailsContainer);
            
            new View(detailsContainer, {height:2}); // Spacer.
            
            // Agents
            let row = self.agentsRow = new ContainerRow(detailsContainer, {label:i18n('event-agent-activity')});
            const headerView = row.getHeaderView();
            new View(headerView, {layoutHint:1}); // Spacer
            self.followExitBtn = new AgentBtn(headerView, {y:1}, [AgentExitBtn]);
            self.agentsRowBtnSeparator = new PaddedPlainText(headerView, {paddingTop:5, text:ICON_SEPARATOR});
            self.deployAgentBtn = new AgentBtn(headerView, {y:1}, [{
                doActivated: () => {self.selectedAgentModel.doDeployToEvent(self.eventModel, self.deployAgentBtn);}
            }]);
            
            // Description
            row = new ContainerRow(detailsContainer, {label:i18n('event-historical-account'), layoutHint:3});
            self.descriptionMedia = new pkg.StandardMediaView(row, {roundedCorners:0});
            const descContainer = self._descContainer = new WideView(row, {}, [{
                setWidth: function(v) {
                    this.callSuper(v);
                    if (this.inited) {
                        const width = this.width;
                        for (const sv of this.getSubviews()) sv.setWidth(width);
                    }
                }
            }]);
            new SpacedLayout(descContainer, {axis:'y', spacing:1, collapseParent:true});
            
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
            this._updateForEventModel();
        },
        
        /*  The HQ and The Void buttons show once those Events are revealed, so a change to
            either updates them too. */
        notifyEventModelChanged: function(eventModel) {
            if (eventModel && (this.eventModel === eventModel || eventModel.isHQ() || eventModel.isTheVoid())) {
                this._updateForEventModel();
            }
        },
        
        notifyAgentSelectedChanged: function(agentModel) {
            this.selectedAgentModel = agentModel;
            // Redraws the agents too, since with none at the Event they preview what the 
            // selected agent could do. That also updates for the selected agent.
            this._updateForEventModel();
        },
        
        updateHistoryBtns: function(prevDisabled, prevBtnTooltip, nextDisabled, nextBtnTooltip) {
            const {histPrevBtn, histNextBtn} = this;
            histPrevBtn.setDisabled(prevDisabled);
            histPrevBtn.setTooltip(prevBtnTooltip);
            histNextBtn.setDisabled(nextDisabled);
            histNextBtn.setTooltip(nextBtnTooltip);
        },
        
        _updateForEventModel: debounceMicrotask(function() {
            const self = this,
                eventModel = self.eventModel,
                hasModel = eventModel != null;
            
            self.noSelectionTxt.setVisible(!hasModel);
            self.detailsContainer.setVisible(hasModel);
            self.scrollToBtn.setDisabled(!hasModel || eventModel.isHidden());
            
            if (hasModel) {
                Layout.incrementGlobalLock();
                
                const {theVoidBtn, agentsRow} = self;
                theVoidBtn.setDisabled(eventModel.isTheVoid());
                theVoidBtn.setVisible(!rootModel.getTheVoidEventModel().isHidden());
                
                self.eventFacts.update(eventModel);
                
                // Agents
                agentsRow.getContentView().destroyAllSubviews();
                let addedCount = 0;
                for (const agentModel of eventModel.getAgentModels()) {
                    new AgentRow(agentsRow, {agentModel, eventModel});
                    addedCount++;
                }
                if (addedCount === 0) new NoAgentsPreview(agentsRow, {agentModel:self.selectedAgentModel, eventModel});
                
                // Description
                self.descriptionMedia.setMedia(...eventModel.getMediaUrls());
                const descContainer = self._descContainer;
                descContainer.destroyAllSubviews();
                for (const part of eventModel.getFullDescriptionAsParts()) new DescPart(descContainer, {part});
                
                Layout.decrementGlobalLock();
            }
            
            self.updateTitle();
            self.updateForSelectedAgent();
        }),
        
        updateForSelectedAgent: debounceMicrotask(function() {
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
        }),
        
        updateTitle: function() {
            const eventName = this.eventModel?.name ?? i18n('txt-none');
            this.setTitle(
                pkg.ICON_EVENT + ' ' + wrapInStyledSpan(eventName, colorUltraLight),
                i18n('tip-open-event-brief-for', eventName)
            );
        },
        
        /** @private */
        _doTitleClick: function(_event) {
            if (this.eventModel) pkg.app.openEventBrief(this.eventModel);
        },
        
        setup: model => {
            rootModel = model;
        }
    });
})(tc);
