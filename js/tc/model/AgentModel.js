(pkg => {
    'use strict';
    
    // Monotonic counter used to order Agents by when they arrived at their current Event.
    let arrivalCounter = 0;
    
    const {max:mathMax, min:mathMin, round:mathRound, abs:mathAbs, floor:mathFloor} = Math,
        
        M = myt,
        
        {
            NotifyingNumericStatModel, getConstrainedValueCfg,
            cfg:{
                EVENT_ID_THE_VOID, EVENT_ID_TIME_CORPS_HQ, FACTION_ID_UNALIGNED, FACTION_ID_TIMECORPS,
                AGENT_DEFAULT_CHRONAL, AGENT_CHRONAL_LIMIT, 
                AGENT_DEFAULT_PARADOX, AGENT_PARADOX_LIMIT, 
                AGENT_DEFAULT_HEALTH, AGENT_HEALTH_LIMIT,
                AGENT_DEFAULT_AGE, AGE_MIN_EFFECTIVE,
                PARADOX_SCORE_MULTIPLIER, MAX_SKILL_VALUE
            },
            timeUtil:{MILLIS_PER_YEAR},
            theme:{colorAction, fontFamilyMono},
            checks:{skill, getSkillEase, getEasePhrase, toDamagePhrase, showFloatingTextForSkillCheck},
            ICON_HQ, ICON_SEPARATOR, ICON_HEALTH, ICON_APPROX,
            STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HEALTH,
            SKILL_ID_INVESTIGATION, SKILL_ID_CHRONOGATION,
            SCOPE_AGENT, SCOPE_SKILLS, CHECK_SKILL_EXPR_PREFIX
        } = pkg,
        
        AGENT_STAT_IDS = [STAT_ID_PARADOX, STAT_ID_CHRONAL, STAT_ID_HEALTH],
        
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
        
        /*  Whether, and at what cost, an agent can time travel to an Event: deploy from HQ,
            jump, loop back to the Event they're at, or be recalled to HQ. All the rules for 
            where an agent may time travel are here. Returns 
            {isHQ, chronalNeeded, paradoxCost, permitted, problem}, where permitted is false if
            it's not an option for them at all, and problem says why they can't go, whether 
            or not it's permitted, or is null if they can. */
        getTimeTravelInfo = (agentModel, eventModel) => {
            const isHQ = eventModel.isHQ(),
                chronalNeeded = isHQ ? pkg.getChronalToRecall(agentModel) : pkg.getChronalToDeploy(agentModel, eventModel),
                retval = {isHQ, chronalNeeded, paradoxCost:agentModel.calculateParadoxForEntry(eventModel), visible:false};
            
            // Not permitted: the dead go nowhere, looping back to an Event takes more 
            // chronogation the shorter it is, and only the Time Corps can go to HQ.
            if (agentModel.isDead()) {
                retval.problem = 'Deceased';
            } else if (agentModel.isAtEvent(eventModel) && agentModel.getSkill(SKILL_ID_CHRONOGATION) < pkg.getMinChronogationToLoopbackAtEvent(eventModel)) {
                retval.problem = 'Not enough chronogation to loop back here';
            } else if (isHQ && !agentModel.isInFaction(FACTION_ID_TIMECORPS)) {
                retval.problem = 'Only the Time Corps can go to HQ';
            } else {
                retval.visible = true;
                const floodedEventModel = getFloodedEventBlockingTravel(agentModel, eventModel);
                if (floodedEventModel) {
                    retval.problem = floodedEventModel.name + ' is flooded with paradox. No one can time travel into or out of it.';
                } else if (chronalNeeded > -agentModel[STAT_ID_CHRONAL].getValueToMin()) {
                    retval.problem = 'Not enough chronal';
                }
            }
            return retval;
        },
        
        getCheckCfg = (agentModel, difficulty) => ({agent:agentModel, event:agentModel.getEventModel(), difficulty}),
        
        /*  Applies rolled adjustments and records them on the log entry by key. */
        applyAdjustments = (adjustments, logEntry) => {
            if (adjustments.length > 0) {
                const logged = logEntry.adj = {};
                for (const {key, stat, amount} of adjustments) stat.adjValue(logged[key] = amount);
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
        
        /*  The Event a log entry put the agent in, or undefined for one that didn't, e.g. an
            action. */
        getEnteredEventModel = entry => {
            switch (entry.type) {
                case LOG_TYPE_EXIT: return entry.exit.getToEventModel();
                case LOG_TYPE_DEPLOY:
                case LOG_TYPE_RECALL:
                case LOG_TYPE_ORIGIN: return entry.event;
            }
        },
        
        /*  What the next purchase of an Agent's skill gets and costs: {points, credits}. One 
            credit for one point. Kept on its own so the pricing can be tuned. */
        getSkillPurchase = pkg.getSkillPurchase = (agentModel, skillId) => ({
            points:1, 
            // A credit for a point near 0, and one more for every 100 the skill is from 0.
            credits:1 + mathFloor(mathAbs(agentModel.getSkill(skillId)) / 100)
        }),
        
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
            self.faction = FACTION_ID_UNALIGNED;
            
            // The number of actions the Agent has executed in the EventModel they are currently in.
            self.actionExecCount = 0;
            
            // How much of the Event they're in the Agent has lived through, in milliseconds.
            self.timeLivedAtEvent = 0;
            
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
            
            // Worked out once the Agent is at their starting Event.
            const {age, effectiveAge} = attrs;
            delete attrs.age;
            delete attrs.effectiveAge;
            
            self.callSuper(attrs);
            
            self.initAges(age, effectiveAge);
        },
        
        /*  Ages are in years. The lived age starts as the data's "age", or AGENT_DEFAULT_AGE,
            and grows with every action and exit. The effective age is the body's: it grows as
            the lived age does, treatments wind it back, and it decides the Agent's maximum 
            health. It starts as the lived age unless the data gives an "effectiveAge". */
        initAges: function(age, effectiveAge) {
            const self = this;
            age ??= AGENT_DEFAULT_AGE;
            effectiveAge ??= age;
            
            self.set('age', age, true);
            self.healthMaxInPrime = self[STAT_ID_HEALTH].getMax();
            self.setEffectiveAge(effectiveAge);
        },
        
        getAsObj: function(cfg) {
            const retval = this.callSuper(cfg);
            for (const attrName of ['name','event','actionExecCount','hidden','playerControlled','faction']) {
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
        
        setBorn: function(born) {this.set('born', born, true);},
        
        /*  The lived age and effective age, in years. */
        getAge: function() {return this.age;},
        getEffectiveAge: function() {return this.effectiveAge;},
        setEffectiveAge: function(years) {
            if (this.effectiveAge !== years) {
                this.set('effectiveAge', years, true);
                
                // Declines from the prime, and reaching 0 kills.
                const statHealth = this[STAT_ID_HEALTH];
                statHealth.setMax(mathRound(this.healthMaxInPrime * pkg.getAgeHealthFactor(years)));
                
                if (this.inited) this.notifyCollectionOfUpdate();
            }
        },
        
        /*  How much of an adjustment to the effective age, in years, can apply: all of it, 
            except a treatment can't wind it back below AGE_MIN_EFFECTIVE. */
        getAllowedEffectiveAgeAdj: function(adj) {
            return adj >= 0 ? adj : mathMax(adj, mathMin(0, AGE_MIN_EFFECTIVE - this.effectiveAge));
        },
        adjEffectiveAge: function(adj) {
            this.setEffectiveAge(this.effectiveAge + this.getAllowedEffectiveAgeAdj(adj));
        },
        
        /*  Lives through the share of the Event that a number of its actions take: its 
            duration divided by its action limit, for each. Nothing in The Void. */
        liveThroughActions: function(actions) {
            const eventModel = this.getEventModel(),
                actionLimit = eventModel?.getActionLimit();
            if (actions > 0 && actionLimit > 0 && !eventModel.isTheVoid()) {
                this.liveThroughEvent(eventModel.getDuration() / actionLimit * actions);
            }
        },
        
        /*  Lives through some of the Agent's Event, in milliseconds, aging them by it. */
        liveThroughEvent: function(millis) {
            this.timeLivedAtEvent += millis;
            this.ageBy(millis);
        },
        
        /*  Ages the Agent by time they live through, in milliseconds: both ages grow. */
        ageBy: function(millis) {
            if (millis > 0 && this.isNotDead()) {
                const years = millis / MILLIS_PER_YEAR;
                this.set('age', this.age + years, true);
                this.setEffectiveAge(this.effectiveAge + years);
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
                this.timeLivedAtEvent = 0;
                this.stampArrival();
                this.notifyCollectionOfUpdate();
                
                this.pushOntoLog(logEntry ?? {type:LOG_TYPE_ORIGIN, event:this.getEventModel()});
                accrueEntryParadox(this, newEventModel);
                
                // An Event that allows no actions is lived through whole on arrival. Otherwise
                // each action lives through a share of it. See doAction.
                if (this.inited && newEventModel?.isRegularEvent() && newEventModel.getActionLimit() === 0) {
                    this.liveThroughEvent(newEventModel.getDuration());
                }
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
        
        /*  The ID of the one Faction the Agent is in. An unknown ID is warned about, and the 
            Agent is unaligned. */
        setFaction: function(factionId) {
            if (!pkg.model.getFactionModel(factionId)) {
                console.warn('Agent', this.id, 'has unknown faction', factionId, '(using ' + FACTION_ID_UNALIGNED + ')');
                factionId = FACTION_ID_UNALIGNED;
            }
            if (this.faction !== factionId) {
                this.set('faction', factionId, true);
                if (this.inited) this.notifyCollectionOfUpdate();
            }
        },
        getFaction: function() {return this.faction;},
        getFactionModel: function() {return pkg.model.getFactionModel(this.faction);},
        isInFaction: function(idOrModel) {
            const id = typeof idOrModel === 'string' ? idOrModel : idOrModel?.id;
            return id === this.getFaction();
        },
        
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
            if (!this.isPlayerControlled()) return 'Not taking direction from you';
            if (this.isDead()) return 'Deceased';
            if (!this.isAtHQ()) return 'Only at HQ';
            if (!this.canAct()) return 'No days left this visit';
            
            const {points, credits} = getSkillPurchase(this, skillId);
            if (this.getSkill(skillId) + points > MAX_SKILL_VALUE) return 'At its maximum';
            if (credits > pkg.model.getCredits()) return 'Not enough credits';
            return null;
        },
        
        /*  Spends credits, and an action of the Agent's time at HQ, to raise a skill, by 
            getSkillPurchase. Returns true if it was bought. */
        purchaseSkill: function(skillId) {
            // First check if there are any problems preventing purchase of a skill.
            if (this.getSkillPurchaseProblem(skillId) == null) {
                const {points, credits} = getSkillPurchase(this, skillId);
                pkg.model.adjCredits(-credits);
                this.setActionExecCount(this.getActionExecCount() + 1);
                this.liveThroughActions(1);
                this[SCOPE_SKILLS] = {...this[SCOPE_SKILLS], [skillId]:this.getSkill(skillId) + points};
                this.notifyCollectionOfUpdate();
                return true;
            }
            return false;
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
                faction:this.faction,
                [SCOPE_SKILLS]:{...this[SCOPE_SKILLS]},
                event:this.event,
                actionExecCount:this.actionExecCount,
                arrivalOrder:this.arrivalOrder,
                devoured:this.devoured,
                age:this.age,
                effectiveAge:this.effectiveAge,
                timeLivedAtEvent:this.timeLivedAtEvent,
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
            if ('faction' in obj) this.setFaction(obj.faction);
            
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
            
            // Set directly, since the saved health already has the maximum they give.
            if ('age' in obj) this.set('age', obj.age, true);
            if ('effectiveAge' in obj) this.set('effectiveAge', obj.effectiveAge, true);
            if ('timeLivedAtEvent' in obj) this.timeLivedAtEvent = obj.timeLivedAtEvent;
            
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
        
        updateBtnForTimeTravel: function(btn, destinationEventModel) {
            const {isHQ, chronalNeeded, paradoxCost, visible, problem} = getTimeTravelInfo(this, destinationEventModel);
            let text;
            if (isHQ) {
                text = 'Recall to ' + ICON_HQ;
            } else if (this.isAtHQ()) {
                text = 'Deploy to';
            } else if (this.isAtEvent(destinationEventModel)) {
                text = 'Loop back';
            } else {
                text = 'Jump to';
            }
            
            btn.callSetters({
                text:text + pkg.formatAgentRisks(chronalNeeded, paradoxCost),
                visible,
                disabled:problem != null,
                tooltip:problem
            });
        },
        
        /*  The exit the Agent can take from its current Event to eventModel, or undefined if 
            there's none. As in the Agent's list of exits, hidden exits and exits to hidden 
            Events don't count. */
        getExitTo: function(destinationEventModel) {
            if (destinationEventModel?.isNotHidden()) {
                const currentEventModel = this.getEventModel();
                if (destinationEventModel !== currentEventModel) {
                    return currentEventModel.getExitModels().find(
                        exitModel => exitModel.isNotHidden() && exitModel.getToEventModel() === destinationEventModel
                    );
                }
            }
        },
        
        /*  Time travels the Agent to an Event, if they can (see getTimeTravelInfo), paying the 
            chronal. To HQ it's a recall. */
        doDeployToEvent: function(destinationEventModel) {
            if (destinationEventModel) {
                const {isHQ, chronalNeeded, problem} = getTimeTravelInfo(this, destinationEventModel);
                if (problem == null) {
                    this[STAT_ID_CHRONAL].adjValue(-chronalNeeded);
                    this.setEvent_Hard(destinationEventModel.id, {type:isHQ ? LOG_TYPE_RECALL : LOG_TYPE_DEPLOY, event:destinationEventModel});
                    pkg.app.selectEventBox(destinationEventModel);
                } else {
                    console.warn('Cannot time travel', this.id, 'to', destinationEventModel.id + ':', problem);
                }
            } else {
                console.warn('doDeployToEvent: no eventModel');
            }
        },
        doRecallToHQ: function() {
            this.doDeployToEvent(pkg.model.getHQEventModel());
        },
        doFollowExit: function(exitModel, btnView) {
            const self = this;
            if (self.isNotDead() && self.getEventModel() === exitModel.event) {
                const toEvent = exitModel.getToEventModel();
                if (toEvent) {
                    // Taking the exit always succeeds, but its adjustments may change things on 
                    // the way, e.g. hurt. The result is shown before the adjustments apply since 
                    // that can rebuild the views, btnView included. The first adjustment with its 
                    // own check gives the result.
                    const costs = self.getCostsFor(exitModel);
                    if (costs.every(cost => cost.canPay)) {
                        const adjustments = exitModel.rollAdjustments(self),
                            logEntry = {type:LOG_TYPE_EXIT, exit:exitModel};
                        // Most exits are free, so only those with costs record them.
                        if (costs.length > 0) self.payCosts(costs, logEntry);
                        if (adjustments.length > 0) {
                            const shownCheck = adjustments.find(adjustment => adjustment.check)?.check ?? {success:true, roll:null};
                            showFloatingTextForSkillCheck(btnView, {...shownCheck, adjustments});
                            applyAdjustments(adjustments, logEntry);
                        }
                        
                        // Taking an exit always succeeds. Its sets apply before the agent 
                        // arrives, so one that reveals where it leads does so first.
                        exitModel.applySets(self, true, 0);
                        
                        exitModel.openPrompt(() => {
                            // Leaving by an exit lives through the rest of the Event, e.g. 
                            // its unused actions. Time travel from an Event doesn't.
                            const fromEvent = exitModel.event;
                            if (fromEvent.isRegularEvent()) self.ageBy(fromEvent.getDuration() - self.timeLivedAtEvent);
                            
                            // The time between leaving one Event and arriving at the next is
                            // lived through on the way, unless the exit is time travel.
                            if (!exitModel.isTimeTravel()) self.ageBy(toEvent.getStart() - fromEvent.getEnd());
                            self.setEvent(toEvent.id, logEntry);
                            pkg.app.selectEventBox(toEvent);
                        });
                    }
                }
            } else {
                console.warn('Agent not at event for exit:', exitModel, self);
            }
        },
        
        doAction: function(actionModel, btnView) {
            if (this.isDead()) return;
            
            if (this.getEventModel() !== actionModel.event) {
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
                    adjustments = actionModel.rollAdjustments(this, check),
                    logEntry = {type:LOG_TYPE_ACTION, action:actionModel, success:check.success};
                
                // Now show floating panel, with the adjustments so there's only one. (must be before 
                // anything that triggers a rerender of EventDetails such as paying the costs or
                // applying the adjustments, since that destroys the btnView)
                showFloatingTextForSkillCheck(btnView, {...check, adjustments});
                
                this.payCosts(costs, logEntry);
                applyAdjustments(adjustments, logEntry);
                
                // After the adjustments are worked out, so they see the count before this is applied.
                actionModel.setAttemptCount(actionModel.getAttemptCount() + 1);
                
                actionModel.applySets(this, check.success, check.result ?? 0);
                
                if (check.success) actionModel.setDoneCount(actionModel.getDoneCount() + 1);
                this.pushOntoLog(logEntry);
                
                // Each action spent lives through an equal share of the Event, so spending them
                // all lives through the whole of it. A free action takes no time.
                this.liveThroughActions(costs.find(({cost}) => cost.isActionCost())?.amount ?? 0);
                
                if (check.success) actionModel.openPrompt();
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
                const failAmount = adjustmentModel.getAvrgAmount(this, false),
                    passAmount = adjustmentModel.getAvrgAmount(this, true);
                let phrase;
                if (adjustmentModel.isHealth() && mathMin(failAmount ?? 0, passAmount ?? 0) < 0) {
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
                    phrase = adjustmentModel.getStatDescription() + ': ' + parts.join(', ');
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
                    const amount = adjustmentModel.getAvrgAmount(this, success);
                    return Number.isFinite(amount) && amount !== 0;
                })
            ) || (ownerModel.getCosts?.() ?? []).some(costModel => costModel.statId === statId && costModel.getAmount(this) > 0);
        },
        /*  True if taking an action could raise anyone's paradox: an adjustment that adds to an 
            agent's, Event's or the timeline's paradox, on average, if the check passes or if it
            fails, or a cost paid in paradox. */
        canGenerateParadoxFor: function(actionModel) {
            return actionModel.getAdjustments().some(adjustmentModel => adjustmentModel.statId === STAT_ID_PARADOX &&
                [true, false].some(success => adjustmentModel.getAvrgAmount(this, success) > 0)
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
        
        
        // Death //
        isDead: function() {return this[STAT_ID_HEALTH].isAtMinValue();},
        isNotDead: function() {return !this.isDead();},
        
        
        // Life and Log //
        pushOntoLog: function(logEntry) {this.log.push(logEntry);},
        getLog: function() {return this.log;},
        countVisitsToEvent: function(eventModel) {
            return this.getLog().filter(entry => getEnteredEventModel(entry) === eventModel).length;
        },
        
        /*  The Events the Agent has entered, in the order they entered them, with an Event 
            entered again listed again. */
        getVisitHistory: function() {
            return this.getLog().map(getEnteredEventModel).filter(eventModel => eventModel != null);
        }
    });
})(tc);
