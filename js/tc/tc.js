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
        HQ_TIME = new Date('2174-10-14T00:00:00').getTime(),
        MIN_DEPLOY_CHRONAL = 1,
        
        
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
        fontSizeLarge = '16px',
        fontSizeVeryLarge = '20px',
        fontFamilyMono = 'SpaceMono',
        
        theme = {
            layoutSpacing, spacing, padding, cornerRadius, btnHeight, rowHeight,
            colorMegaDark, colorUltraDark, colorDark, colorMedium, colorLight, colorUltraLight, colorBtn,
            fontSizeLarge, fontSizeVeryLarge,
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
            
            doRowModelSelected: NOOP // model => {}
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
                    if (sv.isA(GridCellBtn)) sv.setTextColor(textColor);
                }
            },
            
            notifyModelUpdated: function() {
                const self = this;
                self.callSuper();
                
                self.detachFromDom(self, '__DblClk', 'dblclick');
                if (self.supportsDoubleClick()) self.attachToDom(self, '__DblClk', 'dblclick');
            }
        }),
        
        
        // Time Parsing and Formatting /////////////////////////////////////////
        TO_SECOND = 'second',
        TO_MINUTE = 'minute',
        TO_HOUR = 'hour',
        TO_DAY = 'day',
        TO_MONTH = 'month',
        TO_YEAR = 'year',
        TO_DECADE = 'decade',
        TO_CENTURY = 'century',
        TO_MILLENIUM = 'millenium',
        
        /*  Coarse to fine. Used to take the coarser of two precisions, which is
            how "never show more than was authored" is enforced. */
        PRECISION_ORDER = [
            TO_MILLENIUM, TO_CENTURY, TO_DECADE, TO_YEAR,
            TO_MONTH, TO_DAY, TO_HOUR, TO_MINUTE, TO_SECOND
        ],
        PRECISION_RANK = PRECISION_ORDER.reduce((o, p, i) => (o[p] = i, o), {}),
        
        MONTH_NAMES = [
            'January','February','March','April','May','June','July','August','September','October','November','December'
        ],
        
        MILLIS_PER_SECOND = 1000,
        MILLIS_PER_MINUTE = 60 * MILLIS_PER_SECOND,
        MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE,
        MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR,
        MILLIS_PER_WEEK = 7 * MILLIS_PER_DAY,
        MILLIS_PER_MONTH = MILLIS_PER_DAY * 30.41, // Approximate
        MILLIS_PER_YEAR = MILLIS_PER_DAY * 365, // Approximate (no leap years, leap seconds, etc.)
        MILLIS_PER_DECADE = 10 * MILLIS_PER_YEAR,
        MILLIS_PER_CENTURY = 10 * MILLIS_PER_DECADE,
        MILLIS_PER_MILLENIUM = 10 * MILLIS_PER_CENTURY,
        
        SCALE_MILLIS = {
            [TO_SECOND]:MILLIS_PER_SECOND, [TO_MINUTE]:MILLIS_PER_MINUTE, [TO_HOUR]:MILLIS_PER_HOUR, [TO_DAY]:MILLIS_PER_DAY
        },
        SCALE_YEARS = {
            [TO_YEAR]:1, [TO_DECADE]:10, [TO_CENTURY]:100, [TO_MILLENIUM]:1000
        },
        
        /*  A SHAPE GUARD, not a parser. Native Date already handles every
            well-formed case here, including expanded years and truncated forms.
            What it does NOT do is fail on near-misses: "1028-3-7", "793-03-07"
            and "1028/03/07" all parse successfully down Date's
            implementation-defined path and silently pick up the local timezone.
            Those are the ones a warning never catches, so reject by shape first. */
        ISO_SHAPE = /^([+-]\d{6}|\d{4})(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?)?)?Z?$/,
        
        toDate = date => date instanceof Date ? date : new Date(date),
        
        /*  Astronomical year to era. ISO year 0 IS 1 BCE, so this is 1 - y and
            NOT a sign flip. Everything era-facing rounds in THIS space: rounding
            -19999 to the nearest thousand gives -20000, which converts to
            20,001 BCE and is off by one in a way nobody would ever spot. */
        toEra = astroYear => astroYear <= 0 ? {n:1 - astroYear, era:'BCE'} : {n:astroYear, era:'CE'},
        
        /*  Thousands separator only once it helps — "1,912" is wrong, "20,000
            BCE" is right. CE stated only where the number could be mistaken for
            a quantity: below 1000 and above 9999. */
        eraLabel = ({n, era}) => {
            const digits = n >= 10000 ? n.toLocaleString('en-US') : String(n);
            return era === 'BCE' ? digits + ' BCE'
                 : (n < 1000 || n >= 10000) ? digits + ' CE' : digits;
        },
        
        ordinal = n => {
            const tail = n % 100;
            return n + ((tail >= 11 && tail <= 13) ? 'th' : (['th','st','nd','rd'][n % 10] || 'th'));
        },
        
        pad2 = v => String(v).padStart(2, '0'),
        
        timeUtil = {
            TO_SECOND, 
            TO_MINUTE, 
            TO_HOUR, 
            TO_DAY, 
            TO_MONTH,
            TO_YEAR, 
            TO_DECADE, 
            TO_CENTURY, 
            TO_MILLENIUM,
            
            PRECISION_ORDER,
            
            MILLIS_PER_SECOND,
            MILLIS_PER_MINUTE,
            MILLIS_PER_HOUR,
            MILLIS_PER_DAY,
            MILLIS_PER_WEEK,
            MILLIS_PER_MONTH,
            MILLIS_PER_YEAR,
            MILLIS_PER_DECADE,
            MILLIS_PER_CENTURY,
            MILLIS_PER_MILLENIUM,
            
            SCALE_TO_MILLIS: {
                [TO_SECOND]: MILLIS_PER_SECOND,
                [TO_MINUTE]: MILLIS_PER_MINUTE,
                [TO_HOUR]: MILLIS_PER_HOUR,
                [TO_DAY]: MILLIS_PER_DAY,
                [TO_MONTH]: MILLIS_PER_MONTH,
                [TO_YEAR]: MILLIS_PER_YEAR,
                [TO_DECADE]: MILLIS_PER_DECADE,
                [TO_CENTURY]: MILLIS_PER_CENTURY,
                [TO_MILLENIUM]: MILLIS_PER_MILLENIUM
            },
            
            /*  Converts a duration object into milliseconds. If a nullish value is provided, zero
                is returned. If a number is provided it is returned as is. The object format
                supports:
                    ms: milliseconds
                     s: seconds
                     m: minutes
                     h: hours
                     d: days
                     w: weeks
                
                Note there is deliberately no y or mo: years and months are not
                fixed lengths, and a duration that means "until this date" should
                be authored as an end instant instead.
            */
            durationToMillis: spec => {
                if (spec == null) return 0;
                if (typeof spec === 'number') return spec;
                return (spec.w || 0) * MILLIS_PER_WEEK
                     + (spec.d || 0) * MILLIS_PER_DAY
                     + (spec.h || 0) * MILLIS_PER_HOUR
                     + (spec.m || 0) * MILLIS_PER_MINUTE
                     + (spec.s || 0) * MILLIS_PER_SECOND
                     + (spec.ms || 0);
            },
            
            /*  Parse a date string into milliseconds from the epoch. Rejects by
                shape, then hands the well-formed string to native Date. A time
                component with no zone gets a Z appended — without it Date reads
                the string as LOCAL, so the same config file means different
                things on different machines and nothing warns. */
            stringToMillis: str => {
                let millis = NaN,
                    trimmed = String(str).trim();
                if (ISO_SHAPE.test(trimmed)) {
                    const needsZone = trimmed.includes('T') && !trimmed.endsWith('Z');
                    millis = new Date(needsZone ? trimmed + 'Z' : trimmed).getTime();
                }
                if (isNaN(millis)) {
                    console.warn('Invalid Date String', str);
                    millis = 0;
                }
                return millis;
            },
            
            /*  The coarser of two precisions. Use to clamp what a player may see
                against what the author actually knew. */
            coarser: (a, b) => PRECISION_ORDER[
                mathMin(PRECISION_RANK[a] ?? 0, PRECISION_RANK[b] ?? 0)
            ],
            
            format: (date, precision=TO_SECOND) => {
                const d = toDate(date),
                    era = toEra(d.getUTCFullYear()),
                    year = eraLabel(era),
                    day = d.getUTCDate(),
                    month = MONTH_NAMES[d.getUTCMonth()];
                switch (precision) {
                    case TO_MILLENIUM:
                        // "c." only where the number is genuinely a rounding
                        return 'c. ' + eraLabel({n:mathMax(1000, mathRound(era.n / 1000) * 1000), era:era.era});
                    case TO_CENTURY:
                        return ordinal(mathCeil(era.n / 100)) + ' century' + (era.era === 'BCE' ? ' BCE' : '');
                    case TO_DECADE:
                        return (mathFloor(era.n / 10) * 10) + 's' + (era.era === 'BCE' ? ' BCE' : '');
                    case TO_YEAR:
                        return year;
                    case TO_MONTH:
                        return month + ', ' + year;
                    case TO_DAY:
                        return day + ' ' + month + ', ' + year;
                    case TO_HOUR:
                        // "23:00" would claim you know the minute is zero. You do not.
                        return 'around ' + pad2(d.getUTCHours()) + ':00 · ' + day + ' ' + month + ', ' + year;
                    case TO_MINUTE:
                        return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' · ' + day + ' ' + month + ', ' + year;
                    case TO_SECOND:
                    default:
                        return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + ' · ' + day + ' ' + month + ', ' + year;
                }
            },
            
            /*  Clock only, for agent clocks and action windows inside an event
                where the block already establishes the date. */
            formatClock: (date, withSeconds) => {
                const d = toDate(date),
                    base = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
                return withSeconds ? base + ':' + pad2(d.getUTCSeconds()) : base;
            },
            
            /*  Elapsed time, for action blocks and travel legs. */
            formatDuration: millis => {
                const abs = mathAbs(millis),
                    unit = (v, one, many) => v + ' ' + (v === 1 ? one : many);
                if (abs < MILLIS_PER_SECOND) return millis + ' ms';
                if (abs < MILLIS_PER_MINUTE) return mathRound(millis / MILLIS_PER_SECOND) + ' sec';
                if (abs < MILLIS_PER_HOUR) {
                    const m = mathTrunc(millis / MILLIS_PER_MINUTE),
                        s = mathRound((abs % MILLIS_PER_MINUTE) / MILLIS_PER_SECOND);
                    return s ? m + 'm ' + s + 's' : m + ' min';
                }
                if (abs < MILLIS_PER_DAY) {
                    const h = mathTrunc(millis / MILLIS_PER_HOUR),
                        m = mathRound((abs % MILLIS_PER_HOUR) / MILLIS_PER_MINUTE);
                    return m ? h + 'h ' + m + 'm' : h + ' hr';
                }
                if (abs < 30 * MILLIS_PER_DAY)  return unit(mathRound(millis / MILLIS_PER_DAY), 'day', 'days');
                if (abs < 365 * MILLIS_PER_DAY) return unit(mathRound(millis / (30 * MILLIS_PER_DAY)), 'month', 'months');
                return unit(+(millis / (365.2425 * MILLIS_PER_DAY)).toFixed(1), 'year', 'years');
            },
            
            /*  Largest boundary at or before the given instant.
                
                Fine scales just truncate components. Year and coarser floor the
                astronomical year to a multiple of the step — Math.floor is
                correct for negatives here, since astronomical years increase
                monotonically with time and -19999 floors to -20000, which is
                genuinely earlier. Do NOT convert to BCE first: era numbers run
                backwards, so flooring there would move you forward in time. */
            roundBackToScale: (dateObj, scale) => {
                const d = new Date(toDate(dateObj).getTime());
                switch (scale) {
                    case TO_SECOND:
                        d.setUTCMilliseconds(0);
                        return d;
                    case TO_MINUTE:
                        d.setUTCSeconds(0, 0);
                        return d;
                    case TO_HOUR:
                        d.setUTCMinutes(0, 0, 0);
                        return d;
                    case TO_DAY:
                        d.setUTCHours(0, 0, 0, 0);
                        return d;
                    case TO_MONTH:
                        d.setUTCHours(0, 0, 0, 0);
                        d.setUTCDate(1);
                        return d;
                    default: {
                        const step = SCALE_YEARS[scale] || 1;
                        d.setUTCHours(0, 0, 0, 0);
                        // setUTCFullYear, not Date.UTC — the latter folds 0-99 into the 1900s.
                        d.setUTCFullYear(mathFloor(d.getUTCFullYear() / step) * step, 0, 1);
                        return d;
                    }
                }
            },
            
            /*  Smallest boundary at or after the given instant.
                
                Idempotent on exact boundaries: an instant already sitting on a
                tick returns itself, so a range ending exactly at midnight does
                not gain a spurious extra day of axis. */
            roundForwardToScale: (dateObj, scale) => {
                const src = toDate(dateObj),
                    d = timeUtil.roundBackToScale(src, scale);
                if (d.getTime() === src.getTime()) return d;
                return timeUtil.advanceScale(d, scale, 1);
            },
            
            /*  Step a boundary by whole units of the scale. Use this to walk out
                the ticks between the two ends.
                
                Months and years CANNOT be stepped by adding a constant number of
                milliseconds — month lengths vary and leap years make a century
                24 or 25 days longer than 100 * 365. Only the sub-day scales are
                fixed-width. */
            advanceScale: (dateObj, scale, count=1) => {
                const d = new Date(toDate(dateObj).getTime()),
                    fixed = SCALE_MILLIS[scale];
                if (fixed) return new Date(d.getTime() + fixed * count);
                if (scale === TO_MONTH) {
                    d.setUTCMonth(d.getUTCMonth() + count);
                    return d;
                }
                d.setUTCFullYear(d.getUTCFullYear() + (SCALE_YEARS[scale] || 1) * count);
                return d;
            },
            
            /*  Every tick covering [from, to] inclusive of both boundaries.
                Guards against a step that cannot terminate. */
            ticksForRange: (from, to, scale, limit=2000) => {
                const end = timeUtil.roundForwardToScale(to, scale),
                    out = [];
                let cur = timeUtil.roundBackToScale(from, scale);
                while (cur.getTime() <= end.getTime() && out.length < limit) {
                    out.push(cur);
                    const next = timeUtil.advanceScale(cur, scale, 1);
                    if (next.getTime() <= cur.getTime()) break;
                    cur = next;
                }
                return out;
            }
        },
        
        getChronalByTimeDiff = (a, b) => {
            if (a === b) return 0;
            return mathFloor(mathLog2(2 + 2* mathAbs(a - b) / MILLIS_PER_WEEK));
        },
        
        getChronalFromHQ = a => {
            b = HQ_TIME;
            if (a === b) return 0;
            return mathFloor(mathLog10(2 + 2* mathAbs(a - b) / MILLIS_PER_YEAR));
        },
        
        getChronalToDeploy = (agentModel, eventModel) => {
            const eventTime = eventModel.getStart(),
                agentEvent = agentModel.getEventModel();
            let cost;
            if (agentEvent) {
                cost = getChronalByTimeDiff(agentEvent.getEnd(), eventTime);
            } else {
                cost = getChronalFromHQ(eventTime);
            }
            return mathMax(MIN_DEPLOY_CHRONAL, cost);
        };
    
    pkg.tc = {
        app:null, // Holds the App instance.
        model:null, // Holds the Model instance.
        
        HQ_TIME,
        
        theme,
        Spacer, WideView, TallView, Panel, Btn, SquareBtn, LabeledValue,
        InfiniteGridWrapper, GridColHdr, GridCell, PlainGridCell, GridCellBtn, GridRow, SelectableGridRow,
        
        timeUtil,
        
        getChronalToDeploy
    };
})(window);
