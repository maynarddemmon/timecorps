(pkg => {
    'use strict';
    
    let rootModel,
        gridWrapper,
        
        // True while the selection is following the current mission, so it isn't sent back. The
        // follow is debounced, so it could otherwise undo a newer selection.
        isFollowing = false;
    
    const JSClass = JS.Class,
        
        M = myt,
        {Grid:{SORT_ORDER_ASC}} = M,
        {
            GridColHdr,
            cfg:{STANDARD_DEBOUNCE_MILLIS},
            SCOPE_OPERATIONS,
            OPERATION_STATE_COMPLETED
        } = pkg,
        
        // Completed missions sort after the ones still in play, and the rest stay in the
        // order the data gives them.
        getStateRank = operationModel => operationModel.getState() === OPERATION_STATE_COMPLETED ? 1 : 0,
        getDataOrder = operationModel => rootModel.getOperationModelsAsList().indexOf(operationModel),
        
        formatProgress = operationModel => {
            const {success, total} = operationModel.getProgress();
            return success + ' / ' + total;
        },
        
        MissionRow = new JSClass('MissionRow', pkg.SelectableGridRow, {
            getColIds: () => ['name', 'state', 'progress'],
            
            notifyCellUpdated: function(colId) {
                const operationModel = this.model,
                    cell = this.getRef(colId);
                switch (colId) {
                    case 'state':    cell.setText(operationModel.getState()); break;
                    case 'progress': cell.setText(formatProgress(operationModel)); break;
                    default:
                        this.callSuper(colId);
                }
            }
        });
    
    /*  A grid of the revealed missions: their state and how many of their Objectives are
        met. Its selection is the current mission, so selecting a row makes it current. */
    pkg.Missions = new JSClass('Missions', pkg.TallView, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            gridWrapper = self.gridWrapper = new pkg.InfiniteGridWrapper(self, {
                selectable:true,
                rowClasses:MissionRow,
                initialSort:['state', SORT_ORDER_ASC]
            }, [{
                makeGridHeaders: gridHeader => {
                    const WIDTH_NAME = 100,
                        WIDTH_STATE = 90,
                        WIDTH_PROGRESS = 80;
                    new GridColHdr(gridHeader, {columnId:'name',     minValue:WIDTH_NAME,     maxValue:1000,           text:'Name', flex:1});
                    new GridColHdr(gridHeader, {columnId:'state',    minValue:WIDTH_STATE,    maxValue:WIDTH_STATE,    text:'State'});
                    new GridColHdr(gridHeader, {columnId:'progress', minValue:WIDTH_PROGRESS, maxValue:WIDTH_PROGRESS, text:'Progress'});
                },
                doRowModelSelected: model => {
                    if (!isFollowing) self.fireEvent('selectionChanged', model);
                },
                getTieBreakerSortFunction: (_sortColumnId, ascending) => {
                    const sortAsc = ascending ? 1 : -1;
                    return (a, b) => (getDataOrder(a) - getDataOrder(b)) * sortAsc;
                },
                getFilterFunction: () => operationModel => operationModel.isNotHidden(),
                getSortFunction: function(sortColumnId, ascending, tieBreakerSortFunc) {
                    const sortAsc = ascending ? 1 : -1,
                        byNumber = getValue => (a, b) => {
                            const vA = getValue(a),
                                vB = getValue(b);
                            if (vA === vB) return tieBreakerSortFunc(a, b);
                            return (vA - vB) * sortAsc;
                        };
                    switch (sortColumnId) {
                        case 'state':    return byNumber(getStateRank);
                        case 'progress': return byNumber(operationModel => {
                            const {success, total} = operationModel.getProgress();
                            return total === 0 ? 1 : success / total;
                        });
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
        /*  Selects the mission's row, or clears the selection when given nothing. */
        selectOperation: M.debounce(operationModel => {
            const grid = gridWrapper.getGrid();
            if (grid.selectedRowModel !== operationModel) {
                isFollowing = true;
                if (operationModel) {
                    gridWrapper.selectRowForModelOrId(operationModel);
                } else {
                    grid.setSelectedRowModel(null);
                    grid.refreshListUI();
                }
                isFollowing = false;
            }
        }, STANDARD_DEBOUNCE_MILLIS),
        
        setup: function(model) {
            rootModel = model;
            gridWrapper.setModelCollection(rootModel[SCOPE_OPERATIONS]);
        }
    });
})(tc);
