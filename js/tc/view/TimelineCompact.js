(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {min:mathMin, max:mathMax, floor:mathFloor} = Math,
        
        M = myt,
        {View, PaddedPlainText, PlainText, Selectable, debounce} = M,
        
        {
            SquareBtn, Btn, MiniStatBar,
            timeUtil:{format,formatApproxDuration},
            cfg:{
                STANDARD_DEBOUNCE_MILLIS, SPLINE_CURVATURE, 
                MAX_HISTORY_LENGTH, 
                TL_ROW_HEADER_WIDTH, TL_COL_WIDTH, TL_COL_HEADER_HEIGHT,
                TL_COL_SPACING, TL_CLICK_TO_DESELECT, TL_EVENT_BOX_HEIGHT, TL_EVENT_BOX_X_MARGIN,
                TL_EVENT_BOX_Y_MARGIN, TL_TICK_LINE_HEIGHT, 
                TL_GAP_ROW_HEIGHT, TL_GAP_MIN_MILLIS,
                TL_AGENT_TOKEN_FIRST_ROW_Y_OFFSET, TL_AGENT_TOKEN_SIZE, TL_AGENTS_PER_ROW
            },
            theme:{
                spacing, cornerRadius, btnHeight, 
                colorUltraLight, colorLight, colorMedium, colorMediumDark, colorDark, 
                colorUltraDark, colorMegaDark, colorBtn,
                fontSizeLarge, fontSizeVeryLarge
            },
            STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_PARADOX
        } = pkg,
        
        BOX_TOP_OFFSET = TL_EVENT_BOX_Y_MARGIN + TL_TICK_LINE_HEIGHT,
        EVENT_TIER_HEIGHT = TL_EVENT_BOX_HEIGHT + BOX_TOP_OFFSET + TL_EVENT_BOX_Y_MARGIN,
        
        // A spanning Event always reaches at least this far past the next tier's tick line, so
        // even a very small overlap is visibly a continuation rather than a near-miss.
        MIN_SPAN_INTO_TIER = BOX_TOP_OFFSET + 6,
        
        TICK_LABEL_ADJ = TL_TICK_LINE_HEIGHT + spacing,
        
        COL_WIDTH = TL_COL_WIDTH + 2*TL_EVENT_BOX_X_MARGIN,
        COL_EXTENT = COL_WIDTH + TL_COL_SPACING,
        
        BOX_SELECTED_OUTLINE = [1, 'solid', colorUltraLight],
        
        SPLINE_ID_PREFIX_AFFECT = 'affect-',
        SPLINE_ID_PREFIX_EXIT = 'exit-',
        
        Z_IDX_EVENT = 1,
        Z_IDX_AGENT = 3,
        Z_IDX_FLOW = 2,
        
        DEFAULT_STYLE = [{
            color:colorUltraLight, cap:null, thickness:1, startAngle:'vertical', endAngle:'vertical', 
            startCurvature:SPLINE_CURVATURE, endCurvature:SPLINE_CURVATURE, 
            endArrow:'triangle',
            startStub:6, endStub:6, startGap:2, endGap:2
        }],
        SELECTED_CONNECTION_STYLE = {
            color:colorUltraLight, cap:null, thickness:4, startAngle:'vertical', endAngle:'vertical', 
            startCurvature:SPLINE_CURVATURE, endCurvature:SPLINE_CURVATURE, 
            startStub:6, endStub:6, startGap:0, endGap:0
        },
        EXIT_STYLE = {
            color:colorBtn, cap:null, thickness:1, startAngle:'vertical', endAngle:'vertical', 
            dash:1,
            startCurvature:SPLINE_CURVATURE, endCurvature:SPLINE_CURVATURE, 
            endArrow:'triangle',
            startStub:6, endStub:6, startGap:2, endGap:2
        },
        
        ANIM_DURATION = 500,
        animateAttr = (target, attrName, newValue, easingFunction='inOutQuad', duration=ANIM_DURATION) => {
            if (target[attrName] !== newValue) {
                target.stopActiveAnimators(attrName);
                return target.animate({attribute:attrName, to:newValue, duration, easingFunction});
            }
        },
        animateAttrs = (target, attrs) => {
            for (const attrName in attrs) animateAttr(target, attrName, attrs[attrName]);
        },
        
        updateTimelineLayout = (timeline, isInitial) => {
            const {model, colHeaders, rowHeaders, flowLayer} = timeline,
                {events:orderedEvents, locations:locModels} = model.getOrderedEventsAndLocationsForTimeline();
            
            if (isInitial) {
                // Destroy and cleanup for a new timeline layout
                timeline.deselectAll();
                timeline.colsByLocId = {};
                timeline.boxesByEventId = {};
                timeline.ticksByTime = {};
                timeline.gapRowsByTime = {};
                timeline.tokensByAgentId = {};
                colHeaders.destroyAllSubviews();
                rowHeaders.destroyAllSubviews();
                flowLayer.destroyAllSubviews();
                
                // Special Handling for HQ and The Void
                orderedEvents.unshift(model.getHQEventModel(), model.getTheVoidEventModel());
            }
            
            
            // Location Columns //
            let xExtent = 0;
            const colHeadersHeight = colHeaders.height,
                colsByLocId = timeline.colsByLocId,
                locModelsLen = locModels.length,
                locColTargetXById = {};
            for (let i = 0; i < locModelsLen; i++) {
                const locModel = locModels[i],
                    locId = locModel.id;
                if (locModel.order >= 0) { // Locations with negative order are not shown.
                    const locCol = colsByLocId[locId];
                    locColTargetXById[locId] = xExtent;
                    if (locCol) {
                        animateAttrs(locCol, {x:xExtent});
                        locCol.setHeight(colHeadersHeight);
                    } else {
                        colsByLocId[locId] = new LocationColumn(colHeaders, {
                            x:xExtent, height:colHeadersHeight, model:locModel
                        });
                    }
                    xExtent += COL_EXTENT;
                }
            }
            
            
            // Tiers //
            
            // Start time and latest end of each visible tier, indexed by time ordering.
            const tierStarts = [],
                tierMaxEnds = [];
            for (const eventModel of orderedEvents) {
                const ordering = eventModel.getTimeOrdering();
                if (ordering >= 0) {
                    tierStarts[ordering] ??= eventModel.getStart();
                    tierMaxEnds[ordering] = mathMax(tierMaxEnds[ordering] ?? -Infinity, eventModel.getEnd());
                }
            }
            
            // Lay tiers out top to bottom. coveredUntil is the latest end of any Event so far, so 
            // an earlier long Event still in progress keeps a later stretch from counting as idle. 
            // When nothing is in progress for at least TL_GAP_MIN_MILLIS before the next tier, a 
            // compact gap row is inserted.
            const tierCount = tierStarts.length,
                tierYs = [],
                tierActiveDurations = [],
                wantedGaps = [];
            let yExtent = 0,
                coveredUntil = -Infinity;
            for (let i = 0; i < tierCount; i++) {
                const start = tierStarts[i],
                    nextStart = tierStarts[i + 1];
                tierYs[i] = yExtent;
                yExtent += EVENT_TIER_HEIGHT;
                coveredUntil = mathMax(coveredUntil, tierMaxEnds[i]);
                
                if (nextStart === undefined) {
                    tierActiveDurations[i] = coveredUntil - start;
                } else {
                    const gap = nextStart - coveredUntil;
                    if (gap >= TL_GAP_MIN_MILLIS) {
                        tierActiveDurations[i] = coveredUntil - start;
                        wantedGaps.push({time:coveredUntil, duration:gap, y:yExtent});
                        yExtent += TL_GAP_ROW_HEIGHT;
                    } else {
                        // Idle time too short for its own row is folded into this tier.
                        tierActiveDurations[i] = nextStart - start;
                    }
                }
            }
            
            
            // Events and Ticks //
            
            // The number of later tiers that start strictly before this Event ends. An Event 
            // ending exactly when the next tier starts does not extend into it. Events in the same 
            // Location never overlap (enforced at startup), so a tall box never covers another box.
            const countSpannedTiers = (ordering, end) => {
                let i = ordering + 1;
                while (i < tierCount && tierStarts[i] < end) i++;
                return i - ordering - 1;
            };
            
            let selectedBoxAnimatingToBounds; // Used to keep the selected EventBox in the viewport.
            
            const rowHeaderWidth = rowHeaders.width,
                {boxesByEventId, ticksByTime} = timeline,
                eventTargetXById = {},
                eventTargetYById = {};
            for (const eventModel of orderedEvents) {
                const startTime = eventModel.getStart(),
                    eventId = eventModel.id,
                    targetX = eventTargetXById[eventId] = (locColTargetXById[eventModel.getLocation()] ?? 0) + TL_EVENT_BOX_X_MARGIN,
                    
                    timelineOrdering = eventModel.getTimeOrdering(),
                    spannedTiers = timelineOrdering >= 0 ? countSpannedTiers(timelineOrdering, eventModel.getEnd()) : 0;
                
                // A spanning Event covers its middle tiers fully and its last tier in proportion 
                // to the share of that tier's time it occupies. Tiers have a fixed height whatever 
                // their duration, so the proportion is within the last tier only.
                let targetHeight = TL_EVENT_BOX_HEIGHT;
                if (spannedTiers > 0) {
                    const lastTier = timelineOrdering + spannedTiers,
                        lastTierY = tierYs[lastTier],
                        lastTierSpan = tierActiveDurations[lastTier],
                        fraction = lastTierSpan > 0 ? mathMin(1, (eventModel.getEnd() - tierStarts[lastTier]) / lastTierSpan) : 1,
                        endY = mathMin(
                            lastTierY + BOX_TOP_OFFSET + TL_EVENT_BOX_HEIGHT, // No lower than a normal box's bottom in that tier.
                            mathMax(lastTierY + MIN_SPAN_INTO_TIER, lastTierY + fraction * EVENT_TIER_HEIGHT)
                        );
                    targetHeight = endY - (tierYs[timelineOrdering] + BOX_TOP_OFFSET);
                }
                
                const targetY = eventTargetYById[eventId] = (timelineOrdering >= 0 ? tierYs[timelineOrdering] : -EVENT_TIER_HEIGHT) + BOX_TOP_OFFSET,
                    eventBox = boxesByEventId[eventId];
                if (eventBox) {
                    if (eventBox.isSelected()) {
                        selectedBoxAnimatingToBounds = {x:targetX, y:targetY, width:eventBox.width, height:targetHeight};
                    }
                    animateAttrs(eventBox, {x:targetX, y:targetY, height:targetHeight});
                    updateEventBox(eventBox);
                } else {
                    boxesByEventId[eventId] = new EventBox(flowLayer, {
                        x:targetX, y:targetY, height:targetHeight, timeline, model:eventModel
                    });
                }
                
                const tickTargetY = targetY - TL_EVENT_BOX_Y_MARGIN - TL_TICK_LINE_HEIGHT,
                    tick = ticksByTime[startTime];
                if (tick) {
                    animateAttrs(tick, {y:tickTargetY});
                } else {
                    ticksByTime[startTime] = new Tick(rowHeaders, {
                        timeline, time:startTime,
                        y:tickTargetY, 
                        width:rowHeaderWidth, height:TL_TICK_LINE_HEIGHT
                    });
                }
            }
            
            // Each tick shows how long something is in progress from its start.
            for (let i = 0; i < tierCount; i++) {
                ticksByTime[tierStarts[i]]?.setGap(tierActiveDurations[i]);
            }
            
            // Gap Rows: create or move the ones still wanted, destroy the rest.
            const gapRowsByTime = timeline.gapRowsByTime,
                nextGapRowsByTime = {};
            for (const {time, duration, y} of wantedGaps) {
                let gapRow = gapRowsByTime[time];
                if (gapRow) {
                    animateAttrs(gapRow, {y});
                } else {
                    gapRow = new GapRow(rowHeaders, {y, width:rowHeaderWidth, height:TL_GAP_ROW_HEIGHT});
                }
                gapRow.setDuration(duration);
                nextGapRowsByTime[time] = gapRow;
            }
            for (const time in gapRowsByTime) {
                if (!nextGapRowsByTime[time]) gapRowsByTime[time].destroy();
            }
            timeline.gapRowsByTime = nextGapRowsByTime;
            
            
            // Agents //
            const tokensByAgentId = timeline.tokensByAgentId,
                agentCountsByEventId = {};
            for (const agentModel of model.getAgentModelsAsList()) {
                const agentId = agentModel.id,
                    agentEventId = agentModel.getEvent(),
                    isHiddenAgent = agentModel.isHidden();
                let agentToken = tokensByAgentId[agentId];
                
                // Hidden and never shown so there's no token to create or animate.
                if (isHiddenAgent && !agentToken) continue;
                
                let agentCountForEvent = agentCountsByEventId[agentEventId] ?? 1,
                    targetX = eventTargetXById[agentEventId],
                    targetY = eventTargetYById[agentEventId],
                    isOffBoard = isHiddenAgent || targetX === undefined || targetY === undefined;
                
                const rowCount = mathFloor((agentCountForEvent - 1) / TL_AGENTS_PER_ROW); // zero based
                targetX += ((agentCountForEvent - 1) % TL_AGENTS_PER_ROW) * TL_AGENT_TOKEN_SIZE;
                targetY += TL_AGENT_TOKEN_FIRST_ROW_Y_OFFSET + rowCount * TL_AGENT_TOKEN_SIZE;
                if (agentToken) {
                    if (isOffBoard) {
                        if (!agentToken.offBoard) {
                            // Leaving to HQ or The Void
                            agentToken.setScaleX(1);
                            agentToken.setScaleY(1);
                            animateAttrs(agentToken, {opacity:0, scaleX:0, scaleY:0});
                        }
                    } else if (agentToken.offBoard) {
                        // Entering from HQ or The Void
                        agentToken.setX(targetX);
                        agentToken.setY(targetY);
                        agentToken.setOpacity(0);
                        agentToken.setScaleX(10);
                        agentToken.setScaleY(10);
                        animateAttrs(agentToken, {opacity:1});
                        animateAttr(agentToken, 'scaleX', 1, 'outBounce');
                        animateAttr(agentToken, 'scaleY', 1, 'outBounce');
                    } else {
                        animateAttrs(agentToken, {x:targetX, y:targetY});
                    }
                } else {
                    agentToken = tokensByAgentId[agentId] = new AgentToken(flowLayer, {
                        x:targetX, y:targetY, timeline, model:agentModel
                    });
                    if (isOffBoard || agentModel.getEventModel().isHidden()) {
                        isOffBoard = true;
                        
                        // Start in the same state as a token that has left the board, so it isn't 
                        // drawn at a meaningless position and the "Entering" animation works when 
                        // the Agent is deployed.
                        agentToken.setOpacity(0);
                        agentToken.setScaleX(0);
                        agentToken.setScaleY(0);
                    }
                }
                agentToken.offBoard = isOffBoard;
                if (!isHiddenAgent) agentCountsByEventId[agentEventId] = agentCountForEvent + 1;
            }
            
            
            // Update for new extents
            const scrollToken = timeline.scrollToken;
            scrollToken.setX(TL_ROW_HEADER_WIDTH + xExtent - scrollToken.width);
            scrollToken.setY(TL_COL_HEADER_HEIGHT + yExtent - scrollToken.height);
            colHeaders.setWidth(xExtent);
            rowHeaders.setHeight(yExtent);
            flowLayer.setWidth(xExtent);
            flowLayer.setHeight(yExtent);
            
            // Sometimes the animation pushed the selected box off-screen.
            if (selectedBoxAnimatingToBounds) {
                timeline.scrollToBoundingBox(selectedBoxAnimatingToBounds);
            }
            
            // Attempt to select an EventBox if the previous attempt failed. This is result of
            // selection occuring while updateTimeLineLayoutDebounced is still delayed.
            if (timeline._eventModelOrIdToSelect) {
                timeline.doSelectEvent(timeline._eventModelOrIdToSelect);
            }
        },
        
        updateTimeLineLayoutDebounced = debounce(updateTimelineLayout, STANDARD_DEBOUNCE_MILLIS),
        
        // History //
        pushOntoHistory = (timeline, eventId) => {
            if (eventId && !timeline._noHistUpdate) {
                const hist = timeline._hist,
                    idx = timeline._histIdx;
                if (eventId !== hist[idx]) {
                    hist.length = idx + 1; // Truncate to current
                    hist.push(eventId);
                    
                    // Keep History from growing arbitrarily long
                    if (hist.length > MAX_HISTORY_LENGTH) {
                        hist.shift();
                    } else {
                        timeline._histIdx++;
                    }
                    
                    updateHistoryBtns(timeline);
                }
            }
        },
        
        updateHistoryBtns = timeline => {
            const {histPrevBtn, histNextBtn, _hist:hist, _histIdx:idx} = timeline,
                prevDisabled = idx < 1,
                nextDisabled = idx === hist.length - 1,
                prevBtnTooltip = prevDisabled ? 'No last Event to select.' : timeline.model.getEventModel(hist[idx - 1])?.name,
                nextBtnTooltip = nextDisabled ? 'No next Event to select.' : timeline.model.getEventModel(hist[idx + 1])?.name;
            histPrevBtn.setDisabled(prevDisabled);
            histPrevBtn.setTooltip(prevBtnTooltip);
            
            histNextBtn.setDisabled(nextDisabled);
            histNextBtn.setTooltip(nextBtnTooltip);
            
            pkg.app.getEventDetailsView().updateHistoryBtns(prevDisabled, prevBtnTooltip, nextDisabled, nextBtnTooltip);
        },
        
        
        // Event Box //
        refreshConnectionsForSelection = eventBox => {
            const selected = eventBox.selected;
            for (const connection of eventBox.timeline.getAffectiveConnectionsForEventBox(eventBox)) {
                connection.setStyle(connection.endView.selected || connection.startView.selected ? SELECTED_CONNECTION_STYLE : null);
                connection[connection.startView === eventBox ? 'endView' : 'startView'].setAdjacentIsSelected(selected);
            }
        },
        
        updateEventBox = eventBox => {
            const {timeline, model, _label, _historicityBar, _attestationBar, _paradoxBar} = eventBox,
                hidden = model.isHidden();
            eventBox.eventId = model.id;
            
            _label.setText(model.name || '');
            _historicityBar.updateForStat(model[STAT_ID_HISTORICITY]);
            _attestationBar.updateForStat(model[STAT_ID_ATTESTATION]);
            _paradoxBar.updateForStat(model[STAT_ID_PARADOX]);
            
            eventBox.setTooltip(_label.text);
            eventBox.setVisible(!hidden);
            
            // Update connections between boxes
            if (!hidden) {
                const endId = model.id,
                    flowLayer = timeline.flowLayer;
                for (const eventModel of model.getPrecursors()) {
                    const startId = eventModel.id,
                        startBox = timeline.boxesByEventId[startId];
                    if (startBox) {
                        const startEventModel = startBox.model,
                            hideAffectedBy = model.isAffectedByHidden(startEventModel);
                        if (!hideAffectedBy && !startEventModel.isHidden()) {
                            const splineId = SPLINE_ID_PREFIX_AFFECT + startId + '-' + endId,
                                existingConnection = flowLayer.getSpline(splineId);
                            if (!existingConnection) {
                                flowLayer.connect({
                                    splineId,
                                    start:{view:startBox, side:'bottom'},
                                    end:{view:eventBox, side:'top'}
                                });
                            }
                        }
                    }
                }
            }
            
            refreshConnectionsForSelection(eventBox);
        },
        
        /*  Shows the exit splines that touch the selected Event: its own exits and the exits from 
            other Events that lead to it. Each route has a single spline id, exit-<from>-<to>, so a 
            route is drawn once no matter which end is selected. Reconciles against what is 
            currently drawn, so routes that become hidden are removed. */
        refreshExitSplines = debounce(timeline => {
            const flowLayer = timeline.flowLayer,
                existing = timeline._exitSplinesById ?? {},
                newExitSplinesById = {},
                selectedModel = timeline.getSelectedEventBox()?.model;
            
            if (selectedModel) {
                const boxesByEventId = timeline.boxesByEventId;
                for (const exitModel of selectedModel.getVisibleExitAndEntrances()) {
                    const fromModelId = exitModel.event.id,
                        toModelId = exitModel.getToEventModel().id,
                        splineId = SPLINE_ID_PREFIX_EXIT + fromModelId + '-' + toModelId;
                    if (!newExitSplinesById[splineId]) {
                        newExitSplinesById[splineId] = existing[splineId] ?? flowLayer.connect({
                            splineId,
                            start:{view:boxesByEventId[fromModelId], side:'bottom', position:'85%'},
                            end:  {view:boxesByEventId[toModelId],   side:'top',    position:'35%'},
                            style:EXIT_STYLE
                        });
                    }
                }
            }
            
            for (const splineId in existing) {
                if (!newExitSplinesById[splineId]) flowLayer.disconnect(splineId);
            }
            timeline._exitSplinesById = newExitSplinesById;
        }, STANDARD_DEBOUNCE_MILLIS),
        
        EventBox = new JSClass('EventBox', M.SimpleButton, {
            include: [Selectable],
            
            initNode: function(parent, attrs) {
                const self = this,
                    width = attrs.width ??= TL_COL_WIDTH;
                
                attrs.activeColor ??= colorMegaDark;
                attrs.hoverColor ??= colorUltraDark;
                attrs.readyColor ??= colorDark;
                attrs.focusable = false;
                
                attrs.height ??= TL_EVENT_BOX_HEIGHT;
                attrs.roundedCorners ??= cornerRadius;
                
                self.timeline = attrs.timeline;
                delete attrs.timeline;
                
                attrs.zIndex = Z_IDX_EVENT;
                
                self.callSuper(parent, attrs);
                
                // Setup debounced revalidateForEvent so it is unique per instance.
                self.revalidateForEvent = debounce(self._revalidateForEvent, STANDARD_DEBOUNCE_MILLIS);
                
                (self._label = new PaddedPlainText(self, {
                    y:spacing, width:width, paddingLeft:4, paddingRight:4
                })).enableEllipsis();
                
                const barWidth = width - 2*spacing;
                self._historicityBar = new pkg.HistoricityBar(self, {x:spacing, y:17, width:barWidth}, [MiniStatBar]);
                self._attestationBar = new pkg.AttestationBar(self, {x:spacing, y:21, width:barWidth}, [MiniStatBar]);
                self._paradoxBar = new pkg.ParadoxBar(self, {x:spacing, y:25, width:barWidth}, [MiniStatBar]);
                
                updateEventBox(self);
            },
            
            setModel: function(model) {
                if (this.model !== model) {
                    this.releaseConstraint('_updateForModelChanges');
                    this.set('model', model, true);
                    if (this.model) this.constrain('_updateForModelChanges', [this.model, 'updated']);
                    if (this.inited) updateEventBox(this);
                }
            },
            
            setSelected: function(v) {
                this.callSuper(v);
                this.updateUI();
                
                this.bringToFront();
                refreshConnectionsForSelection(this);
            },
            
            setAdjacentIsSelected: function(adjacentIsSelected) {
                this.set('adjacentIsSelected', adjacentIsSelected, true);
                this.updateUI();
            },
            
            doActivated: function() {
                if (TL_CLICK_TO_DESELECT) {
                    this.timeline[this.selected ? 'deselect' : 'select'](this);
                } else {
                    if (!this.selected) this.timeline.select(this);
                }
            },
            
            updateUI: function() {
                this.callSuper();
                
                this.setOutline(this.selected ? BOX_SELECTED_OUTLINE : null);
                
                let barBgColor;
                if (this.selected) {
                    this.setBgColor(colorLight);
                    this.setTextColor(colorDark);
                    barBgColor = colorMedium;
                } else if (this.adjacentIsSelected) {
                    this.setBgColor(colorMedium);
                    this.setTextColor(null);
                    barBgColor = colorMediumDark;
                } else {
                    this.setTextColor(null);
                    barBgColor = colorMegaDark;
                }
                
                for (const sv of [this._historicityBar, this._attestationBar, this._paradoxBar]) {
                    sv?.setBgColor(barBgColor);
                }
            },
            
            _updateForModelChanges: function() {
                if (this.inited) this.revalidateForEvent();
            },
            
            _revalidateForEvent: function() {
                const {timeline, model:eventModel} = this;
                
                updateEventBox(this);
                refreshExitSplines(timeline);
                
                for (const descEventModel of eventModel.getDescendants()) {
                    const descEventBox = timeline.getEventBox(descEventModel);
                    if (descEventBox) updateEventBox(descEventBox);
                }
            }
        }),
        
        // Agent //
        AgentToken = new JSClass('AgentToken', pkg.StatusAgentMarker, {
            include: [M.TransformSupport],
            
            initNode: function(parent, attrs) {
                const self = this;
                
                attrs.size ??= TL_AGENT_TOKEN_SIZE;
                
                self.timeline = attrs.timeline;
                delete attrs.timeline;
                
                attrs.zIndex = Z_IDX_AGENT;
                self.callSuper(parent, attrs);
                
                // Setup debounced revalidateForAgent so it is unique per instance.
                self.revalidateForAgent = debounce(self._revalidateForAgent, STANDARD_DEBOUNCE_MILLIS);
            },
            
            setModel: function(model) {
                if (this.model !== model) {
                    this.releaseConstraint('_updateForModelChanges');
                    this.set('model', model, true);
                    if (this.model) this.constrain('_updateForModelChanges', [this.model, 'updated']);
                }
            },
            
            _updateForModelChanges: function() {
                if (this.inited) this.revalidateForAgent();
            },
            
            _revalidateForAgent: function() {
                this._updateForAgentModel();
            },
            
            doActivated: function() {
                this.callSuper();
                pkg.app.selectEventBox(this.model.getEvent());
            }
        }),
        
        
        // Tick //
        Tick = new JSClass('Tick', View, {
            initNode: function(parent, attrs) {
                const time = this.time = attrs.time,
                    timeline = this.timeline = attrs.timeline;
                delete attrs.time;
                delete attrs.timeline;
                
                attrs.bgColor ??= colorUltraDark;
                
                this.callSuper(parent, attrs);
                
                const labelWidth = TL_ROW_HEADER_WIDTH - 2*TICK_LABEL_ADJ;
                this._label = new PlainText(this, {
                    y:TICK_LABEL_ADJ, width:labelWidth, textAlign:'right', 
                    text:format(time, timeline.scale)
                });
                this._gapLabel = new PlainText(this, {
                    y:35, width:labelWidth, textAlign:'center', 
                    fontSize:fontSizeVeryLarge, textColor:colorMediumDark
                });
            },
            
            /*  How long something is in progress from this tick: until the next tick, or until every
                Event running at this point has ended when an idle gap row follows. */
            setGap: function(millis) {
                this._gapLabel.setText(millis > 0 ? formatApproxDuration(millis) : '');
            }
        }),
        
        
        // Gap Row //
        GapRow = new JSClass('GapRow', View, {
            initNode: function(parent, attrs) {
                attrs.bgColor ??= '#fff3';
                
                this.callSuper(parent, attrs);
                this._label = new PlainText(this, {
                    y:2, width:TL_ROW_HEADER_WIDTH - 2*TICK_LABEL_ADJ, textAlign:'center',
                    textColor:colorMediumDark
                });
            },
            
            setDuration: function(millis) {
                this._label.setText(formatApproxDuration(millis));
            }
        }),
        
        
        // Location Column //
        updateLocationColumn = locationColumn => {
            const {model, _label, _photo} = locationColumn,
                label = model.name || '';
            locationColumn.setBgColor(model.color || 'transparent');
            locationColumn.setTextColor(model.textColor || null);
            _label.setText(label);
            _label.setTooltip(label);
            _photo.setImageUrl(pkg.IMAGE_ROOT + 'location/' + model.id + '.jpg');
        },
        
        LocationColumn = new JSClass('LocationColumn', View, {
            initNode: function(parent, attrs) {
                const self = this,
                    width = attrs.width ??= COL_WIDTH;
                self.callSuper(parent, attrs);
                
                self._photo = new View(self, {
                    width, height:TL_COL_HEADER_HEIGHT, imageSize:'contain'
                }, [M.ImageSupport]);
                
                (self._label = new Btn(self, {
                    width:width + 2*spacing, height:TL_COL_HEADER_HEIGHT, buttonType:'locHdr',
                    roundedCorners:0, paddingLeft:spacing, paddingRight:spacing
                }, [{
                    doActivated:() => pkg.app.openAreaBrief(self.model)
                }])).enableEllipsis();
                
                updateLocationColumn(self);
            },
            
            setModel: function(model) {
                if (this.model !== model) {
                    this.set('model', model, true);
                    if (this.inited) updateLocationColumn(this);
                }
            }
        });
    
    pkg.TimelineCompact = new JSClass('TimelineCompact', pkg.Panel, {
        include: [M.SelectionManager],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self._hist = [];
            self._histIdx = -1;
            
            self.timelineReady = false;
            self.colsByLocId = {};
            self.boxesByEventId = {};
            self.ticksByTime = {};
            self.gapRowsByTime = {};
            self.tokensByAgentId = {};
            
            attrs.maxSelected = 1;
            attrs.itemSelectionId = 'eventId';
            
            self.callSuper(parent, attrs);
            
            self.getContentView().setBgColor(colorMedium);
            
            // Build UI
            const header = self.getHeaderView();
            
            const scoreView = self.scoreView = new pkg.LabeledValue(header, {label:'Score', paddingRight:32}, [{
                update: function(_event) {this.callSuper(pkg.model.score.toLocaleString());}
            }]);
            scoreView.attachTo(pkg.model, 'update', 'score');
            
            self.timelineParadoxBar = new pkg.ParadoxBar(header, {
                valign:'middle', labelTemplate:'Timeline {label}'
            }, [pkg.BigStatBar]);
            
            const 
                scrollCaptureView = self.scrollCaptureView = new View(self, {overflow:'auto'}, [{
                    _handleScroll: event => {
                        const {x, y} = M.ScrollObservable.getScrollFromEvent(event),
                            negX = -x,
                            negY = -y;
                        colHeaders.getODS().transform = 'translate3d(' + negX + 'px,0px,0)';
                        rowHeaders.getODS().transform = 'translate3d(0px,' + negY + 'px,0)';
                        flowLayer.getODS().transform = 'translate3d(' + negX + 'px,' + negY + 'px,0)';
                    }
                }]),
                
                stickyView = self.stickyView = new View(scrollCaptureView, {}),
                
                colHeadersContainer = self.colHeadersContainer = new View(stickyView, {x:TL_ROW_HEADER_WIDTH, overflow:'hidden'}),
                colHeaders = self.colHeaders = new View(colHeadersContainer, {textColor:colorUltraDark}),
                
                rowHeadersContainer = self.rowHeadersContainer = new View(stickyView, {y:TL_COL_HEADER_HEIGHT, overflow:'hidden'}),
                rowHeaders = self.rowHeaders = new View(rowHeadersContainer, {textColor:colorUltraDark}),
                
                flowContainer = self.flowContainer = new View(stickyView, {x:TL_ROW_HEADER_WIDTH, y:TL_COL_HEADER_HEIGHT, overflow:'hidden'}),
                flowLayer = self.flowLayer = new M.SplineFlow(flowContainer, {defaultStyle:DEFAULT_STYLE}),
                flowSVG = flowLayer.getSVG();
            flowSVG.style.zIndex = Z_IDX_FLOW;
            flowSVG.style.position = 'absolute';
            
            stickyView.getIDS().position = 'sticky';
            scrollCaptureView.addDomClass('hideScrollbar');
            
            scrollCaptureView.getIDS().overscrollBehavior = 'none';
            self.scrollToken = new View(scrollCaptureView, {width:1, height:1});
            scrollCaptureView.attachToDom(scrollCaptureView, '_handleScroll', 'scroll');
            
            const hLine = self.hLine = new View(self, {y:TL_COL_HEADER_HEIGHT, height:1, bgColor:colorUltraDark}),
                vLine = self.vLine = new View(self, {x:TL_ROW_HEADER_WIDTH - 1, width:1, bgColor:colorUltraDark});
            hLine.getIDS().pointerEvents = 'none';
            vLine.getIDS().pointerEvents = 'none';
            
            // Selected Event History Nav
            const btnY = (TL_COL_HEADER_HEIGHT - btnHeight) / 2;
            self.histPrevBtn = new SquareBtn(self, {
                x:37, y:btnY, buttonType:'plain', disabled:true,
                text:pkg.ICON_NAV_BACK, fontSize:fontSizeLarge,
                tooltip:'Select the last Event you viewed.'
            }, [{doActivated: function() {self.navigateHistory(-1);}}]);
            self.histNextBtn = new SquareBtn(self, {
                x:62, y:btnY, buttonType:'plain', disabled:true,
                text:pkg.ICON_NAV_FORWARD, fontSize:fontSizeLarge,
                tooltip:'Select the next Event you viewed.'
            }, [{doActivated: function() {self.navigateHistory(1);}}]);
            
            self.ready = true;
            
            // Apply Size
            self.setWidth(self.width);
            self.setHeight(self.height);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setWidth: function(v) {
            const self = this;
            self.callSuper(v);
            if (self.ready) {
                const {rowHeaders, rowHeadersContainer, colHeadersContainer, flowContainer, scrollCaptureView, hLine} = self,
                    width = self.getContentView().width;
                flowContainer.setWidth(width - flowContainer.x);
                scrollCaptureView.setWidth(width);
                hLine.setWidth(width);
                colHeadersContainer.setWidth(width - colHeadersContainer.x);
                rowHeadersContainer.setWidth(width);
                rowHeaders.setWidth(width);
                for (const tick of rowHeaders.getSubviews()) tick.setWidth(width);
            }
        },
        
        setHeight: function(v) {
            const self = this;
            self.callSuper(v);
            if (self.ready) {
                const {rowHeadersContainer, colHeaders, colHeadersContainer, flowContainer, scrollCaptureView, vLine} = self,
                    height = self.getContentView().height;
                flowContainer.setHeight(height - flowContainer.y);
                scrollCaptureView.setHeight(height);
                vLine.setHeight(height);
                rowHeadersContainer.setHeight(height - rowHeadersContainer.y);
                colHeadersContainer.setHeight(height);
                colHeaders.setHeight(height);
                for (const loc of colHeaders.getSubviews()) loc.setHeight(height);
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /** @overrides SelectionManager */
        getManagedItems: function() {
            const retval = [], 
                svs = this.flowLayer.getSubviews();
            let i = svs.length;
            while (i) {
                const sv = svs[--i];
                if (sv.isA(Selectable)) retval.push(sv);
            }
            return retval;
        },
        
        getSelectedEventBox: function() {
            return this.getSelected()[0];
        },
        
        /** @overrides SelectionManager */
        doSelected: function() {
            const selectedEvent = this.getSelectedEventBox();
            refreshExitSplines(this);
            this.fireEvent('selectionChanged', selectedEvent);
            pushOntoHistory(this, selectedEvent.model.id);
            
            this.scrollToEventBox(selectedEvent);
        },
        
        /** @overrides SelectionManager */
        doDeselected: function() {
            refreshExitSplines(this);
            this.fireEvent('selectionChanged', this.getSelectedEventBox());
        },
        
        getConnectionsForEventBox: function(eventBox, filter) {
            const retval = this.flowLayer.getConnections(eventBox);
            return filter ? retval.filter(filter) : retval;
        },
        
        getAffectiveConnectionsForEventBox: function(eventBox) {
            return this.getConnectionsForEventBox(eventBox, connection => connection.splineId.startsWith(SPLINE_ID_PREFIX_AFFECT));
        },
        
        getExitConnectionsForEventBox: function(eventBox) {
            // Only fetch exit type splines that originate from the provided eventBox.
            const matchStr = SPLINE_ID_PREFIX_EXIT + eventBox.model.id + '-';
            return this.getConnectionsForEventBox(
                eventBox, 
                connection => connection.splineId.startsWith(matchStr)
            );
        },
        
        getEventBox: function(eventModelOrId) {
            if (eventModelOrId) return this.boxesByEventId[typeof eventModelOrId === 'string' ? eventModelOrId : eventModelOrId.id];
        },
        
        doSelectEvent: function(eventModelOrId) {
            const eventBox = this.getEventBox(eventModelOrId);
            if (eventBox) {
                this._eventModelOrIdToSelect = null;
                this.select(eventBox);
            } else {
                this._eventModelOrIdToSelect = eventModelOrId;
            }
        },
        
        getAgentToken: function(agentModelOrId) {
            if (agentModelOrId) return this.tokensByAgentId[typeof agentModelOrId === 'string' ? agentModelOrId : agentModelOrId.id];
        },
        
        // History //
        navigateHistory: function(adj) {
            const newIdx = this._histIdx + adj,
                eventIdToSelect = this._hist[newIdx];
            if (eventIdToSelect) {
                this._noHistUpdate = true;
                pkg.app.selectEventBox(eventIdToSelect);
                this._noHistUpdate = false;
                this._histIdx = newIdx;
                updateHistoryBtns(this);
            }
        },
        
        // Scrolling //
        getBoundingBoxForCurrentScrollPosition: function() {
            const ide = this.scrollCaptureView.getIDE(),
                flowContainer = this.flowContainer;
            return {
                x:ide.scrollLeft,
                y:ide.scrollTop,
                width:flowContainer.width,
                height:flowContainer.height
            };
        },
        
        scrollToEventBox: function(thingy, smoothly=true) {
            const eventBox = thingy?.isA?.(EventBox) ? thingy : this.getEventBox(thingy);
            if (eventBox?.visible) this.scrollToBoundingBox(eventBox, smoothly);
        },
        
        scrollToBoundingBox: function(boundingBox, smoothly=true) {
            const flowContainer = this.flowContainer;
            this.scrollCaptureView.scrollXYTo(
                boundingBox.x - (flowContainer.width - boundingBox.width) / 2, 
                boundingBox.y - (flowContainer.height - boundingBox.height) / 2, 
                true, smoothly
            );
        },
        
        scrollToLocation: function(locId, smoothly=true) {
            const locationColumn = this.colsByLocId[locId];
            if (locationColumn) this.scrollCaptureView.scrollXTo(locationColumn.x, true, smoothly);
        },
        
        scrollToTime: function(millis, smoothly=true) {
            const tick = this.ticksByTime[millis];
            if (tick) this.scrollCaptureView.scrollYTo(tick.y, true, smoothly);
        },
        
        // Setup //
        setup: function(model) {
            this.model = model;
            this.timelineParadoxBar.watchStatModel(model[STAT_ID_PARADOX]);
            
            updateTimelineLayout(this, true);
            this.timelineReady = true;
        },
        
        notifyEventVisibilityChange: function(_eventModel) {
            if (this.timelineReady) updateTimeLineLayoutDebounced(this);
        },
        
        notifyAgentLocOrVisChange: function(_agentModel) {
            if (this.timelineReady) updateTimeLineLayoutDebounced(this); // FIXME: agent only update option?
        }
    });
})(tc);