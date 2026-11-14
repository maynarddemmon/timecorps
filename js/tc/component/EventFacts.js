(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {I18N:{get:i18n}, PaddedText} = M,
        
        {
            WideView, EventLinkFlow,
            theme:{
                padding, spacing, 
                fontSizeLarge, fontSizeMedium, colorMegaDark, colorMedium, colorLight
            }
        } = pkg;
    
    /*  An Event's place, time and stats, laid out the same in Event Details and the Event 
        Brief: a line with the Event's location, which opens its Area Brief, and when the 
        Event happens, then its historicity, attestation and paradox bars. The time wraps 
        below the location when the line is too narrow for both. Call update with the Event 
        whenever it changes.
        
        Attrs:
            barBgColor - The background of the stat bars, for when the default doesn't show
                against what's behind them. */
    pkg.EventFacts = new JSClass('EventFacts', WideView, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this,
                barBgColor = attrs.barBgColor;
            delete attrs.barBgColor;
            
            attrs.height ??= 37;
            
            self.callSuper(parent, attrs);
            
            const whereWhen = new WideView(self, {x:spacing, percentOfParentWidthOffset:-2*spacing});
            self._whereBtn = new pkg.InlineUnderlineBtn(whereWhen, {
                fontSize:fontSizeMedium, tooltip:i18n('tip-open-area-brief')
            }, [{doActivated: () => {
                const locationModel = self.eventModel?.getLocationModel();
                if (locationModel) pkg.app.openAreaBrief(locationModel);
            }}]);
            self._whenTxt = new pkg.InlinePlainText(whereWhen, {fontSize:fontSizeMedium});
            
            const row = new pkg.Row(self, {y:19, height:18, inset:spacing}),
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
                whereBtn = self._whereBtn;
            self.eventModel = eventModel;
            
            self._whenTxt.setText(pkg.ICON_SEPARATOR + eventModel.formatAsTemporalExtent());
            whereBtn.setText(locationModel?.name ?? pkg.ICON_NIL);
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
    
    pkg.DescPart = new JSClass('DescPart', M.View, {
        initNode: function(parent, attrs) {
            const self = this,
                hPad = attrs.padding ?? padding,
                part = self.part = attrs.part,
                type = part.type,
                model = part.model,
                isCausator = type === 'causator',
                isLegacy = type === 'legacy',
                causatorCallback = attrs.causatorCallback;
            delete attrs.part;
            delete attrs.padding;
            delete attrs.causatorCallback;
            
            attrs.width ??= parent.width;
            attrs.bgColor ??= colorMegaDark;
            attrs.textColor ??= isCausator ? colorLight : 'inherit';
            
            self.callSuper(parent, attrs);
            
            if (isCausator) {
                self._nameTxt = new PaddedText(self, {
                    paddingLeft:hPad, paddingRight:hPad,
                    textColor:colorMedium,
                    whiteSpace:'normal', fontSize:fontSizeLarge,
                    text:model.getName()
                });
            }
            
            self._txt = new PaddedText(self, {
                width:self.width,
                paddingLeft:hPad, paddingRight:hPad,
                fontSize:fontSizeMedium, whiteSpace:'normal',
                fontStyle:isLegacy ? 'italic' : null,
                text:part.value
            });
            
            if (isCausator) {
                // Only show links the player is allowed to know about.
                const eventModel = model.event,
                    precursorsFlow = self._precursorFlow = new EventLinkFlow(self, {x:hPad}, [{
                        doBtnActivated: btn => causatorCallback?.(btn)
                    }]),
                    descendantsFlow = self._descendantFlow = new EventLinkFlow(self, {x:hPad}, [{
                        doBtnActivated: btn => causatorCallback?.(btn)
                    }]);
                precursorsFlow.update(
                    i18n('event-precursors') + '\u00A0',
                    [...model.getPrecursors()].filter(precursor => precursor.isNotHidden() && !eventModel.isAffectedByHidden(precursor))
                );
                descendantsFlow.update(
                    i18n('event-descendants') + '\u00A0',
                    [...model.getDescendants()].filter(descendant => descendant.isNotHidden() && !descendant.isAffectedByHidden(eventModel))
                );
            }
            
            new M.SpacedLayout(self, {axis:'y', inset:padding, spacing:padding/2, outset:padding, collapseParent:true});
        },
        setWidth: function(v) {
            const self = this;
            self.callSuper(v);
            if (self.inited) {
                const w = self.width;
                for (const sv of [self._nameTxt, self._txt, self._precursorFlow, self._descendantFlow]) sv?.setWidth(w);
            }
        }
    });
})(tc);
