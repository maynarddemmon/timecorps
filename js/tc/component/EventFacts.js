(pkg => {
    'use strict';
    
    const M = myt,
        {I18N:{get:i18n}} = M,
        
        {WideView, InlineMixin, theme:{spacing, fontSizeMedium}} = pkg;
    
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
            
            attrs.height ??= 36;
            
            self.callSuper(parent, attrs);
            
            const whereWhen = new WideView(self, {x:spacing, percentOfParentWidthOffset:-2*spacing});
            self._whereBtn = new pkg.UnderlineBtn(whereWhen, {
                fontSize:fontSizeMedium, tooltip:i18n('tip-open-area-brief')
            }, [InlineMixin, {doActivated: () => {
                const locationModel = self.eventModel?.getLocationModel();
                if (locationModel) pkg.app.openAreaBrief(locationModel);
            }}]);
            self._whenTxt = new M.PaddedPlainText(whereWhen, {fontSize:fontSizeMedium}, [InlineMixin]);
            
            const row = new pkg.Row(self, {y:18, height:18, inset:spacing}),
                barAttrs = {y:12, layoutHint:3};
            if (barBgColor) barAttrs.bgColor = barBgColor;
            self._historicityBar = new pkg.HistoricityBar(row, {...barAttrs});
            self._attestationBar = new pkg.AttestationBar(row, {...barAttrs});
            self._paradoxBar = new pkg.ParadoxBar(row, {...barAttrs});
            self._chronalBar = new pkg.ChronalBar(row, {...barAttrs, layoutHint:4});
            
            // The bars were added after the layout, which won't place them until the row's 
            // width changes, and in a brief it may not.
            row.getFirstLayout().update();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        update: function(eventModel) {
            const self = this,
                locationModel = eventModel.getLocationModel(),
                whereBtn = self._whereBtn,
                whenTxt = self._whenTxt;
            self.eventModel = eventModel;
            
            whenTxt.setText(pkg.ICON_SEPARATOR + eventModel.formatAsTemporalExtent());
            
            // As tall as the text beside it, since a button centers its text, which would 
            // otherwise sit lower.
            whereBtn.setText(locationModel?.name ?? pkg.ICON_NIL);
            whereBtn.setHeight(whenTxt.height);
            whereBtn.setDisabled(!locationModel);
            
            self._historicityBar.updateForStat(eventModel[pkg.STAT_ID_HISTORICITY]);
            self._attestationBar.updateForStat(eventModel[pkg.STAT_ID_ATTESTATION]);
            self._paradoxBar.updateForStat(eventModel[pkg.STAT_ID_PARADOX]);
            
            const chronalBar = self._chronalBar,
                chronalStat = eventModel[pkg.STAT_ID_CHRONAL],
                isHQ = eventModel.isHQ();
            chronalBar.setVisible(isHQ || (chronalStat.max > 0 && eventModel.isNotChronoLocked()) || chronalStat.value > 0);
            chronalBar.setLabelTemplate(i18n(isHQ ? 'bar-pool-label' : 'bar-event-chronal-label'));
            chronalBar.updateForStat(chronalStat);
        }
    });
})(tc);
