(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {I18N:{get:i18n}, SpacedLayout, SizeToParent} = M,
        
        {
            WideView,
            theme:{
                layoutSpacing, padding, cornerRadius,
                colorUltraLight, colorMedium, colorMegaDark,
                fontSizeMedium, fontFamilyMono
            },
            ICON_NIL
        } = pkg,
        
        /*  A labeled row in a brief's profile for views rather than text. Returns the row and
            the view to add them to: they're stacked top down, given its width, and it grows to
            fit them, and the row with it. */
        makeContainerRow = (profileContainer, labelWidth, label, spacing) => {
            const row = new DetailRow(profileContainer, {labelWidth, label}),
                valueView = row.getValueView(),
                labelHeight = row.height;
            valueView.setVisible(false);
            
            const content = new WideView(row, {x:valueView.x, percentOfParentWidthOffset:-valueView.x}, [{
                setHeight: function(v) {
                    this.callSuper(v);
                    row.setHeight(Math.max(labelHeight, this.height));
                },
                setWidth: function(v) {
                    this.callSuper(v);
                    if (this.inited) {
                        const width = this.width;
                        for (const subview of this.getSubviews()) subview.setWidth(width);
                    }
                }
            }]);
            new SpacedLayout(content, {axis:'y', spacing, collapseParent:true});
            return {row, content};
        },
        
        DetailRow = new JSClass('DetailRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this,
                    label = attrs.label,
                    labelWidth = attrs.labelWidth ?? 75,
                    vertical = attrs.vertical ?? false;
                delete attrs.label;
                delete attrs.labelWidth;
                delete attrs.vertical;
                
                self.callSuper(parent, attrs);
                
                const labelView = self._label = new M.PlainText(self, {
                    width:labelWidth, textColor:colorMedium, fontSize:fontSizeMedium, textAlign:vertical ? 'left' : 'right',
                    text:label
                });
                
                const valueX = vertical ? 0 : labelWidth + padding;
                self._value = new M.PaddedText(self, {
                    x:valueX,
                    y:vertical ? labelView.y + labelView.height : 0,
                    percentOfParentWidth:100, percentOfParentWidthOffset:-valueX,
                    text:ICON_NIL, whiteSpace:'normal', fontSize:fontSizeMedium
                }, [SizeToParent, {
                    sizeViewToDom: function() {
                        this.callSuper();
                        const yExtent = this.y + this.height;
                        if (self.height !== yExtent) self.setHeight(yExtent);
                    }
                }]);
            },
            setLabel: function(v) {this._label.setText(v);},
            setValue: function(v) {this.getValueView().setText(v || ICON_NIL);},
            getValueView: function() {return this._value;}
        });
    
    
    /*  For dialogs that brief the player on a model: an optional photo, field notes from the 
        model's description, as blocks (see Describable.getFullDescriptionAsParts and 
        DescPart), and a typed report loaded from a text file.
        Mix into a ModalDialog. The dialog is only as tall as its content, up to the 
        window's height, past which the field notes and report scroll.
        
        Attrs:
            photoWidth - A fixed photo width. Without one the photo spans the dialog.
            photoHeight - Defaults to 200.
            reservePhotoSpace - When true the report stays below the photo's space even if 
                there's no photo, for dialogs that put other views beside the photo.
        
        A brief can also put a summary of the model between the photo and the field notes 
        with setBriefSummaryView, and add rows of its own below the report with addProfileRow
        (text) or addProfileContainerRow (views).
        
        Hooks:
            getBriefTitle(model) - Required. The dialog title for the model.
            getBriefReportUrl(model) - Required. The URL of the report text, or null if there's
                no report, which hides the report row.
            getBriefReportLabel() - The report's label. Defaults to "Report". */
    pkg.BriefSupport = new JS.Module('BriefSupport', {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this,
                halfPadding = padding / 2,
                photoWidth = attrs.photoWidth,
                photoHeight = attrs.photoHeight ?? 200,
                reservePhotoSpace = attrs.reservePhotoSpace ?? false;
            delete attrs.photoWidth;
            delete attrs.photoHeight;
            delete attrs.reservePhotoSpace;
            attrs.sizingStrategy ??= 'fit';
            
            self.callSuper(parent, attrs);
            
            self._photoHeight = photoHeight;
            self._reservePhotoSpace = reservePhotoSpace;
            self._isPhotoShown = false;
            
            // Build UI //
            
            // Hidden until the photo loads. Without one the report fills the whole dialog unless 
            // the dialog reserves the photo's space
            const photoAttrs = {x:halfPadding, y:halfPadding, height:photoHeight, visible:false},
                photoMixins = [{
                    doMediaReady: function() {
                        this.setVisible(true);
                        self._setPhotoShown(true);
                    },
                    doMediaFailed: function() {
                        this.setVisible(false);
                        self._setPhotoShown(false);
                    }
                }];
            if (photoWidth > 0) {
                photoAttrs.width = photoWidth;
            } else {
                photoMixins.unshift(SizeToParent);
                photoAttrs.percentOfParentWidth = 100;
                photoAttrs.percentOfParentWidthOffset = -padding;
            }
            self._photo = new pkg.MediaView(self, photoAttrs, photoMixins);
            
            const labelWidth = self._profileLabelWidth = 65,
                profile = self._profile = new WideView(self, {
                    x:halfPadding, percentOfParentWidthOffset:-padding, percentOfParentHeight:100,
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                profileContainer = new WideView(profile, {percentOfParentWidthOffset:-labelWidth/1.5}),
                fieldNotes = makeContainerRow(profileContainer, labelWidth, i18n('brief-field-notes'), 1),
                profileView = self._profileView = new DetailRow(profileContainer, {labelWidth, label:self.getBriefReportLabel()}),
                profileViewValue = profileView.getValueView();
            self._fieldNotesView = fieldNotes.row;
            self._fieldNotesContent = fieldNotes.content;
            
            profileViewValue.setWhiteSpace('pre-wrap');
            
            new SpacedLayout(profileContainer, {axis:'y', inset:padding, spacing:padding, outset:2*padding, collapseParent:true});
            
            self._placeContent();
            
            // The content is the photo's space, if it's used, and the field notes and report,
            // whose container grows as the report loads.
            self._profileContainer = profileContainer;
            self.syncTo(profile, '_fitToContent', 'y');
            self.syncTo(profileContainer, '_fitToContent', 'height');
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        getPhoto: function() {return this._photo;},
        getProfile: function() {return this._profile;},
        
        getBriefReportLabel: () => i18n('brief-report'),
        
        getBriefModel: function() {return this.briefModel;},
        
        /*  Adds a labeled row below the field notes, report and any rows already added, with
            text styled like the report's but wrapping as ordinary text. Returns the DetailRow. */
        addProfileRow: function(label) {
            return new DetailRow(this._profileContainer, {labelWidth:this._profileLabelWidth, label});
        },
        
        /*  Adds a labeled row below the field notes, report and any rows already added, for 
            views rather than text. Returns the view to add them to: they're stacked top down
            and it grows to fit them, and the row with it. */
        addProfileContainerRow: function(label) {
            return makeContainerRow(this._profileContainer, this._profileLabelWidth, label, padding/2).content;
        },
        
        /*  Puts the view below the photo, or the photo's space, with the field notes and 
            report below it, following its height. Give it the same x and width as the 
            report, i.e. x:padding/2 and percentOfParentWidthOffset:-padding. */
        setBriefSummaryView: function(view) {
            this._briefSummaryView = view;
            this.syncTo(view, '_placeContent', 'height');
        },
        
        setBriefModel: function(model) {
            const self = this,
                photo = self.getPhoto();
            self.briefModel = model;
            
            if (model) {
                self.setTitle(self.getBriefTitle(model));
                photo.setMedia(...model.getMediaUrls());
                self.updateFieldNotes();
                
                const reportUrl = self.getBriefReportUrl(model),
                    profileView = self._profileView;
                if (reportUrl == null) {
                    profileView.setVisible(false);
                } else {
                    profileView.setVisible(true);
                    pkg.loadTxtIntoElement(reportUrl, profileView, () => self.briefModel === model);
                }
            } else {
                photo.clearMedia();
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /** @private */
        _setPhotoShown: function(isShown) {
            this._isPhotoShown = isShown;
            this._placeContent();
        },
        
        /*  The summary, if there is one, goes below the photo's space if the photo is shown 
            or the space is reserved, and the field notes and report below that.
            @private */
        _placeContent: function(_event) {
            const halfPadding = padding / 2,
                summaryView = this._briefSummaryView,
                profile = this.getProfile();
            let y = this._isPhotoShown || this._reservePhotoSpace ? halfPadding + this._photoHeight + layoutSpacing : halfPadding;
            if (summaryView) {
                summaryView.setY(y);
                y += summaryView.height + layoutSpacing;
            }
            profile.setY(y);
            profile.setPercentOfParentHeightOffset(-(y + halfPadding));
        },
        
        /** @private */
        _fitToContent: function(_event) {
            const profile = this.getProfile(),
                profileContainer = this._profileContainer;
            if (profile && profileContainer) this.setContentHeightToFit(profile.y + profileContainer.height + padding / 2);
        },
        
        /*  The dynamic part of the brief: the model's description as blocks, which change as 
            the timeline changes. The row is hidden when there's nothing to show. */
        updateFieldNotes: function() {
            const self = this,
                parts = (self.briefModel?.getFullDescriptionAsParts() ?? []).filter(part => part.value),
                content = self._fieldNotesContent;
            content.destroyAllSubviews();
            
            const len = parts.length;
            for (let i = 0; i < len; i++) {
                const part = parts[i];
                new pkg.DescPart(content, {
                    part, 
                    inset:i === 0 ? 0 : padding, 
                    padding:0, 
                    outset:i === len - 1 ? 0 : padding,
                    causatorCallback:btn => self._doCausatorLinkActivated(btn)
                });
            }
            self._fieldNotesView.setVisible(len > 0);
        },
        
        /*  A causator's link to another Event opens that Event's brief, over this one. With 
            shift, it closes this brief and selects the Event, as a link elsewhere does. 
            Returns true when the Event shouldn't be selected. 
            @private */
        _doCausatorLinkActivated: function(btn) {
            if (M.global.keys.isShiftKeyDown()) {
                this.hide();
            } else {
                pkg.app.openEventBrief(btn.navEventModel, true);
                return true;
            }
        },
        
        /*  The field notes, and the photo, which an imageExpr can change. Given the media it 
            already has, the photo doesn't reload. */
        notifyBriefModelChanged: function(model) {
            if (this.visible && this.briefModel === model) {
                this.updateFieldNotes();
                this.getPhoto().setMedia(...model.getMediaUrls());
            }
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
    pkg.makeBriefTitle = (prefix, name) => {
        const styledName = pkg.wrapInStyledSpan(name, colorUltraLight);
        return prefix ? i18n('brief-title', prefix, styledName) : styledName;
    };
})(tc);
