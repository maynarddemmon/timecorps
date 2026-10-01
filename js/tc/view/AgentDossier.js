(pkg => {
    'use strict';
    
    const M = myt,
        {View, SpacedLayout} = M,
        
        {
            WideView, DetailRow, DetailRowFlow, TextForFlow,
            timeUtil:{format},
            theme:{
                layoutSpacing, spacing, padding, cornerRadius,
                colorUltraLight, colorMegaDark,
                fontSizeMedium, fontFamilyMono, fontSizeHandwritten, fontFamilyHandwritten
            },
            ICON_SEPARATOR
        } = pkg,
        
        HALF_PADDING = padding / 2,
        
        PHOTO_SIZE = 256;
    
    pkg.AgentDossier = new JS.Class('AgentDossier', pkg.ModalDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            const photoAttrs = {
                x:HALF_PADDING, y:HALF_PADDING, roundedCorners:cornerRadius,
                width:PHOTO_SIZE, height:PHOTO_SIZE
            };
            self._photo = new View(self, {...photoAttrs, imageSize:'contain'}, [M.ImageSupport]);
            
            // Muted so browsers allow it to autoplay. Inline so iOS doesn't go fullscreen.
            const video = self._video = new View(self, {...photoAttrs, tagName:'video', visible:false}),
                videoElem = video.getIDE();
            videoElem.muted = videoElem.loop = videoElem.autoplay = videoElem.playsInline = true;
            videoElem.style.objectFit = 'contain';
            
            // Fall back to the still if the video is missing or the browser can't play it.
            videoElem.addEventListener('error', () => {
                const agentModel = self.agentModel;
                if (agentModel && video.visible) self.showPhoto(agentModel.id);
            });
            
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
            self._skills = new DetailRowFlow(vitalsContainer, {label:'Skills'});
            new SpacedLayout(vitalsContainer, {axis:'y', inset:spacing, spacing:-5, outset:spacing, collapseParent:true});
            
            const profileY = HALF_PADDING + PHOTO_SIZE + layoutSpacing,
                profile = new WideView(self, {
                    x:HALF_PADDING, y:profileY, percentOfParentWidthOffset:-2*HALF_PADDING,
                    percentOfParentHeight:100, percentOfParentHeightOffset:-(profileY + HALF_PADDING),
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                profileContainer = new WideView(profile, {percentOfParentWidthOffset:-2*padding}),
                fieldNotesView = self._fieldNotesView = new DetailRow(profileContainer, {label:'Field Notes'}),
                profileView = self._profileView = new DetailRow(profileContainer, {label:'Profile'}),
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
                
                if (agentModel.hasVideoPortrait()) {
                    self.showVideo(id);
                } else {
                    self.showPhoto(id);
                }
                self._idView.setValue(id);
                self._nameView.setValue(name);
                self._roleView.setValue(agentModel.getRoleLabel());
                self._eventView.setValue(eventModel.name);
                self._whereView.setValue(eventModel.getLocationModel()?.name);
                self._whenView.setValue(format(eventModel.getStart()));
                
                const skillsRow = self._skills;
                let isNotFirst = false;
                skillsRow.clearContent();
                for (const skillInfo of agentModel.getSkillInfo()) {
                    if (isNotFirst) new TextForFlow(skillsRow, {text:ICON_SEPARATOR});
                    new TextForFlow(skillsRow, {text:skillInfo.id + ' (' + skillInfo.value + ')'});
                    isNotFirst = true;
                }
                
                self.updateFieldNotes();
                pkg.loadTxtIntoElement('./data/dossiers/' + id + '.txt', self._profileView, () => self.agentModel === agentModel);
            } else {
                self.stopVideo();
            }
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        showPhoto: function(id) {
            this.stopVideo();
            const photo = this._photo;
            photo.setImageUrl(pkg.IMAGE_ROOT + 'agent/' + id + '.jpg');
            photo.setVisible(true);
        },
        
        showVideo: function(id) {
            const video = this._video,
                videoElem = video.getIDE();
            this._photo.setVisible(false);
            video.setVisible(true);
            videoElem.src = pkg.IMAGE_ROOT + 'agent/' + id + '.webm';
            
            // play() rejects if playback is interrupted, e.g. the dossier closes first, which
            // is fine to ignore. A real load failure goes to the error listener.
            videoElem.play()?.catch(() => {});
        },
        
        /*  Stops playback and releases the file so a hidden dossier isn't decoding video. */
        stopVideo: function() {
            const video = this._video,
                videoElem = video.getIDE();
            video.setVisible(false);
            if (videoElem.getAttribute('src')) {
                videoElem.pause();
                videoElem.removeAttribute('src');
                videoElem.load();
            }
        },
        
        updateFieldNotes: function() {
            const fieldNotes = this.agentModel?.getDescription() ?? '',
                fieldNotesView = this._fieldNotesView;
            fieldNotesView.setVisible(fieldNotes !== '');
            fieldNotesView.setValue(fieldNotes);
        },
        
        notifyAgentModelChanged: function(agentModel) {
            if (this.visible && this.agentModel === agentModel) this.updateFieldNotes();
        },
        
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
