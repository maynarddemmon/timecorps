(pkg => {
    const JSClass = JS.Class,
        
        {
            View, PaddedPlainText, PlainText, SimpleButton, SplineFlow, ScrollObservable,
            Selectable, SelectionManager
        } = myt,
        
        {
            SquareBtn, LabeledValue,
            timeUtil:{
                stringToMillis, ticksForRange, format,
                
                TO_SECOND, 
                TO_MINUTE, 
                TO_HOUR, 
                TO_DAY, 
                TO_MONTH,
                TO_YEAR, 
                TO_DECADE, 
                TO_CENTURY,
                TO_MILLENIUM,
                
                SCALE_TO_MILLIS
            },
            cfg:{
                SPLINE_CURVATURE, TL_BOX_VISIBLE_HEIGHT_THRESHOLD, MAX_HISTORY_LENGTH, 
                TL_SCROLL_TO_PADDING, TL_ROW_HEADER_WIDTH, TL_COL_WIDTH, TL_COL_SPACING,
                TL_CLICK_TO_DESELECT
            },
            
            theme:{
                spacing, cornerRadius, rowHeight, 
                colorUltraLight, colorLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                colorBtn,
                fontSizeLarge
            },
            I18N_PARADOX,
            STAT_ID_PARADOX
        } = pkg,
        
        SCALE_TO_TICK_SCALE = {
            [TO_SECOND]: TO_MINUTE,
            [TO_MINUTE]: TO_HOUR,
            [TO_HOUR]: TO_DAY,
            [TO_DAY]: TO_MONTH,
            [TO_MONTH]: TO_YEAR,
            [TO_YEAR]: TO_DECADE,
            [TO_DECADE]: TO_CENTURY,
            [TO_CENTURY]: TO_MILLENIUM
        },
        
        TICK_HEIGHTS = {
            [TO_SECOND]: 60,
            [TO_MINUTE]: 60,
            [TO_HOUR]: 24,
            [TO_DAY]: 30,
            [TO_MONTH]: 12,
            [TO_YEAR]: 10,
            [TO_DECADE]: 10,
            [TO_CENTURY]: 10
        },
        
        SPLINE_ID_PREFIX_AFFECT = 'affect-',
        SPLINE_ID_PREFIX_EXIT = 'exit-',
        
        DEFAULT_STYLE = [{
            color:colorUltraLight, cap:null, thickness:1, startAngle:'vertical', endAngle:'vertical', 
            startCurvature:SPLINE_CURVATURE, endCurvature:SPLINE_CURVATURE, 
            //startArrow:'dot',
            endArrow:'triangle',
            startStub:6, endStub:6, startGap:2, endGap:2
        }],
        SELECTED_CONNECTION_STYLE = {
            color:colorUltraLight, cap:null, thickness:4, startAngle:'vertical', endAngle:'vertical', 
            startCurvature:SPLINE_CURVATURE, endCurvature:SPLINE_CURVATURE, 
            //endArrow:'triangle',
            startStub:6, endStub:6, startGap:0, endGap:0
        },
        EXIT_STYLE = {
            color:colorBtn, cap:null, thickness:1, startAngle:'vertical', endAngle:'vertical', 
            dash:1,
            startCurvature:SPLINE_CURVATURE, endCurvature:SPLINE_CURVATURE, 
            endArrow:'triangle',
            startStub:6, endStub:6, startGap:2, endGap:2
        },
        
        COL_HEADER_HEIGHT = rowHeight,
        
        TICK_LINE_HEIGHT = 1,
        TICK_LABEL_ADJ = TICK_LINE_HEIGHT + spacing,
        
        BOX_INSET_FROM_COL = 1,
        BOX_SELECTED_OUTLINE = [1, 'solid', colorUltraLight],
        
        millisToPx = (timeline, millis) => {
            const millisOffset = millis - timeline.start,
                scale = timeline.scale,
                tickScale = SCALE_TO_TICK_SCALE[scale];
            return (millisOffset / SCALE_TO_MILLIS[tickScale]) * TICK_HEIGHTS[scale];
        },
        
        refreshTimeWindow = timeline => {
            if (timeline.noTimeWindowRefresh) return;
            timeline.noTimeWindowRefresh = true;
            refreshTicks(timeline);
            layoutEvents(timeline);
            timeline.noTimeWindowRefresh = false;
        },
        
        refreshTicks = timeline => {
            const {scale, scrollToken, rowHeaders} = timeline;
            rowHeaders.destroyAllSubviews();
            
            const w = rowHeaders.width,
                ticks = ticksForRange(timeline.start, timeline.end, SCALE_TO_TICK_SCALE[scale]),
                len = ticks.length,
                tickHeight = TICK_HEIGHTS[scale];
            let extent = 0;
            for (let i = 0; i < len; i++) {
                new Tick(rowHeaders, {timeline, time:ticks[i], y:extent, width:w, height:TICK_LINE_HEIGHT});
                extent += tickHeight;
            }
            scrollToken.setY(extent - scrollToken.height + COL_HEADER_HEIGHT);
            rowHeaders.setHeight(extent);
            timeline.flowLayer.setHeight(extent);
        },
        
        refreshLocationColumns = timeline => {
            const {colHeaders, scrollToken, model} = timeline;
            colHeaders.destroyAllSubviews();
            
            const colsByLocId = timeline.colsByLocId = {},
                locModels = model.getLocationsInOrder(),
                len = locModels.length,
                h = colHeaders.height,
                w = TL_COL_WIDTH + TL_COL_SPACING;
            
            let extent = 0;
            for (let i = 0; i < len; i++) {
                const model = locModels[i];
                if (model.order >= 0) { // Locations with negative order are not shown.
                    colsByLocId[model.id] = new LocationColumn(colHeaders, {x:extent, height:h, model});
                    extent += w;
                }
            }
            scrollToken.setX(extent - scrollToken.width + TL_ROW_HEADER_WIDTH);
            colHeaders.setWidth(extent);
            timeline.flowLayer.setWidth(extent);
        },
        
        layoutEvents = timeline => {
            const {model, flowLayer} = timeline,
                eventModels = model.getEventModels(),
                boxesByEventId = timeline.boxesByEventId = {};
            flowLayer.destroyAllSubviews();
            for (const eventModelId in eventModels) {
                const eventModel = eventModels[eventModelId];
                boxesByEventId[eventModelId] = new EventBox(flowLayer, {timeline, model:eventModel});
            }
        },
        
        getLocationColumn = (timeline, modelOrId) => {
            if (modelOrId) {
                let locationId;
                if (typeof modelOrId === 'string') {
                    locationId = modelOrId;
                } else if (modelOrId.isA(pkg.EventModel)) {
                    locationId = modelOrId.getLocation();
                } else {
                    // Assume LocationModel
                    locationId = modelOrId.id;
                }
                
                if (locationId) return timeline.colsByLocId[locationId];
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
        revalidateForEvent = eventBox => {
            const {timeline, model:eventModel} = eventBox;
            
            updateEventBox(eventBox);
            updateExits(eventBox);
            
            for (const descEventModel of eventModel.getDescendants()) {
                const descEventBox = timeline.getEventBox(descEventModel);
                if (descEventBox) updateEventBox(descEventBox);
            }
        },
        
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
                col = timeline.colsByLocId[locId],
                hidden = model.isHidden();
            eventBox.eventId = model.id;
            _label.setText(model.name || '');
            eventBox.setTooltip(_label.text);
            eventBox.setX(col ? col.x + BOX_INSET_FROM_COL : 0);
            
            const startPx = millisToPx(timeline, start),
                endPx = millisToPx(timeline, end);
            
            eventBox.setY(startPx);
            eventBox.setHeight(endPx - startPx);
            
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
                                    start:{view:startBox, side:'bottom', position:'75%'},
                                    end:{view:eventBox, side:'top', position:'25%'}
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
        
        EventBox = new JSClass('EventBox', SimpleButton, {
            include: [Selectable],
            
            initNode: function(parent, attrs) {
                attrs.activeColor ??= colorMegaDark;
                attrs.hoverColor ??= colorUltraDark;
                attrs.readyColor ??= colorDark;
                attrs.focusable = false;
                
                const width = attrs.width ??= TL_COL_WIDTH - 2*BOX_INSET_FROM_COL;
                attrs.roundedCorners ??= cornerRadius;
                //attrs.outline ??= BOX_OUTLINE;
                
                this.timeline = attrs.timeline;
                delete attrs.timeline;
                
                attrs.zIndex = 1;
                
                this.callSuper(parent, attrs);
                
                (this._label = new PaddedPlainText(this, {
                    textAlign:'center', y:spacing, width:width, visible:this.height >= TL_BOX_VISIBLE_HEIGHT_THRESHOLD,
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
            
            setHeight: function(v) {
                this.callSuper(v);
                this._label?.setVisible(this.height >= TL_BOX_VISIBLE_HEIGHT_THRESHOLD);
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
                if (this.inited) revalidateForEvent(this);
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
                const width = attrs.width ??= TL_COL_WIDTH;
                
                this.callSuper(parent, attrs);
                
                (this._label = new PaddedPlainText(this, {
                    width:width, height:COL_HEADER_HEIGHT, bgColor:'#fff3', textAlign:'center',
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
    
    pkg.Timeline = new JSClass('Timeline', pkg.Panel, {
        include: [SelectionManager],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self._hist = [];
            self._histIdx = -1;
            
            attrs.maxSelected = 1;
            attrs.itemSelectionId = 'eventId';
            
            self.callSuper(parent, attrs);
            
            self.getContentView().setBgColor(colorMedium);
            
            // Build UI
            const header = self.getHeaderView();
            self.timelineParadoxView = new LabeledValue(header, {label:'Timeline ' + I18N_PARADOX}, [{
                update: function(v) {
                    if (self.ready) {
                        const statParadox = self.model[STAT_ID_PARADOX];
                        this.callSuper(statParadox.value + '/' + statParadox.max);
                    }
                }
            }]);
            
            const 
                scrollCaptureView = self.scrollCaptureView = new View(self, {overflow:'auto'}, [{
                    _handleScroll: event => {
                        const {x, y} = ScrollObservable.getScrollFromEvent(event),
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
                
                rowHeadersContainer = self.rowHeadersContainer = new View(stickyView, {y:COL_HEADER_HEIGHT, overflow:'hidden'}),
                rowHeaders = self.rowHeaders = new View(rowHeadersContainer, {textColor:colorUltraDark}),
                
                flowContainer = self.flowContainer = new View(stickyView, {x:TL_ROW_HEADER_WIDTH, y:COL_HEADER_HEIGHT, overflow:'hidden'}),
                flowLayer = self.flowLayer = new SplineFlow(flowContainer, {
                    defaultStyle:DEFAULT_STYLE
                });
            const flowSVG = flowLayer.getSVG();
            flowSVG.style.zIndex = 2;
            flowSVG.style.position = 'absolute';
            
            stickyView.getIDS().position = 'sticky';
            
            scrollCaptureView.getIDS().overscrollBehavior = 'none';
            self.scrollToken = new View(scrollCaptureView, {width:1, height:1});
            scrollCaptureView.attachToDom(scrollCaptureView, '_handleScroll', 'scroll');
            
            const hLine = self.hLine = new View(self, {y:COL_HEADER_HEIGHT, height:1, bgColor:colorUltraDark}),
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
        
        setStart: function(start) {
            if (typeof start !== 'number') start = stringToMillis(start);
            if (this.start !== start) {
                this.set('start', start, true);
                if (this.inited) refreshTimeWindow(this);
            }
        },
        
        setEnd: function(end) {
            if (typeof end !== 'number') end = stringToMillis(end);
            if (this.end !== end) {
                this.set('end', end, true);
                if (this.inited) refreshTimeWindow(this);
            }
        },
        
        setScale: function(scale) {
            if (this.scale !== scale) {
                this.set('scale', scale, true);
                if (this.inited) refreshTimeWindow(this);
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
        
        /** @overrides SelectionManager */
        doSelected: function() {
            const selectedEvent = this.getSelected()[0];
            this.fireEvent('selectionChanged', selectedEvent);
            pushOntoHistory(this, selectedEvent.model.id);
        },
        
        /** @overrides SelectionManager */
        doDeselected: function() {this.fireEvent('selectionChanged', this.getSelected()[0]);},
        
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
                if (scrollTo) this.scrollToEventBox(eventModelOrId, smoothly);
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
        scrollToEventBox: function(modelOrId, smoothly=true) {
            const eventBox = this.getEventBox(modelOrId);
            if (eventBox && eventBox.visible) this.scrollCaptureView.scrollXYTo(eventBox.x + TL_SCROLL_TO_PADDING, eventBox.y + TL_SCROLL_TO_PADDING, true, smoothly);
        },
        
        scrollToLocation: function(modelOrId, smoothly=true) {
            const locationColumn = getLocationColumn(this, modelOrId);
            if (locationColumn) this.scrollCaptureView.scrollXTo(locationColumn.x, true, smoothly);
        },
        
        scrollToTime: function(millis, smoothly=true) {
            this.scrollCaptureView.scrollYTo(millisToPx(this, millis), true, smoothly);
        },
        
        
        // Setup //
        setup: function(model) {
            this.model = model;
            const statParadox = model[STAT_ID_PARADOX];
            this.timelineParadoxView.constrain('update', [statParadox, 'value', statParadox, 'max']);
            refreshLocationColumns(this);
        },
        
        setTimeWindow: function(start, end, scale) {
            this.noTimeWindowRefresh = true;
            this.setStart(start);
            this.setEnd(end);
            this.setScale(scale);
            this.noTimeWindowRefresh = false;
            
            if (this.inited) refreshTimeWindow(this);
        },
        
        notifyEventVisibilityChange: function(eventModel) {
            // Does nothing for this Timeline implementation.
        }
    });
})(tc);