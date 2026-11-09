(pkg => {
    'use strict';
    
    let readyToHandleEvents = false, // Prevents the notifyX methods from firing too early during startup.
        ready = false,
        
        appView,
        model,
        persistenceMgr, // The PersistenceManager.
        hiddenSaveFileImporter, // A myt.HiddenJSONImporter used for importing save files.
        
        timelineParadoxBar,
        saveBtn,
        legacyBtn, // Shown once the data turns the legacy on.
        
        timelineView,
        eventDetailsView,
        
        dividerV,
        dividerH,
        
        timelineTabBtn,
        eventsTabBtn,
        missionsTabBtn,
        agentsTabBtn,
        
        opsView,
        teamView,
        eventsView,
        missionsView,
        
        agentDossier,
        areaBrief,
        eventBrief,
        eventBriefShowCount = 0, // How many times an Event Brief has been shown.
        factionBrief,
        missionBrief,
        settingsDialog;
    
    pkg.isAppReady = () => ready;
    
    pkg.getPersistenceManager = () => persistenceMgr;
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, PlainText, ResizeLayout, SizeToParent, global:G, NOOP, I18N:{get:i18n}} = M,
        
        {
            TabBtn, SquareBtn, WideView, wrapInStyledSpan,
            dialogUtil:{openConfirmMsgDialog, openTypedConfirmMsgDialog, openAckMsgDialog, openWhenClear},
            legacy,
            theme:{
                layoutSpacing, spacing, padding, rowHeight,
                colorUltraLight, colorLight, colorMedium, colorDarkMedium, colorUltraDark,
                fontSizeMedium, fontSizeLarge, fontSizeVeryLarge
            },
            cfg:{DATA_BASE_DIR, TOP_VIEW_HEIGHT},
            SCOPE_AGENTS, SCOPE_LOCATIONS, SCOPE_FACTIONS, SCOPE_EVENTS, SCOPE_OPERATIONS,
            ICON_SEPARATOR, STAT_ID_PARADOX
        } = pkg,
        
        I18N_CLOSE_BTN = pkg.ICON_CANCEL + ' ' + i18n('btn-close'),
        
        // The project's home, linked from the header's GitHub mark. The mark is part of the
        // app, not the game's data, so it isn't under IMAGE_BASE_DIR.
        GITHUB_URL = 'https://github.com/maynarddemmon/timecorps',
        GITHUB_MARK_URL = './img/github-mark.svg',
        
        // The value of eventBriefShowCount when each Event's brief was last shown, by Event ID.
        eventBriefShownAt = new Map(),
        
        checkForActiveRoster = () => {
            const activeAgents = pkg.model.getActiveAgentsAsList();
            if (!activeAgents || activeAgents.length === 0) {
                openEndGameDialog(
                    i18n('dlg-roster-depleted-title'),
                    i18n('dlg-roster-depleted-msg')
                );
            }
        },
        
        openEndGameDialog = (title, msg) => {
            openAckMsgDialog(
                title,
                msg,
                () => {
                    // FIXME: do other housekeeping?
                    appView.doRestartCampaign();
                }
            );
        },
        
        openAgentDossier = agentModel => {
            if (readyToHandleEvents) {
                return openWhenClear(() => {
                    agentDossier ??= new pkg.AgentDossier(appView);
                    agentDossier.show(agentModel);
                    return agentDossier;
                });
            }
        },
        
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
        
        // Legacy //
        /*  Shows what past games' losses have accrued, and offers to clear it. */
        openLegacyDialog = () => {
            const {devoured, died, restarted, hauntedCount, glitchedCount, pocketCount, agentModel, bonuses, credits} = legacy.getSummary(),
                title = i18n('dlg-legacy-title');
            if (devoured + died + restarted === 0) {
                openAckMsgDialog(title, i18n('dlg-legacy-none-msg', agentModel?.getName() ?? ''));
            } else {
                const bonusesTxt = bonuses.map(([skillId, amount]) => i18n('skill-gain', pkg.cleanToFixed(amount), pkg.getSkillConfig(skillId)?.name ?? skillId)).join(', '),
                    // It can't be undone, so the player types this to clear it.
                    resetWord = i18n('legacy-reset-word');
                openTypedConfirmMsgDialog(
                    title,
                    i18n('dlg-legacy-msg', 
                        devoured, 
                        died, 
                        restarted, 
                        agentModel?.getName() ?? '', 
                        bonusesTxt || i18n('dlg-legacy-no-bonuses'), 
                        pkg.cleanToFixed(credits), 
                        hauntedCount, 
                        glitchedCount, 
                        pocketCount, 
                        resetWord
                    ),
                    resetWord,
                    () => {
                        legacy.clear();
                        // The selected Event's haunting and glitch go with it.
                        eventDetailsView.notifyEventSelectedChanged(timelineView.getSelectedEventBox());
                    },
                    i18n('btn-legacy-clear')
                );
            }
        },
        
        // Save //
        /*  Saves the game, and with it the legacy's pending losses, so they're stored only 
            once the game they happened in is. Returns whether it saved. */
        saveGame = () => {
            const saved = persistenceMgr.save();
            if (saved) legacy.commit();
            return saved;
        },
        
        updateLastSaved = () => {
            const lastSavedDate = persistenceMgr.getLastSavedDate();
            if (lastSavedDate) {
                saveBtn?.setTextColor(colorLight);
                saveBtn?.setTooltip(i18n('tip-last-saved', lastSavedDate.toLocaleString(M.I18N.getLocale(), {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})));
            } else {
                saveBtn?.setTextColor();
                saveBtn?.setTooltip(i18n('tip-not-saved'));
            }
        },
        
        // Data Loading //
        doImport = () => {
            if (!hiddenSaveFileImporter) {
                hiddenSaveFileImporter = new M.HiddenJSONImporter(appView, null, [{
                    processJSON: json => {
                        const problem = persistenceMgr.importRecord(json);
                        if (problem) {
                            openAckMsgDialog(i18n('dlg-import-failed-title'), i18n('dlg-import-failed-msg', problem));
                        } else {
                            // The legacy goes back to what it was when the save was exported,
                            // so its losses can't be had again by importing it again. A save
                            // exported before the legacy was saved with it leaves it alone.
                            if (json.legacy !== undefined) legacy.importRecord(json.legacy);
                            updateLastSaved();
                            openAckMsgDialog(i18n('dlg-import-succeeded-title'), i18n('dlg-import-succeeded-msg'), appView.doReload, null, i18n('btn-continue'));
                        }
                    },
                    handleJSONParsingError: function(err) {
                        this.callSuper(err);
                        openAckMsgDialog(i18n('dlg-import-failed-title'), i18n('dlg-import-not-save-msg'));
                    }
                }]);
            }
            hiddenSaveFileImporter.promptForFile();
        },
        
        loadDataIntoModel = (url, resultCallback) => {
            M.doFetch(url, {}, true,
                response => {
                    // JSON5 so the data files can have comments and trailing commas.
                    model.processData(JSON5.parse(response));
                    resultCallback?.(true);
                },
                err => {
                    console.error('err', err);
                    resultCallback?.(false);
                }
            );
        },
        
        loadAllData = () => {
            // The scenarios to load are listed in init, so they're queued once it's loaded.
            const filesToLoad = ['init'];
            let idx = 0;
            const chainFunc = success => {
                if (success) {
                    if (idx === 1) filesToLoad.push(...model.getScenarioIds(), 'agents');
                    const namePart = filesToLoad[idx++];
                    if (namePart) {
                        loadDataIntoModel(DATA_BASE_DIR + namePart + '.json5', chainFunc);
                    } else {
                        pkg.resumeConstraintBinding();
                        
                        // The precursors and descendants won't be setup unless constraints have
                        // run at least once.
                        model.processHiddenAttrSetup();
                        
                        const eventsValid = model.validateAllEventDependencies() & model.validateNoLocationOverlaps();
                        model.validateFactionHQs();
                        model.validateActionGroups();
                        model.validateSkillTracks();
                        if (eventsValid) {
                            timelineView.setup(model);
                            timelineParadoxBar.watchStatModel(model[STAT_ID_PARADOX]);
                            teamView.setup(model);
                            eventsView.setup(model);
                            missionsView.setup(model);
                            eventDetailsView.setup(model);
                            model.reset();
                            
                            // The baseline is the fresh campaign a save gets applied on top of.
                            persistenceMgr.captureBaseline();
                            const startCampaign = () => {
                                legacyBtn.setVisible(legacy.isEnabled());
                                if (persistenceMgr.hasSave()) {
                                    const restoreProblem = persistenceMgr.restore();
                                    readyToHandleEvents = true;
                                    if (restoreProblem) openAckMsgDialog(i18n('dlg-restore-failed-title'), i18n('dlg-restore-failed-msg', restoreProblem), appView.doReload, null, i18n('btn-start-over'));
                                } else {
                                    readyToHandleEvents = true;
                                    // After the baseline, so what's picked and given is always saved.
                                    model.pickRandomSkillsByTrack();
                                    legacy.applyToNewGame();
                                    model.getInitialOperation()?.start();
                                }
                                ready = true;
                                model.offerRevealedOperations();
                                model.updateTimelineParadoxMax();
                                updateLastSaved();
                                
                                // Only changes from here on animate, not the restore or setup.
                                timelineView.setAnimateValueChanges(true);
                            };
                            
                            // On a first visit the Field Manual comes first. It loads asynchronously,
                            // so start the campaign once it's open and the Mission Brief queues
                            // behind it.
                            if (hasSeenHelp()) {
                                startCampaign();
                            } else {
                                appView.openHelp(startCampaign);
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
            attrs.minHeight = 750;
            
            appView.callSuper(parent, attrs);
            
            appView.scrollTo = M.debounce(eventModel => {
                if (eventModel) timelineView.scrollToEventBox(eventModel);
            }, 600);
            appView.attachToDom(G.mouse, 'noop', 'contextmenu', true);
            
            globalThis.hideSpinner();
            
            // Build Model
            model = pkg.model = new pkg.Model(appView);
            persistenceMgr = new pkg.PersistenceManager(model);
            
            // Before the data loads, so an Event's start given from "now" is the saved 
            // campaign's, whatever day it is.
            const savedCampaignStart = persistenceMgr.getSavedCampaignStart();
            if (savedCampaignStart !== null) pkg.setCampaignStart(savedCampaignStart);
            
            // Build UI
            appView.buildTopView(new WideView(appView, {bgColor:colorMedium, height:TOP_VIEW_HEIGHT}));
            appView.buildMiddleView(new WideView(appView, {layoutHint:1}));
            
            new ResizeLayout(appView, {axis:'y', spacing:layoutSpacing});
            
            dividerV.setValue(116);
            dividerH.setValue(800);
            
            loadAllData();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        noop: NOOP,
        
        buildTopView: topView => {
            topView.setTextColor(colorUltraDark);
            
            new PlainText(topView, {text:i18n('game-title'), fontSize:fontSizeVeryLarge});
            
            new pkg.Spacer(topView);
            
            (new pkg.LabeledValue(topView, {label:pkg.I18N_SCORE, textColor:colorUltraDark, valueTextColor:colorUltraLight}, [{
                update: function(_event) {this.callSuper(model.score.toLocaleString());}
            }])).attachTo(model, 'update', pkg.STAT_ID_SCORE);
            
            (new pkg.LabeledValue(topView, {label:pkg.I18N_CREDITS, textColor:colorUltraDark, valueTextColor:colorUltraLight, paddingRight:padding}, [{
                update: function(_event) {this.callSuper(model.credits.toLocaleString());}
            }])).attachTo(model, 'update', pkg.STAT_ID_CREDITS);
            
            timelineParadoxBar = new pkg.ParadoxBar(topView, {labelTemplate:i18n('bar-timeline-label')}, [pkg.BigStatBar]);
            
            new pkg.Spacer(topView);
            
            saveBtn = new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_SAVE, fontSize:fontSizeVeryLarge}, [{
                doActivated: () => {
                    openConfirmMsgDialog(
                        i18n('dlg-save-title'),
                        i18n('dlg-save-msg'),
                        () => {
                            let title,
                                msg;
                            if (saveGame()) {
                                updateLastSaved();
                                title = i18n('dlg-save-succeeded-title');
                                msg = i18n('dlg-save-succeeded-msg');
                            } else {
                                title = i18n('dlg-save-failed-title');
                                msg = i18n('dlg-save-failed-msg');
                            }
                            
                            openAckMsgDialog(title, msg);
                        }
                    );
                }
            }]);
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_RESTART, fontSize:fontSizeMedium, tooltip:i18n('dlg-restart-title')}, [{
                doActivated: () => {
                    openConfirmMsgDialog(
                        i18n('dlg-restart-title'),
                        i18n('dlg-restart-msg'),
                        appView.doRestartCampaign
                    );
                }
            }]);
            
            legacyBtn = new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_LEGACY, fontSize:fontSizeLarge, tooltip:i18n('tip-legacy'), visible:false}, [{
                doActivated: openLegacyDialog
            }]);
            
            new PlainText(topView, {text:ICON_SEPARATOR});
            
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_IMPORT, fontSize:fontSizeLarge, tooltip:i18n('tip-import')}, [{
                doActivated: () => {
                    openConfirmMsgDialog(
                        i18n('dlg-import-title'),
                        i18n('dlg-import-msg'),
                        doImport
                    );
                }
            }]);
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_EXPORT, fontSize:fontSizeLarge, tooltip:i18n('tip-export')}, [{
                doActivated: () => {persistenceMgr.export({legacy:legacy.exportRecord()});}
            }]);
            
            new PlainText(topView, {text:ICON_SEPARATOR});
            
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_SETTINGS, fontSize:fontSizeVeryLarge, tooltip:i18n('tip-settings')}, [{
                doActivated: appView.openSettings
            }]);
            
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_HELP, fontSize:fontSizeMedium, tooltip:i18n('tip-help')}, [{
                doActivated: () => {appView.openHelp();}
            }]);
            
            new PlainText(topView, {text:ICON_SEPARATOR});
            
            // GitHub's mark, dark, linking to the project in a new tab.
            const githubBtn = new SquareBtn(topView, {buttonType:'underline', text:'', tooltip:i18n('tip-github')}, [{
                    doActivated: () => {window.open(GITHUB_URL, '_blank', 'noopener');}
                }]),
                githubMarkSize = 20,
                githubMark = new View(githubBtn, {
                    width:githubMarkSize, height:githubMarkSize, align:'center', valign:'middle',
                    imageUrl:GITHUB_MARK_URL, imageSize:'contain'
                }, [M.ImageSupport]);
            githubMark.getIDS().pointerEvents = 'none';
            githubBtn.getIDE().setAttribute('aria-label', i18n('tip-github'));
            
            new ResizeLayout(topView, {inset:padding, spacing:spacing, outset:padding});
            new M.ConstantLayout(topView, {targetAttrName:'valign', targetValue:'middle'});
        },
        
        buildMiddleView: middleView => {
            const tabView = new View(middleView, {
                height:rowHeight, bgColor:colorDarkMedium, maxSelected:1
            }, [M.SelectionManager]);
            
            timelineTabBtn = new TabBtn(tabView, {text:pkg.ICON_CHRONAL + ' ' + i18n('tab-timeline')}, [{
                setSelected: function(v) {
                    this.callSuper(v);
                    timelineView.setVisible(v);
                }
            }]);
            eventsTabBtn = new TabBtn(tabView, {text:pkg.ICON_EVENT + ' ' + i18n('tab-events')}, [{
                setSelected: function(v) {
                    this.callSuper(v);
                    eventsView.setVisible(v);
                }
            }]);
            
            new pkg.Spacer(tabView);
            
            missionsTabBtn = new TabBtn(tabView, {text:pkg.ICON_MISSION + ' ' + i18n('tab-missions')}, [{
                setSelected: function(v) {
                    this.callSuper(v);
                    missionsView.setVisible(v);
                }
            }]);
            agentsTabBtn = new TabBtn(tabView, {text:'♟ ' + i18n('tab-agents')}, [{
                setSelected: function(v) {
                    this.callSuper(v);
                    teamView.setVisible(v);
                }
            }]);
            
            new ResizeLayout(tabView, {inset:spacing, spacing, outset:spacing});
            
            const panelY = tabView.height + layoutSpacing,
                panelAttrs = {y:panelY, visible:false, percentOfParentHeightOffset:-panelY};
            teamView = new pkg.Agents(middleView, panelAttrs);
            eventsView = new pkg.Events(middleView, panelAttrs);
            missionsView = new pkg.Missions(middleView, panelAttrs);
            timelineView = new pkg.TimelineCompact(middleView, panelAttrs);
            
            opsView = new pkg.OperationDetails(middleView);
            eventDetailsView = new pkg.EventDetails(middleView);
            
            appView.attachTo(teamView,'_onAgentSelectionChanged', 'selectionChanged');
            appView.attachTo(timelineView,'_onEventSelectionChanged', 'selectionChanged');
            appView.attachTo(eventsView,'_onEventRowSelectionChanged', 'selectionChanged');
            appView.attachTo(missionsView,'_onMissionRowSelectionChanged', 'selectionChanged');
            
            dividerV = new M.VerticalDivider(middleView, {
                height:5, minValue:116, limitToParent:200,
                activeColor:'transparent', hoverColor:'transparent', readyColor:'transparent'
            }, [{
                setValue: function(v) {
                    this.callSuper(v);
                    this.updateLayout();
                },
                updateLayout: function() {
                    const v = this.value,
                        upperHeight = v + 2;
                    opsView.setHeight(upperHeight);
                    
                    eventDetailsView.setY(upperHeight + layoutSpacing);
                    eventDetailsView.setHeight(middleView.height - eventDetailsView.y);
                }
            }]);
            
            dividerH = new M.HorizontalDivider(middleView, {
                width:5, percentOfParentHeight:100, minValue:352, limitToParent:350,
                activeColor:'transparent', hoverColor:'transparent', readyColor:'transparent'
            }, [SizeToParent, {
                setValue: function(v) {
                    this.callSuper(v);
                    if (this.inited) this.updateLayout();
                },
                updateLayout: function() {
                    const v = this.value,
                        leftWidth = v + 2;
                    for (const sv of [tabView, teamView, eventsView, missionsView, timelineView]) sv.setWidth(leftWidth);
                    for (const sv of [opsView, dividerV, eventDetailsView]) {
                        sv.setX(leftWidth + layoutSpacing);
                        sv.setWidth(middleView.width - sv.x);
                    }
                }
            }]);
            
            dividerV.syncTo(middleView, 'updateLayout', 'height');
            dividerH.syncTo(middleView, 'updateLayout', 'width');
            timelineTabBtn.doActivated();
        },
        
        selectTimelineTab: () => timelineTabBtn.doActivated(),
        selectEventsTab: () => eventsTabBtn.doActivated(),
        selectMissionsTab: () => missionsTabBtn.doActivated(),
        selectAgentsTab: () => agentsTabBtn.doActivated(),
        
        getTimelineView: () => timelineView,
        getTeamView: () => teamView,
        getEventsView: () => eventsView,
        getMissionsView: () => missionsView,
        getEventDetailsView: () => eventDetailsView,
        getOpsView: () => opsView,
        
        doReload: () => {
            location.reload(); // reload the browser.
        },
        
        /*  Clears the save first since a reload would otherwise restore it. The game is 
            abandoned, so it and its losses count toward the legacy. */
        doRestartCampaign: () => {
            legacy.recordRestart();
            legacy.commit();
            persistenceMgr.clear();
            appView.doReload();
        },
        
        
        // Convienence Functions ///////////////////////////////////////////////
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
        selectEventBox: (eventModelOrId, selectTab=false) => {
            if (selectTab) appView.selectTimelineTab();
            timelineView.doSelectEvent(eventModelOrId);
        },
        
        scrollToSelectedEvent: function(immediate=false, immediateScrollsSmoothly=true) {
            const eventModel = timelineView.getSelectedEventBox()?.model;
            if (immediate) {
                this.scrollTo(); // Clear debounced scrolling.
                timelineView.scrollToEventBox(eventModel, immediateScrollsSmoothly);
            } else {
                this.scrollTo(eventModel);
            }
        },
        
        
        // Event Dispatching ///////////////////////////////////////////////////
        _onEventSelectionChanged: event => { // value is an EventBox
            eventDetailsView.notifyEventSelectedChanged(event.value);
            eventsView.selectEvent(event.value?.model);
        },
        
        /*  Selecting a row in the Events grid selects the Event, as the timeline does. */
        _onEventRowSelectionChanged: event => { // value is an EventModel
            const eventModel = event.value;
            if (eventModel) {
                if (timelineView.getSelectedEventId() !== eventModel.id) timelineView.doSelectEvent(eventModel);
            } else if (timelineView.getSelectedEventBox()) {
                timelineView.deselectAll();
            }
        },
        
        /*  Selecting a row in the Missions grid makes that mission the current one, and 
            deselecting it leaves no mission current. */
        _onMissionRowSelectionChanged: event => { // value is an OperationModel
            const operationModel = event.value ?? null;
            if (operationModel !== model.getCurrentOperation()) model.setCurrentOperation(operationModel);
        },
        
        _onAgentSelectionChanged: event => {
            const agentModel = event.value;
            eventDetailsView.notifyAgentSelectedChanged(agentModel);
            timelineView.notifyAgentSelectedChanged(agentModel);
        },
        
        notifyModelUpdated: (instanceModel, scopeId) => {
            switch (scopeId) {
                case SCOPE_AGENTS:
                    agentDossier?.notifyBriefModelChanged(instanceModel);
                    eventDetailsView.notifyEventModelChanged(instanceModel.getEventModel());
                    if (eventDetailsView.selectedAgentModel === instanceModel) {
                        eventDetailsView.updateForSelectedAgent();
                    }
                    break;
                case SCOPE_EVENTS:
                    eventDetailsView.notifyEventModelChanged(instanceModel);
                    opsView.notifyEventModelChanged(instanceModel);
                    eventBrief?.notifyBriefModelChanged(instanceModel);
                    break;
                case SCOPE_OPERATIONS:
                    opsView.notifyOperationModelChanged(instanceModel);
                    // An Objective's expression can change what's entangled.
                    if (instanceModel.isCurrent()) timelineView.updateEntanglements();
                    missionBrief?.notifyBriefModelChanged(instanceModel);
                    break;
                case SCOPE_LOCATIONS:
                    timelineView.notifyLocationModelChanged(instanceModel);
                    areaBrief?.notifyBriefModelChanged(instanceModel);
                    break;
                case SCOPE_FACTIONS:
                    factionBrief?.notifyBriefModelChanged(instanceModel);
                    break;
            }
        },
        
        /*  Called when a setting changes, so what shows it can update. */
        notifySettingChanged: (id, _value) => {
            if (id === pkg.SETTING_SHOW_VISITED_BORDERS || id === pkg.SETTING_SHOW_AGENT_HISTORY) {
                timelineView.notifyAgentHistoryDisplayChanged();
            }
        },
        
        notifyTimelineParadoxExceeded: () => {
            if (readyToHandleEvents) {
                openEndGameDialog(
                    i18n('dlg-timeline-destabilized-title'),
                    i18n('dlg-timeline-destabilized-msg')
                );
            }
        },
        
        /*  Called when the current Operation changes, from previousOperationModel, which
            can be null. */
        notifyCurrentOperationChanged: (previousOperationModel, operationModel) => {
            opsView.notifyOperationSelectedChanged(operationModel);
            timelineView.updateEntanglements();
            missionsView.selectOperation(operationModel);
            
            // Their states depend on which is current.
            previousOperationModel?.notifyCollectionOfUpdate();
            operationModel?.notifyCollectionOfUpdate();
        },
        
        /*  Called when an Operation has completed successfully, with the Operation that 
            comes next, if any, whose brief the debrief can open. */
        notifyOperationCompleted: (operationModel, nextOperationModel) => {
            if (readyToHandleEvents) {
                let saveNote = '';
                if (pkg.settings.get(pkg.SETTING_SAVE_ON_OPERATION_COMPLETION) && persistenceMgr.hasBaseline()) {
                    if (saveGame()) {
                        updateLastSaved();
                        saveNote = '<br><br><i>' + i18n('dlg-mission-complete-saved') + '</i>';
                    } else {
                        saveNote = '<br><br><i>' + i18n('dlg-mission-complete-not-saved') + '</i>';
                    }
                }
                
                const title = i18n('dlg-mission-complete-title', wrapInStyledSpan(operationModel.getName(), colorUltraLight)),
                    debrief = (operationModel.getDebrief() || i18n('dlg-mission-complete-msg')) + saveNote;
                
                // Wait for the timeline to finish showing the changes that completed the mission.
                timelineView.doWhenValueChangeAnimsComplete(() => {
                    if (nextOperationModel) {
                        openConfirmMsgDialog(
                            title, debrief,
                            () => {pkg.app.openMissionBrief(nextOperationModel);},
                            null,
                            i18n('btn-next-mission') + ' ' + pkg.ICON_NEXT, I18N_CLOSE_BTN
                        );
                    } else {
                        // No next operation case.
                        openAckMsgDialog(title, debrief, null, null, I18N_CLOSE_BTN);
                    }
                });
            }
        },
        
        notifyAgentLocOrVisChange: function(agentModel, isHiddenChange) {
            if (isHiddenChange && agentModel && agentModel.inited && agentModel.isNotHidden()) {
                openAgentDossier(agentModel);
            }
            timelineView.notifyAgentLocOrVisChange(agentModel);
        },
        
        notifyAgentDevouredChange: function(agentModel) {
            if (readyToHandleEvents && agentModel.isDevoured()) {
                const name = agentModel.getName();
                openAckMsgDialog(
                    i18n('dlg-agent-devoured-title', wrapInStyledSpan(name, colorUltraLight)),
                    i18n('dlg-agent-devoured-msg'),
                    () => {
                        openAgentDossier(agentModel);
                        checkForActiveRoster();
                    }
                );
            }
        },
        
        notifyAgentAliveChange: function(agentModel) {
            if (readyToHandleEvents && agentModel.isDead()) {
                const name = agentModel.getName();
                openAckMsgDialog(
                    i18n('dlg-agent-death-title', wrapInStyledSpan(name, colorUltraLight)),
                    i18n('dlg-agent-death-msg', name),
                    () => {
                        openAgentDossier(agentModel);
                        checkForActiveRoster();
                    }
                );
            }
        },
        
        
        // Opening Dialogs /////////////////////////////////////////////////////
        openSettings: () => {
            settingsDialog ??= new pkg.SettingsDialog(appView);
            settingsDialog.show();
            return settingsDialog;
        },
        
        /*  afterOpenFunc is called once the manual is open, or once loading it has failed. */
        openHelp: afterOpenFunc => {
            pkg.loadTxt(DATA_BASE_DIR + 'help.txt', (success, txt) => {
                if (success) {
                    markHelpSeen();
                    openAckMsgDialog(i18n('dlg-help-title'), txt, null, null, I18N_CLOSE_BTN);
                }
                afterOpenFunc?.();
            });
        },
        
        openAgentDossier,
        
        openAreaBrief: locationModel => {
            areaBrief ??= new pkg.AreaBrief(appView);
            areaBrief.show(locationModel);
            return areaBrief;
        },
        
        openFactionBrief: factionModel => {
            if (factionModel) {
                factionBrief ??= new pkg.FactionBrief(appView);
                factionBrief.show(factionModel);
                return factionBrief;
            }
        },
        
        /*  Opens the Event's brief once the dialogs ahead of it have closed, or at once if 
            forceIt, e.g. from the Agent Dossier. A brief that waited its turn doesn't open if 
            the Event's brief was shown in the meantime (generally requires it to be forced). */
        openEventBrief: (eventModel, forceIt) => {
            if (readyToHandleEvents) {
                const countWhenRequested = eventBriefShowCount;
                openWhenClear(() => {
                    const eventId = eventModel.id,
                        curShownCount = eventBriefShownAt.get(eventId);
                    if (curShownCount == null || curShownCount <= countWhenRequested) {
                        eventBriefShownAt.set(eventId, ++eventBriefShowCount);
                        
                        eventBrief ??= new pkg.EventBrief(appView);
                        eventBrief.show(eventModel);
                        return eventBrief;
                    }
                }, forceIt);
            }
        },
        
        /*  Takes its turn with the other ack and confirm dialogs, e.g. a new mission's brief
            waits for the previous mission's Mission Complete. An available mission's brief 
            offers to start it. Returns the MissionBrief, or undefined if it's waiting its 
            turn. */
        openMissionBrief: operationModel => openWhenClear(() => {
            missionBrief ??= new pkg.MissionBrief(appView);
            missionBrief.show(operationModel);
            return missionBrief;
        })
    });
})(tc);
