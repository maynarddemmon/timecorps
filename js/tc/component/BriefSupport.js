(pkg => {
    'use strict';
    
    const M = myt,
        
        {
            WideView, DetailRow,
            theme:{
                layoutSpacing, padding, cornerRadius,
                colorUltraLight, colorMegaDark,
                fontSizeMedium, fontSizeHandwritten, fontFamilyMono, fontFamilyHandwritten
            }
        } = pkg;
    
    /*  For dialogs that brief the player on a model: an optional photo, handwritten field 
        notes from the model's Describable phrases, and a typed report loaded from a text file.
        Mix into a ModalDialog.
        
        Attrs:
            photoWidth - A fixed photo width. Without one the photo spans the dialog.
            photoHeight - Defaults to 200.
            reservePhotoSpace - When true the report stays below the photo's space even if 
                there's no photo, for dialogs that put other views beside the photo.
        
        Hooks:
            getBriefTitle(model) - Required. The dialog title for the model.
            getBriefReportUrl(model) - Required. The URL of the report text.
            getBriefReportLabel() - The report's label. Defaults to "Report". */
    pkg.BriefSupport = new JS.Module('BriefSupport', {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this,
                halfPadding = padding / 2,
                photoWidth = attrs.photoWidth,
                photoHeight = attrs.photoHeight ?? 200,
                reservePhotoSpace = attrs.reservePhotoSpace ?? false,
                profileY = halfPadding + photoHeight + layoutSpacing,
                placeProfile = belowPhoto => {
                    const y = belowPhoto || reservePhotoSpace ? profileY : halfPadding;
                    profile.setY(y);
                    profile.setPercentOfParentHeightOffset(-(y + halfPadding));
                };
            delete attrs.photoWidth;
            delete attrs.photoHeight;
            delete attrs.reservePhotoSpace;
            
            self.callSuper(parent, attrs);
            
            // Build UI //
            
            // Hidden until the photo loads. Without one the report fills the whole dialog.
            const photoAttrs = {x:halfPadding, y:halfPadding, height:photoHeight, visible:false},
                photoMixins = [{
                    doMediaReady: function() {
                        this.setVisible(true);
                        placeProfile(true);
                    },
                    doMediaFailed: function() {
                        this.setVisible(false);
                        placeProfile(false);
                    }
                }];
            if (photoWidth > 0) {
                photoAttrs.width = photoWidth;
            } else {
                photoMixins.unshift(M.SizeToParent);
                photoAttrs.percentOfParentWidth = 100;
                photoAttrs.percentOfParentWidthOffset = -padding;
            }
            self._photo = new pkg.MediaView(self, photoAttrs, photoMixins);
            
            const labelWidth = 65,
                profile = new WideView(self, {
                    x:halfPadding, percentOfParentWidthOffset:-padding, percentOfParentHeight:100,
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                profileContainer = new WideView(profile, {percentOfParentWidthOffset:-labelWidth/1.5}),
                fieldNotesView = self._fieldNotesView = new DetailRow(profileContainer, {labelWidth, label:'Field Notes'}),
                profileView = self._profileView = new DetailRow(profileContainer, {labelWidth, label:self.getBriefReportLabel()}),
                profileViewValue = profileView.getValueView(),
                fieldNotesValueView = fieldNotesView.getValueView();
            
            fieldNotesValueView.setWhiteSpace('normal');
            fieldNotesValueView.setPaddingTop(0);
            fieldNotesValueView.setLineHeight('1.75em');
            fieldNotesValueView.setFontFamily(fontFamilyHandwritten);
            fieldNotesValueView.setFontSize(fontSizeHandwritten);
            
            profileViewValue.setWhiteSpace('pre-wrap');
            profileViewValue.setPaddingTop(1);
            profileViewValue.setFontFamily(fontFamilyMono);
            profileViewValue.setFontSize(fontSizeMedium);
            
            new M.SpacedLayout(profileContainer, {axis:'y', inset:padding, outset:2*padding, collapseParent:true});
            
            placeProfile(false);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        getBriefReportLabel: () => 'Report',
        
        getBriefModel: function() {return this.briefModel;},
        
        setBriefModel: function(model) {
            const self = this;
            self.briefModel = model;
            
            if (model) {
                self.setTitle(self.getBriefTitle(model));
                self._photo.setMedia(...model.getMediaUrls());
                self.updateFieldNotes();
                pkg.loadTxtIntoElement(self.getBriefReportUrl(model), self._profileView, () => self.briefModel === model);
            } else {
                self._photo.clearMedia();
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  The dynamic part of the brief: the visible Describable phrases, which change
            as the timeline changes. The row is hidden when nothing is visible. */
        updateFieldNotes: function() {
            const fieldNotes = this.briefModel?.getDescription() ?? '',
                fieldNotesView = this._fieldNotesView;
            fieldNotesView.setVisible(fieldNotes !== '');
            fieldNotesView.setValue(fieldNotes);
        },
        
        notifyBriefModelChanged: function(model) {
            if (this.visible && this.briefModel === model) this.updateFieldNotes();
        },
        
        show: function(model) {
            this.callSuper();
            this.setBriefModel(model);
        },
        
        hide: function(ignoreRestoreFocus) {
            this.setBriefModel();
            this.callSuper(ignoreRestoreFocus);
        }
    });
    
    /*  A title naming the model, e.g. "Area Brief : Bridge". */
    pkg.makeBriefTitle = (prefix, name) => prefix + ' : ' + pkg.wrapInStyledSpan(name, colorUltraLight);
})(tc);
