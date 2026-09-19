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
            dividerH.setValue(800);
            
            // Fetch Data
            pkg.pauseConstraintBinding();
            loadDataIntoModel('./data/locations.json', success => {
                if (success) loadDataIntoModel('./data/events.json', success => {
                    if (success) loadDataIntoModel('./data/agents.json', success => {
                        if (success) {
                            pkg.resumeConstraintBinding();
                            
                            timelineView.setup(model);
                            teamView.setup(model);
                        }
                    });
                });
            });
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        noop: M.NOOP,
        
        buildTopView: topView => {
            topView.setTextColor(colorUltraDark);
            
            new M.PlainText(topView, {valign:'middle', text:'T I M E ◦ C O R P S', fontSize:fontSizeVeryLarge});
            new pkg.Spacer(topView);
            
            new pkg.Btn(topView, {valign:'middle', text:'Restart Campaign'}, [{
                doActivated: () => {model.reset();}
            }]);
            new pkg.SquareBtn(topView, {valign:'middle', icon:'⚙', iconSize:fontSizeVeryLarge, iconX:5, iconY:-2, tooltip:'Settings'});
            
            new ResizeLayout(topView, {inset:padding, spacing:spacing, outset:padding});
        },
        
        buildMiddleView: middleView => {
            teamView = new pkg.Agents(middleView, {title:'Agents'});
            appView.buildOpView(opsView = new pkg.Panel(middleView, {title:'Operation'}));
            appView.attachTo(teamView,'_onAgentSelectionChanged', 'selectionChanged');
            timelineView = new pkg.TimelineCompact(middleView, {title:'Timeline'});
            eventDetailsView = new pkg.EventDetails(middleView);
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
                width:5, percentOfParentHeight:100, minValue:475, limitToParent:375,
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
        
        buildOpView: () => {},
        buildFooterView: footerView => {},
        
        getTimelineView: () => timelineView,
        getTeamView: () => teamView,
        getEventDetailsView: () => eventDetailsView,
        
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
        
        notifyTimelineParadoxExceeded: () => {
            console.log('timeline max paradox EXCEEDED.');
            // FIXME: do end game.
        }
    });
})(tc);