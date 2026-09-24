(pkg => {
    'use strict';
    
    let appView,
        model,
        
        timelineView,
        eventDetailsView,
        
        dividerV,
        dividerH,
        
        opsView,
        teamView;
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, ResizeLayout, SizeToParent, global:G} = M,
        
        {
            WideView,
            theme:{layoutSpacing, spacing, padding, colorUltraDark, colorMedium, fontSizeVeryLarge}
        } = pkg,
        
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
            
            // Build UI
            appView.buildTopView(new WideView(appView, {bgColor:colorMedium, height:40}));
            appView.buildMiddleView(new WideView(appView, {layoutHint:1}));
            appView.buildFooterView(new WideView(appView, {bgColor:colorMedium, height:40}));
            
            new ResizeLayout(appView, {axis:'y', spacing:layoutSpacing});
            
            dividerV.setValue(187);
            dividerH.setValue(900);
            
            // Fetch Data
            const filesToLoad = ['titanic_scenario','lusitania_scenario','agents','operations'];
            let idx = 0;
            const chainFunc = success => {
                if (!success) {
                    console.error('Data load failed:', filesToLoad[idx - 1]);
                    pkg.resumeConstraintBinding();
                    return;
                }
                const namePart = filesToLoad[idx++];
                if (namePart) {
                    loadDataIntoModel('./data/' + namePart + '.json', chainFunc);
                } else {
                    pkg.resumeConstraintBinding();
                    timelineView.setup(model);
                    teamView.setup(model);
                    model.reset(true);
                }
            };
            pkg.pauseConstraintBinding();
            chainFunc(true);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        noop: M.NOOP,
        
        buildTopView: topView => {
            topView.setTextColor(colorUltraDark);
            
            new M.PlainText(topView, {valign:'middle', text:'T I M E ◦ C O R P S', fontSize:fontSizeVeryLarge});
            new pkg.Spacer(topView);
            
            new pkg.Btn(topView, {valign:'middle', text:'Restart Campaign'}, [{
                doActivated: () => {model.reset(true);}
            }]);
            new pkg.SquareBtn(topView, {valign:'middle', text:'⚙', fontSize:fontSizeVeryLarge, tooltip:'Settings'});
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
                width:5, percentOfParentHeight:100, minValue:525, limitToParent:300,
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
        
        buildFooterView: footerView => {},
        
        getTimelineView: () => timelineView,
        getTeamView: () => teamView,
        getEventDetailsView: () => eventDetailsView,
        getOpsView: () => opsView,
        
        // Convienence Functions
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
        
        notifyEventModelAdded: eventModel => {
            //console.log('add event', eventModel);
        },
        
        notifyEventModelUpdated: eventModel => {
            eventDetailsView.notifyEventModelChanged(eventModel);
        },
        
        notifyEventModelRemoved: eventModel => {
            //console.log('remove event', eventModel);
        },
        
        notifyOperationModelUpdated: operationModel => {
            opsView.notifyOperationModelChanged(operationModel);
        },
        
        notifyTimelineParadoxExceeded: () => {
            console.log('timeline max paradox EXCEEDED.');
            // FIXME: do end game.
        }
    });
})(tc);