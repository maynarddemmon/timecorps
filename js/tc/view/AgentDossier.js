(pkg => {
    'use strict';
    
    const {PlainText, SpacedLayout, ResizeLayout, SizeToParent} = myt,
        
        {
            WideView, TallView, CompactField, CompactFieldRow,
            SkillBar,
            timeUtil:{format},
            theme:{
                layoutSpacing, spacing, padding, cornerRadius, 
                colorMedium, colorDark, colorMegaDark
            },
            STAT_ID_CHRONAL, STAT_ID_PARADOX, STAT_ID_HEALTH
        } = pkg,
        
        HALF_PADDING = padding / 2,
        
        PHOTO_SIZE = 256;
    
    pkg.AgentDossier = new JS.Class('AgentDossier', pkg.AckDialog, {
        include: [pkg.BriefSupport],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.cancelable ??= true;
            attrs.photoWidth = attrs.photoHeight = PHOTO_SIZE;
            // The vitals sit beside the portrait, so the profile never moves up into its space.
            attrs.reservePhotoSpace = true;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            self._statusTxt = new PlainText(self);
            
            const vitalsX = HALF_PADDING + PHOTO_SIZE + layoutSpacing,
                vitals = new WideView(self, {
                    x:vitalsX, y:HALF_PADDING, height:PHOTO_SIZE,
                    percentOfParentWidthOffset:-(vitalsX + HALF_PADDING),
                    roundedCorners:cornerRadius, bgColor:colorMegaDark,
                    overflow:'autoy'
                }),
                vitalsContainer = new WideView(vitals);
            
            let row = new WideView(vitalsContainer, {height:18});
            self._chronalView = new pkg.ChronalBar(row, {y:12, bgColor:colorDark, layoutHint:1});
            self._paradoxView = new pkg.ParadoxBar(row, {y:12, bgColor:colorDark, layoutHint:1});
            self._healthView = new pkg.HealthBar(row, {y:12, bgColor:colorDark, layoutHint:1});
            new ResizeLayout(row, {inset:spacing, spacing, outset:spacing});
            
            row = new CompactFieldRow(vitalsContainer);
            self._idView = new CompactField(row, {label:'ID', layoutHint:1});
            self._nameView = new CompactField(row, {label:'Name', layoutHint:1});
            self._roleView = new CompactField(row, {label:'Role', layoutHint:1});
            row.getFirstLayout().update();
            
            row = new CompactFieldRow(vitalsContainer);
            self._whereView = new CompactField(row, {label:'Where', layoutHint:1});
            self._whenView = new CompactField(row, {label:'When', layoutHint:1});
            self._eventView = new CompactField(row, {label:'Event', layoutHint:1});
            row.getFirstLayout().update();
            
            const skillsContainer = self._skills = new WideView(vitalsContainer);
            new SpacedLayout(skillsContainer, {axis:'y', inset:20, spacing:18, outset:12, collapseParent:true});
            
            new SpacedLayout(vitalsContainer, {axis:'y', inset:spacing, outset:spacing, collapseParent:true});
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle('Agent Dossier', briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => './data/dossiers/' + briefModel.id + '.txt',
        
        /** @overrides BriefSupport */
        getBriefReportLabel: () => 'Profile',
        
        /** @overrides BriefSupport */
        setBriefModel: function(agentModel) {
            const self = this;
            
            if (agentModel) {
                const id = agentModel.id,
                    name = agentModel.getName(),
                    eventModel = agentModel.getEventModel(),
                    photo = self.getPhoto(),
                    statusTxt = self._statusTxt;
                
                self._idView.setValue(id);
                self._nameView.setValue(name);
                self._roleView.setValue(agentModel.getRoleLabel());
                self._whereView.setValue(eventModel.getLocationModel()?.name);
                self._whenView.setValue(format(eventModel.getStart()));
                self._eventView.setValue(eventModel.name);
                self.updateStats(agentModel);
                
                let statusAttrs = {text:''};
                if (agentModel.isDead()) {
                    photo.addDomClass('agent-dead');
                    statusAttrs = {x:12, y:-135, fontSize:'400px', textColor:'#fff3', text:pkg.ICON_DEATH};
                } else {
                    photo.removeDomClass('agent-dead');
                }
                statusTxt.callSetters(statusAttrs);
                
                const skillsRow = self._skills;
                skillsRow.destroyAllSubviews();
                new TallView(skillsRow, {
                    align:'center', y:16, width:1, bgColor:colorMedium, 
                    percentOfParentHeightOffset:-24, ignoreLayout:true
                });
                for (const skillInfo of agentModel.getSkillInfo()) {
                    const cfg = skillInfo.cfg,
                        label = cfg.name + ' : ' + skillInfo.value;
                    new SkillBar(skillsRow, {
                        x:spacing, minValue:-1000, value:skillInfo.value, maxValue:1000,
                        percentOfParentWidth:100, percentOfParentWidthOffset:-2*spacing,
                        label, tooltip:label + ' - ' + cfg.description
                    }, [SizeToParent]);
                }
            }
            
            self.callSuper(agentModel);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        updateStats: function(agentModel) {
            this._chronalView.updateForStat(agentModel[STAT_ID_CHRONAL]);
            this._paradoxView.updateForStat(agentModel[STAT_ID_PARADOX]);
            this._healthView.updateForStat(agentModel[STAT_ID_HEALTH]);
        },
        
        /** @overrides BriefSupport */
        notifyBriefModelChanged: function(agentModel) {
            this.callSuper(agentModel);
            if (this.visible && this.getBriefModel() === agentModel) {
                this.updateStats(agentModel);
            }
        }
    });
})(tc);
