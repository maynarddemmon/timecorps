(pkg => {
    'use strict';
    
    const M = myt,
        
        {
            WideView, DetailRow,
            theme:{
                layoutSpacing, spacing, padding, cornerRadius,
                colorUltraLight, colorMegaDark,
                fontSizeHandwritten, fontFamilyMono, fontFamilyHandwritten
            },
            cfg:{TL_COL_HEADER_HEIGHT, TL_COL_WIDTH}
        } = pkg,
        
        HALF_PADDING = padding / 2,
        PHOTO_HEIGHT = 4*TL_COL_HEADER_HEIGHT,
        PROFILE_Y = HALF_PADDING + PHOTO_HEIGHT + layoutSpacing;
    
    pkg.AreaBrief = new JS.Class('AreaBrief', pkg.ModalDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.tallWidth ??= 4*(TL_COL_WIDTH + padding) + padding;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            self._photo = new WideView(self, {
                x:HALF_PADDING, y:HALF_PADDING, percentOfParentWidthOffset:-padding,
                roundedCorners:cornerRadius, height:PHOTO_HEIGHT, imageSize:'contain',
                visible:false,
                calculateNaturalSize:true // Used so that setImageLoadingError/setNaturalWidth fires.
            }, [M.ImageSupport, {
                setImageLoadingError: function(v) {
                    this.callSuper(v);
                    if (v) {
                        // This is the image loading failure case.
                        this.setVisible(false);
                        profile.setY(HALF_PADDING);
                        profile.setPercentOfParentHeightOffset(-padding);
                    }
                },
                setNaturalWidth: function(v) {
                    this.callSuper(v);
                    if (v > 0) {
                        // This is the image loading success case.
                        this.setVisible(true);
                        profile.setY(PROFILE_Y);
                        profile.setPercentOfParentHeightOffset(-(PROFILE_Y + HALF_PADDING));
                    }
                }
            }]);
            
            const profile = new WideView(self, {
                    x:HALF_PADDING, y:HALF_PADDING, percentOfParentWidthOffset:-padding,
                    percentOfParentHeight:100, percentOfParentHeightOffset:-padding,
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                profileContainer = new WideView(profile, {percentOfParentWidthOffset:-2*padding}),
                fieldNotesView = self._fieldNotesView = new DetailRow(profileContainer, {label:'Field Notes'}),
                profileView = self._profileView = new DetailRow(profileContainer, {label:'Report'}),
                profileViewValue = profileView.getValueView(),
                fieldNotesValueView = fieldNotesView.getValueView();
            
            fieldNotesValueView.setWhiteSpace('normal');
            fieldNotesValueView.setPaddingTop(2);
            fieldNotesValueView.setLineHeight('1.75em');
            fieldNotesValueView.setFontFamily(fontFamilyHandwritten);
            fieldNotesValueView.setFontSize(fontSizeHandwritten);
            
            profileViewValue.setWhiteSpace('pre-wrap');
            profileViewValue.setPaddingTop(3);
            profileViewValue.setFontFamily(fontFamilyMono);
            
            new M.SpacedLayout(profileContainer, {axis:'y', inset:spacing, spacing:-5, outset:spacing, collapseParent:true});
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setLocationModel: function(locationModel) {
            const self = this;
            self.locationModel = locationModel;
            
            if (locationModel) {
                const id = locationModel.id,
                    name = locationModel.getName();
                
                const prefix = 'Area Brief : ',
                    title = prefix + '<span style="color:' + colorUltraLight + ';">' + name + '</span>';
                self.setTitle(title, prefix + name);
                
                self._photo.setImageUrl(pkg.IMAGE_ROOT + 'location/' + id + '.jpg');
                self.updateFieldNotes();
                pkg.loadTxtIntoElement('./data/location/' + id + '.txt', self._profileView, () => self.locationModel === locationModel);
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  The dynamic part of the brief: the visible Describable phrases, which change
            as the timeline changes. The row is hidden when nothing is visible. */
        updateFieldNotes: function() {
            const fieldNotes = this.locationModel?.getDescription() ?? '',
                fieldNotesView = this._fieldNotesView;
            fieldNotesView.setVisible(fieldNotes !== '');
            fieldNotesView.setValue(fieldNotes);
        },
        
        notifyLocationModelChanged: function(locationModel) {
            if (this.visible && this.locationModel === locationModel) this.updateFieldNotes();
        },
        
        show: function(locationModel) {
            this.callSuper();
            this.setLocationModel(locationModel);
        },
        
        hide: function(ignoreRestoreFocus) {
            this.callSuper(ignoreRestoreFocus);
            this.setLocationModel();
        }
    });
})(tc);
