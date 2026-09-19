(pkg => {
    const JSClass = JS.Class,
        
        M = myt,
        {View, PaddedText, PlainText, NOOP} = M,
        
        {
            Btn,
            theme:{
                rowHeight,
                colorBtn, colorUltraLight, colorExtraLight, colorLight, colorMedLight, colorMedium,
                colorDark, colorUltraDark, colorMegaDark
            }
        } = pkg,
        
        GridColHdr = pkg.GridColHdr = new JSClass('GridColHdr', M.SimpleGridColHdr, {
            initNode: function(parent, attrs) {
                attrs.activeColor ??= colorMegaDark;
                attrs.hoverColor ??= colorDark;
                attrs.readyColor ??= colorUltraDark;
                attrs.textColor ??= colorBtn;
                attrs.height ??= rowHeight;
                attrs.inset ??= 7;
                
                // Use the parent as the default GridController.
                attrs.gridController ??= parent;
                
                this.callSuper(parent, attrs);
            }
        }),
        
        GridCell = pkg.GridCell = new JSClass('GridCell', M.GridCell, {
            /** @overrides */
            initNode: function(parent, attrs) {
                this.colId = attrs.colId;
                delete attrs.colId;
                
                attrs.height ??= rowHeight;
                attrs.paddingTop ??= 5;
                attrs.paddingRight ??= 7;
                attrs.paddingBottom ??= 5;
                attrs.paddingLeft ??= 7;
                
                this.callSuper(parent, attrs);
            }
        }),
        
        PlainGridCell = pkg.PlainGridCell = new JSClass('PlainGridCell', GridCell, {
            include:[M.PlainTextSupport],
        }),
        
        GridCellBtn = pkg.GridCellBtn = new JSClass('GridCellBtn', Btn, {
            include: [M.MouseEventsBubbleUp],
            
            initNode: function(parent, attrs) {
                this.colId = attrs.colId;
                delete attrs.colId;
                
                attrs.tagName = 'div'; // button has some different layut quirks so use div.
                attrs.paddingTop ??= 4;
                attrs.paddingBottom ??= 4;
                attrs.y ??= 1;
                attrs.buttonType ??= 'plain';
                attrs.textAlign ??= 'left';
                
                // If whiteSpace or overflow is being set then don't enable ellipsis since that
                // messed with the white-space and overflow CSS property.
                const enableEllipsis = attrs.whiteSpace == null && attrs.overflow == null;
                
                this.callSuper(parent, attrs);
                
                if (enableEllipsis) this.enableEllipsis();
            },
            doActivated: function() {
                this.parent.doCellBtnActivated(this.colId);
            },
            setWidth:function(v) {this.callSuper(v - 3);}, // Compensate for border and 1px of spacing
            setHeight:function(v) {this.callSuper(v - 2);} // Compensate for border
        }),
        
        GridRowMixin = pkg.GridRowMixin = new JS.Module('GridRowMixin', {
            initNode: function(parent, attrs) {
                const self = this;
                self.callSuper(parent, attrs);
                for (const colId of self.getColIds()) {
                    self.addRef(colId, new (self.getCellClass(colId))(self, {colId}));
                }
            },
            
            getColIds: () => [], // Subclasses should override
            getCellClass: function(colId) {
                return this.isPlainCell(colId) ? PlainGridCell : GridCell;
            },
            isPlainCell: M.TRUE_FUNC, // colId => {return <boolean>}
            
            setModel: function(v) {
                this.callSuper(v);
                if (this.inited) this.notifyModelUpdated();
            },
            
            notifyModelUpdated: function() {
                for (const colId of this.getColIds()) this.notifyCellUpdated(colId);
            },
            notifyCellUpdated: function(colId) {
                this.getRef(colId).setText(this.model[colId]);
            }
        });
    
    pkg.GridRow = new JSClass('GridRow', View, {
        include: [M.InfiniteGridRow, GridRowMixin]
    });
    
    pkg.SelectableGridRow = new JSClass('SelectableGridRow', M.SimpleSelectableInfiniteGridRow, {
        include: [GridRowMixin],
        
        initNode: function(parent, attrs) {
            attrs.activeColor ??= colorMedLight;
            attrs.hoverColor ??= colorExtraLight;
            attrs.selectedColor ??= colorBtn;
            attrs.readyColor ??= colorLight;
            
            this.callSuper(parent, attrs);
        },
        
        __DblClk: function(_event) {
            if (!this.disabled) this.doDoubleClick();
        },
        
        supportsDoubleClick: M.FALSE_FUNC, // () => {return <boolean>}
        
        doDoubleClick: NOOP,
        
        updateUI: function() {
            this.callSuper();
            const textColor = this.selected ? colorUltraLight : null;
            this.setTextColor(textColor);
            for (const sv of this.getSubviews()) {
                if (sv.isA(GridCellBtn)) {
                    sv.setTextColor(textColor);
                    // Work around undesirable behavior in View.setTextColor
                    if (textColor == null) sv.getODS().removeProperty('color');
                }
            }
        },
        
        notifyModelUpdated: function() {
            const self = this;
            self.callSuper();
            
            self.detachFromDom(self, '__DblClk', 'dblclick');
            if (self.supportsDoubleClick()) self.attachToDom(self, '__DblClk', 'dblclick');
        }
    });
    
    pkg.InfiniteGridWrapper = new JSClass('InfiniteGridWrapper', View, {
        initNode: function(parent, attrs) {
            const self = this,
                {rowClasses, initialSort, modelCollection, selectable} = attrs;
            delete attrs.rowClasses;
            delete attrs.initialSort;
            delete attrs.modelCollection;
            delete attrs.selectable;
            
            attrs.overflow ??= 'autox';
            
            self.callSuper(parent, attrs);
            
            const gridHeader = self.__gridHeader = new M.InfiniteGridHeader(self, {
                bgColor:colorDark,
                height:rowHeight,
                columnSpacing:0
            }, [{
                initNode: function(parent, attrs) {
                    attrs.boxShadow = [0, 0, 12, 'rgba(0,0,0,0.5)'];
                    attrs.zIndex ??= 1;
                    this.callSuper(parent, attrs);
                    this.getIDS().clipPath = 'inset(0px 0px -15px 0px)';
                },
                doSort: function() {
                    this.persistSort();
                    self.refreshGrid();
                }
            }]);
            self.makeGridHeaders(gridHeader);
            
            const grid = self.__grid = new M[selectable ? 'SelectableInfiniteGrid' : 'InfiniteGrid'](self, {
                rowClasses:rowClasses,
                gridHeader:gridHeader,
                rowHeight:rowHeight,
                rowSpacing:1,
                layoutHint:1,
                bgColor:colorMedium,
                textColor:colorDark
            }, [{
                getSortFunction: () => {
                    const [sortColumnId, sortOrder] = gridHeader.sort ?? ['',''],
                        ascending = sortOrder === M.Grid.SORT_ORDER_ASC;
                    if (sortColumnId) return self.getSortFunction(sortColumnId, ascending, self.getTieBreakerSortFunction(sortColumnId, ascending));
                },
                getFilterFunction: () => self.getFilterFunction(),
                
                // Only used by SelectableInfiniteGrid
                setSelectedRowModel: function(v) {
                    this.callSuper(v);
                    self.doRowModelSelected(v);
                }
            }]);
            grid.getListView().setBandedBg([colorLight, rowHeight, colorMedium, 1]);
            
            //pkg.makeOSScrollbarSpacer(self);
            new M.ResizeLayout(self, {axis:'y', spacing:1});
            
            // Setup debounced refreshGrid so it is unique per instance.
            self.refreshGrid = M.debounce(self.__refreshGrid, 100);
            
            self.setModelCollection(modelCollection);
            
            grid.makeReady(initialSort);
            gridHeader.fitHeadersToWidth();
        },
        
        getGridHeader: function() {return this.__gridHeader;},
        getGrid: function() {return this.__grid;},
        
        setModelCollection: function(v) {
            this.releaseConstraint('refreshGrid');
            this.set('modelCollection', v, true);
            if (v) {
                this.getGrid().setCollectionModel(v);
                this.constrain('refreshGrid', [v, 'added', v, 'updated', v, 'removed']);
                this.refreshGrid();
            }
        },
        
        setWidth: function(v) {
            this.callSuper(v);
            if (this.inited) this.getGridHeader().setWidth(this.width);
        },
        
        makeGridHeaders: NOOP, // gridHeader => {} subclasses should implement.
        getSortFunction: (sortColumnId, ascending, tieBreakerSortFunc) => {
            const sortAsc = ascending ? 1 : -1;
            return (a, b) => {
                let vA = a[sortColumnId],
                    vB = b[sortColumnId];
                if (typeof vA === 'number' && typeof vB === 'number') {
                    // Numeric sort
                    if (vA === vB && tieBreakerSortFunc) return tieBreakerSortFunc(a, b);
                    return (vA - vB) * sortAsc;
                } else {
                    // Cast to String and sort case-insensitive
                    vA = ('' + vA).toLowerCase();
                    vB = ('' + vB).toLowerCase();
                    if (vA === vB && tieBreakerSortFunc) return tieBreakerSortFunc(a, b);
                    return vA.localeCompare(vB) * sortAsc;
                }
            };
        },
        getTieBreakerSortFunction: NOOP, // (sortColumnId, ascending) => {}
        getFilterFunction: NOOP, // () => {} subclasses must implement.
        
        __refreshGrid: function() {
            this.getGrid().refreshListData(true, true);
            if (!this._notFirstTime) {
                this._notFirstTime = true;
                this.doOnFirstRefresh();
            }
        },
        
        doOnFirstRefresh: NOOP, // () => {}
        
        doRowModelSelected: NOOP, // model => {}
        
        /*  Use this to update the selection from external sources. */
        selectRowForModelOrId: function(modelOrId) {
            if (typeof modelOrId === 'string') {
                modelOrId = this.modelCollection.getById(modelOrId);
            }
            this.getGrid().selectRowForModel(modelOrId);
        }
    });
})(tc);
