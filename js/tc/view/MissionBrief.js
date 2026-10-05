(pkg => {
    'use strict';
    
    /*  Briefs the player on an Operation: an optional photo, the Operation's Describable 
        phrases as field notes, and the briefing in data/missions/<id>.txt. It opens when a 
        mission is set up and from the Mission panel's title. It's acknowledged like an ack 
        dialog, and takes its turn with them. */
    pkg.MissionBrief = new JS.Class('MissionBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            attrs.cancelable ??= true;
            this.callSuper(parent, attrs);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: operationModel => pkg.makeBriefTitle('Mission Brief', operationModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: operationModel => './data/missions/' + operationModel.id + '.txt',
        
        /** @overrides BriefSupport */
        getBriefReportLabel: () => 'Briefing',
        
        
        // Methods /////////////////////////////////////////////////////////////
        notifyOperationModelChanged: function(operationModel) {
            this.notifyBriefModelChanged(operationModel);
        }
    });
})(tc);
