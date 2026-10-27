(pkg => {
    'use strict';
    
    const {
        cfg:{TL_COL_HEADER_HEIGHT, TL_COL_WIDTH},
        theme:{padding}
    } = pkg;
    
    /*  Briefs the player on an Operation: an optional photo, the Operation's Describable 
        phrases as field notes, and the briefing in mission/<id>.txt under cfg.DATA_BASE_DIR. 
        It opens when a mission is set up or revealed, and from the Mission panel's title. It's 
        acknowledged like an ack dialog, and takes its turn with them. While the mission is 
        available, the button accepts it instead, which starts it, and closing the brief 
        leaves it available. */
    pkg.MissionBrief = new JS.Class('MissionBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            attrs.cancelable ??= true;
            attrs.tallWidth ??= 5*(TL_COL_WIDTH + padding) + padding;
            attrs.photoHeight ??= 5*TL_COL_HEADER_HEIGHT;
            
            this.callSuper(parent, attrs);
            
            this._ackLabel = this.getDefaultBtn().text;
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle(briefModel.getTitle(), briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => pkg.cfg.DATA_BASE_DIR + 'mission/' + briefModel.id + '.txt',
        
        /** @overrides BriefSupport */
        getBriefReportLabel: () => 'Briefing',
        
        
        // Methods /////////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        show: function(operationModel) {
            this.callSuper(operationModel);
            
            // Whether it's an offer is settled as it opens, since starting the mission from
            // elsewhere while it's showing shouldn't turn the button into an acknowledgment.
            const isOffer = this._isOffer = operationModel.isAvailable();
            this.getDefaultBtn().setText(isOffer ? 'Accept Mission' : this._ackLabel);
        },
        
        /** @overrides AckDialog */
        doConfirm: function() {
            // Started before the brief closes, so what the setup opens waits behind anything
            // already waiting for the brief.
            if (this._isOffer) this.getBriefModel().start(true);
            this.callSuper();
        }
    });
})(tc);
