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
                AGENT_DEFAULT_CHRONAL, AGENT_CHRONAL_LIMIT, 
                AGENT_DEFAULT_PARADOX, AGENT_PARADOX_LIMIT, 
                AGENT_DEFAULT_HEALTH, AGENT_HEALTH_LIMIT,
                SCORE_PER_ATTESTATION, PARADOX_SCORE_MULTIPLIER, MAX_SKILL_VALUE
            },
            theme:{colorAction, fontFamilyMono},
            checks:{rollValue, skill, getSkillEase, getEasePhrase, rollAmount, getAverageAmount, getAverageMargin, toDamagePhrase, showFloatingTextForSkillCheck},
            isNoRollDifficulty,
            ICON_HQ, ICON_SEPARATOR, ICON_HEALTH, ICON_APPROX,
            STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HEALTH, STAT_ID_ATTESTATION,
            SKILL_ID_INVESTIGATION, SKILL_ID_CHRONOGATION,
            SCOPE_AGENT, SCOPE_EVENT, SCOPE_SKILLS, SCOPE_SCRATCH, CHECK_SKILL_EXPR_PREFIX,
            getStatName
        } = pkg,
        
        AGENT_STAT_IDS = [STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HEALTH],
        
        // An action's set key that names a scratch entry, e.g. "scratch.collision_lookoutWarned".
        SCRATCH_PREFIX = SCOPE_SCRATCH + '.',
        
        LOG_TYPE_ORIGIN = 'origin',
        LOG_TYPE_DEPLOY = 'deploy',
        LOG_TYPE_RECALL = 'recall',
        LOG_TYPE_EXIT = 'exit',
        LOG_TYPE_ACTION = 'action',
        LOG_TYPE_DEVOURED = 'devoured',
        
        /*  The flooded Event, if any, that keeps the Agent from time traveling to eventModel:
            the one they'd leave, or the one they'd arrive at. null if neither is flooded. */
        getFloodedEventBlockingTravel = (agentModel, eventModel) => {
            const from = agentModel.getEventModel();
            if (from?.isFlooded()) return from;
            if (eventModel?.isFlooded()) return eventModel;
            return null;
        },
        isFloodedEventNotBlockingTravel = (agentModel, eventModel) => getFloodedEventBlockingTravel(agentModel, eventModel) == null,
        
        getInfoForTimeTravel = (agentModel, eventModel) => {
            const isHQ = eventModel.isHQ(),
                chronalNeeded = isHQ ? pkg.getChronalToRecall(agentModel) : pkg.getChronalToDeploy(agentModel, eventModel),
                chronalAvailable = -agentModel[STAT_ID_CHRONAL].getValueToMin(),
                hasEnoughChronal = chronalNeeded <= chronalAvailable,
                paradoxCost = agentModel.calculateParadoxForEntry(eventModel),
                agentRisksPhrase = pkg.formatAgentRisks(chronalNeeded, paradoxCost),
                floodedEventModel = getFloodedEventBlockingTravel(agentModel, eventModel);
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
            
            if (floodedEventModel) disabled = true;
            const tooltip = floodedEventModel ? floodedEventModel.name + ' is flooded with paradox. No one can time travel into or out of it.' : '';
            
            if (agentModel.isDead()) visible = false;
            
            return {disabled, text, tooltip, visible};
        },
        
        getCheckCfg = (agentModel, difficulty) => ({agent:agentModel, event:agentModel.getEventModel(), difficulty}),
        
        /*  The difficulty an adjustment's amount expression sees: its own check's, or else the
            action's or exit's. */
        getAdjustmentDifficulty = adjustmentModel => (adjustmentModel.hasOwnCheck() ? adjustmentModel : adjustmentModel.owner).getActionSkillDifficulty(),
        
        /*  An adjustment's amount for when its check passes or fails, given that check's margin: 
            rolled, or its average. Undefined if nothing happens in that case. */
        getAdjustmentAmount = (agentModel, adjustmentModel, success, amountFunc, margin) => {
            const expr = adjustmentModel.getAmountExpr(success);
            return expr ? amountFunc(expr, {...getCheckCfg(agentModel, getAdjustmentDifficulty(adjustmentModel)), margin}) : undefined;
        },
        
        /*  The average margin of the check that decides an adjustment, for a pass or a failure: 
            its own check, or else its action's. 0 if nothing is rolled, as for an exit without 
            a check of its own or a no-roll check. */
        getAverageAdjustmentMargin = (agentModel, adjustmentModel, success) => {
            const decider = adjustmentModel.hasOwnCheck() ? adjustmentModel : (adjustmentModel.owner.isGatedByActionSkillCheck() ? adjustmentModel.owner : null);
            if (!decider) return 0;
            
            const difficulty = decider.getActionSkillDifficulty();
            if (isNoRollDifficulty(difficulty)) return 0;
            return getAverageMargin(agentModel.getSkillExpressionEase(decider.getActionSkillExpr(), difficulty), success);
        },
        
        /*  An adjustment's average amount for a pass or a failure, without rolling. */
        getAverageAdjustmentAmount = (agentModel, adjustmentModel, success) => getAdjustmentAmount(
            agentModel, adjustmentModel, success, getAverageAmount, getAverageAdjustmentMargin(agentModel, adjustmentModel, success)
        ),
        
        isHealthAdjustment = adjustmentModel => adjustmentModel.scopeName === SCOPE_AGENT && adjustmentModel.statId === STAT_ID_HEALTH,
        
        /*  Names the stat an adjustment changes, e.g. "Health" or "Event Attestation". */
        describeAdjustmentStat = adjustmentModel => {
            const name = getStatName(adjustmentModel.statId);
            switch (adjustmentModel.scopeName) {
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
        
        /*  What the next purchase of an Agent's skill gets and costs: {points, credits}. One 
            credit for one point. Kept on its own so the pricing can be tuned. */
        getSkillPurchase = pkg.getSkillPurchase = (_agentModel, _skillId) => ({points:1, credits:1}),
        
        accrueEntryParadox = (agentModel, eventModelOrId) => {
            const paradox = agentModel.calculateParadoxForEntry(eventModelOrId, 1); // 1 because we will have just pushed an entry event of some kind onto the log.
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
                notifyTargets:self, id:STAT_ID_PARADOX,
                absMin:0, min:0, value:AGENT_DEFAULT_PARADOX, max:AGENT_PARADOX_LIMIT
            }, [{
                // Reaching the limit, however it happens, gets the Agent devoured.
                triggerValueAtMax: function() {
                    this.callSuper();
                    self.setDevoured(true);
                }
            }]);
            
            self[STAT_ID_CHRONAL] = new NotifyingNumericStatModel({
                notifyTargets:self, id:STAT_ID_CHRONAL,
                absMin:0, min:0, value:AGENT_DEFAULT_CHRONAL, max:AGENT_CHRONAL_LIMIT
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
        
        /*  Used by instantiation only. Takes a value, or {value, max} where the value defaults
            to the max. */
        setParadox: function(v) {
            if (this.inited) {
                console.warn('AgentModel.setParadox after init', this);
            } else {
                const statParadox = this[STAT_ID_PARADOX];
                if (typeof v === 'number') {
                    statParadox.setValue(v);
                } else if (v) {
                    if (v.max != null) statParadox.setMax(v.max);
                    statParadox.setValue(v.value ?? statParadox.getMin());
                }
            }
        },
        
        /*  Used by instantiation only. Takes a value, or {value, max} where the value defaults
            to the max. */
        setChronal: function(v) {
            if (this.inited) {
                console.warn('AgentModel.setChronal after init', this);
            } else {
                const statChronal = this[STAT_ID_CHRONAL];
                if (typeof v === 'number') {
                    statChronal.setValue(v);
                } else if (v) {
                    if (v.max != null) statChronal.setMax(v.max);
                    statChronal.setValue(v.value ?? statChronal.getMax());
                }
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
                
                this.tryToOpenEventBrief();
            }
        },
        
        /*  The first time a known agent is at a known Event, whether by entering it or by
            either of them being revealed, the Event is marked visited and, if the player 
            wants, its brief opens. */
        tryToOpenEventBrief: function() {
            const eventModel = this.getEventModel();
            if (
                eventModel?.isRegularEvent() && eventModel.isNotHidden() && 
                this.isNotHidden() && !eventModel.hasBeenVisited()
            ) {
                eventModel.setBeenVisited(true);
                if (pkg.settings.get(pkg.SETTING_OPEN_EVENT_BRIEF_ON_FIRST_ENTRY)) {
                    pkg.app.openEventBrief(eventModel);
                }
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
                this.tryToOpenEventBrief();
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
        
        /*  A skill as an adjustment sees a stat: it can change within ±MAX_SKILL_VALUE. */
        getSkillStat: function(skillId) {
            // This provides a Stat like interface to a skill for purposes of modification.
            const agentModel = this;
            return {
                get value() {return agentModel.getSkill(skillId);},
                getAllowedAdj: adj => {
                    const value = agentModel.getSkill(skillId),
                        newValue = mathMin(MAX_SKILL_VALUE, mathMax(-MAX_SKILL_VALUE, value + adj));
                    return {adj:newValue - value};
                },
                adjValue: adj => {
                    agentModel[SCOPE_SKILLS] = {...agentModel[SCOPE_SKILLS], [skillId]:agentModel.getSkill(skillId) + adj};
                    agentModel.notifyCollectionOfUpdate();
                }
            };
        },
        getSkillChronogation: function() {return this.getSkill(SKILL_ID_CHRONOGATION);},
        getSkillInvestigation: function() {return this.getSkill(SKILL_ID_INVESTIGATION);},
        
        /*  Why the Agent can't buy the next purchase of a skill now, e.g. "Only at HQ", or 
            null if they can. */
        getSkillPurchaseProblem: function(skillId) {
            if (!pkg.isSkillId(skillId)) return 'No such skill';
            if (!this.isPlayerControlled()) return 'Not under Time Corps control';
            if (this.isDead()) return 'Deceased';
            if (!this.isAtHQ()) return 'Only at HQ';
            
            const {points, credits} = getSkillPurchase(this, skillId);
            if (this.getSkill(skillId) + points > MAX_SKILL_VALUE) return 'At its maximum';
            if (credits > pkg.model.getCredits()) return 'Not enough credits';
            return null;
        },
        canPurchaseSkill: function(skillId) {return this.getSkillPurchaseProblem(skillId) == null;},
        
        /*  Spends credits to raise a skill, by getSkillPurchase. Returns true if it was bought. */
        purchaseSkill: function(skillId) {
            if (!this.canPurchaseSkill(skillId)) return false;
            
            const {points, credits} = getSkillPurchase(this, skillId);
            pkg.model.adjCredits(-credits);
            this[SCOPE_SKILLS] = {...this[SCOPE_SKILLS], [skillId]:this.getSkill(skillId) + points};
            this.notifyCollectionOfUpdate();
            return true;
        },
        
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
        selectRow: function() {
            pkg.app.selectAgentRow(this);
        },
        
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
        
        /*  The exit the Agent can take from its current Event to eventModel, or undefined if 
            there's none. As in the Agent's list of exits, hidden exits and exits to hidden 
            Events don't count. */
        getExitTo: function(eventModel) {
            if (eventModel?.isNotHidden()) {
                const currentEventModel = this.getEventModel();
                if (eventModel !== currentEventModel) {
                    return currentEventModel.getExitModels().find(
                        exitModel => exitModel.isNotHidden() && exitModel.getToEventModel() === eventModel
                    );
                }
            }
        },
        
        doDeployToEvent: function(eventModel, isRecall) {
            if (eventModel && this.isNotDead()) {
                if (isFloodedEventNotBlockingTravel(this, eventModel)) {
                    const cost = isRecall ? pkg.getChronalToRecall(this) : pkg.getChronalToDeploy(this, eventModel);
                    if (cost <= -this[STAT_ID_CHRONAL].getValueToMin()) {
                        this[STAT_ID_CHRONAL].adjValue(-cost);
                        this.setEvent_Hard(
                            eventModel.id, 
                            {type:isRecall ? LOG_TYPE_RECALL : LOG_TYPE_DEPLOY, event:eventModel}
                        );
                        pkg.app.selectEventBox(eventModel);
                    } else {
                        console.warn('insufficent chronal to ' + (isRecall ? 'recall' : 'deploy'));
                    }
                } else {
                    console.warn('Cannot time travel into or out of a flooded Event');
                }
            } else {
                console.warn('doDeployToEvent: no eventModel');
            }
        },
        doRecallToHQ: function() {
            this.doDeployToEvent(pkg.model.getHQEventModel(), true);
        },
        doFollowExit: function(exitModel, btnView) {
            if (this.isNotDead() && this.getEventModel() === exitModel.event) {
                const toEvent = exitModel.getToEventModel();
                if (toEvent) {
                    // Taking the exit always succeeds, but its adjustments may change things on 
                    // the way, e.g. hurt. The result is shown before the adjustments apply since 
                    // that can rebuild the views, btnView included. The first adjustment with its 
                    // own check gives the result.
                    const costs = this.getCostsFor(exitModel);
                    if (costs.every(cost => cost.canPay)) {
                        const adjustments = this.rollAdjustmentsFor(exitModel),
                            logEntry = {type:LOG_TYPE_EXIT, exit:exitModel};
                        // Most exits are free, so only those with costs record them.
                        if (costs.length > 0) this.payCosts(costs, logEntry);
                        if (adjustments.length > 0) {
                            const shownCheck = adjustments.find(adjustment => adjustment.check)?.check ?? {success:true, roll:null};
                            showFloatingTextForSkillCheck(btnView, {...shownCheck, adjustments});
                            this.applyAdjustments(adjustments, logEntry);
                        }
                        
                        this.setEvent(toEvent.id, logEntry);
                        pkg.app.selectEventBox(toEvent);
                    }
                }
            } else {
                console.warn('Agent not at event for exit:', exitModel, this);
            }
        },
        
        doAction: function(actionModel, btnView) {
            if (this.isDead()) return;
            
            const eventModel = this.getEventModel(),
                {setObj, event} = actionModel;
            
            if (eventModel !== event) {
                console.warn('Agent not in same event as action.', actionModel, this);
                return;
            }
            
            if (this.isActionBlockedByFlood(actionModel)) {
                console.warn('Cannot take an action that could generate paradox in a flooded Event');
                return;
            }
            
            // Don't proceed with an action this Agent doesn't have available or can't pay for.
            // The costs are worked out before anything changes, since they may depend on it.
            const costs = this.getCostsFor(actionModel);
            if (actionModel.isAvailableFor(this) && costs.every(cost => cost.canPay)) {
                // A failed check still pays the costs.
                const check = this.checkSkillExpression(
                        actionModel.getActionSkillExpr(),
                        actionModel.getActionSkillDifficulty()
                    ),
                    adjustments = this.rollAdjustmentsFor(actionModel, check),
                    logEntry = {type:LOG_TYPE_ACTION, action:actionModel, success:check.success};
                
                // Now show floating panel, with the adjustments so there's only one. (must be before 
                // anything that triggers a rerender of EventDetails such as paying the costs or
                // applying the adjustments, since that destroys the btnView)
                showFloatingTextForSkillCheck(btnView, {...check, adjustments});
                
                this.payCosts(costs, logEntry);
                this.applyAdjustments(adjustments, logEntry);
                
                // After the adjustments are worked out, so they see the count before this is applied.
                actionModel.setAttemptCount(actionModel.getAttemptCount() + 1);
                
                // A string entry sets on success. An {onSuccess, onFailure} entry sets for 
                // either result, worked out once now. See EventActionModel.setSet.
                const success = check.success,
                    rollCfg = {...getCheckCfg(this, actionModel.getActionSkillDifficulty()), margin:check.result ?? 0};
                for (const key in setObj) {
                    const cfg = setObj[key],
                        isPerResult = typeof cfg === 'object',
                        expr = isPerResult ? (success ? cfg.onSuccess : cfg.onFailure) : (success ? cfg : undefined);
                    if (expr === undefined) continue;
                    
                    const parsedKey = pkg.parseChangeKey(key);
                    if (key.startsWith(SCRATCH_PREFIX)) {
                        // Worked out once, now, rather than kept up to date like a Causator,
                        // so "scratch.x + 1" counts. Dice roll.
                        const result = rollValue(expr, rollCfg);
                        if (result !== undefined) pkg.model.setScratch(key.slice(SCRATCH_PREFIX.length), result);
                    } else if (parsedKey.kind === 'stat' || parsedKey.kind === 'skill') {
                        // Worked out once, now, and set within the stat's limits, by adjusting it
                        // so the stat's own rules apply, e.g. reaching a paradox limit.
                        const result = rollValue(expr, rollCfg),
                            target = pkg.getChangeTarget(parsedKey, this, event);
                        if (target && Number.isFinite(result)) {
                            const adj = target.getAllowedAdj(mathRound(result) - target.value).adj;
                            if (adj) {
                                target.adjValue(adj);
                                if (parsedKey.scopeName === SCOPE_EVENT && parsedKey.statId === STAT_ID_ATTESTATION) pkg.model.adjScore(adj * SCORE_PER_ATTESTATION);
                            }
                        }
                    } else {
                        const eventValueModel = event.values[key];
                        if (!eventValueModel) {
                            console.warn('Missing Value in doIt:' + key);
                        } else if (isPerResult) {
                            // Set as a literal, so it stays what it was worked out to be.
                            const result = rollValue(expr, rollCfg);
                            if (result !== undefined) eventValueModel.setValueByAction(JSON.stringify(result));
                        } else {
                            eventValueModel.setValueByAction(expr);
                        }
                    }
                }
                
                if (success) actionModel.setDoneCount(actionModel.getDoneCount() + 1);
                this.pushOntoLog(logEntry);
            }
        },
        
        
        // Paradox //
        calculateParadoxForEntry: function(eventModelOrId, permittedVisitCount=0) {
            const eventModel = typeof eventModelOrId === 'string' ? pkg.model.getEventModel(eventModelOrId) : eventModelOrId;
            if (eventModel) {
                // Paradox is only to enter regular events.
                if (eventModel.isRegularEvent()) {
                    // More paradox the more times the Agent has already visited the Event.
                    return this.countVisitsToEvent(eventModel) - permittedVisitCount;
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
        isNotDevoured: function() {return !this.isDevoured();},
        
        
        // Costs //
        /*  Works out what taking an action would cost the agent now. Returns an Array of
            {cost, key, amount, canPay} where amount is in whole points, or NaN if its
            expression is broken, which can't be paid. */
        getCostsFor: function(actionModel) {
            return actionModel.getCosts().map(costModel => {
                const amount = costModel.getAmount(this);
                return {cost:costModel, key:costModel.key, amount, canPay:costModel.canPay(this, amount)};
            });
        },
        
        /*  Whether the agent can pay all of an action's costs. The dead can't pay anything. */
        canPayCostsFor: function(actionModel) {
            return this.isNotDead() && this.getCostsFor(actionModel).every(cost => cost.canPay);
        },
        
        /*  Pays costs from getCostsFor and records them on the log entry by key. */
        payCosts: function(costs, logEntry) {
            const logged = logEntry.costs = {};
            let usedAction = false;
            for (const {cost, key, amount} of costs) {
                logged[key] = amount;
                cost.pay(this, amount);
                if (cost.isActionCost() && amount > 0) usedAction = true;
            }
            
            // Using an action updates the Event's view, so make sure something does when an
            // action is free.
            if (!usedAction) this.getEventModel()?.notifyCollectionOfUpdate();
        },
        
        /*  Describes an action's costs, e.g. "Costs: 2 Actions, 100 Score", or an empty string
            if it only costs the usual one action. A cost the agent can't pay says so, and an
            action that uses no action says that. */
        getCostsPhrase: function(actionModel) {
            const parts = [];
            // Exits cost no action by default, so only an action says when it uses none.
            let actionCost = actionModel.isGatedByActionSkillCheck() ? 0 : null;
            for (const {cost, amount, canPay} of this.getCostsFor(actionModel)) {
                if (cost.isActionCost()) {
                    actionCost = amount;
                    if (amount === 1 && canPay) continue;
                }
                if (amount !== 0) parts.push((Number.isFinite(amount) ? amount : '?') + ' ' + cost.getName(amount) + (canPay ? '' : " (can't pay)"));
            }
            const phrases = [];
            if (actionCost === 0) phrases.push('Uses no action');
            if (parts.length > 0) phrases.push('Costs: ' + parts.join(', '));
            return phrases.join(ICON_SEPARATOR);
        },
        
        
        // Adjustments //
        /*  Describes the adjustments of an action or exit, or an empty string if it has none. Each
            gives its average amounts without rolling, then its own check if it has one. Harm 
            to the agent's health reads as injury, e.g. 
            "♥ Risking: deadly injury (light injury if passed) · Athletic / even", and anything 
            else as amounts, e.g. "Event Attestation: ~+5 if passed, ~-2 if failed". */
        getAdjustmentsPhrase: function(ownerModel) {
            return ownerModel.getAdjustments().filter(adjustmentModel => adjustmentModel.isShown()).map(adjustmentModel => {
                const failAmount = getAverageAdjustmentAmount(this, adjustmentModel, false),
                    passAmount = getAverageAdjustmentAmount(this, adjustmentModel, true);
                let phrase;
                if (isHealthAdjustment(adjustmentModel) && mathMin(failAmount ?? 0, passAmount ?? 0) < 0) {
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
                    phrase = describeAdjustmentStat(adjustmentModel) + ': ' + parts.join(', ');
                }
                
                if (adjustmentModel.hasOwnCheck()) {
                    const name = adjustmentModel.getActionSkillName();
                    phrase += ICON_SEPARATOR + (name ? name + ' / ' : '') + this.getSkillEasePhrase(adjustmentModel.getActionSkillExpr(), adjustmentModel.getActionSkillDifficulty());
                }
                return phrase;
            }).join(ICON_SEPARATOR);
        },
        
        /*  True if an action or exit could, on average, change a stat with this ID, whoever
            has it: the agent, the Event or the timeline. That's by an adjustment, or for an action
            by a cost. A broken amount (NaN) doesn't count. */
        hasStatChangeFor: function(ownerModel, statId) {
            return ownerModel.getAdjustments().some(adjustmentModel => adjustmentModel.statId === statId && 
                [true, false].some(success => {
                    const amount = getAverageAdjustmentAmount(this, adjustmentModel, success);
                    return Number.isFinite(amount) && amount !== 0;
                })
            ) || (ownerModel.getCosts?.() ?? []).some(costModel => costModel.statId === statId && costModel.getAmount(this) > 0);
        },
        /*  True if taking an action could raise anyone's paradox: an adjustment that adds to an 
            agent's, Event's or the timeline's paradox, on average, if the check passes or if it
            fails, or a cost paid in paradox. */
        canGenerateParadoxFor: function(actionModel) {
            return actionModel.getAdjustments().some(adjustmentModel => adjustmentModel.statId === STAT_ID_PARADOX &&
                [true, false].some(success => getAverageAdjustmentAmount(this, adjustmentModel, success) > 0)
            ) || actionModel.getCosts().some(costModel => costModel.statId === STAT_ID_PARADOX && costModel.getAmount(this) > 0);
        },
        
        /*  True if the action's Event is flooded and the action could generate paradox, which
            isn't allowed there. */
        isActionBlockedByFlood: function(actionModel) {
            return !!actionModel.event?.isFlooded() && this.canGenerateParadoxFor(actionModel);
        },
        
        hasHealthChangeRiskFor: function(ownerModel) {return this.hasStatChangeFor(ownerModel, STAT_ID_HEALTH);},
        hasChronalChangeRiskFor: function(ownerModel) {return this.hasStatChangeFor(ownerModel, STAT_ID_CHRONAL);},
        hasParadoxChangeRiskFor: function(ownerModel) {return this.hasStatChangeFor(ownerModel, STAT_ID_PARADOX);},
        
        /*  Rolls the adjustments of an action or exit that apply, given the action's own check if 
            it has one. Doesn't apply them. Returns an Array of 
            {adjustment, key, statId, stat, amount, check} where amount is what the stat will 
            actually change by, in whole points within its limits, and check is the adjustment's 
            own check if it has one. An adjustment with nothing to do in its case is left out, 
            unless it rolled its own check. */
        rollAdjustmentsFor: function(ownerModel, actionCheck) {
            const results = [];
            for (const adjustmentModel of ownerModel.getAdjustments()) {
                if (!adjustmentModel.appliesFor(actionCheck)) continue;
                
                const check = adjustmentModel.hasOwnCheck() ? this.checkSkillExpression(adjustmentModel.getActionSkillExpr(), adjustmentModel.getActionSkillDifficulty()) : null,
                    // Without its own check an adjustment follows the action, and an exit succeeds.
                    // The margin is that of whichever check decided it, or 0 if none.
                    decidingCheck = check ?? actionCheck,
                    success = decidingCheck ? decidingCheck.success : true,
                    amount = getAdjustmentAmount(this, adjustmentModel, success, rollAmount, decidingCheck?.result ?? 0);
                if (amount === undefined && !check) continue;
                
                // A broken expression (NaN) does nothing. || 0 so it's never -0.
                const stat = adjustmentModel.getStat(this),
                    adj = (stat && Number.isFinite(amount) ? stat.getAllowedAdj(mathRound(amount)).adj : 0) || 0;
                results.push({adjustment:adjustmentModel, key:adjustmentModel.key, statId:adjustmentModel.statId, stat, amount:adj, check, shown:adjustmentModel.isShown()});
            }
            return results;
        },
        
        /*  Applies rolled adjustments and records them on the log entry by key. */
        applyAdjustments: function(adjustments, logEntry) {
            if (adjustments.length === 0) return;
            
            const logged = logEntry.adj = {};
            for (const {adjustment, key, stat, amount} of adjustments) {
                logged[key] = amount;
                if (amount !== 0) {
                    stat.adjValue(amount);
                    
                    // An Event's attestation scores the same however it's gained, or lost.
                    if (adjustment.scopeName === SCOPE_EVENT && adjustment.statId === STAT_ID_ATTESTATION) {
                        pkg.model.adjScore(amount * SCORE_PER_ATTESTATION);
                    }
                }
            }
        },
        
        
        // Death //
        isDead: function() {return this[STAT_ID_HEALTH].isAtMinValue();},
        isNotDead: function() {return !this.isDead();},
        
        
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
