(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
        cfg:{TL_COL_HEADER_HEIGHT, TL_COL_WIDTH},
        theme:{padding},
        OPERATION_STATE_COMPLETED
    } = pkg;
    
    /*  Briefs the player on an Operation: an optional photo, the Operation's Describable 
        phrases as field notes, and the briefing in mission/<id>.txt under cfg.DATA_BASE_DIR. 
        It opens when a mission is set up or revealed, and from the Mission panel's title. It's 
        acknowledged like an ack dialog, and takes its turn with them. While the mission is 
        available, the button accepts it instead, which starts it, and closing the brief 
        leaves it available. Once the mission is completed, its debrief follows the briefing,
        so the player can review it. */
    pkg.MissionBrief = new JS.Class('MissionBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            attrs.cancelable ??= true;
            attrs.tallWidth ??= 5*(TL_COL_WIDTH + padding) + padding;
            attrs.photoHeight ??= 5*TL_COL_HEADER_HEIGHT;
            
            this.callSuper(parent, attrs);
            
            this._ackLabel = this.getDefaultBtn().text;
            this._debriefView = this.addProfileRow(i18n('brief-debrief'));
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle(briefModel.getTitle(), briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => pkg.cfg.DATA_BASE_DIR + 'mission/' + briefModel.id + '.txt',
        
        /** @overrides BriefSupport */
        getBriefReportLabel: () => i18n('brief-briefing'),
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  The debrief is dynamic like the field notes, so it's updated along with them. Only 
            a completed mission has one to show, the same as the Mission Complete dialog showed.
            @overrides BriefSupport */
        updateFieldNotes: function() {
            this.callSuper();
            
            const operationModel = this.getBriefModel(),
                debriefView = this._debriefView,
                isCompleted = operationModel?.getState() === OPERATION_STATE_COMPLETED;
            debriefView.setVisible(isCompleted);
            if (isCompleted) debriefView.setValue(operationModel.getDebrief() || i18n('dlg-mission-complete-msg'));
        },
        
        /** @overrides BriefSupport */
        show: function(operationModel) {
            this.callSuper(operationModel);
            
            // Whether it's an offer is settled as it opens, since starting the mission from
            // elsewhere while it's showing shouldn't turn the button into an acknowledgment.
            const isOffer = this._isOffer = operationModel.isAvailable();
            this.getDefaultBtn().setText(isOffer ? i18n('btn-accept-mission') : this._ackLabel);
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
