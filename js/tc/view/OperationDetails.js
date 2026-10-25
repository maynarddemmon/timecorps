(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {PaddedText, PaddedPlainText, SizeToParent, Layout, SpacedLayout} = myt,
        
        {
            UnderlineBtn, EventNavBtn, WideView, MiniPanel, GrandWidthMixin, DetailRow, 
            DetailRowFlow, TextForFlow,
            theme:{
                spacing, padding,
                colorUltraLight, colorMegaDark, colorSuccess, colorError,
                fontSizeMedium, fontSizeLarge
            },
            ICON_MISSION, ICON_NEXT, ICON_CHECKED, ICON_UNCHECKED, ICON_SEPARATOR, ICON_NAV_FORWARD,
            getStatName
        } = pkg,
        
        /*  The button text for one part of an Event that an Objective depends on, e.g.
            "Collision: Struck ❯". */
        getPrecursorText = ({eventModel, valueModel, statId}) => {
            const partName = valueModel ? valueModel.getName() : statId ? getStatName(statId) : null;
            return eventModel.name + (partName ? ': ' + partName : '') + ' ' + ICON_NAV_FORWARD;
        },
        
        ObjectiveRow = new JSClass('ObjectiveRow', WideView, {
            initNode: function(parent, attrs) {
                const self = this;
                
                self.quickSet(['objectiveModel'], attrs);
                
                attrs.bgColor ??= colorMegaDark;
                
                self.callSuper(parent, attrs);
                
                const labelWidth = 105,
                    iconSize = 24,
                    iconInset = 12;
                self.successView = new PaddedText(self, {
                    x:iconInset, y:iconInset, width:iconSize, height:iconSize,
                    roundedCorners:iconSize/2, outline:[1, 'solid', '#000'],
                    fontSize:fontSizeLarge, textColor:colorUltraLight,
                    ignoreLayout:true
                }, [{
                    setSuccess: function(success) {
                        if (success) {
                            this.setText(ICON_CHECKED);
                            this.setBgColor(colorSuccess);
                            this.setPaddingLeft(5);
                            this.setPaddingTop(3);
                            this.setTooltip('Objective met.');
                        } else {
                            this.setText(ICON_UNCHECKED);
                            this.setBgColor(colorError);
                            this.setPaddingLeft(7);
                            this.setPaddingTop(2);
                            this.setTooltip('Objective not met.');
                        }
                    }
                }]);
                self.nameView = new DetailRow(self, {label:'Name', labelWidth});
                self.descriptionView = new DetailRow(self, {label:'Description', labelWidth});
                self.precursorsView = new DetailRowFlow(self, {label:'Entanglements', labelWidth});
                
                new SpacedLayout(self, {axis:'y', inset:spacing, spacing:-5, outset:spacing, collapseParent:true});
                
                self.update();
            },
            update: function() {
                const self = this,
                    objectiveModel = self.objectiveModel;
                self.nameView.setValue(objectiveModel.getName());
                self.descriptionView.setValue(objectiveModel.getDescription());
                self.successView.setSuccess(objectiveModel.isSuccess());
                self.updatePrecursors();
            },
            
            /*  A nav button for each part of an Event the Objective depends on. Parts the
                player doesn't know about yet, a hidden Event or Causator, are summed up as
                "Unknown" so the row doesn't give them away. */
            updatePrecursors: function() {
                const precursorsView = this.precursorsView,
                    precursors = this.objectiveModel.getPrecursors();
                precursorsView.clearContent();
                
                let addedCount = 0,
                    hasUnknown = false;
                for (const precursor of precursors) {
                    if (!precursor.known) {
                        hasUnknown = true;
                    } else {
                        if (addedCount > 0) new TextForFlow(precursorsView, {text:ICON_SEPARATOR});
                        new EventNavBtn(precursorsView, {
                            navEventModel:precursor.eventModel, text:getPrecursorText(precursor)
                        });
                        addedCount++;
                    }
                }
                if (hasUnknown) {
                    if (addedCount > 0) new TextForFlow(precursorsView, {text:ICON_SEPARATOR});
                    new TextForFlow(precursorsView, {text:'Unknown', fontStyle:'italic'});
                }
                precursorsView.setVisible(precursors.length > 0);
            }
        });
    
    pkg.OperationDetails = new JSClass('OperationDetails', pkg.Panel, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            
            self.callSuper(parent, attrs);
            
            // Build UI
            const header = self.getHeaderView();
            self.proceedBtn = new UnderlineBtn(header, {
                text:'Next Mission ' + ICON_NEXT, visible:false
            }, [{doActivated: function() {self.operationModel.proceed();}}]);
            
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding, whiteSpace:'normal', text:'Select a mission in the Missions tab to see more about it here.'
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {
                x:padding, percentOfParentWidthOffset:-2*padding, visible:false
            });
            
            const objectivesRow = self.objectivesRow = new MiniPanel(detailsContainer, {
                title:'Objectives', percentOfParentWidth:100
            }, [GrandWidthMixin, SizeToParent, {
                clearContent: function() {
                    this.getContentView().destroyAllSubviews();
                }
            }]);
            self.progressView = new pkg.LabeledValue(objectivesRow.getHeaderView(), {y:2, label:'Progress', fontSize:fontSizeMedium});
            new SpacedLayout(objectivesRow, {axis:'y', spacing:1, outset:1, collapseParent:true});
            
            new SpacedLayout(detailsContainer, {axis:'y', spacing:spacing, collapseParent:true});
            
            // The title opens the Mission Brief, which has the mission's full description.
            const titleView = self.getTitleView();
            titleView.setCursor('pointer');
            self.attachToDom(titleView, '_doTitleClick', 'click');
            
            self.ready = true;
            
            // Apply Size
            self.setWidth(self.width);
            self.setHeight(self.height);
            
            self.updateTitle();
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setWidth: function(v) {
            this.callSuper(v);
            if (this.ready) this.noSelectionTxt.setWidth(this.width);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        notifyOperationSelectedChanged: function(operationModel) {
            this.operationModel = operationModel;
            this.updateForOperationModel();
            
            if (operationModel) {
                const app = pkg.app,
                    initialEventId = operationModel.getInitialEventSelection(),
                    initialAgentId = operationModel.getInitialAgentSelection();
                if (initialEventId) app.selectEventBox(initialEventId);
                if (initialAgentId) app.selectAgentRow(initialAgentId);
            }
        },
        
        notifyOperationModelChanged: function(operationModel) {
            if (operationModel && this.operationModel === operationModel) this.updateForOperationModel();
        },
        
        /*  An Objective's precursors show only what the player knows about, so they're 
            redone when one of their Events changes, e.g. is revealed. */
        notifyEventModelChanged: function(eventModel) {
            if (eventModel && this.operationModel?.dependsOnEvent(eventModel)) this.updateForOperationModel();
        },
        
        updateForOperationModel: function() {
            const self = this,
                {operationModel, detailsContainer} = self,
                hasModel = operationModel != null;
            
            self.noSelectionTxt.setVisible(!hasModel);
            detailsContainer.setVisible(hasModel);
            
            if (hasModel) {
                Layout.incrementGlobalLock();
                
                const {success, total, completed} = operationModel.getProgress(),
                    progressView = self.progressView;
                progressView.setValue(success + '/' + total);
                progressView.setValueTextColor(completed ? colorSuccess : colorError);
                self.proceedBtn.setVisible(operationModel.canProceed());
                
                // Agent Information //
                const objectivesRow = self.objectivesRow;
                objectivesRow.clearContent();
                for (const objectiveModel of Object.values(operationModel.getObjectiveModels())) {
                    new ObjectiveRow(objectivesRow, {objectiveModel});
                }
                
                Layout.decrementGlobalLock();
            }
            
            self.updateTitle();
        },
        
        updateTitle: function() {
            const opName = this.operationModel?.name ?? 'none';
            this.setTitle(
                ICON_MISSION + ' ' + pkg.wrapInStyledSpan(opName, colorUltraLight),
                'Open the mission brief for: ' + opName
            );
        },
        
        /** @private */
        _doTitleClick: function(_event) {
            if (this.operationModel) pkg.app.openMissionBrief(this.operationModel);
        }
    });
})(tc);
