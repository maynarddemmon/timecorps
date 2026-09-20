(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, PaddedPlainText, PlainText, Selectable} = M,
        
        {
            SquareBtn, LabeledValue,
            timeUtil:{format,},
            cfg:{
                STANDARD_DEBOUNCE_MILLIS, SPLINE_CURVATURE, TL_BOX_VISIBLE_HEIGHT_THRESHOLD, 
                MAX_HISTORY_LENGTH, 
                TL_ROW_HEADER_WIDTH, TL_COL_WIDTH, TL_COL_HEADER_HEIGHT,
                TL_COL_SPACING, TL_CLICK_TO_DESELECT, TL_EVENT_BOX_HEIGHT, TL_EVENT_BOX_X_MARGIN,
                TL_EVENT_BOX_Y_MARGIN, TL_TICK_LINE_HEIGHT
            },
            theme:{
                spacing, cornerRadius, rowHeight, 
                colorUltraLight, colorLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                colorBtn, colorParadox,
                fontSizeLarge
            },
            I18N_PARADOX,
            STAT_ID_PARADOX
        } = pkg,
        
        EVENT_TIER_HEIGHT = TL_EVENT_BOX_HEIGHT + 2*TL_EVENT_BOX_Y_MARGIN + TL_TICK_LINE_HEIGHT,
        TICK_LABEL_ADJ = TL_TICK_LINE_HEIGHT + spacing,
        
        COL_WIDTH = TL_COL_WIDTH + 2*TL_EVENT_BOX_X_MARGIN,
        COL_EXTENT = COL_WIDTH + TL_COL_SPACING,
        
        BOX_SELECTED_OUTLINE = [1, 'solid', colorUltraLight],
        
        SPLINE_ID_PREFIX_AFFECT = 'affect-',
        SPLINE_ID_PREFIX_EXIT = 'exit-',
        
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
        animateAttrs = (target, attrs) => {
            target.stopActiveAnimators();
            for (const attrName in attrs) {
                const newValue = attrs[attrName];
                if (target[attrName] !== newValue) target.animate({attribute:attrName, to:newValue, duration:ANIM_DURATION})
            }
        },
        
        updateTimelineLayout = (timeline, isInitial) => {
            // Order the Events and Locations
            const {model, colHeaders, scrollToken, rowHeaders, flowLayer} = timeline,
                {events:orderedEvents, locations:locModels} = timeline.orderedEvents = model.putEventModelsInTieredTimeOrder(),
                locModelsLen = locModels.length,
                colHeadersHeight = colHeaders.height,
                rowHeaderWidth = rowHeaders.width;
            
            if (isInitial) {
                // Destroy and cleanup for a new timeline layout
                timeline.deselectAll();
                timeline.colsByLocId = {};
                timeline.boxesByEventId = {};
                timeline.ticksByTime = {};
                colHeaders.destroyAllSubviews();
                rowHeaders.destroyAllSubviews();
                flowLayer.destroyAllSubviews();
            }
            
            const {colsByLocId, boxesByEventId, ticksByTime} = timeline;
            
            // Layout Events, Location Columns and Refresh Ticks
            let xExtent = 0;
            const locColTargetXById = {};
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
            
            if (isInitial) {
                // Special Handling for HQ and The Void
                orderedEvents.unshift(model.getHQEventModel(), model.getTheVoidEventModel());
            }
            
            let selectedBoxAnimatingToBounds;
            let targetY = 0;
            for (const eventModel of orderedEvents) {
                const startTime = eventModel.getStart(),
                    eventId = eventModel.id,
                    targetX = (locColTargetXById[eventModel.getLocation()] ?? 0) + TL_EVENT_BOX_X_MARGIN;
                targetY = eventModel.getTimeOrdering() * EVENT_TIER_HEIGHT + TL_EVENT_BOX_Y_MARGIN + TL_TICK_LINE_HEIGHT;
                const eventBox = boxesByEventId[eventId];
                if (eventBox) {
                    if (eventBox.isSelected()) selectedBoxAnimatingToBounds = {x:targetX, y:targetY, width:eventBox.width, height:eventBox.height};
                    animateAttrs(eventBox, {x:targetX, y:targetY});
                    updateEventBox(eventBox);
                } else {
                    boxesByEventId[eventId] = new EventBox(flowLayer, {
                        x:targetX, y:targetY, timeline, model:eventModel
                    });
                }
                
                const tick = ticksByTime[startTime],
                    tickTargetY = targetY - TL_EVENT_BOX_Y_MARGIN - TL_TICK_LINE_HEIGHT;
                if (tick) {
                    animateAttrs(tick, {y:tickTargetY});
                    tick.setWidth(rowHeaderWidth);
                    tick.setHeight(TL_TICK_LINE_HEIGHT);
                } else {
                    ticksByTime[startTime] = new Tick(rowHeaders, {
                        timeline, time:startTime,
                        y:tickTargetY, 
                        width:rowHeaderWidth, height:TL_TICK_LINE_HEIGHT
                    });
                }
            }
            
            // Update for new extents
            const yExtent = targetY ? targetY + EVENT_TIER_HEIGHT - TL_EVENT_BOX_Y_MARGIN - TL_TICK_LINE_HEIGHT : 0;
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
        },
        
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
            const {timeline, model, _label} = eventBox,
                start = model.getStart(),
                end = model.getEnd(),
                locId = model.getLocation(),
                hidden = model.isHidden();
            eventBox.eventId = model.id;
            _label.setText(model.name || '');
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
        
        updateExits = eventBox => {
            const {timeline, model, selected:show} = eventBox,
                flowLayer = timeline.flowLayer,
                exitsById = eventBox._exitsById ??= {};
            
            // Update travel paths between boxes
            if (show) {
                const startId = model.id;
                for (const exitModel of model.getExitModels()) {
                    if (exitModel.isHidden()) continue;
                    
                    const toBox = timeline.boxesByEventId[exitModel.getToEventModel()?.id];
                    if (toBox && !toBox.model.isHidden()) {
                        const splineId = SPLINE_ID_PREFIX_EXIT + startId + '-' + toBox.model.id,
                            existingConnection = flowLayer.getSpline(splineId);
                        if (!existingConnection) {
                            exitsById[splineId] = flowLayer.connect({
                                splineId,
                                start:{view:eventBox, side:'bottom', position:'85%'},
                                end:{view:toBox, side:'top', position:'35%'},
                                style:EXIT_STYLE
                            });
                        }
                    }
                } 
            } else {
                for (const connectionId in exitsById) flowLayer.disconnect(connectionId);
                eventBox._exitsById = {};
            }
        },
        
        EventBox = new JSClass('EventBox', M.SimpleButton, {
            include: [Selectable],
            
            initNode: function(parent, attrs) {
                attrs.activeColor ??= colorMegaDark;
                attrs.hoverColor ??= colorUltraDark;
                attrs.readyColor ??= colorDark;
                attrs.focusable = false;
                
                attrs.height ??= TL_EVENT_BOX_HEIGHT;
                
                const width = attrs.width ??= TL_COL_WIDTH;
                attrs.roundedCorners ??= cornerRadius;
                
                this.timeline = attrs.timeline;
                delete attrs.timeline;
                
                attrs.zIndex = 1;
                
                this.callSuper(parent, attrs);
                
                // Setup debounced revalidateForEvent so it is unique per instance.
                this.revalidateForEvent = M.debounce(this._revalidateForEvent, STANDARD_DEBOUNCE_MILLIS);
                
                (this._label = new PaddedPlainText(this, {
                    y:spacing, width:width, visible:this.height >= TL_BOX_VISIBLE_HEIGHT_THRESHOLD,
                    paddingLeft:4, paddingRight:4
                })).enableEllipsis();
                
                updateEventBox(this);
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
                updateExits(this);
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
                
                if (this.selected) {
                    this.setBgColor(colorLight);
                    this.setTextColor(colorDark);
                } else if (this.adjacentIsSelected) {
                    this.setBgColor(colorMedium);
                    this.setTextColor(null);
                } else {
                    this.setTextColor(null);
                }
            },
            
            _updateForModelChanges: function() {
                if (this.inited) this.revalidateForEvent();
            },
            
            _revalidateForEvent: function() {
                const {timeline, model:eventModel} = this;
                
                updateEventBox(this);
                updateExits(this);
                
                for (const descEventModel of eventModel.getDescendants()) {
                    const descEventBox = timeline.getEventBox(descEventModel);
                    if (descEventBox) updateEventBox(descEventBox);
                }
            }
        }),
        
        
        // Tick //
        Tick = new JSClass('Tick', View, {
            initNode: function(parent, attrs) {
                const time = attrs.time,
                    timeline = this.timeline = attrs.timeline;
                delete attrs.time;
                delete attrs.timeline;
                
                attrs.bgColor ??= colorUltraDark;
                
                this.callSuper(parent, attrs);
                
                this._label = new PlainText(this, {
                    y:TICK_LABEL_ADJ, width:TL_ROW_HEADER_WIDTH - 2*TICK_LABEL_ADJ,
                    textAlign:'right', text:format(time, timeline.scale)
                });
            }
        }),
        
        
        // Location Column //
        updateLocationColumn = locationColumn => {
            const {model, _label} = locationColumn;
            locationColumn.setBgColor(model.color || 'transparent');
            locationColumn.setTextColor(model.textColor || null);
            _label.setText(model.name || '');
        },
        
        LocationColumn = new JSClass('LocationColumn', View, {
            initNode: function(parent, attrs) {
                const width = attrs.width ??= COL_WIDTH;
                
                this.callSuper(parent, attrs);
                
                (this._label = new PaddedPlainText(this, {
                    width:width, height:TL_COL_HEADER_HEIGHT, bgColor:'#fff3', textAlign:'center',
                    paddingTop:5, paddingLeft:4, paddingRight:4
                })).enableEllipsis();
                
                updateLocationColumn(this);
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
            
            attrs.maxSelected = 1;
            attrs.itemSelectionId = 'eventId';
            
            self.callSuper(parent, attrs);
            
            self.getContentView().setBgColor(colorMedium);
            
            // Build UI
            const header = self.getHeaderView();
            self.timelineParadoxView = new LabeledValue(header, {label:'Timeline ' + I18N_PARADOX, valueTextColor:colorParadox}, [{
                update: function(v) {
                    if (self.ready) {
                        this.callSuper(self.model[STAT_ID_PARADOX].formatAsPercent());
                    }
                }
            }]);
            
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
            flowSVG.style.zIndex = 2;
            flowSVG.style.position = 'absolute';
            
            stickyView.getIDS().position = 'sticky';
            
            scrollCaptureView.getIDS().overscrollBehavior = 'none';
            self.scrollToken = new View(scrollCaptureView, {width:1, height:1});
            scrollCaptureView.attachToDom(scrollCaptureView, '_handleScroll', 'scroll');
            
            const hLine = self.hLine = new View(self, {y:TL_COL_HEADER_HEIGHT, height:1, bgColor:colorUltraDark}),
                vLine = self.vLine = new View(self, {x:TL_ROW_HEADER_WIDTH - 1, width:1, bgColor:colorUltraDark});
            hLine.getIDS().pointerEvents = 'none';
            vLine.getIDS().pointerEvents = 'none';
            
            // Selected Event History Nav
            self.histPrevBtn = new SquareBtn(self, {
                x:37, y:1, buttonType:'plain', disabled:true,
                icon:pkg.ICON_NAV_BACK, iconSize:fontSizeLarge, iconX:6, iconY:1, 
                tooltip:'Select the last Event you viewed.'
            }, [{doActivated: function() {self.navigateHistory(-1);}}]);
            self.histNextBtn = new SquareBtn(self, {
                x:62, y:1, buttonType:'plain', disabled:true,
                icon:pkg.ICON_NAV_FORWARD, iconSize:fontSizeLarge, iconX:8, iconY:1, 
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
            this.fireEvent('selectionChanged', selectedEvent);
            pushOntoHistory(this, selectedEvent.model.id);
        },
        
        /** @overrides SelectionManager */
        doDeselected: function() {this.fireEvent('selectionChanged', this.getSelectedEventBox());},
        
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
        
        doSelectEvent: function(eventModelOrId, scrollTo, smoothly=true) {
            const eventBox = this.getEventBox(eventModelOrId);
            if (eventBox) {
                this.select(eventBox);
                if (scrollTo) this.scrollToEventBox(eventBox, smoothly);
            }
        },
        
        // History //
        navigateHistory: function(adj) {
            const newIdx = this._histIdx + adj,
                eventIdToSelect = this._hist[newIdx];
            if (eventIdToSelect) {
                this._noHistUpdate = true;
                this.doSelectEvent(eventIdToSelect,true, true);
                this._noHistUpdate = false;
                this._histIdx = newIdx;
                updateHistoryBtns(this);
            }
        },
        
        // Scrolling //
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
            const statParadox = model[STAT_ID_PARADOX];
            this.timelineParadoxView.constrain('update', [statParadox, 'value', statParadox, 'max']);
            
            updateTimelineLayout(this, true);
            this.timelineReady = true;
            
            this.doSelectEvent(model.getInitialSelection());
        },
        
        notifyEventVisibilityChange: function(_eventModel) {
            if (this.timelineReady) updateTimelineLayout(this);
        }
    });
})(tc);