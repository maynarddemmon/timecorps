(pkg => {
    'use strict';
    
    /*  A side an Agent belongs to, e.g. the Time Corps. Every Agent is in exactly one, which
        is "unaligned" unless the data says otherwise. Configured in the "factions" data as:
            label - What the player sees, e.g. "Time Corps".
            description - Describable phrases, shown as the Faction Brief's field notes.
            hq - Optional. The ID of the Event that's the Faction's HQ. Only its members can
                time travel there, and they're recalled there.
            jobBoard - Optional. The name of the scratch entry that's the Faction's job board:
                the ID of the Operation on offer at its HQ, or '' when there's none. A job is 
                picked each time a player-controlled member arrives at the HQ. See pickJob. */
    pkg.FactionModel = new JS.Class('FactionModel', myt.BaseModel, {
        include: [pkg.ConstrainableAttrSupport, pkg.Describable],
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setLabel: function(label) {this.set('label', label, true);},
        getLabel: function() {return this.label ?? this.id;},
        
        setDefaultAgentRole: function(v) {this.set('defaultAgentRole', v, true);},
        getDefaultAgentRole: function() {return this.defaultAgentRole ?? ''},
        
        setHq: function(hq) {this.set('hq', hq, true);},
        
        setJobBoard: function(v) {this.set('jobBoard', v, true);},
        getJobBoard: function() {return this.jobBoard;},
        
        /*  The Faction's HQ, or null if it has none. */
        getHQEventModel: function() {
            return this.hq ? pkg.model.getEventModel(this.hq) ?? null : null;
        },
        
        /*  Puts a job on the Faction's job board, if it has one, for a member who has just 
            arrived at its HQ: an Operation picked at random from those not yet revealed whose
            "job" is true for them, or none. One already on another Faction's board isn't 
            picked, so a job is only offered at one HQ at a time. The board is a scratch entry,
            so it's saved, and only a new arrival changes it. Revealing the Operation takes it
            off the board. See OperationModel.reveal. */
        pickJob: function(agentModel) {
            const jobBoard = this.jobBoard;
            if (!jobBoard) return;
            
            const rootModel = pkg.model,
                scratch = rootModel.scratch,
                elsewhere = new Set(rootModel.getFactionModelsAsList(factionModel => factionModel !== this && factionModel.jobBoard).map(factionModel => scratch[factionModel.jobBoard])),
                jobs = rootModel.getOperationModelsAsList(operationModel => !operationModel.revealed && !elsewhere.has(operationModel.id) && operationModel.isJobFor(agentModel));
            rootModel.setScratch(jobBoard, jobs.length > 0 ? jobs[pkg.rng.roll(jobs.length)].id : '');
        },
        
        /*  For dialogs, e.g. the Faction Brief's title. */
        getName: function() {return this.getLabel();},
        
        /*  The arguments for MediaView.setMedia. A Faction has no picture yet. */
        getMediaUrls: () => [null, null],
        
        doDescriptionChanged: function() {this.notifyCollectionOfUpdate();}
    });
})(tc);
