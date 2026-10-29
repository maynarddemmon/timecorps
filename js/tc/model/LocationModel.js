(pkg => {
    'use strict';
    
    /*  Locations scope constraints to themselves, so description phrases use 
        "events.<id>..." or "timeline..." but not "event...". */
    pkg.LocationModel = new JS.Class('LocationModel', myt.BaseModel, {
        include: [pkg.ConstrainableAttrSupport, pkg.Describable, pkg.MediaSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        init: function(attrs) {
            // First, since the data adds it last, and warnings about the other attrs name it.
            this.id = attrs.id;
            this.callSuper(attrs);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setName: function(name) {this.set('name', name, true);},
        getName: function() {return this.name;},
        
        // Title
        setTitle: function(v) {this.set('title', v, true);},
        getTitle: function() {return this.title ?? 'Area Brief';},
        
        setColor: function(color) {this.set('color', color, true);},
        setTextColor: function(color) {this.set('textColor', color, true);},
        setOrder: function(order) {this.set('order', order, true);},
        
        /** @overrides MediaSupport */
        getMediaFolder: () => 'location',
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);