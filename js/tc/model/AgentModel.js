(pkg => {
    'use strict';
    
    // Monotonic counter used to order Agents by when they arrived at their current Event.
    let arrivalCounter = 0;
    
    const {max:mathMax, min:mathMin, round:mathRound, abs:mathAbs} = Math,
        
        M = myt,
        
        {
            NotifyingNumericStatModel, getConstrainedValueCfg,
            cfg:{
                EVENT_ID_THE_VOID, EVENT_ID_TIME_CORPS_HQ,
                AGENT_CHRONAL_LIMIT, AGENT_PARADOX_LIMIT, AGENT_DEFAULT_HEALTH, AGENT_HEALTH_LIMIT,
                SCORE_PER_ATTESTATION, PARADOX_SCORE_MULTIPLIER, RELOAD_CHRONAL_AMOUNT
            },
            theme:{colorAction, fontFamilyMono},
            checks:{skill, getSkillEase, getEasePhrase, rollAmount, getAverageAmount, getAverageMargin, toDamagePhrase, showFloatingTextForSkillCheck},
            isNoRollDifficulty,
            ICON_HQ, ICON_SEPARATOR, ICON_HEALTH, ICON_APPROX,
            STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HEALTH, STAT_ID_ATTESTATION,
            SKILL_ID_INVESTIGATION, SKILL_ID_CHRONOGATION,
            SCOPE_AGENT, SCOPE_EVENT, SCOPE_SKILLS, CHECK_SKILL_EXPR_PREFIX,
            getStatName
        } = pkg,
        
        AGENT_STAT_IDS = [STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HEALTH],
        
        LOG_TYPE_ORIGIN = 'origin',
        LOG_TYPE_DEPLOY = 'deploy',
        LOG_TYPE_RECALL = 'recall',
        LOG_TYPE_EXIT = 'exit',
        LOG_TYPE_ACTION = 'action',
        LOG_TYPE_DEVOURED = 'devoured',
        
        getInfoForTimeTravel = (agentModel, eventModel) => {
            const isHQ = eventModel.isHQ(),
                chronalNeeded = isHQ ? pkg.getChronalToRecall(agentModel) : pkg.getChronalToDeploy(agentModel, eventModel),
                chronalAvailable = -agentModel[STAT_ID_CHRONAL].getValueToMin(),
                hasEnoughChronal = chronalNeeded <= chronalAvailable,
                paradoxCost = agentModel.calculateParadoxForEntry(eventModel),
                agentRisksPhrase = pkg.formatAgentRisks(chronalNeeded, paradoxCost);
            let disabled,
                text,
                visible = true;
            if (isHQ) {
                disabled = !hasEnoughChronal;
                text = 'Recall to ' + ICON_HQ + agentRisksPhrase;
            } else {
                const isAlreadyAtEvent = agentModel.isAtEvent(eventModel);
                disabled = !hasEnoughChronal;
                text = (agentModel.isAtHQ() ? 'Deploy to' : (isAlreadyAtEvent ? 'Loop back' : 'Jump to')) + agentRisksPhrase;
            }
            
            if (agentModel.isDead()) visible = false;
            
            return {disabled, text, visible};
        },
        
        getCheckCfg = (agentModel, difficulty) => ({agent:agentModel, event:agentModel.getEventModel(), difficulty}),
        
        /*  The difficulty an effect's amount expression sees: its own check's, or else the
            action's or exit's. */
        getEffectDifficulty = effectModel => (effectModel.hasOwnCheck() ? effectModel : effectModel.owner).getActionSkillDifficulty(),
        
        /*  An effect's amount for when its check passes or fails, given that check's margin: 
            rolled, or its average. Undefined if nothing happens in that case. */
        getEffectAmount = (agentModel, effectModel, success, amountFunc, margin) => {
            const expr = effectModel.getAmountExpr(success);
            return expr ? amountFunc(expr, {...getCheckCfg(agentModel, getEffectDifficulty(effectModel)), margin}) : undefined;
        },
        
        /*  The average margin of the check that decides an effect, for a pass or a failure: 
            its own check, or else its action's. 0 if nothing is rolled, as for an exit without 
            a check of its own or a no-roll check. */
        getAverageEffectMargin = (agentModel, effectModel, success) => {
            const decider = effectModel.hasOwnCheck() ? effectModel : (effectModel.owner.isGatedByActionSkillCheck() ? effectModel.owner : null);
            if (!decider) return 0;
            
            const difficulty = decider.getActionSkillDifficulty();
            if (isNoRollDifficulty(difficulty)) return 0;
            return getAverageMargin(agentModel.getSkillExpressionEase(decider.getActionSkillExpr(), difficulty), success);
        },
        
        /*  An effect's average amount for a pass or a failure, without rolling. */
        getAverageEffectAmount = (agentModel, effectModel, success) => getEffectAmount(
            agentModel, effectModel, success, getAverageAmount, getAverageEffectMargin(agentModel, effectModel, success)
        ),
        
        isHealthEffect = effectModel => effectModel.scopeName === SCOPE_AGENT && effectModel.statId === STAT_ID_HEALTH,
        
        /*  Names the stat an effect changes, e.g. "Health" or "Event Attestation". */
        describeEffectStat = effectModel => {
            const name = getStatName(effectModel.statId);
            switch (effectModel.scopeName) {
                case SCOPE_AGENT: return name;
                case SCOPE_EVENT: return 'Event ' + name;
                default: return 'Timeline ' + name;
            }
        },
        
        /*  Log entries hold model references which are saved as IDs. Exits have no ID so they 
            are saved as [eventId, index]. Actions are saved as [eventId, actionId]. */
        exportLogEntry = entry => {
            const {event, exit, action, ...retval} = entry;
            if (event) retval.event = event.id;
            if (exit) retval.exit = [exit.event.id, exit.event.getExitModels().indexOf(exit)];
            if (action) retval.action = [action.event.id, action.id];
            return retval;
        },
        
        /*  Returns null if a referenced model no longer exists. */
        importLogEntry = obj => {
            const {event, exit, action, ...retval} = obj,
                rootModel = pkg.model;
            if (event != null) {
                if (!(retval.event = rootModel.getEventModel(event))) return null;
            }
            if (exit) {
                if (!(retval.exit = rootModel.getEventModel(exit[0])?.getExitModels()[exit[1]])) return null;
            }
            if (action) {
                if (!(retval.action = rootModel.getEventModel(action[0])?.getActionModels()[action[1]])) return null;
            }
            return retval;
        },
        
        accrueEntryParadox = (agentModel, eventModelOrId) => {
            const paradox = agentModel.calculateParadoxForEntry(eventModelOrId, -1); // -1 because we will have just pushed an entry event of some kind onto the log.
            if (paradox > 0) {
                // Accrue in Event first since the Agent might get sent to The Void.
                const eventModel = agentModel.getEventModel();
                if (eventModel) {
                    agentModel.getEventModel()[STAT_ID_PARADOX].adjValue(paradox);
                } else {
                    console.warn('accrueEntryParadox for timeline should be mediated by an event');
                }
                
                agentModel[STAT_ID_PARADOX].adjValue(paradox);
                
                // Adjust score for paradox generated.
                pkg.model.adjScore(paradox * PARADOX_SCORE_MULTIPLIER);
            }
        };
    
    /*  Hidden Agents are not yet part of the game (e.g. awaiting a mission reward). Accepts 
        a boolean or a constraint expression. A new value replaces any existing constraint, 
        so a reward's reveal overrides an expression from the data. Expressions resolve 
        against the Agent, so use "agent...", "agents.<id>...", "events.<id>..." or "timeline..." 
        but not "event...". */
    // FIXME: support event... as the Event the agent is currently in?
    pkg.AgentModel = new JS.Class('AgentModel', M.BaseModel, {
        include: [pkg.DescribableHideable, pkg.MediaSupport],
        
        /** @overrides ConstrainableAttrSupport */
        getConstraintScopeName: () => SCOPE_AGENT,
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        init: function(attrs) {
            const self = this;
            
            self.log = [];
            self[SCOPE_SKILLS] = {};
            
            // Hidden and NPC unless the data says otherwise.
            self.hidden = true;
            self.playerControlled = false;
            self.devoured = false;
            
            // The number of actions the Agent has executed in the EventModel they are currently in.
            self.actionExecCount = 0;
            
            self[STAT_ID_PARADOX] = new NotifyingNumericStatModel({
                notifyTargets:self, id:STAT_ID_PARADOX, absMin:0, min:0, value:0, max:AGENT_PARADOX_LIMIT
            }, [{
                triggerValueAtMax: function() {
                    this.callSuper();
                    // FIXME: perhaps provide a warning in the UI.
                    console.log('agent max paradox reached.');
                },
                triggerValueClampedToMax: function() {
                    this.callSuper();
                    self.setDevoured(true);
                }
            }]);
            
            self[STAT_ID_CHRONAL] = new NotifyingNumericStatModel({
                notifyTargets:self, id:STAT_ID_CHRONAL, absMin:0, min:0, value:0, max:AGENT_CHRONAL_LIMIT
            });
            
            // The max is the Agent's constitution, which can be raised up to the absMax. 
            self[STAT_ID_HEALTH] = new NotifyingNumericStatModel({
                notifyTargets:self, id:STAT_ID_HEALTH, 
                absMin:0, min:0, value:AGENT_DEFAULT_HEALTH, max:AGENT_DEFAULT_HEALTH, absMax:AGENT_HEALTH_LIMIT
            }, [{
                triggerValueAtMin: function() {
                    this.callSuper();
                    pkg.app.notifyAgentAliveChange(self);
                }
            }]);
            
            // Nullish event during init is assumed to be the HQ.
            attrs.event ??= EVENT_ID_TIME_CORPS_HQ;
            
            self.callSuper(attrs);
        },
        
        getAsObj: function(cfg) {
            const retval = this.callSuper(cfg);
            for (const attrName of ['name','event','actionExecCount','hidden','playerControlled']) {
                retval[attrName] = this[attrName];
            }
            for (const attrName of AGENT_STAT_IDS) {
                // Use stableStringify since similarTo uses shallowEqual. If this gets 
                // unwieldy change similarTo to use deepEqual and drop the stableStringify.
                retval[attrName] = M.stableStringify(this[attrName].getAsObj(cfg));
            }
            return retval;
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setName: function(name) {this.setAndNotifyCollection('name', name, true);},
        getName: function() {return this.name;},
        
        setParadox: function(v) { // Used by instantiation only.
            if (this.inited) {
                console.warn('AgentModel.setParadox after init', this);
            } else {
                this[STAT_ID_PARADOX].setValue(v);
            }
        },
        
        setChronal: function(v) { // Used by instantiation only.
            if (this.inited) {
                console.warn('AgentModel.setChronal after init', this);
            } else {
                this[STAT_ID_CHRONAL].setValue(v);
            }
        },
        
        /*  Used by instantiation only. Takes a value, or {value, max} where the value defaults
            to the max. */
        setHealth: function(v) {
            if (this.inited) {
                console.warn('AgentModel.setHealth after init', this);
            } else {
                const statHealth = this[STAT_ID_HEALTH];
                if (typeof v === 'number') {
                    statHealth.setValue(v);
                } else if (v) {
                    if (v.max != null) statHealth.setMax(v.max);
                    statHealth.setValue(v.value ?? statHealth.getMax());
                }
            }
        },
        
        setActionExecCount: function(v, noEventUpdate) {
            if (this.actionExecCount !== v) {
                this.setAndNotifyCollection('actionExecCount', v, true);
                if (this.inited && !noEventUpdate) this.getEventModel()?.notifyCollectionOfUpdate();
            }
        },
        getActionExecCount: function() {return this.actionExecCount;},
        incrementActionExecCount: function() {this.setActionExecCount(this.actionExecCount + 1);},
        getEventActionLimit: function() {return this.getEventModel()?.getActionLimit() ?? 0;},
        getActionsRemaining: function() {
            if (this.isDead()) return 0;
            return mathMax(0, this.getEventActionLimit() - this.getActionExecCount());
        },
        canAct: function() {return this.getActionsRemaining() > 0;},
        getActionsPhrase: function() {
            return 'Actions: ' + pkg.wrapInStyledSpan(this.getActionsRemaining(), colorAction, fontFamilyMono);
        },
        
        setEvent_Hard: function(event, logEntry) {
            this.setEvent(event, logEntry, true);
        },
        
        setEvent: function(event, logEntry, forceIt) {
            if (this.event !== event || forceIt) {
                const oldEventModel = this.getEventModel();
                
                this.set('event', event, true);
                const newEventModel = this._eventModel = pkg.model.getEventModel(this.event); // Populate immediately
                this.setActionExecCount(0, true);
                this.stampArrival();
                this.notifyCollectionOfUpdate();
                
                this.pushOntoLog(logEntry ?? {type:LOG_TYPE_ORIGIN, event:this.getEventModel()});
                accrueEntryParadox(this, newEventModel);
                oldEventModel?.notifyCollectionOfUpdate();
                newEventModel?.notifyCollectionOfUpdate();
                pkg.app.notifyAgentLocOrVisChange(this, false);
            }
        },
        
        getEvent: function() {return this.event;},
        getEventModel: function() {return this._eventModel;},
        isAtEvent: function(eventModelOrId) {
            switch (typeof eventModelOrId) {
                case 'string':
                    return this.event === eventModelOrId;
                case 'object':
                    return this.getEventModel() === eventModelOrId;
                default:
                    console.warn('Unexpected type in isAtEvent', typeof eventModelOrId);
                    return false;
            }
        },
        isAtHQ: function() {return this.event === EVENT_ID_TIME_CORPS_HQ;},
        isAtTheVoid: function() {return this.event === EVENT_ID_THE_VOID;},
        
        doHiddenChanged: function(hidden) {
            if (this.inited) {
                if (!hidden) this.stampArrival();
                this.notifyCollectionOfUpdate();
                pkg.app.notifyAgentLocOrVisChange(this, true);
            }
        },
        
        /*  Player controlled Agents are directed by the player. Visible Agents that are not player 
            controlled are NPCs. */
        setPlayerControlled: function(value) {
            value = !!value;
            if (this.playerControlled !== value) {
                this.set('playerControlled', value, true);
                if (this.inited) this.notifyCollectionOfUpdate();
            }
        },
        isPlayerControlled: function() {return this.playerControlled;},
        
        stampArrival: function() {this.arrivalOrder = ++arrivalCounter;},
        getArrivalOrder: function() {return this.arrivalOrder ?? 0;},
        
        /** @overrides MediaSupport */
        getMediaFolder: () => 'agent',
        
        getRoleLabel: function() {
            return this.isPlayerControlled() ? 'Agent' : 'Civilian';
        },
        
        // Skills //
        setSkills: function(skills) {
            const clean = {};
            for (const skillId in skills) {
                const v = skills[skillId];
                if (typeof v === 'number') {
                    clean[skillId] = v;
                } else {
                    console.warn('Agent', this.id, 'skill', skillId, 'not numeric. IGNORING:', v);
                }
            }
            this[SCOPE_SKILLS] = clean;
        },
        getSkills: function() {return this[SCOPE_SKILLS];},
        getSkill: function(skillId) {return this.getSkills()[skillId] ?? 0;},
        getSkillChronogation: function() {return this.getSkill(SKILL_ID_CHRONOGATION);},
        getSkillInvestigation: function() {return this.getSkill(SKILL_ID_INVESTIGATION);},
        
        getSkillInfo: function() {
            const accum = [];
            for (const skillId of pkg.getSkillIds()) {
                accum.push({
                    id:skillId, 
                    value:this.getSkill(skillId), 
                    cfg:pkg.getSkillConfig(skillId)
                });
            }
            return accum;
        },
        
        /*  Rolls a check of a skill expression, e.g. "Math.max(agent.skills.a, agent.skills.b)",
            against a difficulty. Returns {success, result, roll, difficulty, ease}. */
        checkSkillExpression: function(skillExpr, difficulty) {
            return skill(skillExpr, getCheckCfg(this, difficulty));
        },
        
        /*  The ease of a skill expression check, without rolling. */
        getSkillExpressionEase: function(skillExpr, difficulty) {
            return getSkillEase(skillExpr, getCheckCfg(this, difficulty));
        },
        
        /*  Describes how likely a skill expression check is to succeed, without rolling. */
        getSkillEasePhrase: function(skillExpr, difficulty) {
            return getEasePhrase(skillExpr, getCheckCfg(this, difficulty));
        },
        
        /*  Rolls a check of one skill against a difficulty. Returns the same as 
            checkSkillExpression. */
        checkSkill: function(skillName, difficulty) {
            return this.checkSkillExpression(CHECK_SKILL_EXPR_PREFIX + skillName, difficulty);
        },
        
        
        // Persistence /////////////////////////////////////////////////////////
        exportToObj: function() {
            const retval = {
                hidden:getConstrainedValueCfg(this, 'hidden'),
                playerControlled:this.playerControlled,
                [SCOPE_SKILLS]:{...this[SCOPE_SKILLS]},
                event:this.event,
                actionExecCount:this.actionExecCount,
                arrivalOrder:this.arrivalOrder,
                devoured:this.devoured,
                log:this.log.map(exportLogEntry)
            };
            for (const statId of AGENT_STAT_IDS) retval[statId] = this[statId].exportToObj();
            return retval;
        },
        
        /*  Update only. Runs while constraint binding is paused. Deliberately avoids setEvent 
            and adjValue since those would log, accrue paradox and stamp arrival again. */
        importFromObj: function(obj) {
            for (const statId of AGENT_STAT_IDS) {
                if (obj[statId]) this[statId].importFromObj(obj[statId]);
            }
            if ('hidden' in obj) this.setHidden(obj.hidden);
            if ('playerControlled' in obj) this.setPlayerControlled(obj.playerControlled);
            
            // Set directly, since setDevoured would send the Agent to The Void again. The saved
            // event and chronal already have them there.
            if ('devoured' in obj) this.set('devoured', !!obj.devoured, true);
            
            // A saved diff only holds the skills that changed so merge rather than replace.
            if (obj[SCOPE_SKILLS]) this.setSkills({...this[SCOPE_SKILLS], ...obj[SCOPE_SKILLS]});
            
            if ('event' in obj) {
                //  Puts the Agent at an Event with none of the side effects of setEvent.
                const eventId = obj.event,
                    eventModel = pkg.model.getEventModel(eventId);
                if (eventModel) {
                    this.set('event', eventId, true);
                    this._eventModel = eventModel;
                } else {
                    console.warn('Save puts Agent', this.id, 'at unknown Event', eventId, '(skipping)');
                }
            }
            if ('actionExecCount' in obj) this.setActionExecCount(obj.actionExecCount, true);
            
            if (obj.log) {
                const log = [];
                for (const entryObj of obj.log) {
                    const entry = importLogEntry(entryObj);
                    if (entry) {
                        log.push(entry);
                    } else {
                        console.warn('Save has a log entry for Agent', this.id, 'that references a missing model (skipping):', entryObj);
                    }
                }
                this.log = log;
            }
        },
        
        /*  Runs after constraint binding resumes. Revealing an Agent stamps its arrival when 
            the hidden constraint binds, so the saved order must be applied after that. */
        completeImportFromObj: function(obj) {
            if ('arrivalOrder' in obj) {
                const arrivalOrder = this.arrivalOrder = obj.arrivalOrder;
                arrivalCounter = mathMax(arrivalCounter, arrivalOrder ?? 0);
            }
            this.notifyCollectionOfUpdate();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        notifyCollectionOfUpdate: function() {
            if (this.inited) {
                this.callSuper();
                this.fireEvent('updated');
            }
        },
        
        notifyStatChanged: function(_statModel) {
            if (this.inited) this.notifyCollectionOfUpdate();
        },
        
        doDescriptionChanged: function() {
            if (this.inited) this.notifyCollectionOfUpdate();
        },
        
        updateBtnForTimeTravel: function(btn, eventModel) {
            btn.callSetters(getInfoForTimeTravel(this, eventModel));
        },
        
        /*  The exit the Agent can take from its current Event to eventModel, or null if there's 
            none. As in the Agent's list of exits, hidden exits and exits to hidden Events don't 
            count. */
        getExitTo: function(eventModel) {
            const currentEventModel = this.getEventModel();
            if (!currentEventModel || !eventModel || eventModel === currentEventModel || eventModel.isHidden()) return null;
            return currentEventModel.getExitModels().find(exitModel => !exitModel.isHidden() && exitModel.getToEventModel() === eventModel) ?? null;
        },
        
        doDeployToEvent: function(eventModel) {
            if (this.isDead()) return;
            
            if (eventModel) {
                const cost = pkg.getChronalToDeploy(this, eventModel);
                if (cost <= -this[STAT_ID_CHRONAL].getValueToMin()) {
                    this[STAT_ID_CHRONAL].adjValue(-cost);
                    this.setEvent_Hard(eventModel.id, {type:LOG_TYPE_DEPLOY, event:eventModel});
                } else {
                    console.warn('insufficent chronal to deploy');
                }
            } else {
                console.warn('doDeployToEvent: no eventModel');
            }
        },
        doRecallToHQ: function() {
            if (this.isDead()) return;
            
            const hqEventModel = pkg.model.getHQEventModel();
            if (hqEventModel) {
                const cost = pkg.getChronalToRecall(this);
                if (cost <= -this[STAT_ID_CHRONAL].getValueToMin()) {
                    this[STAT_ID_CHRONAL].adjValue(-cost);
                    this.setEvent(hqEventModel.id, {type:LOG_TYPE_RECALL, event:hqEventModel});
                } else {
                    console.warn('insufficent chronal to recall');
                }
            } else {
                console.warn('doRecallToHQ: no eventModel');
            }
        },
        doFollowExit: function(exitModel, btnView) {
            if (this.isDead()) return;
            
            if (this.getEventModel() === exitModel.event) {
                const toEvent = exitModel.getToEventModel();
                if (toEvent) {
                    // Taking the exit always succeeds, but its effects may change things on the 
                    // way, e.g. hurt. The result is shown before the effects apply since that can
                    // rebuild the views, btnView included. The first effect with its own check 
                    // gives the result.
                    const effects = this.rollEffectsFor(exitModel),
                        logEntry = {type:LOG_TYPE_EXIT, exit:exitModel};
                    if (effects.length > 0) {
                        const shownCheck = effects.find(effect => effect.check)?.check ?? {success:true, roll:null};
                        showFloatingTextForSkillCheck(btnView, {...shownCheck, effects});
                        this.applyEffects(effects, logEntry);
                    }
                    
                    this.setEvent(toEvent.id, logEntry);
                    pkg.app.selectEventBox(toEvent);
                }
            } else {
                console.warn('Agent not at event for exit:', exitModel, this);
            }
        },
        
        doAction: function(actionModel, btnView) {
            if (!this.canAct()) return;
            
            /*if (actionModel.isDone()) {
                console.warn('Attemp to do a done action.', actionModel, this);
                return;
            }*/
            
            const eventModel = this.getEventModel(),
                {setObj, event} = actionModel;
            
            if (eventModel !== event) {
                console.warn('Agent not in same event as action.', actionModel, this);
                return;
            }
            
            // A failed check still uses the action.
            const check = this.checkSkillExpression(
                    actionModel.getActionSkillExpr(),
                    actionModel.getActionSkillDifficulty()
                ),
                effects = this.rollEffectsFor(actionModel, check),
                logEntry = {type:LOG_TYPE_ACTION, action:actionModel, success:check.success};
            
            // Now show floating panel, with the effects so there's only one. (must be before 
            // anything that triggers a rerender of EventDetails such as applying the effects or
            // incrementActionExecCount, since that destroys the btnView)
            showFloatingTextForSkillCheck(btnView, {...check, effects});
            
            this.applyEffects(effects, logEntry);
            this.incrementActionExecCount();
            
            if (check.success) {
                for (const key in setObj) {
                    const value = setObj[key],
                        eventValueModel = event.values[key];
                    if (eventValueModel) {
                        eventValueModel.setValue(value, false);
                    } else {
                        console.warn('Missing Value in doIt:' + key);
                    }
                }
                //actionModel.setDone(true);
            }
            this.pushOntoLog(logEntry);
        },
        
        
        // Chronal //
        doReloadChronal: function(requestedAmount=RELOAD_CHRONAL_AMOUNT) {
            if (this.canReloadChronal(requestedAmount)) {
                const amount = this.getReloadChronalAmount(requestedAmount);
                pkg.model[STAT_ID_CHRONAL].adjValue(-amount);
                this[STAT_ID_CHRONAL].adjValue(amount);
            }
        },
        getReloadChronalAmount: function(requestedAmount=RELOAD_CHRONAL_AMOUNT) {
            return mathMin(requestedAmount, -pkg.model[STAT_ID_CHRONAL].getValueToMin(), this[STAT_ID_CHRONAL].getValueToMax());
        },
        canReloadChronal: function(requestedAmount=RELOAD_CHRONAL_AMOUNT) {
            return !this.isDead() && this.getReloadChronalAmount(requestedAmount) > 0;
        },
        
        
        // Paradox //
        calculateParadoxForEntry: function(eventModelOrId, visitsAdj=0) {
            const eventModel = typeof eventModelOrId === 'string' ? pkg.model.getEventModel(eventModelOrId) : eventModelOrId;
            if (eventModel) {
                // Paradox is only to enter regular events.
                if (eventModel.isRegularEvent()) {
                    const visits = this.countVisitsToEvent(eventModel) + visitsAdj;
                    // More paradox the more times the Agent has already been to the Event.
                    if (visits > 0) return visits;
                }
            }
            return 0;
        },
        
        setDevoured: function(v) {
            if (this.devoured !== v) {
                this.set('devoured', v, true);
                if (this.devoured) {
                    // Do devoured by chronovores
                    this[STAT_ID_CHRONAL].setMax(0); // They have lost the ability to time travel.
                    this.setEvent(EVENT_ID_THE_VOID, {type:LOG_TYPE_DEVOURED});
                    
                    pkg.app.notifyAgentDevouredChange(this);
                }
            }
        },
        isDevoured: function() {return this.devoured;},
        
        
        // Effects //
        /*  Describes the effects of an action or exit, or an empty string if it has none. Each
            gives its average amounts without rolling, then its own check if it has one. Harm 
            to the agent's health reads as injury, e.g. 
            "♥ Risking: deadly injury (light injury if passed) · Athletic / even", and anything 
            else as amounts, e.g. "Event Attestation: ~+5 if passed, ~-2 if failed". */
        getEffectsPhrase: function(ownerModel) {
            return ownerModel.getEffects().map(effectModel => {
                const failAmount = getAverageEffectAmount(this, effectModel, false),
                    passAmount = getAverageEffectAmount(this, effectModel, true);
                let phrase;
                if (isHealthEffect(effectModel) && mathMin(failAmount ?? 0, passAmount ?? 0) < 0) {
                    // A failure's damage first, then a pass's if that hurts too and reads 
                    // differently.
                    const failPhrase = toDamagePhrase(-(failAmount ?? 0)),
                        passDamage = -(passAmount ?? 0),
                        passPhrase = toDamagePhrase(passDamage);
                    phrase = ICON_HEALTH + ' Risking: ' + failPhrase + (passDamage >= 1 && passPhrase !== failPhrase ? ' (' + passPhrase + ' if passed)' : '');
                } else {
                    const parts = [];
                    for (const [amount, when] of [[passAmount, 'if passed'], [failAmount, 'if failed']]) {
                        if (Number.isFinite(amount)) {
                            const rounded = mathRound(amount);
                            parts.push(ICON_APPROX + (rounded < 0 ? '-' : '+') + mathAbs(rounded) + ' ' + when);
                        }
                    }
                    phrase = describeEffectStat(effectModel) + ': ' + parts.join(', ');
                }
                
                if (effectModel.hasOwnCheck()) {
                    const name = effectModel.getActionSkillName();
                    phrase += ICON_SEPARATOR + (name ? name + ' / ' : '') + this.getSkillEasePhrase(effectModel.getActionSkillExpr(), effectModel.getActionSkillDifficulty());
                }
                return phrase;
            }).join(ICON_SEPARATOR);
        },
        
        /*  True if an action or exit could, on average, change a stat with this ID, whoever
            has it: the agent, the Event or the timeline. A broken amount (NaN) doesn't count. */
        hasStatChangeFor: function(ownerModel, statId) {
            return ownerModel.getEffects().some(effectModel => effectModel.statId === statId && 
                [true, false].some(success => {
                    const amount = getAverageEffectAmount(this, effectModel, success);
                    return Number.isFinite(amount) && amount !== 0;
                })
            );
        },
        hasHealthChangeRiskFor: function(ownerModel) {return this.hasStatChangeFor(ownerModel, STAT_ID_HEALTH);},
        hasChronalChangeRiskFor: function(ownerModel) {return this.hasStatChangeFor(ownerModel, STAT_ID_CHRONAL);},
        hasParadoxChangeRiskFor: function(ownerModel) {return this.hasStatChangeFor(ownerModel, STAT_ID_PARADOX);},
        
        /*  Rolls the effects of an action or exit that apply, given the action's own check if 
            it has one. Doesn't apply them. Returns an Array of 
            {effect, key, statId, stat, amount, check} where amount is what the stat will 
            actually change by, in whole points within its limits, and check is the effect's 
            own check if it has one. An effect with nothing to do in its case is left out, 
            unless it rolled its own check. */
        rollEffectsFor: function(ownerModel, actionCheck) {
            const results = [];
            for (const effectModel of ownerModel.getEffects()) {
                if (!effectModel.appliesFor(actionCheck)) continue;
                
                const check = effectModel.hasOwnCheck() ? this.checkSkillExpression(effectModel.getActionSkillExpr(), effectModel.getActionSkillDifficulty()) : null,
                    // Without its own check an effect follows the action, and an exit succeeds.
                    // The margin is that of whichever check decided it, or 0 if none.
                    decidingCheck = check ?? actionCheck,
                    success = decidingCheck ? decidingCheck.success : true,
                    amount = getEffectAmount(this, effectModel, success, rollAmount, decidingCheck?.result ?? 0);
                if (amount === undefined && !check) continue;
                
                // A broken expression (NaN) does nothing. || 0 so it's never -0.
                const stat = effectModel.getStat(this),
                    adj = (stat && Number.isFinite(amount) ? stat.getAllowedAdj(mathRound(amount)).adj : 0) || 0;
                results.push({effect:effectModel, key:effectModel.key, statId:effectModel.statId, stat, amount:adj, check});
            }
            return results;
        },
        
        /*  Applies rolled effects and records them on the log entry by key. */
        applyEffects: function(effects, logEntry) {
            if (effects.length === 0) return;
            
            const logged = logEntry.effects = {};
            for (const {effect, key, stat, amount} of effects) {
                logged[key] = amount;
                if (amount !== 0) {
                    stat.adjValue(amount);
                    
                    // An Event's attestation scores the same however it's gained, or lost.
                    if (effect.scopeName === SCOPE_EVENT && effect.statId === STAT_ID_ATTESTATION) {
                        pkg.model.adjScore(amount * SCORE_PER_ATTESTATION);
                    }
                }
            }
        },
        
        
        // Death //
        isDead: function() {
            return this[STAT_ID_HEALTH].isAtMinValue();
        },
        
        
        // Life and Log //
        pushOntoLog: function(logEntry) {this.log.push(logEntry);},
        getLog: function() {return this.log;},
        countVisitsToEvent: function(eventModel) {
            let count = 0;
            for (const entry of this.getLog()) {
                switch (entry.type) {
                    case LOG_TYPE_EXIT:
                        if (entry.exit.getToEventModel() === eventModel) count++;
                        break;
                    case LOG_TYPE_DEPLOY:
                    case LOG_TYPE_RECALL:
                    case LOG_TYPE_ORIGIN:
                        if (entry.event === eventModel) count++;
                        break;
                }
            }
            return count;
        }
    });
})(tc);
