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
            cfg:{MAX_SKILL_VALUE},
            ICON_SEPARATOR,
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
                vitals = self._vitalsView = new WideView(self, {
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
            const factionView = self._factionView = new CompactField(row, {label:'Faction', tooltip:'Open the faction brief', cursor:'pointer', layoutHint:1});
            self.attachToDom(factionView, '_doFactionClick', 'click');
            self._ageView = new CompactField(row, {label:'Age', tooltip:'Years lived', layoutHint:1});
            self._effectiveAgeView = new CompactField(row, {label:'Biological Age', tooltip:'The body’s age, which treatments can wind back. From 35 it lowers the maximum health, to nothing at 85.', layoutHint:1});
            row.getFirstLayout().update();
            
            row = new CompactFieldRow(vitalsContainer);
            const whereView = self._whereView = new CompactField(row, {label:'Where', tooltip:'Open the area brief', cursor:'pointer', layoutHint:1});
            self.attachToDom(whereView, '_doWhereClick', 'click');
            
            self._whenView = new CompactField(row, {label:'When', layoutHint:1});
            const eventView = self._eventView = new CompactField(row, {label:'Event', tooltip:'Open the event brief', cursor:'pointer', layoutHint:1});
            self.attachToDom(eventView, '_doEventClick', 'click');
            row.getFirstLayout().update();
            
            const skillsContainer = self._skills = new WideView(vitalsContainer);
            new SpacedLayout(skillsContainer, {axis:'y', inset:20, spacing:18, outset:12, collapseParent:true});
            
            new SpacedLayout(vitalsContainer, {axis:'y', inset:spacing, outset:spacing, collapseParent:true});
            
            // Credits decide which skills can be bought.
            self.attachTo(pkg.model, '_handleCreditsChanged', 'credits');
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        getVitalsView: function() {return this._vitalsView;},
        
        /** @overrides BriefSupport */
        getBriefTitle: briefModel => pkg.makeBriefTitle('Agent Dossier', briefModel.getName()),
        
        /** @overrides BriefSupport */
        getBriefReportUrl: briefModel => pkg.cfg.DATA_BASE_DIR + 'dossiers/' + briefModel.id + '.txt',
        
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
                self._factionView.setValue(agentModel.getFactionModel()?.getLabel() ?? '');
                self._whereView.setValue(eventModel.getLocationModel()?.name);
                self._whenView.setValue(format(eventModel.getStart()));
                self._eventView.setValue(eventModel.name);
                self.updateStats(agentModel);
                
                let statusAttrs = {text:''},
                    bgColor = colorDark,
                    panelBgColor = colorMegaDark;
                if (agentModel.isDead()) {
                    bgColor = '#444';
                    panelBgColor = '#222';
                    photo.addDomClass('agent-dead');
                    statusAttrs = {x:12, y:-135, fontSize:'400px', textColor:'#fff3', text:pkg.ICON_DEATH};
                } else {
                    photo.removeDomClass('agent-dead');
                }
                if (agentModel.isDevoured()) {
                    bgColor = '#608';
                    panelBgColor = '#406';
                    photo.addDomClass('agent-devoured');
                    statusAttrs = {x:-8, y:-138, fontSize:'400px', textColor:'#fff3', text:pkg.ICON_THE_VOID};
                } else {
                    photo.removeDomClass('agent-devoured');
                }
                statusTxt.callSetters(statusAttrs);
                self.getContentView().setBgColor(bgColor);
                self.getVitalsView().setBgColor(panelBgColor);
                self.getProfile().setBgColor(panelBgColor);
                
                const skillsRow = self._skills;
                skillsRow.destroyAllSubviews();
                new TallView(skillsRow, {
                    align:'center', y:16, width:1, bgColor:colorMedium, 
                    percentOfParentHeightOffset:-24, ignoreLayout:true
                });
                // Only the Corps' own agents can be trained, so only they get the buttons.
                const showIncreaseBtn = agentModel.isPlayerControlled(),
                    skillBars = self._skillBars = [];
                for (const skillInfo of agentModel.getSkillInfo()) {
                    const skillId = skillInfo.id;
                    skillBars.push(new SkillBar(skillsRow, {
                        x:spacing, minValue:-MAX_SKILL_VALUE, value:skillInfo.value, maxValue:MAX_SKILL_VALUE,
                        percentOfParentWidth:100, percentOfParentWidthOffset:-2*spacing,
                        skillId, showIncreaseBtn
                    }, [SizeToParent, {
                        doIncrease: () => {agentModel.purchaseSkill(skillId);}
                    }]));
                }
                self.updateSkills(agentModel);
            }
            
            self.callSuper(agentModel);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /** @private */
        _doWhereClick: function(_event) {
            const eventModel = this.getBriefModel()?.getEventModel(),
                locationModel = eventModel?.getLocationModel();
            if (locationModel) pkg.app.openAreaBrief(locationModel);
        },
        
        /** @private */
        _doEventClick: function(_event) {
            const eventModel = this.getBriefModel()?.getEventModel();
            if (eventModel) pkg.app.openEventBrief(eventModel, true);
        },
        
        /** @private */
        _doFactionClick: function(_event) {
            pkg.app.openFactionBrief(this.getBriefModel()?.getFactionModel());
        },
        
        /*  Updates each skill's bar, label and purchase button. */
        updateSkills: function(agentModel) {
            for (const skillBar of this._skillBars ?? []) {
                const skillId = skillBar.skillId,
                    cfg = pkg.getSkillConfig(skillId),
                    value = agentModel.getSkill(skillId),
                    label = cfg.name + ' : ' + value,
                    {points, credits} = pkg.getSkillPurchase(agentModel, skillId),
                    problem = agentModel.getSkillPurchaseProblem(skillId),
                    trainLabel = 'Train ' + cfg.name + ' +' + points;
                skillBar.setValue(value);
                skillBar.setLabelText(label);
                skillBar.setTooltip(label + ' - ' + cfg.description);
                skillBar.updateIncreaseBtn(
                    trainLabel,
                    problem != null,
                    trainLabel + ' for ' + credits + (credits === 1 ? ' credit' : ' credits') + (problem ? ICON_SEPARATOR + problem : '')
                );
            }
        },
        
        _handleCreditsChanged: function(_event) {
            const agentModel = this.getBriefModel();
            if (this.visible && agentModel) this.updateSkills(agentModel);
        },
        
        updateStats: function(agentModel) {
            this._chronalView.updateForStat(agentModel[STAT_ID_CHRONAL]);
            this._paradoxView.updateForStat(agentModel[STAT_ID_PARADOX]);
            this._healthView.updateForStat(agentModel[STAT_ID_HEALTH]);
            
            // In whole years.
            this._ageView.setValue(agentModel.getAge().toFixed(2));
            this._effectiveAgeView.setValue(agentModel.getEffectiveAge().toFixed(2));
        },
        
        /** @overrides BriefSupport */
        notifyBriefModelChanged: function(agentModel) {
            this.callSuper(agentModel);
            if (this.visible && this.getBriefModel() === agentModel) {
                this.updateStats(agentModel);
                this.updateSkills(agentModel);
            }
        }
    });
})(tc);
