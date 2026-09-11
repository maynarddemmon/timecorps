(pkg => {
    const JSClass = JS.Class,
        
        {
            View, PaddedPlainText, PlainText, SimpleButton, SplineFlow, ScrollObservable,
            Selectable, SelectionManager
        } = myt,
        
        {
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
            theme:{
                spacing, cornerRadius, rowHeight, 
                colorUltraLight, colorLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                colorBtn
            }
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
        
        CURVATURE = 0.25,
        
        COL_HEADER_HEIGHT = rowHeight,
        ROW_HEADER_WIDTH = 125,
        
        COL_WIDTH = 100,
        COL_SPACING = 1,
        
        TICK_LINE_HEIGHT = 1,
        TICK_LABEL_ADJ = TICK_LINE_HEIGHT + spacing,
        
        BOX_VISIBLE_HEIGHT_THRESHOLD = 20,
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
                w = COL_WIDTH + COL_SPACING;
            
            let extent = 0;
            for (let i = 0; i < len; i++) {
                const model = locModels[i];
                colsByLocId[model.id] = new LocationColumn(colHeaders, {x:extent, height:h, model});
                extent += w;
            }
            scrollToken.setX(extent - scrollToken.width + ROW_HEADER_WIDTH);
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
        
        EventBox = new JSClass('EventBox', SimpleButton, {
            include: [Selectable],
            
            initNode: function(parent, attrs) {
                attrs.activeColor ??= colorMegaDark;
                attrs.hoverColor ??= colorUltraDark;
                attrs.readyColor ??= colorDark;
                attrs.focusable = false;
                
                const width = attrs.width ??= COL_WIDTH - 2*BOX_INSET_FROM_COL;
                attrs.roundedCorners ??= cornerRadius;
                //attrs.outline ??= BOX_OUTLINE;
                
                this.timeline = attrs.timeline;
                delete attrs.timeline;
                
                attrs.zIndex = 1;
                
                this.callSuper(parent, attrs);
                
                (this._label = new PaddedPlainText(this, {
                    textAlign:'center', y:spacing, width:width, visible:this.height >= BOX_VISIBLE_HEIGHT_THRESHOLD,
                    paddingLeft:4, paddingRight:4
                })).enableEllipsis();
                
                this._update();
            },
            
            setModel: function(model) {
                if (this.model !== model) {
                    this.set('model', model, true);
                    if (this.inited) this._update();
                }
            },
            
            setHeight: function(v) {
                this.callSuper(v);
                this._label?.setVisible(this.height >= BOX_VISIBLE_HEIGHT_THRESHOLD);
            },
            
            setSelected: function(v) {
                this.callSuper(v);
                this.updateUI();
                
                this.bringToFront();
                
                // Update Connections
                const selected = this.selected,
                    connections = this.timeline.getConnectionsForEventBox(this);
                for (const connection of connections) {
                    connection.setStyle(selected ? {
                        color:colorUltraLight, cap:null, thickness:4, startAngle:'vertical', endAngle:'vertical', 
                        startCurvature:CURVATURE, endCurvature:CURVATURE, 
                        //endArrow:'triangle',
                        startStub:6, endStub:6, startGap:0, endGap:0
                    } : null);
                    if (connection.startView === this) {
                        connection.endView.setAdjacentIsSelected(selected);
                    } else {
                        connection.startView.setAdjacentIsSelected(selected);
                    }
                }
                
                // Update Exists
                this._updateExits(this.selected);
            },
            
            setAdjacentIsSelected: function(v) {
                this.set('adjacentIsSelected', v, true);
                this.updateUI();
            },
            
            doActivated: function() {
                this.timeline[this.selected ? 'deselect' : 'select'](this);
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
            
            _update: function() {
                const self = this,
                    {timeline, model, _label} = self,
                    start = model.getStart(),
                    end = model.getEnd(),
                    locId = model.getLocation(),
                    col = timeline.colsByLocId[locId];
                self.eventId = model.id;
                _label.setText(model.name || '');
                this.setTooltip(_label.text);
                self.setX(col.x + BOX_INSET_FROM_COL);
                
                const startPx = millisToPx(timeline, start),
                    endPx = millisToPx(timeline, end);
                
                self.setY(startPx);
                self.setHeight(endPx - startPx);
                
                // Update connections between boxes
                const endId = model.id,
                    flowLayer = timeline.flowLayer;
                for (const eventModel of model.getInfluencingEvents()) {
                    const startId = eventModel.id,
                        startBox = timeline.boxesByEventId[startId];
                    if (startBox) {
                        flowLayer.connect({
                            splineId:startId + '-' + endId,
                            start:{view:startBox, side:'bottom', position:'75%'},
                            end:{view:self, side:'top', position:'25%'}
                        });
                    }
                }
            },
            
            _updateExits: function(show) {
                const self = this,
                    {timeline, model} = self,
                    flowLayer = timeline.flowLayer,
                    exitsById = self._exitsById ??= {};
                
                // Update travel paths between boxes
                if (show) {
                    for (const exit of model.getExits()) {
                        const toBox = timeline.boxesByEventId[exit.getToEventModel()?.id];
                        if (toBox) {
                            const connection = flowLayer.connect({
                                start:{view:self, side:'bottom', position:'85%'},
                                end:{view:toBox, side:'top', position:'35%'},
                                style:{
                                    color:colorBtn, cap:null, thickness:1, startAngle:'vertical', endAngle:'vertical', 
                                    dash:1,
                                    startCurvature:CURVATURE, endCurvature:CURVATURE, 
                                    endArrow:'triangle',
                                    startStub:6, endStub:6, startGap:2, endGap:2
                                }
                            });
                            exitsById[connection.splineId] = connection;
                        }
                    } 
                } else {
                    for (const connectionId in exitsById) flowLayer.disconnect(connectionId);
                    self._exitsById = {};
                }
            }
        }),
        
        Tick = new JSClass('Tick', View, {
            initNode: function(parent, attrs) {
                const time = attrs.time,
                    timeline = this.timeline = attrs.timeline;
                delete attrs.time;
                delete attrs.timeline;
                
                attrs.bgColor ??= colorUltraDark;
                
                this.callSuper(parent, attrs);
                
                this._label = new PlainText(this, {
                    y:TICK_LABEL_ADJ, width:ROW_HEADER_WIDTH - 2*TICK_LABEL_ADJ,
                    textAlign:'right', text:format(time, timeline.scale)
                });
            }
        }),
        
        LocationColumn = new JSClass('LocationColumn', View, {
            initNode: function(parent, attrs) {
                const width = attrs.width ??= COL_WIDTH;
                
                this.callSuper(parent, attrs);
                
                (this._label = new PaddedPlainText(this, {
                    width:width, height:COL_HEADER_HEIGHT, bgColor:'#fff3', textAlign:'center',
                    paddingTop:5, paddingLeft:4, paddingRight:4
                })).enableEllipsis();
                
                this._update();
            },
            
            setModel: function(model) {
                if (this.model !== model) {
                    this.set('model', model, true);
                    if (this.inited) this._update();
                }
            },
            
            _update: function() {
                const {model, _label} = this;
                this.setBgColor(model.color || 'transparent');
                _label.setText(model.name || '');
            }
        });
    
    pkg.Timeline = new JSClass('Timeline', pkg.Panel, {
        include: [SelectionManager],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            attrs.maxSelected = 1;
            attrs.itemSelectionId = 'eventId';
            
            self.callSuper(parent, attrs);
            
            self.getContentView().setBgColor(colorMedium);
            
            // Build UI
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
                
                colHeadersContainer = self.colHeadersContainer = new View(stickyView, {x:ROW_HEADER_WIDTH, overflow:'hidden'}),
                colHeaders = self.colHeaders = new View(colHeadersContainer, {textColor:colorUltraDark}),
                
                rowHeadersContainer = self.rowHeadersContainer = new View(stickyView, {y:COL_HEADER_HEIGHT, overflow:'hidden'}),
                rowHeaders = self.rowHeaders = new View(rowHeadersContainer, {textColor:colorUltraDark}),
                
                flowContainer = self.flowContainer = new View(stickyView, {x:ROW_HEADER_WIDTH, y:COL_HEADER_HEIGHT, overflow:'hidden'}),
                flowLayer = self.flowLayer = new SplineFlow(flowContainer, {
                    defaultStyle:[
                        {
                            color:colorUltraLight, cap:null, thickness:1, startAngle:'vertical', endAngle:'vertical', 
                            startCurvature:CURVATURE, endCurvature:CURVATURE, 
                            //startArrow:'dot',
                            endArrow:'triangle',
                            startStub:6, endStub:6, startGap:2, endGap:2
                        }
                    ]
                });
            const flowSVG = flowLayer.getSVG();
            flowSVG.style.zIndex = 2;
            flowSVG.style.position = 'absolute';
            
            stickyView.getIDS().position = 'sticky';
            
            scrollCaptureView.getIDS().overscrollBehavior = 'none';
            self.scrollToken = new View(scrollCaptureView, {width:1, height:1});
            scrollCaptureView.attachToDom(scrollCaptureView, '_handleScroll', 'scroll');
            
            const hLine = self.hLine = new View(self, {y:COL_HEADER_HEIGHT, height:1, bgColor:colorUltraDark}),
                vLine = self.vLine = new View(self, {x:ROW_HEADER_WIDTH - 1, width:1, bgColor:colorUltraDark});
            hLine.getIDS().pointerEvents = 'none';
            vLine.getIDS().pointerEvents = 'none';
            
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
        doSelected: function() {this.fireEvent('selectionChanged', this.getSelected()[0]);},
        /** @overrides SelectionManager */
        doDeselected: function() {this.fireEvent('selectionChanged', this.getSelected()[0]);},
        
        getConnectionsForEventBox: function(eventBox) {
            return this.flowLayer.getConnections(eventBox);
        },
        
        setup: function(model) {
            this.model = model;
            refreshLocationColumns(this);
        },
        
        setTimeWindow: function(start, end, scale) {
            this.noTimeWindowRefresh = true;
            this.setStart(start);
            this.setEnd(end);
            this.setScale(scale);
            this.noTimeWindowRefresh = false;
            
            if (this.inited) refreshTimeWindow(this);
        }
    });
})(tc);