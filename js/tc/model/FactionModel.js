(pkg => {
    'use strict';
    
    /*  A side an Agent belongs to, e.g. the Time Corps. Every Agent is in exactly one, which
        is "unaligned" unless the data says otherwise. Configured in the "factions" data as:
            label - What the player sees, e.g. "Time Corps".
            description - Describable phrases, shown as the Faction Brief's field notes. */
    pkg.FactionModel = new JS.Class('FactionModel', myt.BaseModel, {
        include: [pkg.ConstrainableAttrSupport, pkg.Describable],
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setLabel: function(label) {this.set('label', label, true);},
        getLabel: function() {return this.label ?? this.id;},
        
        /*  For dialogs, e.g. the Faction Brief's title. */
        getName: function() {return this.getLabel();},
        
        /*  The arguments for MediaView.setMedia. A Faction has no picture yet. */
        getMediaUrls: () => [null, null],
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);
