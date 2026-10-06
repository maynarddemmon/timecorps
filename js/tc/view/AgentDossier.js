(pkg => {
    'use strict';
    
    const {SpacedLayout} = myt,
        
        {
            WideView, DetailRow, DetailRowFlow, TextForFlow,
            timeUtil:{format},
            theme:{layoutSpacing, spacing, padding, cornerRadius, colorMegaDark},
            ICON_SEPARATOR
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
            
            self.callSuper(parent, attrs);
            
            // Build UI
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
                    eventModel = agentModel.getEventModel();
                
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
                    const cfg = skillInfo.cfg;
                    new TextForFlow(skillsRow, {
                        text:cfg.name + '\u00A0(' + skillInfo.value + ')',
                        tooltip:cfg.description
                    });
                    isNotFirst = true;
                }
            }
            
            self.callSuper(agentModel);
        }
    });
})(tc);
