(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        {
            View, Text, PaddedText, PaddedPlainText, PlainText, SimpleButton, SizeToParent, 
            Layout, SpacedLayout, WrappingLayout, ResizeLayout, debounce
        } = myt,
        
        {
            Btn, UnderlineBtn, UnderlineActionBtn, SquareBtn, WideView, MiniPanel,
            GrandWidthMixin, Row, DividerRow, DetailRow, DetailRowFlow, TextForFlow, NoValueText,
            theme:{
                spacing, padding, rowHeight, btnHeight,
                colorUltraLight, colorLight, colorMedium, colorDark, colorMegaDark, colorSuccess, colorError,
                fontSizeMedium, fontSizeLarge
            },
            ICON_NEXT
        } = pkg,
        
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
                            this.setText('✓');
                            this.setBgColor(colorSuccess);
                            this.setPaddingLeft(5);
                            this.setPaddingTop(3);
                            this.setTooltip('Objective met.');
                        } else {
                            this.setText('✗');
                            this.setBgColor(colorError);
                            this.setPaddingLeft(7);
                            this.setPaddingTop(2);
                            this.setTooltip('Objective not met.');
                        }
                    }
                }]);
                self.nameView = new DetailRow(self, {label:'Name', labelWidth});
                self.descriptionView = new DetailRow(self, {label:'Description', labelWidth});
                
                new SpacedLayout(self, {axis:'y', inset:spacing, spacing:-5, outset:spacing, collapseParent:true});
                
                self.update();
            },
            update: function() {
                const self = this,
                    objectiveModel = self.objectiveModel;
                self.nameView.setValue(objectiveModel.getName());
                self.descriptionView.setValue(objectiveModel.getDescription());
                self.successView.setSuccess(objectiveModel.isSuccess());
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
            }, [{
                doActivated: function() {
                    const operationModel = self.operationModel;
                    if (operationModel.canProceed()) pkg.model.setCurrentOperation(operationModel.getNextOperation());
                }
            }]);
            
            self.noSelectionTxt = new PaddedPlainText(self, {
                padding, whiteSpace:'normal', text:"Select an Operation to see more about it here."
            });
            
            const detailsContainer = self.detailsContainer = new WideView(self, {
                x:padding, percentOfParentWidthOffset:-2*padding, visible:false
            });
            
            self.descriptionRow = new DetailRow(detailsContainer, {label:'Description'});
            
            const objectivesRow = self.objectivesRow = new MiniPanel(detailsContainer, {
                title:'Objectives', percentOfParentWidth:100
            }, [GrandWidthMixin, SizeToParent, {
                clearContent: function() {
                    this.getContentView().destroyAllSubviews();
                }
            }]);
            self.progressView = new pkg.LabeledValue(objectivesRow.getHeaderView(), {label:'Progress', fontSize:fontSizeMedium});
            new SpacedLayout(objectivesRow, {axis:'y', spacing:1, outset:1, collapseParent:true});
            
            new SpacedLayout(detailsContainer, {axis:'y', inset:spacing, spacing:spacing, collapseParent:true});
            
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
                    historicityAdjustments = operationModel.getHistoricityAdjustments(),
                    initialEventId = operationModel.getInitialEventSelection(),
                    initialAgentId = operationModel.getInitialAgentSelection();
                if (historicityAdjustments) pkg.model.adjustHistoricity(historicityAdjustments);
                if (initialEventId) app.selectEventBox(initialEventId);
                if (initialAgentId) app.selectAgentRow(initialAgentId);
            }
        },
        
        notifyOperationModelChanged: function(operationModel) {
            if (operationModel && this.operationModel === operationModel) this.updateForOperationModel();
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
                
                self.descriptionRow.setValue(operationModel.getDescription());
                
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
            const operationName = (this.operationModel?.name ?? 'none'),
                prefix = 'Mission : ',
                title = prefix + '<span style="color:' + colorUltraLight + ';">' + operationName + '</span>';
            this.setTitle(title, prefix + operationName);
        }
    });
})(tc);
