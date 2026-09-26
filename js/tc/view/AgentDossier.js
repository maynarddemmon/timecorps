(pkg => {
    'use strict';
    
    const M = myt,
        {View, SpacedLayout} = M,
        
        {
            WideView, DetailRow,
            timeUtil:{format},
            theme:{
                layoutSpacing, spacing, padding, cornerRadius,
                colorUltraLight, colorMegaDark,
                fontFamilyMono
            }
        } = pkg,
        
        HALF_PADDING = padding / 2,
        
        PHOTO_SIZE = 256,
        
        loadTxtIntoElement = (url, targetView, isStillWanted) => {
            targetView.setValue('Retrieving…');
            
            M.doFetch(url, {}, true,
                response => {
                    if (isStillWanted()) targetView.setValue(response);
                },
                err => {
                    console.error('err', err);
                    if (isStillWanted()) targetView.setValue('MISSING / REDACTED: ' + err);
                }
            );
        };
    
    pkg.AgentDossier = new JS.Class('AgentDossier', pkg.ModalDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            self._photo = new View(self, {
                x:HALF_PADDING, y:HALF_PADDING, roundedCorners:cornerRadius,
                width:PHOTO_SIZE, height:PHOTO_SIZE, imageSize:'contain'
            }, [M.ImageSupport]);
            
            const vitalsX = HALF_PADDING + PHOTO_SIZE + layoutSpacing,
                vitals = new WideView(self, {
                    x:vitalsX, y:HALF_PADDING, height:PHOTO_SIZE,
                    percentOfParentWidthOffset:-(vitalsX + HALF_PADDING),
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                vitalsContainer = new WideView(vitals, {});
            self._idView = new DetailRow(vitalsContainer, {label:'ID'});
            self._nameView = new DetailRow(vitalsContainer, {label:'Name'});
            self._roleView = new DetailRow(vitalsContainer, {label:'Role'});
            self._eventView = new DetailRow(vitalsContainer, {label:'Event'});
            self._whereView = new DetailRow(vitalsContainer, {label:'Where'});
            self._whenView = new DetailRow(vitalsContainer, {label:'When'});
            new SpacedLayout(vitalsContainer, {axis:'y', inset:spacing, spacing:-5, outset:spacing, collapseParent:true});
            
            const profileY = HALF_PADDING + PHOTO_SIZE + layoutSpacing,
                profile = new WideView(self, {
                    x:HALF_PADDING, y:profileY, percentOfParentWidthOffset:-2*HALF_PADDING,
                    percentOfParentHeight:100, percentOfParentHeightOffset:-(profileY + HALF_PADDING),
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                profileContainer = new WideView(profile, {percentOfParentWidthOffset:-2*padding}),
                profileView = self._profileView = new DetailRow(profileContainer, {label:'Profile'}),
                profileViewValue = profileView._value;
            profileViewValue.setWhiteSpace('pre-wrap');
            profileViewValue.setPaddingTop(3);
            profileViewValue.setFontFamily(fontFamilyMono);
            new SpacedLayout(profileContainer, {axis:'y', inset:spacing, spacing:-5, outset:spacing, collapseParent:true});
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setAgentModel: function(agentModel) {
            const self = this;
            self.agentModel = agentModel;
            
            if (agentModel) {
                const id = agentModel.id,
                    name = agentModel.getName(),
                    eventModel = agentModel.getEventModel();
                
                const prefix = 'Agent Dossier : ',
                    title = prefix + '<span style="color:' + colorUltraLight + ';">' + name + '</span>';
                self.setTitle(title, prefix + name);
                
                self._photo.setImageUrl(pkg.IMAGE_ROOT + 'agent/' + id + '.jpg');
                self._idView.setValue(id);
                self._nameView.setValue(name);
                self._roleView.setValue(agentModel.getRoleLabel());
                self._eventView.setValue(eventModel.name);
                self._whereView.setValue(eventModel.getLocationModel()?.name);
                self._whenView.setValue(format(eventModel.getStart()));
                loadTxtIntoElement('./data/dossiers/' + id + '.txt', self._profileView, () => self.agentModel === agentModel);
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        show: function(agentModel) {
            this.callSuper();
            this.setAgentModel(agentModel);
        },
        
        hide: function(ignoreRestoreFocus) {
            this.callSuper(ignoreRestoreFocus);
            this.setAgentModel();
        }
    });
})(tc);
