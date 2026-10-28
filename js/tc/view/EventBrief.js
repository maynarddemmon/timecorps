(pkg => {
    'use strict';
    
    const {
        cfg:{TL_COL_HEADER_HEIGHT, TL_COL_WIDTH},
        theme:{spacing, padding, cornerRadius, colorDark, colorMegaDark}
    } = pkg;
    
    /*  Briefs the player on an Event, laid out like the Area Brief: an optional photo across 
        the top, then the Event's place, time and stats as Event Details shows them, its 
        Describable phrases as field notes, and an optional report. The photo is 
        event/<id>.jpg under cfg.IMAGE_BASE_DIR when the data says "image":true, and the report
        is event/<id>.txt under cfg.DATA_BASE_DIR when it says "brief":true. It opens from the
        Event Details title and by double-clicking an EventBox. */
    pkg.EventBrief = new JS.Class('EventBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.cancelable ??= true;
            attrs.tallWidth ??= 5*(TL_COL_WIDTH + padding) + padding;
            attrs.photoHeight ??= 5*TL_COL_HEADER_HEIGHT;
            
            self.callSuper(parent, attrs);
            
            const summaryView = new pkg.WideView(self, {
                x:padding / 2, percentOfParentWidthOffset:-padding,
                roundedCorners:cornerRadius, bgColor:colorMegaDark
            });
            self._eventFacts = new pkg.EventFacts(summaryView, {barBgColor:colorDark});
            new myt.SpacedLayout(summaryView, {axis:'y', inset:spacing, outset:spacing, collapseParent:true});
            self.setBriefSummaryView(summaryView);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle(briefModel.getTitle(), briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => briefModel.hasBrief() ? pkg.cfg.DATA_BASE_DIR + 'event/' + briefModel.id + '.txt' : null,
        
        /** @overrides BriefSupport */
        setBriefModel: function(eventModel) {
            if (eventModel) this._eventFacts.update(eventModel);
            this.callSuper(eventModel);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        notifyBriefModelChanged: function(eventModel) {
            this.callSuper(eventModel);
            if (this.visible && this.getBriefModel() === eventModel) this._eventFacts.update(eventModel);
        }
    });
})(tc);
