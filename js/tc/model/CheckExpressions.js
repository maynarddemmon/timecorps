(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {min:mathMin, max:mathMax, abs:mathAbs, round:mathRound} = Math,
        isFiniteNumber = Number.isFinite,
        
        {
            SCOPE_SKILLS, SCOPE_AGENT, SCOPE_EVENT, SCOPE_TIMELINE, SCOPE_SCRATCH, SCOPE_EVENTS, 
            SCOPE_AGENTS, SCOPE_FACTIONS, SCOPE_OPERATIONS, SCOPE_PLAYER,
            rng:{roll},
            cfg:{MAX_SKILL_EASE, MIN_SKILL_EASE, CHECK_EXPR_SHOW_DIE_ROLL, DIE_SIZE},
            theme:{colorSuccess, colorError, colorMegaDark},
            ICON_SEPARATOR
        } = pkg,
        
        PARAM_DIFFICULTY = 'difficulty',
        
        // A difficulty in the data that skips the roll, so the check always succeeds. It's
        // stored as DIFFICULTY_NO_ROLL_THRESHOLD, or any difficulty at or below it.
        DIFFICULTY_NO_ROLL = 'no-roll',
        DIFFICULTY_NO_ROLL_THRESHOLD = -999999,
        
        // Die Rolling /////////////////////////////////////////////////////////
        /*  Cleans up the sides and count the die function in an expression uses. Sides and count 
            will be converted to integers of at least 1, and count is capped at 99.
            Returns an Array with [sides, count] or throws an Error. */
        cleanDice = (sides, count) => {
            if (isFiniteNumber(sides)) {
                if (isFiniteNumber(count)) {
                    return [
                        // At least 1 side
                        mathMax(1, mathRound(sides)),
                        
                        // We place an arbitrary upper limit of 99 on the count to prevent 
                        // exceptionally high die counts.
                        mathMin(99, mathMax(1, mathRound(count)))
                    ];
                } else {
                    throw new RangeError('d(' + sides + ', ' + count + ') needs a number of dice');
                }
            } else {
                throw new RangeError('d(' + sides + ') needs a number of sides');
            }
        },
        
        // Rolls a die 1 or more times and returns the total.
        rollDie = (sides, count=1) => {
            [sides, count] = cleanDice(sides, count);
            let total = count; // Because roll() is 0-(sides-1).
            while (count--) total += roll(sides);
            return total;
        },
        
        /*  The dice's average total. Used for working out an ease without rolling. Success is 
            linear in the ease, so a check's chance at the average ease is its true chance, unless 
            the ease gets clamped. */
        averageDie = (sides, count=1) => {
            [sides, count] = cleanDice(sides, count);
            return count * (1 + sides) / 2;
        },
        
        /*  True if a check at this difficulty skips the roll and always succeeds. */
        isNumericNoRollDifficulty = difficulty => difficulty <= DIFFICULTY_NO_ROLL_THRESHOLD,
        
        
        // Expression Compilations /////////////////////////////////////////////
        /*  Compiled check functions by expression text. The parameters are the same for every
            check, so events that share an expression share one function. */
        COMPILED = new Map(),
        
        // Skills an agent doesn't have count as 0, so a check can name any skill without error.
        SKILLS_HANDLER = {
            get: (skills, key) => typeof key === 'string' ? (skills[key] ?? 0) : skills[key]
        },
        
        // The agent as an expression sees it: the AgentModel, except skills default to 0.
        AGENT_HANDLER = {
            get: (agentModel, key) => key === SCOPE_SKILLS ? new Proxy(agentModel.getSkills(), SKILLS_HANDLER) : agentModel[key]
        },
        
        AGENT_VIEWS = new WeakMap(),
        
        // Any agent by ID, as "agents.<id>", seen as the acting agent is.
        AGENTS_HANDLER = {
            get: (agentModels, key) => typeof key === 'string' ? getAgentView(agentModels[key]) : agentModels[key]
        },
        
        getAgentView = agentModel => {
            if (!agentModel) return agentModel;
            let view = AGENT_VIEWS.get(agentModel);
            if (!view) AGENT_VIEWS.set(agentModel, view = new Proxy(agentModel, AGENT_HANDLER));
            return view;
        },
        
        /*  What compile gives for an expression that doesn't compile. NaN makes every check
            with it fail, and evaluateExpr doesn't warn about it again. */
        NOT_COMPILED_FUNC = () => NaN,
        
        /*  Evaluates an expression with die as its d function, as whatever it gives. 
            undefined, with a warning, if it doesn't compile or throws. */
        evaluateRaw = (expr, {agent, event, difficulty=0, margin=0, chronal=0}, die) => {
            // Get the expression function or attempt to compile it.
            let func = COMPILED.get(expr);
            if (!func) {
                if (typeof expr !== 'string' || expr.trim() === '') {
                    console.warn('Expression does not compile (expression must be a non-empty string):', expr);
                    // Stands in for an expression that doesn't compile. It's cached like any 
                    // other, so the warning only happens once per expression.
                    func = NOT_COMPILED_FUNC;
                } else {
                    func = new Function(
                        SCOPE_AGENT,
                        SCOPE_AGENTS,
                        SCOPE_EVENT,
                        SCOPE_EVENTS,
                        SCOPE_TIMELINE,
                        SCOPE_SCRATCH,
                        SCOPE_FACTIONS,
                        SCOPE_OPERATIONS,
                        SCOPE_PLAYER,
                        PARAM_DIFFICULTY,
                        'd', // The die roll param.
                        'margin', // The margin of success param.
                        'chronal', // The chronal used param.
                        '"use strict";return(' + expr + ');'
                    );
                }
                COMPILED.set(expr, func);
            }
            
            // Execute the expression function.
            if (func !== NOT_COMPILED_FUNC) {
                try {
                    const rootModel = pkg.model;
                    return func(
                        getAgentView(agent),                                   // SCOPE_AGENT
                        new Proxy(rootModel.getAgentModels(), AGENTS_HANDLER), // SCOPE_AGENTS
                        event,                                                 // SCOPE_EVENT
                        rootModel.getEventModels(),                            // SCOPE_EVENTS
                        rootModel,                                             // SCOPE_TIMELINE
                        rootModel[SCOPE_SCRATCH],                              // SCOPE_SCRATCH
                        rootModel.getFactionModels(),                          // SCOPE_FACTIONS
                        rootModel.getOperationModels(),                        // SCOPE_OPERATIONS
                        getAgentView(rootModel.getPlayerAgentModel()),         // SCOPE_PLAYER
                        difficulty,                                            // PARAM_DIFFICULTY
                        die,                                                   // 'd'
                        margin,                                                // 'margin'
                        chronal                                                // 'chronal'
                    );
                } catch (err) {
                    console.warn('Check expression threw (' + err.message + '):', expr);
                }
            }
        },
        
        /*  Evaluates an expression with die as its d function, as a number: a boolean is 1
            or 0, and anything else is converted as Number() does. NaN, with a warning, if the
            expression throws or the result isn't a finite number, e.g. from a misspelled 
            property. */
        evaluateExpr = (expr, cfg, die) => {
            const value = evaluateRaw(expr, cfg, die);
            if (value !== undefined) {
                const number = Number(value);
                if (isFiniteNumber(number)) return number;
                
                console.warn('Check expression is not a finite number (' + value + '):', expr);
            }
            return NaN;
        },
        
        /*  Evaluates an expression to an ease, clamped to [minEase, maxEase], with die as the 
            expression's d function. NaN if the expression throws or isn't a finite number, 
            which fails any check. */
        evaluateEase = (expr, cfg, die) => {
            const {difficulty=0, maxEase=0, minEase=-DIE_SIZE} = cfg;
            
            // A no-roll check always succeeds, whatever the expression, and rolls no dice.
            if (isNumericNoRollDifficulty(difficulty)) return 0;
            
            return mathMax(minEase, mathMin(maxEase, evaluateExpr(expr, cfg, die))); // NaN stays NaN.
        },
        
        /*  The ease without rolling: any d(sides) counts as its average. */
        getSkillEase = (skillExpr, cfg) => evaluateEase(toSkillCheckExpr(skillExpr), toSkillCheckCfg(cfg), averageDie),
        
        
        /*  The expression for a skill check: (skillExpr) - difficulty. The parentheses keep an 
            expression using ||, ?: or comparisons from changing what difficulty is taken from. */
        toSkillCheckExpr = skillExpr => '(' + skillExpr + ')-' + PARAM_DIFFICULTY,
        
        /*  Skill checks always have at least a 0.1% chance of success and of failure, unless 
            the cfg says otherwise. */
        toSkillCheckCfg = cfg => ({maxEase:MAX_SKILL_EASE, minEase:MIN_SKILL_EASE, ...cfg}),
        
        /*  The average margin, roll + ease, of a check that passes or fails at this ease, for 
            working out an amount without rolling. Rolls run from 0 to DIE_SIZE - 1, so a pass 
            averages the passing results and a failure the failing ones. Meaningless for a result 
            that can't happen at that ease. */
        getAverageMargin = (ease, success) => {
            const lowestPassingRoll = mathMax(0, -ease);
            return success ? (lowestPassingRoll + DIE_SIZE - 1) / 2 + ease : (ease - 1) / 2;
        },
        
        /*  The ease phrase for an ease, by the lowest ease that earns it. The comment is the
            chance of success at that ease. */
        EASE_PHRASES = [
            [0,    i18n('ease-certain')],   // 100%
            [-1,   i18n('ease-ensured')],   // 99.9%
            [-99,  i18n('ease-trivial')],   // 90.1%
            [-199, i18n('ease-very-easy')], // 80.1%
            [-299, i18n('ease-easy')],      // 70.1%
            [-399, i18n('ease-fair')],      // 60.1%
            [-499, i18n('ease-even')],      // 50.1%
            [-599, i18n('ease-tough')],     // 40.1%
            [-699, i18n('ease-hard')],      // 30.1%
            [-799, i18n('ease-very-hard')], // 20.1%
            [-899, i18n('ease-brutal')],    // 10.1%
            [-999, i18n('ease-hopeless')]   // 0.1%
        ],
        
        /*  The phrase for an amount of damage, by the least damage that earns it. Against an 
            Agent's normal health of 100. */
        DAMAGE_PHRASES = [
            [150, i18n('damage-certain-death')],
            [100, i18n('damage-deadly-injury')],
            [75,  i18n('damage-crippling-injury')],
            [50,  i18n('damage-critical-injury')],
            [25,  i18n('damage-grievous-injury')],
            [15,  i18n('damage-severe-injury')],
            [10,  i18n('damage-serious-injury')],
            [5,   i18n('damage-moderate-injury')],
            [1,   i18n('damage-light-injury')]
        ],
        
        /*  Evaluates check expressions for checks such as investigating. An expression is plain 
            JavaScript that evaluates to an ease: the number added to a roll of 0 to 999, where a 
            result of 0 or more succeeds. It can use:
                agent - The AgentModel making the check. agent.skills.<id> is 0 for any skill the
                    agent doesn't have.
                event - The EventModel the check happens at.
                timeline - The root Model.
                scratch - The entries the data declares, e.g. "scratch.collision_lookoutWarned".
                difficulty - The check's difficulty.
                d(sides, count) - Rolls count dice, 1 by default, each a whole number from 1 to 
                    sides, and totals them, e.g. "agent.skills.str + d(12) - difficulty" or 
                    "d(6, 3)". Use d(13) - 1 for 0 to 12. Only a real check rolls. Working out 
                    the ease without rolling, e.g. for an ease phrase, uses the dice's average.
                    Sides and count are rounded, sides to at least 1 and count to 1 to 99.
                margin - For an amount, such as an adjustment's, the result of the check that decided
                    it: roll + ease, so 0 or more on a pass and negative on a failure. 0 if 
                    nothing was rolled. Working out an amount without rolling uses the average 
                    margin for a pass or a failure. 0 in a check expression itself.
                chronal - For a time travel hazard's amount, the chronal the time travel cost, 
                    e.g. "-d(chronal)". 0 anywhere else.
            For example the skill check "(agent.skills.deception)-difficulty" with skill 0 and 
            difficulty 500 has an ease of -500, a 50% chance, and each skill point adds 0.1%.
            
            An expression that doesn't compile, throws or isn't a number fails, with a warning. */
        CHECK = pkg.checks = {
            /*  Validates a difficulty value configured in the JSON and converts it to a
                numeric difficulty value. */
            validateDifficultyValue: (difficulty, warnFunc) => {
                if (Number.isInteger(difficulty) || difficulty === DIFFICULTY_NO_ROLL) {
                    return CHECK.toNumericDifficulty(difficulty);
                }
                warnFunc?.('difficulty must be an integer or "' + DIFFICULTY_NO_ROLL + '"');
            },
            
            /*  A difficulty from the data as a number, so DIFFICULTY_NO_ROLL becomes the 
                threshold. Anything else is returned as is. */
            toNumericDifficulty: v => v === DIFFICULTY_NO_ROLL ? DIFFICULTY_NO_ROLL_THRESHOLD : v,
            
            /*  The average margin of the check that decides it, for a pass or a failure: its own
                check, or else its action's. 0 if nothing is rolled, as for an exit without a check 
                of its own or a no-roll check. */
            getAverageMarginForAgent: (statAdjModel, agentModel, success) => {
                const decider = statAdjModel.hasOwnCheck() ? statAdjModel : (statAdjModel.owner.isGatedByActionSkillCheck() ? statAdjModel.owner : null);
                if (decider) {
                    const difficulty = decider.getActionSkillDifficulty();
                    if (!isNumericNoRollDifficulty(difficulty)) {
                        return getAverageMargin(
                            getSkillEase(decider.getActionSkillExpr(), {agent:agentModel, event:agentModel.getEventModel(), difficulty}), 
                            success
                        );
                    }
                }
                return 0;
            },
            
            /*  Evaluates an amount, such as damage, rolling any dice. The same parameters as a 
                check, but the result isn't an ease so it isn't clamped. NaN, with a warning, if 
                the expression throws or isn't a number. */
            rollAmount: (expr, cfg={}) => evaluateExpr(expr, cfg, rollDie),
            
            /*  An amount without rolling: any d(sides) counts as its average. */
            getAverageAmount: (expr, cfg={}) => evaluateExpr(expr, cfg, averageDie),
            
            /*  Evaluates an expression for whatever it gives, e.g. a boolean or a string, 
                rolling any dice. The same parameters as a check. undefined, with a warning, if 
                it doesn't compile or throws. */
            rollValue: (expr, cfg={}) => evaluateRaw(expr, cfg, rollDie),
            
            /*  Evaluates a condition, such as whether an action is available, with the same
                parameters as a check. Nothing is rolled: any d(sides) counts as its average.
                A boolean is the usual result, and a number counts as true unless it's 0. A 
                broken condition is false, with evaluateExpr's warning, so it shows up rather
                than quietly allowing everything. */
            isTrue: (expr, cfg={}) => !!CHECK.getAverageAmount(expr, cfg),
            
            /*  Rolls and evaluates against cfg {agent, event, difficulty, maxEase, minEase}. 
                Returns {success, result, roll, difficulty, ease} where result is roll + ease. A
                no-roll check doesn't roll, so its roll is null and its result is 0. Any dice in
                the expression are rolled first, then the check's roll. */
            skill: (skillExpr, cfg) => {
                cfg = toSkillCheckCfg(cfg);
                const difficulty = cfg.difficulty ?? 0,
                    ease = evaluateEase(toSkillCheckExpr(skillExpr), cfg, rollDie),
                    dieRoll = isNumericNoRollDifficulty(difficulty) ? null : roll(),
                    result = (dieRoll ?? 0) + ease;
                return {
                    success:result >= 0, 
                    result, 
                    roll:dieRoll, 
                    difficulty, 
                    ease
                };
            },
            
            /*  Describes how likely a skill check is to succeed, without 
                rolling, e.g. 'easy' or 'toss-up'. */
            getEasePhrase: (skillExpr, cfg) => {
                const ease = getSkillEase(skillExpr, cfg);
                return EASE_PHRASES.find(([minEase]) => ease >= minEase)?.[1] ?? i18n('ease-impossible');
            },
            
            /*  Describes an amount of damage, e.g. 'light' or 'deadly'. */
            toDamagePhrase: damage => DAMAGE_PHRASES.find(([minDamage]) => damage >= minDamage)?.[1] ?? i18n('damage-harmless'),
            
            showFloatingTextForSkillCheck: (btnView, checkResult) => {
                if (btnView && checkResult) {
                    const {success, roll, ease, adjustments=[]} = checkResult,
                        // A no-roll check has no margin or roll to show.
                        text = (roll == null ? i18n('check-succeeded') : 
                            i18n(success ? 'check-succeeded-by' : 'check-failed-by', pkg.cleanToFixed(mathAbs(roll + ease))) + (CHECK_EXPR_SHOW_DIE_ROLL ? ICON_SEPARATOR + '⚅' + roll : '')) +
                            // What any adjustments changed, e.g. "Failed by 120 · -7♥ · +2⥁".
                            adjustments.filter(adjustment => adjustment.amount && adjustment.shown !== false).map(adjustment => ICON_SEPARATOR + pkg.formatStatAdj(adjustment.statId, adjustment.amount)).join('');
                    pkg.showFloatingTextAboveView(
                        btnView, 
                        text, 
                        {
                            bgColor:success ? colorSuccess : colorError,
                            textColor:colorMegaDark
                        }
                    );
                }
            }
        };
})(tc);
