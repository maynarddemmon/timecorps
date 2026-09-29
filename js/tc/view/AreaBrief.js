(pkg => {
    'use strict';
    
    const M = myt,
        {View, SpacedLayout} = M,
        
        {
            WideView, DetailRow, DetailRowFlow, TextForFlow,
            theme:{
                layoutSpacing, spacing, padding, cornerRadius,
                colorUltraLight, colorMegaDark,
                fontFamilyMono
            },
            ICON_SEPARATOR
        } = pkg,
        
        HALF_PADDING = padding / 2,
        
        PHOTO_HEIGHT = 208;
    
    pkg.AreaBrief = new JS.Class('AreaBrief', pkg.ModalDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.tallWidth ??= 520;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            self._photo = new WideView(self, {
                x:HALF_PADDING, y:HALF_PADDING, percentOfParentWidthOffset:-2*HALF_PADDING,
                roundedCorners:cornerRadius, height:PHOTO_HEIGHT, imageSize:'contain'
            }, [M.ImageSupport]);
            
            const profileY = HALF_PADDING + PHOTO_HEIGHT + layoutSpacing,
                profile = new WideView(self, {
                    x:HALF_PADDING, y:profileY, percentOfParentWidthOffset:-2*HALF_PADDING,
                    percentOfParentHeight:100, percentOfParentHeightOffset:-(profileY + HALF_PADDING),
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                profileContainer = new WideView(profile, {percentOfParentWidthOffset:-2*padding}),
                profileView = self._profileView = new DetailRow(profileContainer, {label:'Report'}),
                profileViewValue = profileView._value;
            profileViewValue.setWhiteSpace('pre-wrap');
            profileViewValue.setPaddingTop(3);
            profileViewValue.setFontFamily(fontFamilyMono);
            new SpacedLayout(profileContainer, {axis:'y', inset:spacing, spacing:-5, outset:spacing, collapseParent:true});
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
                
                pkg.loadTxtIntoElement('./data/location/' + id + '.txt', self._profileView, () => self.locationModel === locationModel);
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
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
