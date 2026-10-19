(pkg => {
    'use strict';
    
    /*  Briefs the player on a Faction: its label as the title and its description as field
        notes. It has no photo or report yet. Opens from the Agents grid and the Agent Dossier. */
    pkg.FactionBrief = new JS.Class('FactionBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            attrs.cancelable ??= true;
            this.callSuper(parent, attrs);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle('Faction Brief', briefModel.getLabel()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: () => null
    });
})(tc);
