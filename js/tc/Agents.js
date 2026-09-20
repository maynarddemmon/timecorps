(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {Grid:{SORT_ORDER_ASC}} = myt,
        {
            InfiniteGridWrapper, GridColHdr, GridCellBtn, 
            SimpleAgentGridMarker,
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
        
        AgentRow = new JSClass('AgentRow', pkg.SelectableGridRow, {
            initNode: function(parent, attrs) {
                this.callSuper(parent, attrs);
                
                const cellParadox = this.getRef(STAT_ID_PARADOX),
                    cellChronal = this.getRef(STAT_ID_CHRONAL);
                cellParadox.setTextColor(colorParadox);
                cellParadox.setFontFamily(fontFamilyMono);
                cellParadox.setTextAlign('center');
                cellChronal.setTextColor(colorChronal);
                cellChronal.setFontFamily(fontFamilyMono);
                cellChronal.setTextAlign('center');
            },
            
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
                        const statModel = this.model[colId];
                        this.getRef(colId).setText(
                            statModel.formatAsPercent(), 
                            statModel.formatVerbose()
                        );
                        return;
                    case STAT_ID_CHRONAL: {
                        const statModel = this.model[colId];
                        this.getRef(colId).setText(
                            statModel.formatAsBracketFraction(), 
                            statModel.formatVerbose()
                        );
                        return;
                    }
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
                        pkg.app.getTimelineView().doSelectEvent(this.model.getEventModel(), true);
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
            
            self.gridWrapper = new InfiniteGridWrapper(self, {
                selectable:true,
                rowClasses:AgentRow,
                initialSort:['id', SORT_ORDER_ASC]
            }, [{
                makeGridHeaders: gridHeader => {
                    new GridColHdr(gridHeader, {columnId:'id',            minValue:btnHeight + padding, maxValue:btnHeight + padding, cellXAdj:padding, cellWidthAdj:-padding, text:'ID'});
                    new GridColHdr(gridHeader, {columnId:'name',          minValue:70, maxValue:2000, flex:1, text:'Name'});
                    new GridColHdr(gridHeader, {columnId:'event',         minValue:70, maxValue:2000, flex:1, text:'Event'});
                    new GridColHdr(gridHeader, {columnId:'where',         minValue:70, maxValue:2000, flex:1, text:'Where'});
                    new GridColHdr(gridHeader, {columnId:'when',          minValue:70, maxValue:2000, flex:1, text:'When'});
                    new GridColHdr(gridHeader, {columnId:STAT_ID_PARADOX, minValue:70, maxValue:70, text:I18N_PARADOX});
                    new GridColHdr(gridHeader, {columnId:STAT_ID_CHRONAL, minValue:70, maxValue:70, text:I18N_CHRONAL});
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