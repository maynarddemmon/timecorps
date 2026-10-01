(pkg => {
    'use strict';
    
    /*  Locations scope constraints to themselves, so description phrases use 
        "events.<id>..." or "timeline..." but not "event...". */
    pkg.LocationModel = new JS.Class('LocationModel', myt.BaseModel, {
        include: [pkg.ConstrainableAttrSupport, pkg.Describable, pkg.MediaSupport],
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setName: function(name) {this.set('name', name, true);},
        getName: function() {return this.name;},
        setColor: function(color) {this.set('color', color, true);},
        setTextColor: function(color) {this.set('textColor', color, true);},
        setOrder: function(order) {this.set('order', order, true);},
        
        /** @overrides MediaSupport */
        getMediaFolder: () => 'location',
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);