(pkg => {
    'use strict';
    
    let rootModel,
        gridWrapper;
    
    const JSClass = JS.Class,
        
        M = myt,
        {Grid:{SORT_ORDER_ASC}} = M,
        {
            GridColHdr, SimpleAgentGridMarker,
            timeUtil:{format},
            theme:{padding, spacing, btnHeight},
            cfg:{STANDARD_DEBOUNCE_MILLIS},
            SCOPE_EVENTS,
            I18N_HISTORICITY, I18N_ATTESTATION, I18N_PARADOX,
            STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_PARADOX
        } = pkg,
        
        STAT_COL_IDS = [STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_PARADOX],
        
        // The agents at an Event, as the timeline shows them: known agents, latest arrival first.
        getAgentsAt = eventModel => rootModel?.getAgentModelsForEvent(eventModel.id) ?? [],
        
        EventBar = new JS.Module('EventBar', {
            initNode: function(parent, attrs) {
                attrs.y = 10;
                attrs.showLabel = false;
                this.callSuper(parent, attrs);
            }
        }),
        EventHistoricityBar = new JSClass('EventHistoricityBar', pkg.HistoricityBar, {include: [EventBar]}),
        EventAttestationBar = new JSClass('EventAttestationBar', pkg.AttestationBar, {include: [EventBar]}),
        EventParadoxBar = new JSClass('EventParadoxBar', pkg.ParadoxBar, {include: [EventBar]}),
        
        /*  A marker for each agent at the Event. Clicking one selects the agent, and double
            clicking opens their dossier. */
        AgentsCell = new JSClass('AgentsCell', M.View, {
            initNode: function(parent, attrs) {
                this.colId = attrs.colId;
                delete attrs.colId;
                this.callSuper(parent, attrs);
                new M.SpacedLayout(this, {inset:padding/2, spacing:spacing/2});
            },
            
            setAgentModels: function(agentModels) {
                const self = this,
                    markers = self.getSubviews().filter(sv => sv.isA(SimpleAgentGridMarker));
                while (markers.length > agentModels.length) markers.pop().destroy();
                agentModels.forEach((agentModel, idx) => {
                    const marker = markers[idx] ?? new SimpleAgentGridMarker(self, {}, [{
                        doActivated: function() {
                            gridWrapper.parent.selectEvent(self.parent.model);
                        }
                    }]);
                    marker.setModel(agentModel);
                });
            }
        }),
        
        EventRow = new JSClass('EventRow', pkg.SelectableGridRow, {
            getColIds: () => ['name', 'start', 'end', 'duration', 'agents', ...STAT_COL_IDS],
            
            /*  Activating the selected Event shows it on the timeline. */
            doActivated: function() {
                if (this.selected) {
                    pkg.app.selectEventBox(this.model, true);
                } else {
                    this.callSuper();
                }
            },
            
            notifyCellUpdated: function(colId) {
                const eventModel = this.model,
                    cell = this.getRef(colId);
                switch (colId) {
                    case 'start':    cell.setText(format(eventModel.getStart())); break;
                    case 'end':      cell.setText(format(eventModel.getEnd())); break;
                    case 'duration': cell.setText(eventModel.getDuration(true)); break;
                    case 'agents':   cell.setAgentModels(getAgentsAt(eventModel)); break;
                    case STAT_ID_HISTORICITY:
                    case STAT_ID_ATTESTATION:
                    case STAT_ID_PARADOX:
                        cell.updateForStat(eventModel[colId]);
                        break;
                    default:
                        this.callSuper(colId);
                }
            },
            
            getCellClass: function(colId) {
                switch (colId) {
                    case 'agents': return AgentsCell;
                    case STAT_ID_HISTORICITY: return EventHistoricityBar;
                    case STAT_ID_ATTESTATION: return EventAttestationBar;
                    case STAT_ID_PARADOX: return EventParadoxBar;
                    default: return this.callSuper(colId);
                }
            },
            
            isPlainCell: function(colId) {
                return colId !== 'agents' && !STAT_COL_IDS.includes(colId) && this.callSuper(colId);
            }
        });
    
    /*  A grid of the known Events: their times, the agents at them and their stats. Its
        selection follows the timeline's, and selecting a row selects the Event. */
    pkg.Events = new JSClass('Events', pkg.TallView, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            gridWrapper = self.gridWrapper = new pkg.InfiniteGridWrapper(self, {
                selectable:true,
                rowClasses:EventRow,
                initialSort:['start', SORT_ORDER_ASC]
            }, [{
                makeGridHeaders: gridHeader => {
                    const WIDTH_NAME = 100,
                        WIDTH_WHEN = 125,
                        WIDTH_DURATION = 70,
                        WIDTH_AGENTS = 2*btnHeight + padding,
                        WIDTH_BAR = 70,
                        barAttrs = {minValue:WIDTH_BAR, maxValue:WIDTH_BAR, cellXAdj:padding/2, cellWidthAdj:-padding};
                    new GridColHdr(gridHeader, {columnId:'name',     minValue:WIDTH_NAME,     maxValue:1000,           text:'Name', flex:1});
                    new GridColHdr(gridHeader, {columnId:'start',    minValue:WIDTH_WHEN,     maxValue:WIDTH_WHEN,     text:'Start'});
                    new GridColHdr(gridHeader, {columnId:'end',      minValue:WIDTH_WHEN,     maxValue:WIDTH_WHEN,     text:'End'});
                    new GridColHdr(gridHeader, {columnId:'duration', minValue:WIDTH_DURATION, maxValue:WIDTH_DURATION, text:'Duration'});
                    new GridColHdr(gridHeader, {columnId:'agents',   minValue:WIDTH_AGENTS,   maxValue:1000,           text:'Agents', flex:1});
                    new GridColHdr(gridHeader, {columnId:STAT_ID_HISTORICITY, text:I18N_HISTORICITY, ...barAttrs});
                    new GridColHdr(gridHeader, {columnId:STAT_ID_ATTESTATION, text:I18N_ATTESTATION, ...barAttrs});
                    new GridColHdr(gridHeader, {columnId:STAT_ID_PARADOX,     text:I18N_PARADOX,     ...barAttrs});
                },
                doRowModelSelected: model => {
                    self.fireEvent('selectionChanged', model);
                },
                getTieBreakerSortFunction: (_sortColumnId, ascending) => {
                    const sortAsc = ascending ? 1 : -1;
                    return (a, b) => a.id.localeCompare(b.id) * sortAsc;
                },
                getFilterFunction: () => eventModel => eventModel.isNotHidden(),
                getSortFunction: function(sortColumnId, ascending, tieBreakerSortFunc) {
                    const sortAsc = ascending ? 1 : -1,
                        byNumber = getValue => (a, b) => {
                            const vA = getValue(a),
                                vB = getValue(b);
                            if (vA === vB) return tieBreakerSortFunc(a, b);
                            return (vA - vB) * sortAsc;
                        };
                    switch (sortColumnId) {
                        case 'start':    return byNumber(eventModel => eventModel.getStart());
                        case 'end':      return byNumber(eventModel => eventModel.getEnd());
                        case 'duration': return byNumber(eventModel => eventModel.getDuration());
                        case 'agents':   return byNumber(eventModel => getAgentsAt(eventModel).length);
                        case STAT_ID_HISTORICITY:
                        case STAT_ID_ATTESTATION:
                        case STAT_ID_PARADOX:
                            return byNumber(eventModel => eventModel[sortColumnId].getValue());
                        default:
                            return this.callSuper(sortColumnId, ascending, tieBreakerSortFunc);
                    }
                }
            }]);
            
            self.ready = true;
            
            // Apply Size
            self.setWidth(self.width);
            self.setHeight(self.height);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setWidth: function(v) {
            this.callSuper(v);
            if (this.ready) gridWrapper.setWidth(this.width);
        },
        
        setHeight: function(v) {
            this.callSuper(v);
            if (this.ready) gridWrapper.setHeight(this.height);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Selects the Event's row, or clears the selection when given nothing. */
        selectEvent: M.debounce(function(eventModel) {
            const grid = gridWrapper.getGrid();
            if (grid.selectedRowModel !== eventModel) {
                if (eventModel) {
                    gridWrapper.selectRowForModelOrId(eventModel);
                } else {
                    grid.setSelectedRowModel(null);
                    grid.refreshListUI();
                }
            }
        }, STANDARD_DEBOUNCE_MILLIS),
        
        getSelectedEventId: function() {
            return gridWrapper.getGrid().selectedRowModel?.id ?? null;
        },
        
        setup: function(model) {
            rootModel = model;
            gridWrapper.setModelCollection(rootModel[SCOPE_EVENTS]);
        }
    });
})(tc);
