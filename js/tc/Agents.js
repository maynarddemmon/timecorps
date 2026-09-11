(pkg => {
    const JSClass = JS.Class,
        
        {Grid:{SORT_ORDER_ASC}} = myt,
        {LabeledValue, InfiniteGridWrapper, GridColHdr} = pkg,
        
        /*AgentRow = new JSClass('AgentRow', pkg.GridRow, {
            getColIds: () => ['id','name', 'paradox', 'chronal']
        })*/
        
        AgentRow = new JSClass('AgentRow', pkg.SelectableGridRow, {
            getColIds: () => ['id','name', 'paradox', 'chronal'],
            supportsDoubleClick: () => true,
            doDoubleClick: () => console.log('double click')
        });
    
    pkg.Agents = new JSClass('Agents', pkg.Panel, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            const header = self.getHeaderView();
            self.chronalPool = new LabeledValue(header, {label:'Chronal Pool'}, [{
                update: function(v) {
                    if (self.ready) this.callSuper(self.model.chronal + '/' + self.model.chronalLimit);
                }
            }]);
            self.teamParadox = new LabeledValue(header, {label:'Team Paradox'}, [{
                update: function(v) {
                    if (self.ready) this.callSuper(self.model.teamParadox + '/' + self.model.teamParadoxLimit);
                }
            }]);
            
            self.gridWrapper = new InfiniteGridWrapper(self, {
                selectable:true,
                rowClasses:AgentRow,
                initialSort:['id', SORT_ORDER_ASC]
            }, [{
                getTieBreakerSortFunction: (sortColumnId, ascending) => {
                    const sortAsc = ascending ? 1 : -1;
                    return (a, b) => a.id.localeCompare(b.id) * sortAsc;
                },
                makeGridHeaders: gridHeader => {
                    new GridColHdr(gridHeader, {columnId:'id',      minValue:50,  maxValue:50,  text:'ID'});
                    new GridColHdr(gridHeader, {columnId:'name',    minValue:100, maxValue:5000, flex:1, text:'Name'});
                    new GridColHdr(gridHeader, {columnId:'paradox', minValue:100, maxValue:100, text:'Paradox'});
                    new GridColHdr(gridHeader, {columnId:'chronal', minValue:100, maxValue:100, text:'Chronal'});
                },
                doRowModelSelected: model => {}
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
        setup: function(model) {
            this.model = model;
            
            this.chronalPool.constrain('update', [model, 'chronal', model, 'chronalLimit']);
            this.teamParadox.constrain('update', [model, 'teamParadox', model, 'teamParadoxLimit']);
            this.gridWrapper.setModelCollection(model.agents);
        }
    });
})(tc);