(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {Grid:{SORT_ORDER_ASC}} = myt,
        {
            GridColHdr, GridCellBtn, SimpleAgentGridMarker,
            timeUtil:{format},
            theme:{padding, colorParadox, colorChronal, fontFamilyMono, btnHeight},
            SCOPE_AGENTS,
            ICON_NAV_FORWARD, I18N_CHRONAL, I18N_PARADOX,
            STAT_ID_CHRONAL, STAT_ID_PARADOX
        } = pkg,
        
        updateBtnCell = (row, colId, eventExistsTxtFunc) => {
            const event = row.model.getEventModel(),
                cell = row.getRef(colId);
            cell.setText(event ? eventExistsTxtFunc(event) : 'unknown');
            cell.setDisabled(!event);
        },
        
        AgentBar = new JS.Module('AgentBar', {
            initNode: function(parent, attrs) {
                attrs.y = 10;
                attrs.showLabel = false;
                this.callSuper(parent, attrs);
            }
        }),
        AgentParadoxBar = new JSClass('AgentParadoxBar', pkg.ParadoxBar, {include: [AgentBar]}),
        AgentChronalBar = new JSClass('AgentChronalBar', pkg.ChronalBar, {include: [AgentBar]}),
        
        AgentRow = new JSClass('AgentRow', pkg.SelectableGridRow, {
            getColIds: () => ['id','name','event','where','when',STAT_ID_PARADOX,STAT_ID_CHRONAL],
            supportsDoubleClick: () => true,
            doDoubleClick: function() {
                this.doCellBtnActivated('event');
            },
            notifyCellUpdated: function(colId) {
                let eventExistsTxtFunc;
                switch (colId) {
                    case 'id':
                        this.getRef(colId).setModel(this.model);
                        return;
                    case 'event': eventExistsTxtFunc = event => event.name + ' ' + ICON_NAV_FORWARD; break;
                    case 'where': eventExistsTxtFunc = event => event.getLocationModel()?.name;      break;
                    case 'when':  eventExistsTxtFunc = event => format(event.getStart());            break;
                    case STAT_ID_PARADOX:
                    case STAT_ID_CHRONAL:
                        this.getRef(colId).updateForStat(this.model[colId]);
                        return;
                }
                if (eventExistsTxtFunc) {
                    updateBtnCell(this, colId, eventExistsTxtFunc);
                } else {
                    this.callSuper(colId);
                }
            },
            getCellClass: function(colId) {
                switch (colId) {
                    case 'id':
                        return SimpleAgentGridMarker;
                    case 'event':
                    case 'where':
                    case 'when':
                        return GridCellBtn;
                    case STAT_ID_PARADOX:
                        return AgentParadoxBar;
                    case STAT_ID_CHRONAL:
                        return AgentChronalBar;
                    default:
                        return this.callSuper(colId);
                }
            },
            isPlainCell: function(colId) {
                switch (colId) {
                    case STAT_ID_PARADOX:
                    case STAT_ID_CHRONAL:
                        return false;
                    default:
                        return this.callSuper(colId);
                }
            },
            doCellBtnActivated: function(colId) {
                switch (colId) {
                    case 'event':
                        pkg.app.selectEventBox(this.model.getEventModel());
                        break;
                    case 'where':
                        pkg.app.getTimelineView().scrollToLocation(this.model.getEventModel().getLocation());
                        break;
                    case 'when':
                        pkg.app.getTimelineView().scrollToTime(this.model.getEventModel()?.getStart());
                        break;
                }
            }
        });
    
    pkg.Agents = new JSClass('Agents', pkg.Panel, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            const header = self.getHeaderView();
            self.chronalBar = new pkg.ChronalBar(header, {
                valign:'middle', labelTemplate:'{label} Pool'
            }, [pkg.BigStatBar]);
            
            self.gridWrapper = new pkg.InfiniteGridWrapper(self, {
                selectable:true,
                rowClasses:AgentRow,
                initialSort:['id', SORT_ORDER_ASC]
            }, [{
                makeGridHeaders: gridHeader => {
                    const WIDTH_ID = btnHeight + padding,
                        WIDTH_MISC = 70,
                        WIDTH_WHEN = 150,
                        WIDTH_BAR = 65;
                    new GridColHdr(gridHeader, {columnId:'id',            minValue:WIDTH_ID,   maxValue:WIDTH_ID,   text:'ID',         cellXAdj:padding,   cellWidthAdj:-padding});
                    new GridColHdr(gridHeader, {columnId:'name',          minValue:WIDTH_MISC, maxValue:2000,       text:'Name',  flex:1});
                    new GridColHdr(gridHeader, {columnId:'event',         minValue:WIDTH_MISC, maxValue:2000,       text:'Event', flex:1});
                    new GridColHdr(gridHeader, {columnId:'where',         minValue:WIDTH_MISC, maxValue:2000,       text:'Where', flex:1});
                    new GridColHdr(gridHeader, {columnId:'when',          minValue:WIDTH_WHEN, maxValue:WIDTH_WHEN, text:'When'});
                    new GridColHdr(gridHeader, {columnId:STAT_ID_PARADOX, minValue:WIDTH_BAR,  maxValue:WIDTH_BAR,  text:I18N_PARADOX, cellXAdj:padding/2, cellWidthAdj:-padding});
                    new GridColHdr(gridHeader, {columnId:STAT_ID_CHRONAL, minValue:WIDTH_BAR,  maxValue:WIDTH_BAR,  text:I18N_CHRONAL, cellXAdj:padding/2, cellWidthAdj:-padding});
                },
                doRowModelSelected: model => {
                    self.fireEvent('selectionChanged', model);
                },
                getTieBreakerSortFunction: (sortColumnId, ascending) => {
                    const sortAsc = ascending ? 1 : -1;
                    return (a, b) => a.id.localeCompare(b.id) * sortAsc;
                },
                getSortFunction: function(sortColumnId, ascending, tieBreakerSortFunc) {
                    const sortAsc = ascending ? 1 : -1;
                    switch (sortColumnId) {
                        case 'event':
                            return (a, b) => {
                                const eventA = a.getEventModel(),
                                    eventB = b.getEventModel();
                                if (!eventA) {
                                    if (!eventB) {
                                        return tieBreakerSortFunc(a, b);
                                    } else {
                                        return sortAsc;
                                    }
                                } else if (!eventB) {
                                    return -sortAsc;
                                } else {
                                    const vA = eventA.name,
                                        vB = eventB.name;
                                    if (vA === vB) return tieBreakerSortFunc(a, b);
                                    return vA.localeCompare(vB) * sortAsc;
                                }
                            };
                        case 'where':
                            return (a, b) => {
                                const locA = a.getEventModel()?.getLocationModel(),
                                    locB = b.getEventModel()?.getLocationModel();
                                if (!locA) {
                                    if (!locB) {
                                        return tieBreakerSortFunc(a, b);
                                    } else {
                                        return sortAsc;
                                    }
                                } else if (!locB) {
                                    return -sortAsc;
                                } else {
                                    const vA = locA.name,
                                        vB = locB.name;
                                    if (vA === vB) return tieBreakerSortFunc(a, b);
                                    return vA.localeCompare(vB) * sortAsc;
                                }
                            };
                        case 'when':
                            return (a, b) => {
                                const eventA = a.getEventModel(),
                                    eventB = b.getEventModel();
                                if (!eventA) {
                                    if (!eventB) {
                                        return tieBreakerSortFunc(a, b);
                                    } else {
                                        return sortAsc;
                                    }
                                } else if (!eventB) {
                                    return -sortAsc;
                                } else {
                                    const vA = eventA.getStart(),
                                        vB = eventB.getStart();
                                    if (vA === vB) return tieBreakerSortFunc(a, b);
                                    return (vA - vB) * sortAsc;
                                }
                            };
                        case STAT_ID_PARADOX:
                        case STAT_ID_CHRONAL:
                            return (a, b) => {
                                const vA = a[sortColumnId].getValue(),
                                    vB = b[sortColumnId].getValue();
                                if (vA === vB) return tieBreakerSortFunc(a, b);
                                return (vA - vB) * sortAsc;
                            };
                        default:
                            return this.callSuper(sortColumnId, ascending, tieBreakerSortFunc);
                    }
                },
                doOnFirstRefresh: () => {
                    self.selectAgent(self.model.getInitialAgentSelection());
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
            if (this.ready) this.gridWrapper.setWidth(this.getContentView().width);
        },
        
        setHeight: function(v) {
            this.callSuper(v);
            if (this.ready) this.gridWrapper.setHeight(this.getContentView().height);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        selectAgent: function(agentModelOrId) {
            this.gridWrapper.selectRowForModelOrId(agentModelOrId);
        },
        
        setup: function(model) {
            this.model = model;
            this.chronalBar.watchStatModel(model[STAT_ID_CHRONAL]);
            this.gridWrapper.setModelCollection(model[SCOPE_AGENTS]);
        }
    });
})(tc);