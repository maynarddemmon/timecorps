(pkg => {
    'use strict';
    
    /*  A side an Agent belongs to, e.g. the Time Corps. Every Agent is in exactly one, which
        is "unaligned" unless the data says otherwise. Configured in the "factions" data as:
            label - What the player sees, e.g. "Time Corps".
            description - Describable phrases, shown as the Faction Brief's field notes.
            hq - Optional. The ID of the Event that's the Faction's HQ. Only its members can
                time travel there, and they're recalled there. */
    pkg.FactionModel = new JS.Class('FactionModel', myt.BaseModel, {
        include: [pkg.ConstrainableAttrSupport, pkg.Describable],
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setLabel: function(label) {this.set('label', label, true);},
        getLabel: function() {return this.label ?? this.id;},
        
        setDefaultAgentRole: function(v) {this.set('defaultAgentRole', v, true);},
        getDefaultAgentRole: function() {return this.defaultAgentRole ?? ''},
        
        setHq: function(hq) {this.set('hq', hq, true);},
        
        /*  The Faction's HQ, or null if it has none. */
        getHQEventModel: function() {
            return this.hq ? pkg.model.getEventModel(this.hq) ?? null : null;
        },
        
        /*  For dialogs, e.g. the Faction Brief's title. */
        getName: function() {return this.getLabel();},
        
        /*  The arguments for MediaView.setMedia. A Faction has no picture yet. */
        getMediaUrls: () => [null, null],
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);
