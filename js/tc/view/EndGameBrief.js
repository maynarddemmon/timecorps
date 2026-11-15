(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {I18N:{get:i18n}, SpacedLayout, SizeToParent} = M,
        
        {
            WideView, UnderlineBtn,
            theme:{
                padding, cornerRadius,
                colorMedium, colorMegaDark, colorSuccess, colorError,
                fontSizeMedium, fontSizeLarge
            },
            STAT_ID_PARADOX, OPERATION_STATE_COMPLETED,
            getStatName
        } = pkg,
        
        LABEL_WIDTH = 140,
        
        toPercent = fraction => i18n('end-game-percent', Math.round(100*fraction)),
        
        sumOf = (list, valueFunc) => list.reduce((sum, item) => sum + valueFunc(item), 0),
        
        /*  How the game went, as [label, value] pairs, worked out from the timeline as it
            stands: nothing is tracked for it. Shown Events are the regular ones the player
            knows about, so not the hubs. The agents are the ones the player has directed. */
        getMetrics = () => {
            const model = pkg.model,
                shownEvents = model.getEventModelsAsList(eventModel => eventModel.isNotHidden() && !eventModel.isHub()),
                shownCount = shownEvents.length,
                attestation = sumOf(shownEvents, eventModel => eventModel.attestation.getValue()),
                attestationMax = sumOf(shownEvents, eventModel => eventModel.attestation.getMax()),
                historicity = sumOf(shownEvents, eventModel => eventModel.historicity.getPercentOfMax()),
                floodedCount = shownEvents.filter(eventModel => eventModel.isFlooded()).length,
                
                missions = model.getOperationModelsAsList(operationModel => operationModel.isNotHidden()),
                completedCount = missions.filter(operationModel => operationModel.getState() === OPERATION_STATE_COMPLETED).length,
                
                agents = model.getAgentModelsAsList(agentModel => agentModel.isPlayerControlled() && agentModel.isNotHidden()),
                devouredCount = agents.filter(agentModel => agentModel.isDevoured()).length,
                diedCount = agents.filter(agentModel => !agentModel.isDevoured() && agentModel.isDead()).length,
                timeJumpCount = sumOf(agents, agentModel => agentModel.getVisitHistory().filter(visit => visit.isTimeTravel).length),
                
                timelineParadox = model[STAT_ID_PARADOX],
                
                // The high score now, and as it stood when this game began.
                score = model.score ?? 0,
                legacy = pkg.legacy,
                highScore = legacy.getHighScore(),
                highScoreBefore = legacy.getHighScoreBefore(),
                isNewHighScore = highScore !== null && highScore !== highScoreBefore,
                
                metrics = [
                    [i18n('end-game-score'), String(score)],
                    [
                        i18n('end-game-high-score'), 
                        highScore === null ? i18n('end-game-high-score-none') : 
                            isNewHighScore ? i18n('end-game-high-score-new', highScore) : String(highScore)
                    ]
                ];
            // The highest this game's score reached, when it's since fallen, e.g. to paradox.
            const peakScore = model.getPeakScore();
            if (peakScore > score) metrics.splice(1, 0, [i18n('end-game-peak-score'), String(peakScore)]);
            if (highScoreBefore > 0) metrics.push([i18n('end-game-of-high-score'), toPercent(score / highScoreBefore)]);
            
            return [
                ...metrics,
                [i18n('end-game-credits'), String(model.credits ?? 0)],
                [i18n('end-game-missions'), i18n('end-game-of', completedCount, missions.length)],
                [i18n('end-game-events'), String(shownCount)],
                [i18n('end-game-attestation'), String(attestation)],
                [i18n('end-game-attestation-percent'), toPercent(attestationMax > 0 ? attestation / attestationMax : 0)],
                [i18n('end-game-historicity'), toPercent(shownCount > 0 ? historicity / shownCount : 0)],
                [i18n('stat-scope-timeline', getStatName(STAT_ID_PARADOX)), i18n('end-game-of', timelineParadox.getValue(), timelineParadox.getMax())],
                [i18n('end-game-flooded'), String(floodedCount)],
                [i18n('end-game-agents-lost'), i18n('end-game-agents-lost-value', diedCount, devouredCount)],
                [i18n('end-game-time-jumps'), String(timeJumpCount)]
            ];
        },
        
        /*  A label and its value, on one line. */
        MetricRow = new JSClass('MetricRow', WideView, {
            initNode: function(parent, attrs) {
                const label = attrs.label,
                    value = attrs.value;
                delete attrs.label;
                delete attrs.value;
                
                this.callSuper(parent, attrs);
                
                const labelTxt = new M.PlainText(this, {
                    width:LABEL_WIDTH, textColor:colorMedium, fontSize:fontSizeMedium, textAlign:'right', text:label
                });
                new M.PlainText(this, {x:LABEL_WIDTH + padding, fontSize:fontSizeMedium, text:value});
                this.setHeight(labelTxt.height);
            }
        });
    
    /*  Shown when the game has effectively ended, e.g. the roster is depleted or the timeline
        destabilized: why, how the game went (see getMetrics), and the ways on. Restart starts
        a new campaign, as the header's restart does. Reload goes back to the last save, and is
        only offered when there is one. It can't be closed any other way. Enter reloads when
        it can, else restarts. */
    pkg.EndGameBrief = new JSClass('EndGameBrief', pkg.AckDialog, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this;
            attrs.sizingStrategy ??= 'fit';
            attrs.tallWidth ??= 450;
            attrs.centerItemCfgs ??= [
                {klass:UnderlineBtn, attrs:{
                    name:'reloadBtn', text:i18n('btn-reload-save'), textColor:colorSuccess,
                    fontSize:fontSizeLarge, valign:'middle'
                }, mixins:[{doActivated:() => self._doChoice(self._reloadFunc)}]},
                {klass:pkg.Spacer, attrs:{name:'spacer'}},
                {klass:UnderlineBtn, attrs:{
                    name:'restartBtn', text:i18n('btn-restart-campaign'), textColor:colorError,
                    fontSize:fontSizeLarge, valign:'middle'
                }, mixins:[{doActivated:() => self._doChoice(self._restartFunc)}]}
            ];
            
            self.callSuper(parent, attrs);
            
            const container = self._container = new WideView(self, {x:padding / 2, percentOfParentWidthOffset:-padding});
            
            self._msgTxt = new M.PaddedText(container, {
                percentOfParentWidth:100, padding:padding / 2, whiteSpace:'pre-wrap', fontSize:fontSizeMedium
            }, [SizeToParent]);
            
            const metricsView = self._metricsView = new WideView(container, {
                roundedCorners:cornerRadius, bgColor:colorMegaDark
            });
            new SpacedLayout(metricsView, {axis:'y', inset:padding, spacing:padding / 2, outset:padding, collapseParent:true});
            
            new SpacedLayout(container, {axis:'y', inset:padding / 2, spacing:padding / 2, outset:padding / 2, collapseParent:true});
            self.syncTo(container, '_fitToContent', 'height');
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        getReloadBtn: function() {return this.getFooterView().reloadBtn;},
        getRestartBtn: function() {return this.getFooterView().restartBtn;},
        
        /** @overrides AckDialog */
        getDefaultBtn: function() {
            const reloadBtn = this.getReloadBtn();
            return reloadBtn.visible ? reloadBtn : this.getRestartBtn();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Without a reloadFunc, there's no Reload button. */
        show: function(title, msg, restartFunc, reloadFunc) {
            const self = this,
                reloadVisible = !!reloadFunc,
                footerView = self.getFooterView(),
                msgTxt = self._msgTxt,
                metricsView = self._metricsView;
            
            self.callSuper();
            
            self.setTitle(title);
            self._restartFunc = restartFunc;
            self._reloadFunc = reloadFunc;
            self.getReloadBtn().setVisible(reloadVisible);
            footerView.spacer.setVisible(reloadVisible);
            footerView.getFirstLayout().update();
            
            msgTxt.setText(msg);
            msgTxt.sizeViewToDom();
            
            metricsView.destroyAllSubviews();
            for (const [label, value] of getMetrics()) new MetricRow(metricsView, {label, value});
        },
        
        /** @private */
        _doChoice: function(func) {
            this.hide();
            func?.();
        },
        
        /** @private */
        _fitToContent: function(_event) {
            this.setContentHeightToFit(this._container.height);
        }
    });
})(tc);
