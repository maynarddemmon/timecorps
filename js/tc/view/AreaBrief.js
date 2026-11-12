(pkg => {
    'use strict';
    
    const M = myt,
        {I18N:{get:i18n}, SizeToParent} = M,
        
        {
            WideView,
            cfg:{TL_COL_HEADER_HEIGHT, TL_COL_WIDTH},
            theme:{padding, fontSizeMedium, fontFamilyMono}
        } = pkg,
        
        resolveUrl = path => new URL(path, document.baseURI).href,
        
        /*  The known Events at a Location, earliest first. */
        CHRONOLOGY_SORT_FUNC = (a, b) => a.getStart() - b.getStart() || a.id.localeCompare(b.id),
        getChronology = locationModel => {
            const locationId = locationModel.id;
            return pkg.model.getEventModelsAsList(
                eventModel => eventModel.getLocation() === locationId && eventModel.isNotHidden()
            ).sort(CHRONOLOGY_SORT_FUNC);
        },
        
        /*  An Event in an Area Brief's chronology: its name and when it happens, laid out like
            the location line in Event Details, then its picture and description. The name
            opens the Event's brief, or with shift, selects the Event and closes the Area
            Brief. Call update whenever the Event changes. */
        ChronologyEntry = new JS.Class('ChronologyEntry', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    brief = self.brief = attrs.brief;
                delete attrs.brief;
                
                self.callSuper(parent, attrs);
                
                const line = new WideView(self, {height:18});
                self._nameBtn = new pkg.InlineUnderlineBtn(line, {
                    fontSize:fontSizeMedium, tooltip:i18n('tip-chronology-event')
                }, [{doActivated: () => {
                    const eventModel = self.eventModel;
                    if (M.global.keys.isShiftKeyDown()) {
                        pkg.app.selectEventBox(eventModel, true);
                        brief.hide();
                    } else {
                        pkg.app.openEventBrief(eventModel, true);
                    }
                }}]);
                self._whenTxt = new pkg.InlinePlainText(line, {fontSize:fontSizeMedium});
                
                // Hidden unless the Event has a picture. As wide as the text, at the timeline's
                // proportions.
                self._media = new pkg.MediaView(self, {
                    percentOfParentWidth:100, visible:false
                }, [SizeToParent, {
                    setWidth: function(v) {
                        this.callSuper(v);
                        this.setHeight(this.width*0.40625);
                    },
                    doMediaReady: function() {this.setVisible(true);},
                    doMediaFailed: function() {this.setVisible(false);}
                }]);
                
                self._descriptionTxt = new pkg.TextForFlow(self, {
                    whiteSpace:'normal', percentOfParentWidth:100,
                    fontSize:fontSizeMedium, fontFamily:fontFamilyMono
                }, [SizeToParent]);
                
                new M.SpacedLayout(self, {axis:'y', spacing:padding / 2, collapseParent:true});
            },
            
            update: function(eventModel) {
                const self = this,
                    nameBtn = self._nameBtn,
                    whenTxt = self._whenTxt;
                self.eventModel = eventModel;
                
                whenTxt.setText(pkg.ICON_SEPARATOR + eventModel.formatAsTemporalExtent());
                
                // As tall as the text beside it, as in EventFacts.
                nameBtn.setText(eventModel.getName());
                nameBtn.setHeight(whenTxt.height);
                
                // Given the media it already has, it doesn't reload.
                const mediaURLs = eventModel.getMediaUrls(),
                    isEquivalentImg = resolveUrl(mediaURLs[0]) === resolveUrl(self.brief.briefModel.getMediaUrls()[0]);
                if (isEquivalentImg) {
                    self._media.setMedia();
                } else {
                    self._media.setMedia(...mediaURLs);
                }
                
                self._descriptionTxt.setText(eventModel.getFullDescription());
            }
        });
    
    /*  Briefs the player on a Location: its photo, field notes, the report in
        location/<id>.txt under cfg.DATA_BASE_DIR, and a chronology of the known Events there,
        earliest first. */
    pkg.AreaBrief = new JS.Class('AreaBrief', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.cancelable ??= true;
            attrs.tallWidth ??= 5*(TL_COL_WIDTH + padding) + padding;
            attrs.photoHeight ??= 5*TL_COL_HEADER_HEIGHT;
            
            self.callSuper(parent, attrs);
            
            self._chronologyView = self.addProfileContainerRow(i18n('brief-chronology'));
            self._chronologyEntries = [];
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle(briefModel.getTitle(), briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => pkg.cfg.DATA_BASE_DIR + 'location/' + briefModel.id + '.txt',
        
        /** @overrides BriefSupport */
        setBriefModel: function(model) {
            this.callSuper(model);
            this._updateChronology();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Called when an Event changes, which may be one in the chronology, or one that
            joins or leaves it. It's called for every Event change, so the update is debounced,
            but each change is checked: a debounced call only sees the last change's Event, 
            which may be at another location. */
        notifyEventModelChanged: function(eventModel) {
            const locationModel = this.briefModel;
            if (this.visible && locationModel && eventModel.getLocation() === locationModel.id) this._updateChronologyDebounced();
        },
        
        /** @private */
        _updateChronologyDebounced: M.debounce(function() {this._updateChronology();}, 250),
        
        /*  Shows the known Events at the Location. The entries are kept, and only updated,
            while the same Events are known, so their pictures don't reload. The row is
            hidden when there are none. */
        _updateChronology: function() {
            const self = this,
                locationModel = self.briefModel,
                chronologyView = self._chronologyView,
                eventModels = locationModel ? getChronology(locationModel) : [];
            let entries = self._chronologyEntries;
            
            if (entries.length !== eventModels.length || entries.some((entry, i) => entry.eventModel !== eventModels[i])) {
                for (const entry of entries) entry.destroy();
                entries = self._chronologyEntries = eventModels.map(() => new ChronologyEntry(chronologyView, {brief:self}));
            }
            eventModels.forEach((eventModel, i) => {entries[i].update(eventModel);});
            
            chronologyView.parent.setVisible(eventModels.length > 0);
        }
    });
})(tc);
