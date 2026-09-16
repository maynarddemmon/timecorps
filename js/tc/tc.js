(pkg => {
    const {Class:JSClass, Module:JSModule} = JS,
        
        {
            min:mathMin, max:mathMax, round:mathRound, ceil:mathCeil, floor:mathFloor, 
            log2:mathLog2, log10:mathLog10, abs:mathAbs, trunc:mathTrunc
        } = Math,
        
        M = myt,
        {
            View, PaddedText, PlainText, ResizeLayout, SizeToParent,
            NOOP, FALSE_FUNC, TRUE_FUNC
        } = M,
        
        // Game Properties /////////////////////////////////////////////////////
        EVENT_ID_THE_VOID = 'the_void',
        EVENT_ID_TIME_CORPS_HQ = 'time_corps_hq',
        
        MIN_DEPLOY_CHRONAL = 1,
        MIN_RECALL_CHRONAL = 1,
        
        
        // Theme ///////////////////////////////////////////////////////////////
        layoutSpacing = 1,
        spacing = 2,
        padding = 8,
        cornerRadius = 5,
        btnHeight = 24,
        rowHeight = 26,
        colorMegaDark = '#310',
        colorUltraDark = '#420',
        colorDark = '#530',
        colorMedium = '#990',
        colorMedLight = '#bb0',
        colorLight = '#cc0',
        colorExtraLight = '#dd0',
        colorUltraLight = '#ff9',
        colorBtn = '#a50',
        fontSizeMedium = '14px',
        fontSizeLarge = '16px',
        fontSizeVeryLarge = '20px',
        fontFamilyMono = 'SpaceMono',
        
        theme = {
            layoutSpacing, spacing, padding, cornerRadius, btnHeight, rowHeight,
            colorMegaDark, colorUltraDark, colorDark, colorMedium, colorLight, colorUltraLight, colorBtn,
            fontSizeMedium, fontSizeLarge, fontSizeVeryLarge,
            fontFamilyMono
        },
        
        
        // UI Classes //////////////////////////////////////////////////////////
        Spacer = new JSClass('Spacer', View, {
            initNode: function(parent, attrs) {
                attrs.layoutHint ??= 1;
                this.callSuper(parent, attrs);
            }
        }),
        
        WideView = new JSClass('WideView', View, {
            include: [SizeToParent],
            
            initNode: function(parent, attrs) {
                attrs.percentOfParentWidth ??= 100;
                this.callSuper(parent, attrs);
            }
        }),
        
        TallView = new JSClass('TallView', View, {
            include: [SizeToParent],
            
            initNode: function(parent, attrs) {
                attrs.percentOfParentHeight ??= 100;
                this.callSuper(parent, attrs);
            }
        }),
        
        Panel = new JSClass('Panel', View, {
            initNode: function(parent, attrs) {
                attrs.defaultPlacement = '_contentView';
                
                const title = attrs.title ?? '';
                delete attrs.title
                
                this.callSuper(parent, attrs);
                
                const headerView = this._headerView = new WideView(this, {ignorePlacement:true, height:rowHeight, bgColor:colorDark});
                (this._titleView = new PlainText(headerView, {text:title, tooltip:title, textColor:colorMedium, fontSize:fontSizeVeryLarge, y:1, layoutHint:1})).enableEllipsis();
                new ResizeLayout(headerView, {inset:padding, spacing:spacing, outset:padding});
                
                const y = headerView.y + headerView.height + layoutSpacing;
                this._contentView = new WideView(this, {
                    ignorePlacement:true, overflow:'auto', y, percentOfParentHeight:100, percentOfParentHeightOffset:-y,
                    bgColor:colorUltraDark, textColor:colorUltraLight
                });
            },
            
            setTitle: function(v) {
                this._titleView.setText(v);
                this._titleView.setTooltip(v);
            },
            
            getHeaderView: function() {return this._headerView;},
            getContentView: function() {return this._contentView;}
        }),
        
        MiniPanel = new JSClass('MiniPanel', Panel, {
            initNode: function(parent, attrs) {
                this.callSuper(parent, attrs);
                this._titleView.setY(4);
                this._titleView.setFontSize(fontSizeMedium);
                this.syncTo(this._contentView, '_updateHeight', 'height');
            },
            _updateHeight: function(_event) {
                const contentView = this.getContentView();
                this.setHeight(contentView.y + contentView.height);
            }
        }),
        
        LabeledValue = new JSClass('LabeledValue', PaddedText, {
            initNode: function(parent, attrs) {
                attrs.paddingLeft ??= padding;
                attrs.paddingRight ??= spacing;
                attrs.textColor ??= colorMedium;
                attrs.fontSize ??= fontSizeLarge;
                attrs.y ??= 1;
                
                this.callSuper(parent, attrs);
                this.update();
            },
            
            setLabel: function(v) {
                this.set('label', v, true);
                if (this.inited) this.updateText();
            },
            
            setValue: function(v) {
                this.set('value', v, true);
                if (this.inited) this.updateText();
            },
            
            update: function(v) {
                this.setValue(v ?? '-');
            },
            
            updateText: function() {
                this.setText(this.label + ' : <span style="color:' + colorBtn + '; font-family:' + fontFamilyMono + ';">' + this.value + '</span>');
            }
        }),
        
        updateBtnIcon = btn => {
            const {icon, iconSize, iconX, iconY} = btn;
            let iconView = btn.getIconView();
            if (icon) {
                if (!iconView) iconView = btn.__iconView = new PlainText(btn);
                iconView.setX(iconX);
                iconView.setY(iconY);
                iconView.setText(icon);
                iconView.setFontSize(iconSize);
                iconView.setVisible(true);
            } else {
                iconView?.setVisible(false);
            }
            btn.sizeViewToDom();
        },
        
        Btn = new JSClass('Btn', M.PaddedPlainText, {
            include: [M.Button],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            initNode: function(parent, attrs) {
                // Do disabled late since domClass will step on it.
                this.appendToLateAttrs('disabled');
                
                attrs.userUnselectable ??= true;
                attrs.tagName ??= 'button';
                attrs.focusable ??= true;
                attrs.focusIndicator ??= false;
                attrs.height ??= btnHeight;
                
                attrs.paddingLeft ??= 8;
                attrs.paddingRight ??= 8;
                
                const buttonType = attrs.buttonType || '';
                delete attrs.buttonType;
                
                this.callSuper(parent, attrs);
                this.addDomClass('tc-Btn', buttonType);
                
                updateBtnIcon(this);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setButtonType: function(v) {
                this.setDomClass('tc-Btn ' + (v || ''));
                if (this.disabled) this.addDomClass('disabled');
            },
            
            /** @overrides */
            setDisabled: function(v) {
                if (this.disabled !== v) {
                    this.callSuper(v);
                    
                    this.removeDomClass('disabled');
                    if (this.disabled) this.addDomClass('disabled');
                }
            },
            
            setIcon: function(v) {
                this.set('icon', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            setIconSize: function(v) {
                this.set('iconSize', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            setIconX: function(v) {
                this.set('iconX', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            setIconY: function(v) {
                this.set('iconY', v, true);
                if (this.inited) updateBtnIcon(this);
            },
            
            getIconView: function() {
                return this.__iconView;
            }
        }),
        
        SquareBtn = new JSClass('SquareBtn', Btn, {
            initNode: function(parent, attrs) {
                attrs.width ??= btnHeight;
                attrs.paddingLeft ??= 0;
                attrs.paddingRight ??= 0;
                
                this.callSuper(parent, attrs);
            }
        }),
        
        
        // Grids ///////////////////////////////////////////////////////////////
        InfiniteGridWrapper = new JSClass('InfiniteGridWrapper', View, {
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
                new ResizeLayout(self, {axis:'y', spacing:1});
                
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
                if (this.inited) {
                    this.getGridHeader().setWidth(this.width);
                }
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
            },
            
            doRowModelSelected: NOOP, // model => {}
            
            /*  Use this to update the selection from external sources. */
            selectRowForModelOrId: function(modelOrId) {
                if (typeof modelOrId === 'string') {
                    modelOrId = this.modelCollection.getById(modelOrId);
                }
                this.getGrid().selectRowForModel(modelOrId);
            }
        }),
        
        GridColHdr = new JSClass('GridColHdr', M.SimpleGridColHdr, {
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
        
        GridCell = new JSClass('GridCell', M.GridCell, {
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
        
        PlainGridCell = new JSClass('PlainGridCell', GridCell, {
            include:[M.PlainTextSupport],
        }),
        
        GridCellBtn = new JSClass('GridCellBtn', Btn, {
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
        
        GridRowMixin = new JSModule('GridRowMixin', {
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
            isPlainCell: TRUE_FUNC, // colId => {return <boolean>}
            
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
        }),
        
        GridRow = new JSClass('GridRow', View, {
            include: [M.InfiniteGridRow, GridRowMixin]
        }),
        
        SelectableGridRow = new JSClass('SelectableGridRow', M.SimpleSelectableInfiniteGridRow, {
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
            
            supportsDoubleClick: FALSE_FUNC, // () => {return <boolean>}
            
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
        }),
        
        // Chronal Util
        getChronalByTimeDiff = (a, b) => {
            if (a === b) return 0;
            return mathFloor(mathLog2(2 + 2* mathAbs(a - b) / TC.timeUtil.MILLIS_PER_WEEK));
        },
        
        getChronalEfficiently = (a, b) => {
            if (a === b) return 0;
            return mathFloor(mathLog10(2 + 2* mathAbs(a - b) / TC.timeUtil.MILLIS_PER_YEAR));
        },
        
        getChronalToDeploy = (agentModel, eventModel) => {
            const eventTime = eventModel.getStart(),
                agentEvent = agentModel.getEventModel(),
                getFunc = agentEvent.id === EVENT_ID_TIME_CORPS_HQ ? getChronalEfficiently : getChronalByTimeDiff,
                cost = getFunc(agentEvent.getEnd(), eventTime);
            return mathMax(MIN_DEPLOY_CHRONAL, cost);
        },
        
        getChronalToRecall = agentModel => {
            const agentEvent = agentModel.getEventModel(),
                cost = getChronalEfficiently(pkg.tc.model.getEventModel(EVENT_ID_TIME_CORPS_HQ).getStart(), agentEvent.getEnd()) / 2;
            return mathMax(MIN_RECALL_CHRONAL, cost);
        },
        
        ICON_CHRONAL ='⏲', // ⏲ ⌚ ♾
        ICON_PARADOX = '⥁', // ⥁ ☣ ꩜
        
        TC = pkg.tc = {
            app:null, // Holds the App instance.
            model:null, // Holds the Model instance.
            
            theme,
            Spacer, WideView, TallView, Panel, MiniPanel, Btn, SquareBtn, LabeledValue,
            InfiniteGridWrapper, GridColHdr, GridCell, PlainGridCell, GridCellBtn, GridRow, SelectableGridRow,
            
            getChronalToDeploy, getChronalToRecall,
            
            SCOPE_TIMELINE: 'timeline',
            SCOPE_AGENTS: 'agents',
            SCOPE_LOCATIONS: 'locations',
            SCOPE_EVENTS: 'events',
            SCOPE_EVENT: 'event',
            
            I18N_CHRONAL:'Chr' + ICON_CHRONAL + 'nal',
            I18N_PARADOX:'Parad' + ICON_PARADOX + 'x',
            
            ICON_NAV_BACK:'❮',
            ICON_NAV_FORWARD:'❯',
            ICON_ACTION:'⎇', // ⎌ ⎇ ☟
            ICON_JUMP:'⎌',
            ICON_TRAVEL:'⎆', // ⎈
            ICON_VIEW:'⏿',
            ICON_CHRONAL,
            ICON_PARADOX,
            ICON_THE_VOID:'⦰',
            ICON_HQ:'❉',
            
            EVENT_ID_THE_VOID,
            EVENT_ID_TIME_CORPS_HQ
        };
})(window);
