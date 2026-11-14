(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
            cfg:{TL_COL_HEADER_HEIGHT, TL_COL_WIDTH},
            theme:{padding},
            OPERATION_STATE_COMPLETED
        } = pkg;
    
    /*  Briefs the player on an Operation: an optional photo, the Operation's Describable 
        phrases as field notes, the briefing in mission/<id>.txt under cfg.DATA_BASE_DIR, and
        the Objectives, as the Mission panel shows them. 
        It opens when a mission is set up or revealed, and from the Mission panel's title. It's 
        acknowledged like an ack dialog, and takes its turn with them. While the mission is 
        available, the button accepts it instead, which starts it, and closing the brief 
        leaves it available. Once the mission is completed, its debrief follows the briefing,
        so the player can review it. */
    pkg.MissionBrief = new JS.Class('MissionBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.cancelable ??= true;
            attrs.tallWidth ??= 5*(TL_COL_WIDTH + padding) + padding;
            attrs.photoHeight ??= 5*TL_COL_HEADER_HEIGHT;
            
            self.callSuper(parent, attrs);
            
            self._ackLabel = self.getDefaultBtn().text;
            const objectivesView = self._objectivesView = self.addContainerRow(i18n('brief-objectives'));
            self._debriefView = self.addProfileRow(i18n('brief-debrief'));
            
            // Tighten up the layout since divider lines are not visible in the briefs.
            objectivesView.getFirstLayout().callSetters({inset:-10, spacing:-5, outset:-10});
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle(briefModel.getTitle(), briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => pkg.cfg.DATA_BASE_DIR + 'mission/' + briefModel.id + '.txt',
        
        /** @overrides BriefSupport */
        getBriefReportLabel: () => i18n('brief-briefing'),
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  An Objective's precursors show only what the player knows about, so they're 
            redone when one of their Events changes, e.g. is revealed, as in the Mission panel. */
        notifyEventModelChanged: function(eventModel) {
            if (this.visible && this.getBriefModel()?.dependsOnEvent(eventModel)) this.updateFieldNotes();
        },
        
        /*  The Objectives and the debrief are dynamic like the field notes, so they're updated
            along with them. Only a completed mission has a debrief to show, the same as the 
            Mission Complete dialog showed.
            @overrides BriefSupport */
        updateFieldNotes: function() {
            this.callSuper();
            
            const self = this,
                operationModel = self.getBriefModel(),
                objectiveModels = operationModel?.getShownObjectiveModels() ?? [],
                objectivesView = self._objectivesView,
                debriefView = self._debriefView,
                isCompleted = operationModel?.getState() === OPERATION_STATE_COMPLETED;
            
            objectivesView.destroyAllSubviews();
            for (const objectiveModel of objectiveModels) {
                // A link opens its Event's brief, as the field notes' links do.
                new pkg.ObjectiveRow(objectivesView, {
                    objectiveModel, 
                    bgColor:'transparent', 
                    precursorCallback:btn => self._doCausatorLinkActivated(btn)
                });
            }
            objectivesView.parent.setVisible(objectiveModels.length > 0);
            
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
