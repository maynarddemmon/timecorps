(pkg => {
    'use strict';
    
    const {ResizeLayout, SpacedLayout} = myt,
        
        {
            WideView, CompactField, CompactFieldRow,
            timeUtil:{format},
            theme:{layoutSpacing, spacing, padding, cornerRadius, colorDark, colorMegaDark},
            ICON_NIL,
            STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_PARADOX
        } = pkg,
        
        HALF_PADDING = padding / 2,
        
        PHOTO_SIZE = 256;
    
    /*  Briefs the player on an Event: an optional square photo, the Event's facts beside it, 
        its Describable phrases as field notes, and an optional report. The photo is 
        event/<id>.jpg under cfg.IMAGE_BASE_DIR when the data says "image":true, and the report
        is event/<id>.txt under cfg.DATA_BASE_DIR when it says "brief":true. It opens from the
        Event Details title and by double-clicking an EventBox. */
    pkg.EventBrief = new JS.Class('EventBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.cancelable ??= true;
            attrs.photoWidth = attrs.photoHeight = PHOTO_SIZE;
            // The facts sit beside the photo, so the report never moves up into its space.
            attrs.reservePhotoSpace = true;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            const facts = self._factsView = new WideView(self, {
                    y:HALF_PADDING, height:PHOTO_SIZE,
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                factsContainer = new WideView(facts);
            
            let row = new WideView(factsContainer, {height:18});
            self._historicityView = new pkg.HistoricityBar(row, {y:12, bgColor:colorDark, layoutHint:1});
            self._attestationView = new pkg.AttestationBar(row, {y:12, bgColor:colorDark, layoutHint:1});
            self._paradoxView = new pkg.ParadoxBar(row, {y:12, bgColor:colorDark, layoutHint:1});
            new ResizeLayout(row, {inset:spacing, spacing, outset:spacing});
            
            row = new CompactFieldRow(factsContainer);
            self._idView = new CompactField(row, {label:'ID', layoutHint:1});
            self._whereView = new CompactField(row, {label:'Where', layoutHint:2});
            row.getFirstLayout().update();
            
            row = new CompactFieldRow(factsContainer);
            self._startView = new CompactField(row, {label:'Start', layoutHint:1});
            self._endView = new CompactField(row, {label:'End', layoutHint:1});
            self._durationView = new CompactField(row, {label:'Duration', layoutHint:1});
            row.getFirstLayout().update();
            
            new SpacedLayout(factsContainer, {axis:'y', inset:spacing, outset:spacing, collapseParent:true});
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle('Event Brief', briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => briefModel.hasBrief() ? pkg.cfg.DATA_BASE_DIR + 'event/' + briefModel.id + '.txt' : null,
        
        /** @overrides BriefSupport */
        setBriefModel: function(eventModel) {
            if (eventModel) {
                // Without a photo the facts take its place.
                const factsX = HALF_PADDING + (eventModel.hasImage() ? PHOTO_SIZE + layoutSpacing : 0),
                    facts = this._factsView;
                facts.setX(factsX);
                facts.setPercentOfParentWidthOffset(-(factsX + HALF_PADDING));
                
                this._idView.setValue(eventModel.id);
                this._whereView.setValue(eventModel.getLocationModel()?.name ?? ICON_NIL);
                this._startView.setValue(format(eventModel.getStart()));
                this._endView.setValue(format(eventModel.getEnd()));
                this._durationView.setValue(eventModel.getDuration(true));
                this.updateStats(eventModel);
            }
            
            this.callSuper(eventModel);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        updateStats: function(eventModel) {
            this._historicityView.updateForStat(eventModel[STAT_ID_HISTORICITY]);
            this._attestationView.updateForStat(eventModel[STAT_ID_ATTESTATION]);
            this._paradoxView.updateForStat(eventModel[STAT_ID_PARADOX]);
        },
        
        /** @overrides BriefSupport */
        notifyBriefModelChanged: function(eventModel) {
            this.callSuper(eventModel);
            if (this.visible && this.getBriefModel() === eventModel) this.updateStats(eventModel);
        }
    });
})(tc);
