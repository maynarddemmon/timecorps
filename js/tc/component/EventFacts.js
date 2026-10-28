(pkg => {
    'use strict';
    
    const {View, PaddedPlainText, WrappingLayout, SpacedLayout} = myt,
        
        {
            WideView, Row, UnderlineBtn,
            theme:{spacing, fontSizeMedium},
            ICON_NIL, ICON_SEPARATOR,
            STAT_ID_HISTORICITY, STAT_ID_ATTESTATION, STAT_ID_PARADOX
        } = pkg;
    
    /*  An Event's place, time and stats, laid out the same in Event Details and the Event 
        Brief: a line with the Event's location, which opens its Area Brief, and when the 
        Event happens, then its historicity, attestation and paradox bars. The time wraps 
        below the location when the line is too narrow for both. Call update with the Event 
        whenever it changes.
        
        Attrs:
            barBgColor - The background of the stat bars, for when the default doesn't show
                against what's behind them. */
    pkg.EventFacts = new JS.Class('EventFacts', WideView, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this,
                barBgColor = attrs.barBgColor;
            delete attrs.barBgColor;
            
            self.callSuper(parent, attrs);
            
            const whereWhen = new WideView(self, {x:spacing, percentOfParentWidthOffset:-2*spacing});
            self._whereBtn = new UnderlineBtn(whereWhen, {
                fontSize:fontSizeMedium, tooltip:'Open the area brief'
            }, [{doActivated: () => {self._doWhereActivated();}}]);
            self._whenTxt = new PaddedPlainText(whereWhen, {fontSize:fontSizeMedium});
            new WrappingLayout(whereWhen, {collapseParent:true});
            
            new View(self, {height:2}); // Spacer.
            
            const row = new Row(self, {height:18, inset:spacing}),
                barAttrs = {y:12, layoutHint:1};
            if (barBgColor) barAttrs.bgColor = barBgColor;
            self._historicityBar = new pkg.HistoricityBar(row, {...barAttrs});
            self._attestationBar = new pkg.AttestationBar(row, {...barAttrs});
            self._paradoxBar = new pkg.ParadoxBar(row, {...barAttrs});
            
            // The bars were added after the layout, which won't place them until the row's 
            // width changes, and in a brief it may not.
            row.getFirstLayout().update();
            
            new SpacedLayout(self, {axis:'y', collapseParent:true});
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        update: function(eventModel) {
            const self = this,
                locationModel = eventModel.getLocationModel(),
                whereBtn = self._whereBtn,
                whenTxt = self._whenTxt;
            self.eventModel = eventModel;
            
            whenTxt.setText(ICON_SEPARATOR + eventModel.formatAsTemporalExtent());
            
            // As tall as the text beside it, since a button centers its text, which would 
            // otherwise sit lower.
            whereBtn.setText(locationModel?.name ?? ICON_NIL);
            whereBtn.sizeViewToDom();
            whereBtn.setHeight(whenTxt.height);
            whereBtn.setDisabled(!locationModel);
            
            self._historicityBar.updateForStat(eventModel[STAT_ID_HISTORICITY]);
            self._attestationBar.updateForStat(eventModel[STAT_ID_ATTESTATION]);
            self._paradoxBar.updateForStat(eventModel[STAT_ID_PARADOX]);
        },
        
        /** @private */
        _doWhereActivated: function() {
            const locationModel = this.eventModel?.getLocationModel();
            if (locationModel) pkg.app.openAreaBrief(locationModel);
        }
    });
})(tc);
