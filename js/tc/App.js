(pkg => {
    'use strict';
    
    let appView,
        model,
        persistence,
        hiddenSaveFileImporter,
        
        saveBtn,
        
        timelineView,
        eventDetailsView,
        
        dividerV,
        dividerH,
        
        opsView,
        teamView,
        
        agentDossier,
        areaBrief,
        settingsDialog;
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, PlainText, ResizeLayout, SizeToParent, global:G, NOOP} = M,
        
        {
            SquareBtn, WideView,
            dialogUtil:{openConfirmMsgDialog, openAckMsgDialog},
            theme:{
                layoutSpacing, spacing, padding, 
                colorUltraDark, colorMedium, colorLight,
                fontSizeMedium, fontSizeLarge, fontSizeVeryLarge
            },
            SCOPE_AGENTS, SCOPE_LOCATIONS, SCOPE_EVENTS, SCOPE_OPERATIONS,
            ICON_SEPARATOR
        } = pkg,
        
        I18N_CLOSE_BTN = pkg.ICON_CANCEL + ' Close',
        
        // Help //
        HELP_SEEN_KEY = 'tc.helpSeen',
        hasSeenHelp = () => {
            try {
                return localStorage.getItem(HELP_SEEN_KEY) === 'true';
            } catch {
                return false;
            }
        },
        markHelpSeen = () => {
            try {
                localStorage.setItem(HELP_SEEN_KEY, 'true');
            } catch {
                // Ignore.
            }
        },
        
        // Save //
        updateLastSaved = () => {
            const lastSavedDate = persistence.getLastSavedDate();
            if (lastSavedDate) {
                saveBtn?.setTextColor(colorLight);
                saveBtn?.setTooltip('Last saved ' + lastSavedDate.toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}));
            } else {
                saveBtn?.setTextColor();
                saveBtn?.setTooltip('Not saved');
            }
        },
        
        // Data Loading //
        loadDataIntoModel = (url, resultCallback) => {
            M.doFetch(url, {}, true,
                response => {
                    model.processData(JSON.parse(response));
                    resultCallback?.(true);
                },
                err => {
                    console.error('err', err);
                    resultCallback?.(false);
                }
            );
        },
        
        getScenarioIDsToLoad = () => ['titanic_scenario','lusitania_scenario'],
        
        loadAllData = () => {
            const filesToLoad = ['init', ...getScenarioIDsToLoad(), 'agents','operations'];
            let idx = 0;
            const chainFunc = success => {
                if (success) {
                    const namePart = filesToLoad[idx++];
                    if (namePart) {
                        loadDataIntoModel('./data/' + namePart + '.json', chainFunc);
                    } else {
                        pkg.resumeConstraintBinding();
                        
                        const eventsValid = model.validateAllEventDependencies() & model.validateNoLocationOverlaps();
                        if (eventsValid) {
                            timelineView.setup(model);
                            teamView.setup(model);
                            model.reset();
                            
                            // The baseline is the fresh campaign a save gets applied on top of.
                            persistence.captureBaseline();
                            const restoreProblem = persistence.restore();
                            updateLastSaved();
                            
                            if (restoreProblem) {
                                openAckMsgDialog('Save Could Not Be Loaded', 'Your saved progress could not be loaded because ' + restoreProblem + ', so it has been cleared.', appView.doReload, null, 'Start Over');
                            } else if (!hasSeenHelp()) {
                                appView.openHelp();
                            }
                        } else {
                            console.log('INVALID EVENT DATA: HALTING STARTUP!!!');
                        }
                    }
                } else {
                    console.error('Data load failed:', filesToLoad[idx - 1]);
                    pkg.resumeConstraintBinding();
                }
            };
            pkg.pauseConstraintBinding();
            chainFunc(true);
        };
    
    pkg.App = new JSClass('App', View, {
        include: [M.RootView, M.SizeToWindow],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            appView = pkg.app = this;
            
            attrs.minWidth = 1200;
            attrs.minHeight = 600;
            
            appView.callSuper(parent, attrs);
            
            appView.scrollToDebounced = M.debounce(appView.scrollToEvent, 1000);
            appView.attachToDom(G.mouse, 'noop', 'contextmenu', true);
            
            globalThis.hideSpinner();
            
            // Build Model
            model = pkg.model = new pkg.Model(appView);
            persistence = pkg.persistence = new pkg.PersistenceManager(model);
            
            // Build UI
            appView.buildTopView(new WideView(appView, {bgColor:colorMedium, height:40}));
            appView.buildMiddleView(new WideView(appView, {layoutHint:1}));
            appView.buildFooterView(new WideView(appView, {bgColor:colorMedium, height:40}));
            
            new ResizeLayout(appView, {axis:'y', spacing:layoutSpacing});
            
            dividerV.setValue(187);
            dividerH.setValue(900);
            
            loadAllData();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        noop: NOOP,
        
        buildTopView: topView => {
            topView.setTextColor(colorUltraDark);
            
            new PlainText(topView, {valign:'middle', text:'T I M E ◦ C O R P S', fontSize:fontSizeVeryLarge});
            new pkg.Spacer(topView);
            
            saveBtn = new SquareBtn(topView, {buttonType:'underline', valign:'middle', text:pkg.ICON_SAVE, fontSize:fontSizeVeryLarge}, [{
                doActivated: () => {
                    openConfirmMsgDialog(
                        'Save Campaign',
                        'Save your progress? This will overwrite any existing save data.',
                        () => {
                            let title,
                                msg;
                            if (persistence.save()) {
                                updateLastSaved();
                                title = 'Save Succeeded';
                                msg = 'Your progress has been saved.';
                            } else {
                                title = 'Save Failed';
                                msg = 'Your progress could not be saved. The browser may be blocking storage for this site.';
                            }
                            
                            // Use a timeout so the confirm dialog can close, focus restores, then
                            // open the ack dialog which then pulls focus again.
                            setTimeout(() => openAckMsgDialog(title, msg), 0);
                        }
                    );
                }
            }]);
            new SquareBtn(topView, {buttonType:'underline', valign:'middle', text:pkg.ICON_RESTART, fontSize:fontSizeMedium, tooltip:'Restart Campaign'}, [{
                doActivated: () => {
                    openConfirmMsgDialog(
                        'Restart Campaign',
                        'Are you sure you want to start over with a new campaign? Any currently saved progress will be discarded.',
                        appView.doRestartCampaign
                    );
                }
            }]);
            
            new PlainText(topView, {valign:'middle', text:ICON_SEPARATOR});
            
            new SquareBtn(topView, {buttonType:'underline', valign:'middle', text:pkg.ICON_IMPORT, fontSize:fontSizeLarge, tooltip:'Import a “save” file.'}, [{
                doActivated: () => {
                    openConfirmMsgDialog(
                        'Import Save File',
                        'Are you sure you want to import a “save” file and continue from there? Any currently saved progress will be overwritten.',
                        appView.doImport
                    );
                }
            }]);
            new SquareBtn(topView, {buttonType:'underline', valign:'middle', text:pkg.ICON_EXPORT, fontSize:fontSizeLarge, tooltip:'Export a “save” file of your current progress.'}, [{
                doActivated: persistence.export.bind(persistence)
            }]);
            
            new PlainText(topView, {valign:'middle', text:ICON_SEPARATOR});
            
            new SquareBtn(topView, {buttonType:'underline', valign:'middle', text:pkg.ICON_SETTINGS, fontSize:fontSizeVeryLarge, tooltip:'Settings'}, [{
                doActivated: appView.openSettings
            }]);
            
            new SquareBtn(topView, {buttonType:'underline', valign:'middle', text:pkg.ICON_HELP, fontSize:fontSizeMedium, tooltip:'Help'}, [{
                doActivated: appView.openHelp
            }]);
            
            new ResizeLayout(topView, {inset:padding, spacing:spacing, outset:padding});
        },
        
        buildMiddleView: middleView => {
            teamView = new pkg.Agents(middleView, {title:'Agents'});
            opsView = new pkg.OperationDetails(middleView);
            timelineView = new pkg.TimelineCompact(middleView, {title:'Timeline'});
            eventDetailsView = new pkg.EventDetails(middleView);
            
            appView.attachTo(teamView,'_onAgentSelectionChanged', 'selectionChanged');
            appView.attachTo(timelineView,'_onEventSelectionChanged', 'selectionChanged');
            
            dividerV = new M.VerticalDivider(middleView, {
                height:5, percentOfParentWidth:100, minValue:133, limitToParent:200,
                activeColor:'transparent', hoverColor:'transparent', readyColor:'transparent'
            }, [SizeToParent, {
                setValue: function(v) {
                    this.callSuper(v);
                    this.updateLayout();
                },
                updateLayout: function() {
                    const v = this.value,
                        upperHeight = v + 2;
                    opsView.setHeight(upperHeight);
                    teamView.setHeight(upperHeight);
                    
                    eventDetailsView.setY(upperHeight + layoutSpacing);
                    eventDetailsView.setHeight(middleView.height - eventDetailsView.y);
                    
                    timelineView.setY(upperHeight + layoutSpacing);
                    timelineView.setHeight(middleView.height - timelineView.y);
                }
            }]);
            
            dividerH = new M.HorizontalDivider(middleView, {
                width:5, percentOfParentHeight:100, minValue:600, limitToParent:300,
                activeColor:'transparent', hoverColor:'transparent', readyColor:'transparent'
            }, [SizeToParent, {
                setValue: function(v) {
                    this.callSuper(v);
                    if (this.inited) this.updateLayout();
                },
                updateLayout: function() {
                    const v = this.value,
                        leftWidth = v + 2;
                    for (const sv of [teamView, timelineView]) sv.setWidth(leftWidth);
                    for (const sv of [opsView, eventDetailsView]) {
                        sv.setX(leftWidth + layoutSpacing);
                        sv.setWidth(middleView.width - sv.x);
                    }
                }
            }]);
            
            dividerV.syncTo(middleView, 'updateLayout', 'height');
            dividerH.syncTo(middleView, 'updateLayout', 'width');
        },
        
        buildFooterView: NOOP, // footerView => {},
        
        getTimelineView: () => timelineView,
        getTeamView: () => teamView,
        getEventDetailsView: () => eventDetailsView,
        getOpsView: () => opsView,
        
        // Convienence Functions
        /*  The selected Event and Agent by id, or null, for saving. */
        getSelectionForSave: () => ({
            event:timelineView.getSelectedEventId(),
            agent:teamView.getSelectedAgentId()
        }),
        restoreSelectionForLoad: selection => {
            if ('event' in selection) {
                if (selection.event) {
                    timelineView.doSelectEvent(selection.event);
                } else {
                    timelineView.deselectAll();
                }
            }
            if ('agent' in selection) teamView.selectAgent(selection.agent);
        },
        
        selectAgentRow: agentModelOrId => {
            teamView.selectAgent(typeof agentModelOrId === 'string' ? agentModelOrId : agentModelOrId.id);
        },
        selectEventBox: eventModelOrId => {
            timelineView.doSelectEvent(eventModelOrId);
        },
        
        scrollToEvent: function(eventModel, clearDebounce) {
            if (eventModel) timelineView.scrollToEventBox(eventModel);
            if (clearDebounce) this.scrollToDebounced();
        },
        // scrollToDebounced: setup in initNode
        
        // Event Dispatching
        _onEventSelectionChanged: event => { // value is an EventBox
            eventDetailsView.notifyEventSelectedChanged(event.value);
        },
        
        _onAgentSelectionChanged: event => { // value is an AgentModel
            eventDetailsView.notifyAgentSelectedChanged(event.value);
        },
        
        notifyModelUpdated: (instanceModel, scopeId) => {
            switch (scopeId) {
                case SCOPE_AGENTS:
                    agentDossier?.notifyAgentModelChanged(instanceModel);
                    eventDetailsView.notifyEventModelChanged(instanceModel.getEventModel());
                    if (eventDetailsView.selectedAgentModel === instanceModel) {
                        eventDetailsView.updateForSelectedAgent();
                    }
                    break;
                case SCOPE_EVENTS:
                    eventDetailsView.notifyEventModelChanged(instanceModel);
                    break;
                case SCOPE_OPERATIONS:
                    opsView.notifyOperationModelChanged(instanceModel);
                    break;
                case SCOPE_LOCATIONS:
                    areaBrief?.notifyLocationModelChanged(instanceModel);
                    break;
            }
        },
        
        doReload: () => {
            location.reload(); // reload the browser.
        },
        
        /*  Clears the save first since a reload would otherwise restore it. */
        doRestartCampaign: () => {
            persistence.clear();
            appView.doReload();
        },
        
        doImport: () => {
            if (!hiddenSaveFileImporter) {
                hiddenSaveFileImporter = new M.HiddenJSONImporter(appView, null, [{
                    processJSON: json => {
                        const problem = persistence.importRecord(json);
                        if (problem) {
                            openAckMsgDialog('Import Failed', 'That file could not be imported because ' + problem + '. Your current progress is unchanged.');
                        } else {
                            updateLastSaved();
                            openAckMsgDialog('Import Succeeded', 'Your data has been imported.', appView.doReload, null, 'Continue');
                        }
                    },
                    handleJSONParsingError: function(err) {
                        this.callSuper(err);
                        openAckMsgDialog('Import Failed', 'That file is not a Time Corps save file. Your current progress is unchanged.');
                    }
                }]);
            }
            hiddenSaveFileImporter.promptForFile();
        },
        
        notifyTimelineParadoxExceeded: () => {
            openAckMsgDialog(
                'Timeline Destabilized',
                'Paradox in this timeline has exceeded the “Otomo” threshold and the causal thread has unravelled. You, the Time Corps and all its endeavors have come undone. You must begin again in a new timeline.',
                () => {
                    // FIXME: do other housekeeping?
                    appView.doRestartCampaign();
                }
            );
        },
        
        notifyOperationCompleted: operationModel => {
            let saveNote = '';
            if (pkg.settings.get(pkg.SETTING_SAVE_ON_OPERATION_COMPLETION) && persistence.hasBaseline()) {
                if (persistence.save()) {
                    updateLastSaved();
                    saveNote = '<br><br><i>Your progress has been saved.</i>';
                } else {
                    saveNote = '<br><br><i>Your progress could not be saved automatically.</i>';
                }
            }
            
            const title = 'Mission Complete',
                debrief = (operationModel.getDebrief() || 'All mission objectives have been achieved.') + saveNote;
            if (operationModel.getNextOperation()) {
                openConfirmMsgDialog(
                    title, debrief,
                    () => {operationModel.proceed();},
                    null,
                    'Next Mission ' + pkg.ICON_NEXT, I18N_CLOSE_BTN
                );
            } else {
                // No next operation case.
                openAckMsgDialog(title, debrief, null, null, I18N_CLOSE_BTN);
            }
        },
        
        openSettings: () => {
            settingsDialog ??= new pkg.SettingsDialog(appView);
            settingsDialog.show();
            return settingsDialog;
        },
        
        openHelp: () => {
            pkg.loadTxt('./data/' + 'help.txt', (success, txt) => {
                if (success) {
                    markHelpSeen();
                    openAckMsgDialog('Time Corps Field Manual', txt, null, null, I18N_CLOSE_BTN);
                }
            });
        },
        
        openAgentDossier: agentModel => {
            agentDossier ??= new pkg.AgentDossier(appView);
            agentDossier.show(agentModel);
            return agentDossier;
        },
        
        openAreaBrief: locationModel => {
            areaBrief ??= new pkg.AreaBrief(appView);
            areaBrief.show(locationModel);
            return areaBrief;
        }
    });
})(tc);
