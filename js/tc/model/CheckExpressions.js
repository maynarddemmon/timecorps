(pkg => {
    'use strict';
    
    const {min:mathMin, max:mathMax, abs:mathAbs, round:mathRound} = Math,
        
        {
            SCOPE_SKILLS, SCOPE_AGENT, SCOPE_EVENT, SCOPE_TIMELINE,
            rng:{roll},
            cfg:{MAX_SKILL_EASE, MIN_SKILL_EASE, CHECK_EXPR_SHOW_DIE_ROLL, DIE_SIZE},
            theme:{colorSuccess, colorError, colorMegaDark},
            isNoRollDifficulty,
            ICON_SEPARATOR
        } = pkg,
        
        PARAM_DIFFICULTY = 'difficulty',
        PARAM_DIE = 'd',
        FUNC_PARAMS = [SCOPE_AGENT, SCOPE_EVENT, SCOPE_TIMELINE, PARAM_DIFFICULTY, PARAM_DIE],
        
        // An arbitrary limit on the number of dice in one d(sides, count).
        MAX_DICE = 99,
        
        /*  The d(sides, count) function an expression sees. Sides and count must be numbers, so
            anything else throws and fails the check. Numbers are cleaned up so a computed count, 
            e.g. from an Event's duration, still rolls: both are rounded, sides to at least 1 and 
            count to 1 to MAX_DICE. Returns [sides, count]. */
        cleanDice = (sides, count) => {
            if (!Number.isFinite(sides)) throw new RangeError('d(' + sides + ') needs a number of sides');
            if (!Number.isFinite(count)) throw new RangeError('d(' + sides + ', ' + count + ') needs a number of dice');
            return [mathMax(1, mathRound(sides)), mathMin(MAX_DICE, mathMax(1, mathRound(count)))];
        },
        
        // Rolls the dice and totals them, each 1 to sides. A queued roll is a die's value minus 1.
        rollDie = (sides, count=1) => {
            [sides, count] = cleanDice(sides, count);
            let total = 0;
            for (let i = 0; i < count; i++) total += roll(sides) + 1;
            return total;
        },
        
        /*  The dice's average total, count * (1 + sides) / 2, for working out an ease without 
            rolling. Success is linear in the ease, so a check's chance at the average ease is its
            true chance, unless the ease gets clamped. */
        averageDie = (sides, count=1) => {
            [sides, count] = cleanDice(sides, count);
            return count * (1 + sides) / 2;
        },
        
        // Compiled check functions by expression text. The parameters are the same for every
        // check, so events that share an expression share one function.
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
        getAgentView = agentModel => {
            if (!agentModel) return agentModel;
            let view = AGENT_VIEWS.get(agentModel);
            if (!view) AGENT_VIEWS.set(agentModel, view = new Proxy(agentModel, AGENT_HANDLER));
            return view;
        },
        
        /*  Returns the function, or throws if the expression doesn't compile. */
        build = expr => {
            if (typeof expr !== 'string' || expr.trim() === '') throw new TypeError('expression must be a non-empty string');
            return new Function(...FUNC_PARAMS, '"use strict";return(' + expr + ');');
        },
        
        compile = expr => {
            let func = COMPILED.get(expr);
            if (!func) {
                try {
                    func = build(expr);
                } catch (err) {
                    console.warn('Check expression does not compile (' + err.message + '):', expr);
                    // Stands in for an expression that doesn't compile. It's cached like any 
                    // other, so the warning only happens once per expression. NaN makes every
                    // check with it fail.
                    func = () => NaN;
                }
                COMPILED.set(expr, func);
            }
            return func;
        },
        
        /*  Evaluates an expression with die as its d function. NaN, with a warning, if the 
            expression throws or isn't a number. */
        evaluateExpr = (expr, {agent, event, difficulty=0}, die) => {
            let value;
            try {
                value = compile(expr)(getAgentView(agent), event, pkg.model, difficulty, die);
            } catch (err) {
                console.warn('Check expression threw (' + err.message + '):', expr);
                return NaN;
            }
            if (typeof value !== 'number') {
                console.warn('Check expression is not a number (' + typeof value + '):', expr);
                return NaN;
            }
            return value;
        },
        
        /*  Evaluates an expression to an ease, clamped to [minEase, maxEase], with die as the 
            expression's d function. NaN if the expression throws or isn't a number, which fails 
            any check. */
        evaluateEase = (expr, cfg, die) => {
            const {difficulty=0, maxEase=0, minEase=-DIE_SIZE} = cfg;
            
            // A no-roll check always succeeds, whatever the expression, and rolls no dice.
            if (isNoRollDifficulty(difficulty)) return 0;
            
            return mathMax(minEase, mathMin(maxEase, evaluateExpr(expr, cfg, die))); // NaN stays NaN.
        },
        
        /*  The ease without rolling: any d(sides) counts as its average. */
        getEase = (expr, cfg={}) => evaluateEase(expr, cfg, averageDie),
        
        /*  The expression for a skill check: (skillExpr) - difficulty. The parentheses keep an 
            expression using ||, ?: or comparisons from changing what difficulty is taken from. */
        toSkillCheckExpr = skillExpr => '(' + skillExpr + ')-' + PARAM_DIFFICULTY,
        
        /*  Skill checks always have at least a 0.1% chance of success and of failure, unless 
            the cfg says otherwise. */
        toSkillCheckCfg = cfg => ({maxEase:MAX_SKILL_EASE, minEase:MIN_SKILL_EASE, ...cfg}),
        
        /*  The ease phrase for an ease, by the lowest ease that earns it. The comment is the
            chance of success at that ease. */
        EASE_PHRASES = [
            [0,    'certain'],   // 100%
            [-1,   'ensured'],   // 99.9%
            [-99,  'trivial'],   // 90.1%
            [-199, 'very easy'], // 80.1%
            [-299, 'easy'],      // 70.1%
            [-399, 'fair'],      // 60.1%
            [-499, 'even'],      // 50.1%
            [-599, 'tough'],     // 40.1%
            [-699, 'hard'],      // 30.1%
            [-799, 'very hard'], // 20.1%
            [-899, 'brutal'],    // 10.1%
            [-999, 'hopeless']   // 0.1%
        ],
        toEasePhrase = ease => EASE_PHRASES.find(([minEase]) => ease >= minEase)?.[1] ?? 'impossible',
        
        /*  The phrase for an amount of damage, by the least damage that earns it. Against an 
            Agent's normal health of 100. */
        DAMAGE_PHRASES = [
            [150, 'certain death'],
            [100, 'deadly injury'],
            [75,  'crippling injury'],
            [50,  'critical injury'],
            [25,  'grievous injury'],
            [15,  'severe injury'],
            [10,  'serious injury'],
            [5,   'moderate injury'],
            [1,   'light injury']
        ],
        toDamagePhrase = damage => DAMAGE_PHRASES.find(([minDamage]) => damage >= minDamage)?.[1] ?? 'harmless',
        
        /*  Evaluates check expressions for checks such as investigating. An expression is plain 
            JavaScript that evaluates to an ease: the number added to a roll of 0 to 999, where a 
            result of 0 or more succeeds. It can use:
                agent - The AgentModel making the check. agent.skills.<id> is 0 for any skill the
                    agent doesn't have.
                event - The EventModel the check happens at.
                timeline - The root Model.
                difficulty - The check's difficulty.
                d(sides, count) - Rolls count dice, 1 by default, each a whole number from 1 to 
                    sides, and totals them, e.g. "agent.skills.str + d(12) - difficulty" or 
                    "d(6, 3)". Use d(13) - 1 for 0 to 12. Only a real check rolls. Working out 
                    the ease without rolling, e.g. for an ease phrase, uses the dice's average.
                    Sides and count are rounded, sides to at least 1 and count to 1 to 99.
            For example the skill check "(agent.skills.deception)-difficulty" with skill 0 and 
            difficulty 500 has an ease of -500, a 50% chance, and each skill point adds 0.1%.
            
            An expression that doesn't compile, throws or isn't a number fails, with a warning. */
        CHECK = pkg.checks = {
            /*  Returns why an expression can't be compiled, or null if it can. */
            getCompileError: expr => {
                try {
                    build(expr);
                    return null;
                } catch (err) {
                    return err.message;
                }
            },
            
            compile,
            getEase,
            
            /*  Rolls and evaluates against cfg {agent, event, difficulty, maxEase, minEase}. 
                Returns {success, result, roll, difficulty, ease} where result is roll + ease. A
                no-roll check doesn't roll, so its roll is null and its result is 0. Any dice in
                the expression are rolled first, then the check's roll. */
            evaluate: (expr, cfg={}) => {
                const difficulty = cfg.difficulty ?? 0,
                    ease = evaluateEase(expr, cfg, rollDie),
                    dieRoll = isNoRollDifficulty(difficulty) ? null : roll(),
                    result = (dieRoll ?? 0) + ease;
                return {success:result >= 0, result, roll:dieRoll, difficulty, ease};
            },
            
            /*  Evaluates an amount, such as damage, rolling any dice. The same parameters as a 
                check, but the result isn't an ease so it isn't clamped. NaN, with a warning, if 
                the expression throws or isn't a number. */
            rollAmount: (expr, cfg={}) => evaluateExpr(expr, cfg, rollDie),
            
            /*  An amount without rolling: any d(sides) counts as its average. */
            getAverageAmount: (expr, cfg={}) => evaluateExpr(expr, cfg, averageDie),
            
            /*  Describes an amount of damage, e.g. 'light' or 'deadly'. */
            toDamagePhrase,
            
            /*  Rolls a skill check: success when roll + (skillExpr) - difficulty >= 0. Returns the
                same as evaluate. */
            skill: (skillExpr, cfg) => CHECK.evaluate(toSkillCheckExpr(skillExpr), toSkillCheckCfg(cfg)),
            
            /*  The ease of a skill check, without rolling. */
            getSkillEase: (skillExpr, cfg) => getEase(toSkillCheckExpr(skillExpr), toSkillCheckCfg(cfg)),
            
            /*  Describes how likely an ease is to succeed, e.g. 'easy' or 'toss-up'. */
            toEasePhrase,
            
            /*  Describes how likely a skill check is to succeed, without rolling. */
            getEasePhrase: (skillExpr, cfg) => toEasePhrase(CHECK.getSkillEase(skillExpr, cfg)),
            
            showFloatingTextForSkillCheck: (btnView, checkResult) => {
                if (btnView && checkResult) {
                    const {success, roll, ease, damage} = checkResult,
                        // A no-roll check has no margin or roll to show.
                        text = (roll == null ? 'Succeeded' : 
                            (success ? 'Succeeded' : 'Failed') + ' by ' + mathAbs(roll + ease) + (CHECK_EXPR_SHOW_DIE_ROLL ? ICON_SEPARATOR + '⚅' + roll : '')) +
                            // An injury check's damage, e.g. "Failed by 120 · -7♥".
                            (damage ? ICON_SEPARATOR + (damage < 0 ? '+' : '-') + mathAbs(damage) + pkg.ICON_HEALTH : '');
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
