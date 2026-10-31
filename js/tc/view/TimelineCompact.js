(pkg => {
    'use strict';
    
    let isInitial = true; // Indicates this is the first time the timeline is being layed out.
    
    const JSClass = JS.Class,
        
        {PI, min:mathMin, max:mathMax, floor:mathFloor, sin:mathSin, random:mathRandom} = Math,
        TWO_PI = 2*PI,
        
        M = myt,
        {Text, View, PaddedPlainText, PlainText, Selectable, debounce} = M,
        
        {
            SquareBtn, Btn, MiniStatBar, settings, SETTING_SHOW_VISITED_BORDERS, SETTING_SHOW_AGENT_HISTORY,
            SETTING_ANIMATE_TIMELINE_UNREST,
            hashToRange,
            timeUtil:{formatApproxDuration,formatForTimeline},
            cfg:{
                STANDARD_DEBOUNCE_MILLIS, SPLINE_CURVATURE, 
                TL_SPLINE_DRIFT_BASE_DEGREES, TL_SPLINE_DRIFT_MAX_DEGREES, 
                TL_EVENT_DRIFT_X_MAX_PIXELS, TL_EVENT_DRIFT_Y_MAX_PIXELS,
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
                colorUltraDark, colorMegaDark, colorBtnLight,
                colorParadox, colorParadoxDark, colorParadoxLight,
                fontSizeLarge
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
        VISITED_COLOR = '#6cf',
        BOX_VISITED_LINE_THICKNESS = 1,
        BOX_VISITED_OUTLINE = [BOX_VISITED_LINE_THICKNESS, 'solid', VISITED_COLOR],
        
        // Marks the Event boxes the current Operation's Objectives depend on. See index.html.
        DOM_CLASS_ENTANGLED = 'entangled',
        
        SPLINE_ID_PREFIX_AFFECT = 'affect-',
        SPLINE_ID_PREFIX_EXIT = 'exit-',
        SPLINE_ID_PREFIX_VISIT = 'visit-',
        
        Z_IDX_EVENT = 1,
        Z_IDX_FLOW = 2,
        Z_IDX_AGENT = 3,
        
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
            color:colorBtnLight, cap:null, thickness:1, startAngle:'vertical', endAngle:'vertical', 
            startCurvature:SPLINE_CURVATURE, endCurvature:SPLINE_CURVATURE, 
            endArrow:'triangle',
            startStub:3, endStub:3, startGap:2, endGap:2
        },
        // The selected Agent's path from Event to Event, leaving each box's right edge and 
        // arriving at the next one's left.
        VISIT_STYLE = {
            color:VISITED_COLOR, cap:null, thickness:BOX_VISITED_LINE_THICKNESS,
            startCurvature:2*SPLINE_CURVATURE, endCurvature:2*SPLINE_CURVATURE, 
            endArrow:'triangle',
            startStub:6, endStub:6, startGap:BOX_VISITED_LINE_THICKNESS, endGap:BOX_VISITED_LINE_THICKNESS
        },
        // Thicker to or from the selected Event, as its causator splines are, so the way in and
        // out can be followed through a busy history.
        SELECTED_VISIT_THICKNESS = 3,
        SELECTED_VISIT_STYLE = {...VISIT_STYLE, thickness:SELECTED_VISIT_THICKNESS},
        // Visit styles for time travel are dashed.
        VISIT_STYLE_TIME_TRAVEL = {...VISIT_STYLE, dash:[BOX_VISITED_LINE_THICKNESS,BOX_VISITED_LINE_THICKNESS]},
        SELECTED_VISIT_STYLE_TIME_TRAVEL = {...SELECTED_VISIT_STYLE, dash:[SELECTED_VISIT_THICKNESS,SELECTED_VISIT_THICKNESS]},
        
        // Where a visit's arrows meet its box, as a percent of the box's height from the top:
        // the first visit at 55%, and each later one 5% lower, down to 95%.
        getVisitPosition = visitIdx => mathMin(55 + 5*visitIdx, 95) + '%',
        
        ANIM_DURATION = 500,
        animateAttr = (target, attrName, newValue, easingFunction='inOutQuad', duration=ANIM_DURATION) => {
            if (target[attrName] !== newValue) {
                target.stopActiveAnimators(attrName);
                if (isInitial) {
                    target.set(attrName, newValue);
                } else {
                    target.animate({attribute:attrName, to:newValue, duration, easingFunction});
                }
            }
        },
        animateAttrs = (target, attrs) => {
            for (const attrName in attrs) animateAttr(target, attrName, attrs[attrName]);
        },
        
        SCROLL_TO_DEBOUNCE_MILLIS = 100,
        scrollToBoundingBox = debounce((timeline, boundingBox, smoothly=true) => {
            const flowContainer = timeline.flowContainer;
            timeline.scrollCaptureView.scrollXYTo(
                boundingBox.x - (flowContainer.width - boundingBox.width) / 2, 
                boundingBox.y - (flowContainer.height - boundingBox.height) / 2, 
                true, smoothly
            );
        }, SCROLL_TO_DEBOUNCE_MILLIS),
        
        // Value Change Animation //
        /*  When a Value of an Event changes, its box pops: it grows, then bounces back. Boxes take 
            turns in the order their Values changed, so a change that cascades through the 
            timeline reads like a row of dominoes falling. A box that's animating or already 
            waiting its turn isn't queued again, e.g. when several of its Values change at once, 
            and boxes that are hidden by the time their turn comes are skipped. */
        VALUE_CHANGE_SCALE = 1.5,
        VALUE_CHANGE_MILLIS = 500,
        VALUE_CHANGE_MILLIS_CUTOFF = mathMax(50, SCROLL_TO_DEBOUNCE_MILLIS),
        valueChangeAnims = {queue:[], current:null, whenDone:[]},
        runNextValueChangeAnim = () => {
            const [eventBox, duration] = valueChangeAnims.queue.shift() ?? [null, 0];
            valueChangeAnims.current = eventBox;
            if (!eventBox) {
                // Scroll back to the currently selected event after animation.
                pkg.app.scrollToSelectedEvent(true, false);
                
                // Run whatever was waiting for the animations to finish. Taken first since a
                // callback could start more animations.
                const whenDone = valueChangeAnims.whenDone.splice(0);
                for (const func of whenDone) func();
            } else if (eventBox.destroyed || !eventBox.visible || duration <= VALUE_CHANGE_MILLIS_CUTOFF) {
                runNextValueChangeAnim();
            } else {
                // Scroll to each event immediately before animating.
                eventBox.timeline.scrollToEventBox(eventBox, false);
                
                // The from values are needed because there's no "scale" attribute to read them from,
                // just scaleX and scaleY.
                eventBox.animate({
                    attribute:'scale', from:1, to:VALUE_CHANGE_SCALE, duration, easingFunction:'wiggle',
                    callback:() => {
                        eventBox.setScale(1);
                        runNextValueChangeAnim();
                    }
                });
            }
        },
        queueValueChangeAnim = eventBox => {
            const {queue, current} = valueChangeAnims;
            if (eventBox !== current && !queue.some(([queuedBox]) => queuedBox === eventBox)) {
                const newLen = queue.length + 1,
                    duration = VALUE_CHANGE_MILLIS *  4 / (newLen + 3); // About 37 animations by the time it reaches 50 millis.
                queue.push([eventBox, duration]);
                if (!current) runNextValueChangeAnim();
            }
        },
        
        updateTimeLineLayoutDebounced = debounce(timeline => {
            const {model, colHeaders, rowHeaders, flowLayer} = timeline,
                {events:orderedEvents, locations:locModels} = model.getOrderedEventsAndLocationsForTimeline();
            
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
            flowLayer.setWidth(mathMax(xExtent, flowLayer.parent.width));
            flowLayer.setHeight(mathMax(yExtent, flowLayer.parent.height));
            
            // Sometimes the animation pushed the selected box off-screen.
            if (selectedBoxAnimatingToBounds) {
                scrollToBoundingBox(timeline, selectedBoxAnimatingToBounds);
            }
            
            // Attempt to select an EventBox if the previous attempt failed. This is result of
            // selection occuring while updateTimeLineLayoutDebounced is still delayed.
            if (timeline._eventModelOrIdToSelect) {
                timeline.doSelectEvent(timeline._eventModelOrIdToSelect);
            }
            
            updateVisitedStatusForSelectedAgent(timeline);
            
            isInitial = false;
        }, STANDARD_DEBOUNCE_MILLIS),
        
        /*  Outlines the Events the selected Agent has visited, and draws arrows from each to the
            next, in the order the Agent went, as the settings allow. An arrow to or from an Event
            without a visible box, e.g. HQ, is left out, and one to or from the selected Event is
            thicker. */
        updateVisitedStatusForSelectedAgent = debounce(timeline => {
            const {selectedAgentModel, boxesByEventId, flowLayer} = timeline,
                isPlayerControlled = !!selectedAgentModel?.isPlayerControlled(),
                history = selectedAgentModel?.getVisitHistory() ?? [],
                eventsVisited = new Set(settings.get(SETTING_SHOW_VISITED_BORDERS) ? history.map(visit => visit.event) : []);
            
            // Show visited for player controlled Agents only
            for (const eventId in boxesByEventId) {
                const eventBox = boxesByEventId[eventId];
                eventBox.setVisited(isPlayerControlled && eventsVisited.has(eventBox.model));
            }
            
            // Clear them away before drawing again.
            for (const splineId of timeline._visitSplineIds ?? []) flowLayer.disconnect(splineId);
            
            // Drawn afresh each time, since a revisit moves where later arrows meet a box.
            if (isPlayerControlled) {
                const visitSplineIds = timeline._visitSplineIds = [],
                    visitCounts = new Map();
                let prev = null;
                for (const {event:eventModel, isTimeTravel} of settings.get(SETTING_SHOW_AGENT_HISTORY) ? history : []) {
                    const visitIdx = visitCounts.get(eventModel) ?? 0,
                        box = boxesByEventId[eventModel.id],
                        cur = box?.visible ? {box, position:getVisitPosition(visitIdx)} : null;
                    visitCounts.set(eventModel, visitIdx + 1);
                    if (prev && cur && cur.box.model.isNotHub() && prev.box.model.isNotHub()) {
                        const splineId = SPLINE_ID_PREFIX_VISIT + visitSplineIds.length;
                        flowLayer.connect({
                            splineId,
                            start:{view:prev.box, side:'right', position:prev.position},
                            end:  {view:cur.box,  side:'left',  position:cur.position},
                            style:prev.box.selected || cur.box.selected ? (isTimeTravel ? SELECTED_VISIT_STYLE_TIME_TRAVEL : SELECTED_VISIT_STYLE) : (isTimeTravel ? VISIT_STYLE_TIME_TRAVEL : VISIT_STYLE)
                        });
                        visitSplineIds.push(splineId);
                    }
                    prev = cur;
                }
            }
        }, 2*STANDARD_DEBOUNCE_MILLIS),
        
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
                notHidden = model.isNotHidden();
            eventBox.eventId = model.id;
            
            _label.setText(model.name || '');
            _historicityBar.updateForStat(model[STAT_ID_HISTORICITY]);
            _attestationBar.updateForStat(model[STAT_ID_ATTESTATION]);
            _paradoxBar.updateForStat(model[STAT_ID_PARADOX]);
            
            eventBox._media.setMedia(...model.getMediaUrls());
            
            eventBox.setTooltip(_label.text);
            eventBox.setVisible(notHidden);
            eventBox.updateEntangled();
            eventBox.updateFlooded();
            
            // Update connections between boxes
            if (notHidden) {
                const endId = model.id,
                    flowLayer = timeline.flowLayer;
                for (const eventModel of model.getPrecursors()) {
                    const startId = eventModel.id,
                        startBox = timeline.boxesByEventId[startId];
                    if (startBox) {
                        const startEventModel = startBox.model,
                            hideAffectedBy = model.isAffectedByHidden(startEventModel);
                        if (!hideAffectedBy && startEventModel.isNotHidden()) {
                            const splineId = SPLINE_ID_PREFIX_AFFECT + startId + '-' + endId,
                                existingConnection = flowLayer.getSpline(splineId);
                            if (!existingConnection) {
                                flowLayer.connect({
                                    splineId,
                                    start:{view:startBox, side:'bottom', position:hashToRange(startId, 15,65) + '%'},
                                    end:  {view:eventBox, side:'top',    position:hashToRange(endId, 15,65) + '%'}
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
                        splineId = SPLINE_ID_PREFIX_EXIT + fromModelId + '-' + toModelId,
                        fromBox = boxesByEventId[fromModelId],
                        toBox = boxesByEventId[toModelId];
                    
                    // A box can be missing while the timeline is being rebuilt, e.g. during a 
                    // restore. The route is drawn by a later refresh once both boxes exist.
                    if (fromBox && toBox && !newExitSplinesById[splineId]) {
                        newExitSplinesById[splineId] = existing[splineId] ?? flowLayer.connect({
                            splineId,
                            start:{view:fromBox, side:'bottom', position:hashToRange(fromModelId, 25,75) + '%'},
                            end:  {view:toBox,   side:'top',    position:hashToRange(toModelId, 25,75) + '%'},
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
            include: [Selectable, M.TransformSupport],
            
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
                attrs.overflow = 'hidden';
                
                self.callSuper(parent, attrs);
                
                // Setup debounced revalidateForEvent so it is unique per instance.
                self.revalidateForEvent = debounce(self._revalidateForEvent, STANDARD_DEBOUNCE_MILLIS);
                
                (self._label = new PaddedPlainText(self, {
                    y:1, width:width, paddingLeft:4, paddingRight:4
                })).enableEllipsis();
                
                const barWidth = width - 2*spacing;
                self._historicityBar = new pkg.HistoricityBar(self, {x:spacing, y:16, width:barWidth}, [MiniStatBar]);
                self._attestationBar = new pkg.AttestationBar(self, {x:spacing, y:20, width:barWidth}, [MiniStatBar]);
                self._paradoxBar = new pkg.ParadoxBar(self, {x:spacing, y:24, width:barWidth}, [MiniStatBar]);
                
                self._media = new pkg.MediaView(self, {
                    y:31, width, height:width*0.40625, roundedCorners:0, visible:false
                }, [{
                    doMediaReady: function() {this.setVisible(true);},
                    doMediaFailed: function() {this.setVisible(false);}
                }]);
                
                updateEventBox(self);
                
                self.attachDomObserver(self, '_doDblClick', 'dblclick');
            },
            
            /*  Shows the box offset by dx and dy pixels from where the layout puts it, e.g. 0 and 
                0 to put it back. It's done with the CSS translate property, which leaves x and y
                alone and composes with the transform the value change animation scales. The 
                curves joined to the box are offset to match by driftSplines. */
            setDrift: function(dx, dy) {
                const self = this;
                if (self._driftX !== dx || self._driftY !== dy) {
                    self._driftX = dx;
                    self._driftY = dy;
                    self.getODS().translate = dx || dy ? dx + 'px ' + dy + 'px' : '';
                }
            },
            getDriftX: function() {return this._driftX ?? 0;},
            getDriftY: function() {return this._driftY ?? 0;},
            hasDrift: function() {return !!(this._driftX || this._driftY);},
            
            setModel: function(model) {
                const self = this,
                    existingModel = self.model;
                if (existingModel !== model) {
                    self.releaseConstraint('_updateForModelChanges');
                    if (existingModel) self.detachFrom(existingModel, '_doValueChanged', 'valueChanged');
                    self.set('model', model, true);
                    const newModel = self.model;
                    if (newModel) {
                        self.constrain('_updateForModelChanges', [newModel, 'updated']);
                        self.attachTo(newModel, '_doValueChanged', 'valueChanged');
                    }
                    if (self.inited) updateEventBox(self);
                }
            },
            
            setVisited: function(v) {
                this.set('visited', v, true);
                if (this.inited) this.updateUI();
            },
            
            /** @private */
            _doValueChanged: function(_event) {
                if (this.timeline?.animateValueChanges) queueValueChangeAnim(this);
            },
            
            setSelected: function(v) {
                this.callSuper(v);
                this.updateUI();
                
                this.bringToFront();
                refreshConnectionsForSelection(this);
            },
            
            /*  Whether an Objective of the current Operation depends on this Event, as far
                as the player knows. Shown with the "entangled" style. */
            setEntangled: function(entangled) {
                if (this.entangled !== entangled) {
                    this.set('entangled', entangled, true);
                    this[entangled ? 'addDomClass' : 'removeDomClass'](DOM_CLASS_ENTANGLED);
                }
            },
            updateEntangled: function() {
                const model = this.model;
                this.setEntangled(model != null && (pkg.model?.getCurrentOperation()?.isEntangledWith(model) ?? false));
            },
            
            /*  A flooded Event's box takes the paradox color: darker under the mouse and 
                lighter when selected. */
            updateFlooded: function() {
                const flooded = this.model?.isFlooded() ?? false;
                if (this.flooded !== flooded) {
                    this.flooded = flooded;
                    this.readyColor = flooded ? colorParadox : colorDark;
                    this.hoverColor = flooded ? colorParadoxDark : colorUltraDark;
                    this.activeColor = flooded ? colorParadoxDark : colorMegaDark;
                    this.updateUI();
                }
            },
            
            setAdjacentIsSelected: function(adjacentIsSelected) {
                this.set('adjacentIsSelected', adjacentIsSelected, true);
                this.updateUI();
            },
            
            _doDblClick: function(_event) {
                if (!this.disabled && this.model) pkg.app.openEventBrief(this.model);
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
                
                let outline = null;
                if (this.selected) {
                    if (this.visited) {
                        outline = BOX_VISITED_OUTLINE;
                    } else {
                        outline = BOX_SELECTED_OUTLINE;
                    }
                } else {
                    if (this.visited) {
                        outline = BOX_VISITED_OUTLINE;
                    }
                }
                this.setOutline(outline);
                
                let barBgColor;
                if (this.selected) {
                    this.setBgColor(this.flooded ? colorParadoxLight : colorLight);
                    this.setTextColor(colorDark);
                    barBgColor = colorMedium;
                } else if (this.adjacentIsSelected && !this.flooded) {
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
                const time = this.time = attrs.time;
                this.timeline = attrs.timeline;
                delete attrs.time;
                delete attrs.timeline;
                
                attrs.bgColor ??= colorUltraDark;
                
                this.callSuper(parent, attrs);
                
                const labelWidth = TL_ROW_HEADER_WIDTH - 2*TICK_LABEL_ADJ;
                this._label = new Text(this, {
                    y:TICK_LABEL_ADJ, width:labelWidth, textAlign:'right', 
                    text:formatForTimeline(time)
                });
                this._gapLabel = new PlainText(this, {
                    y:46, width:labelWidth, textAlign:'right', 
                    fontSize:fontSizeLarge, textColor:colorMediumDark
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
                    y:2, width:TL_ROW_HEADER_WIDTH - 2*TICK_LABEL_ADJ, textAlign:'right',
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
            _photo.setImageUrl(model.getImageUrl());
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
        }),
        
        // Spline and Event Drift //
        /*  While the timeline shows, the ends of its curves drift a little, as if it were unsteady,
            and more as paradox builds: in the timeline as a whole, and in either Event a curve 
            joins, with a flooded Event at its most unsteady. Each end's angle wanders around the 
            side it leaves, so the curves bend while their ends stay where they meet their boxes. 
            The box of an Event with paradox drifts too, around where it belongs, and the ends of
            the curves joined to it follow. */
        DEGREES_BY_SIDE = {right:0, bottom:90, left:180, top:270}, // As myt measures them.
        
        /*  How unsteady an Event is, from 0 to 1: as full of paradox as it is, or 1 once it's
            flooded. */
        getEventUnrest = eventModel => eventModel ? (eventModel.flooded ? 1 : eventModel[STAT_ID_PARADOX].getPercentOfMax()) : 0,
        
        /*  Two waves at different rates, so the drift doesn't swing like a pendulum. Within ±1. */
        getWobble = phase => 0.7*mathSin(phase) + 0.3*mathSin(2.3*phase + 1),
        
        /*  Moves one end of a curve with the drift of the box it's joined to. The end myt 
            places, from the box's x and y, is its base. An end still where this last put it 
            keeps the base it had, while one myt has placed again, e.g. as the layout moved the
            box, takes its new place as its base. */
        driftSplineEnd = (connection, end, view) => {
            const xKey = end + 'X',
                yKey = end + 'Y',
                driftPoints = connection._driftPoints ??= {},
                last = driftPoints[end],
                baseX = last && last.x === connection[xKey] && last.y === connection[yKey] ? last.baseX : connection[xKey],
                baseY = last && last.x === connection[xKey] && last.y === connection[yKey] ? last.baseY : connection[yKey],
                x = baseX + (view?.getDriftX?.() ?? 0),
                y = baseY + (view?.getDriftY?.() ?? 0);
            connection[xKey] = x;
            connection[yKey] = y;
            driftPoints[end] = {x, y, baseX, baseY};
        },
        
        /*  Moves each end of every curve on by the time elapsed. Each curve keeps its own phases,
            so they drift apart, and quickens as it gets more unsteady. Its ends follow the 
            drift of their boxes. */
        driftSplines = (timeline, elapsedSecs) => {
            const timelineUnrest = timeline.model[STAT_ID_PARADOX].getPercentOfMax(),
                elapsedPhase = TWO_PI*elapsedSecs,
                DEGREES_RANGE = TL_SPLINE_DRIFT_MAX_DEGREES - TL_SPLINE_DRIFT_BASE_DEGREES;
            for (const connection of timeline.flowLayer.getConnections()) {
                const startDegrees = DEGREES_BY_SIDE[connection.startSide],
                    endDegrees = DEGREES_BY_SIDE[connection.endSide];
                if (startDegrees != null && endDegrees != null) {
                    const drift = connection._drift ??= {
                            startPhase:mathRandom()*TWO_PI, 
                            endPhase:mathRandom()*TWO_PI,
                            startSpeed:0.2 + mathRandom()*0.2, 
                            endSpeed:0.2 + mathRandom()*0.2
                        },
                        
                        // Unrest is multiplicative. It combines the unrest of the timeline and
                        // the Events at either end of the spline.
                        unrest = 1 -
                            (1 - timelineUnrest) * 
                            (1 - getEventUnrest(connection.startView?.model)) *
                            (1 - getEventUnrest(connection.endView?.model)),
                        
                        amplitude = TL_SPLINE_DRIFT_BASE_DEGREES + DEGREES_RANGE*unrest,
                        quicken = 1 + 2*unrest,
                        timing = elapsedPhase*quicken;
                    drift.startPhase += timing*drift.startSpeed;
                    drift.endPhase += timing*drift.endSpeed;
                    
                    // The ends and angles are all set before the one redraw, rather than with 
                    // their setters, each of which would redraw.
                    driftSplineEnd(connection, 'start', connection.startView);
                    driftSplineEnd(connection, 'end', connection.endView);
                    connection.startAngle = startDegrees + amplitude*getWobble(drift.startPhase);
                    connection.endAngle = endDegrees + amplitude*getWobble(drift.endPhase);
                    connection.redraw();
                }
            }
        },
        
        /*  Moves the box of each Event with paradox on by the time elapsed: up to 
            TL_EVENT_DRIFT_MAX_PIXELS either way once it's flooded, and quicker the more 
            unsteady it is. A box whose Event has none goes back home. */
        driftEventBoxes = (timeline, elapsedSecs) => {
            const elapsedPhase = TWO_PI*elapsedSecs,
                boxesByEventId = timeline.boxesByEventId;
            for (const eventId in boxesByEventId) {
                const eventBox = boxesByEventId[eventId],
                    unrest = eventBox.visible ? getEventUnrest(eventBox.model) : 0;
                if (unrest > 0) {
                    const drift = eventBox._drift ??= {
                            xPhase:mathRandom()*TWO_PI, 
                            yPhase:mathRandom()*TWO_PI,
                            xSpeed:0.3 + mathRandom()*0.3, 
                            ySpeed:0.3 + mathRandom()*0.3
                        },
                        amplitudeX = TL_EVENT_DRIFT_X_MAX_PIXELS*unrest,
                        amplitudeY = TL_EVENT_DRIFT_Y_MAX_PIXELS*unrest,
                        timing = elapsedPhase*(1 + 2*unrest);
                    drift.xPhase += timing*drift.xSpeed;
                    drift.yPhase += timing*drift.ySpeed;
                    eventBox.setDrift(
                        amplitudeX*getWobble(drift.xPhase), 
                        amplitudeY*getWobble(drift.yPhase)
                    );
                } else if (eventBox.hasDrift()) {
                    eventBox.setDrift(0, 0);
                }
            }
        },
        
        /*  Runs for the life of the timeline. It checks each frame whether the drift is wanted,
            so a change of tab or setting takes effect at once, and browsers pause it while 
            the page is hidden. */
        startDriftLoop = timeline => {
            let lastTime = null,
                isDrifting = false;
            const tick = now => {
                if (!timeline.isBeingDestroyed) {
                    if (
                        timeline.visible && 
                        timeline.model != null && 
                        settings.get(SETTING_ANIMATE_TIMELINE_UNREST) && 
                        !pkg.REDUCE_MOTION.matches
                    ) {
                        // About 30 frames a second is smooth enough for a slow drift.
                        if (lastTime == null || now - lastTime >= 33) {
                            // A long gap, e.g. after the tab was hidden, moves it on no more than 
                            // a frame or so.
                            const elapsedSecs = lastTime == null ? 0 : mathMin(now - lastTime, 100) / 1000;
                            
                            // Boxes first, so the curves can follow them.
                            driftEventBoxes(timeline, elapsedSecs);
                            driftSplines(timeline, elapsedSecs);
                            isDrifting = true;
                            lastTime = now;
                        }
                    } else {
                        if (isDrifting) {
                            // Settle the Splines by putting every curve back straight out of 
                            // their sides.
                            // And every box back home, with the ends of the curves.
                            for (const eventBox of Object.values(timeline.boxesByEventId)) {
                                if (eventBox.hasDrift()) eventBox.setDrift(0, 0);
                            }
                            for (const connection of timeline.flowLayer.getConnections()) {
                                connection.setStartAngle(DEGREES_BY_SIDE[connection.startSide] ?? null);
                                connection.setEndAngle(DEGREES_BY_SIDE[connection.endSide] ?? null);
                                connection.updateEndpoints();
                                connection._driftPoints = null;
                            }
                            isDrifting = false;
                        }
                        lastTime = null;
                    }
                    requestAnimationFrame(tick);
                }
            };
            requestAnimationFrame(tick);
        };
    
    pkg.TimelineCompact = new JSClass('TimelineCompact', pkg.TallView, {
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
            attrs.bgColor ??= colorMedium;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            const scrollCaptureView = self.scrollCaptureView = new View(self, {overflow:'auto'}, [{
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
                x:22, y:btnY, buttonType:'plain', disabled:true,
                text:pkg.ICON_NAV_BACK, fontSize:fontSizeLarge,
                tooltip:'Select the last Event you viewed.'
            }, [{doActivated: function() {self.navigateHistory(-1);}}]);
            self.histNextBtn = new SquareBtn(self, {
                x:49, y:btnY, buttonType:'plain', disabled:true,
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
                const {
                        rowHeaders, rowHeadersContainer, colHeaders, colHeadersContainer, 
                        flowLayer, flowContainer, scrollCaptureView, hLine
                    } = self,
                    width = self.width;
                flowContainer.setWidth(width - flowContainer.x);
                flowLayer.setWidth(mathMax(colHeaders.width, flowContainer.width));
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
                const {
                        rowHeaders, rowHeadersContainer, colHeaders, colHeadersContainer, 
                        flowLayer, flowContainer, scrollCaptureView, vLine
                    } = self,
                    height = self.height;
                flowContainer.setHeight(height - flowContainer.y);
                flowLayer.setHeight(mathMax(rowHeaders.height, flowContainer.height));
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
        
        /*  Redoes every box's entangled style, e.g. when the current Operation changes. A
            box also redoes its own whenever its Event changes, which covers reveals. */
        updateEntanglements: function() {
            for (const eventBox of Object.values(this.boxesByEventId)) eventBox.updateEntangled();
        },
        
        getSelectedEventBox: function() {
            return this.getSelected()[0];
        },
        
        /** @overrides SelectionManager */
        doSelected: function() {
            this._eventModelOrIdToSelect = null;
            const selectedEvent = this.getSelectedEventBox();
            refreshExitSplines(this);
            if (this.timelineReady) updateVisitedStatusForSelectedAgent(this);
            this.fireEvent('selectionChanged', selectedEvent);
            pushOntoHistory(this, selectedEvent.model.id);
            
            this.scrollToEventBox(selectedEvent);
        },
        
        /** @overrides SelectionManager */
        doDeselected: function() {
            refreshExitSplines(this);
            if (this.timelineReady) updateVisitedStatusForSelectedAgent(this);
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
        
        deselectAll: function() {
            this._eventModelOrIdToSelect = null;
            this.callSuper();
        },
        
        /*  The id of the selected Event, or of the one waiting for its EventBox to exist so it 
            can be selected, since that is what will be selected. Null if neither. */
        getSelectedEventId: function() {
            const pending = this._eventModelOrIdToSelect;
            if (pending) return typeof pending === 'string' ? pending : pending.id;
            return this.getSelectedEventBox()?.model.id ?? null;
        },
        
        doSelectEvent: function(eventModelOrId) {
            const eventBox = this.getEventBox(eventModelOrId);
            if (eventBox) {
                this._eventModelOrIdToSelect = null;
                if (eventBox.selected) {
                    this.scrollToEventBox(eventBox);
                } else {
                    this.select(eventBox);
                }
            } else {
                this._eventModelOrIdToSelect = eventModelOrId;
            }
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
        scrollToEventBox: function(thingy, smoothly=true) {
            const eventBox = thingy?.isA?.(EventBox) ? thingy : this.getEventBox(thingy);
            if (eventBox?.visible) scrollToBoundingBox(this, eventBox, smoothly);
        },
        
        /*  Redraws the Location's column header, e.g. for a new image. */
        notifyLocationModelChanged: function(locationModel) {
            const locationColumn = this.colsByLocId[locationModel.id];
            if (locationColumn) updateLocationColumn(locationColumn);
        },
        
        scrollToLocation: function(locId, smoothly=true, selectTab=true) {
            if (selectTab) pkg.app.selectTimelineTab();
            const locationColumn = this.colsByLocId[locId];
            if (locationColumn) this.scrollCaptureView.scrollXTo(locationColumn.x, true, smoothly);
        },
        
        scrollToTime: function(millis, smoothly=true, selectTab=true) {
            if (selectTab) pkg.app.selectTimelineTab();
            const tick = this.ticksByTime[millis];
            if (tick) this.scrollCaptureView.scrollYTo(tick.y, true, smoothly);
        },
        
        // Setup //
        setup: function(model) {
            this.model = model;
            this.timelineReady = true;
            updateTimeLineLayoutDebounced(this);
            startDriftLoop(this);
        },
        
        /*  Turned on once startup, including restoring a save, is done, so only changes the 
            player makes from then on animate. */
        setAnimateValueChanges: function(v) {this.animateValueChanges = v;},
        
        /*  Calls func once the value change animations are done, or right away if none are
            running, e.g. so a dialog doesn't cover the end of a chain of changes. */
        doWhenValueChangeAnimsDone: func => {
            const {queue, current, whenDone} = valueChangeAnims;
            if (current || queue.length > 0) {
                whenDone.push(func);
            } else {
                func();
            }
        },
        
        /*  The value change animations, as Event IDs: the box animating now and the boxes 
            waiting their turn. For tests and debugging. */
        getValueChangeAnimState: () => ({
            current:valueChangeAnims.current?.model?.id ?? null,
            queued:valueChangeAnims.queue.map(([eventBox]) => eventBox.model?.id)
        }),
        
        notifyEventVisibilityChange: function(_eventModel) {
            if (this.timelineReady) updateTimeLineLayoutDebounced(this);
        },
        
        notifyAgentLocOrVisChange: function(_agentModel) {
            if (this.timelineReady) updateTimeLineLayoutDebounced(this); // FIXME: agent only update option?
        },
        
        notifyAgentSelectedChanged: function(agentModel) {
            this.selectedAgentModel = agentModel;
            if (this.timelineReady) updateVisitedStatusForSelectedAgent(this);
        },
        
        /*  The settings for showing the selected Agent's visited borders or history changed. */
        notifyAgentHistoryDisplayChanged: function() {
            if (this.timelineReady) updateVisitedStatusForSelectedAgent(this);
        }
    });
})(tc);