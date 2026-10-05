(pkg => {
    'use strict';
    
    const {
        cfg:{TL_COL_HEADER_HEIGHT, TL_COL_WIDTH},
        theme:{padding}
    } = pkg;
    
    /*  Briefs the player on a Location: its photo, field notes, and the report in 
        data/location/<id>.txt. */
    pkg.AreaBrief = new JS.Class('AreaBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            attrs.cancelable ??= true;
            attrs.tallWidth ??= 4*(TL_COL_WIDTH + padding) + padding;
            attrs.photoHeight ??= 4*TL_COL_HEADER_HEIGHT;
            
            this.callSuper(parent, attrs);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: locationModel => pkg.makeBriefTitle('Area Brief', locationModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: locationModel => './data/location/' + locationModel.id + '.txt',
        
        
        // Methods /////////////////////////////////////////////////////////////
        notifyLocationModelChanged: function(locationModel) {
            this.notifyBriefModelChanged(locationModel);
        }
    });
})(tc);
