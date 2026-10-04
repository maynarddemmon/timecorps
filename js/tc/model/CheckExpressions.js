(pkg => {
    'use strict';
    
    const {min:mathMin, max:mathMax, abs:mathAbs} = Math,
        
        {
            SCOPE_SKILLS, SCOPE_AGENT, SCOPE_EVENT, SCOPE_TIMELINE,
            rng:{roll},
            cfg:{MAX_SKILL_EASE, MIN_SKILL_EASE, CHECK_EXPR_SHOW_DIE_ROLL, DIE_SIZE},
            theme:{colorSuccess, colorError, colorMegaDark},
            isNoRollDifficulty
        } = pkg,
        
        PARAM_DIFFICULTY = 'difficulty',
        FUNC_PARAMS = [SCOPE_AGENT, SCOPE_EVENT, SCOPE_TIMELINE, PARAM_DIFFICULTY],
        
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
        
        /*  Evaluates an expression to an ease, clamped to [minEase, maxEase]. Doesn't roll. NaN
            if the expression throws or isn't a number, which fails any check. */
        getEase = (expr, {agent, event, difficulty=0, maxEase=0, minEase=-DIE_SIZE}={}) => {
            // A no-roll check always succeeds, whatever the expression.
            if (isNoRollDifficulty(difficulty)) return 0;
            
            let value;
            try {
                value = compile(expr)(getAgentView(agent), event, pkg.model, difficulty);
            } catch (err) {
                console.warn('Check expression threw (' + err.message + '):', expr);
                return NaN;
            }
            if (typeof value !== 'number') {
                console.warn('Check expression is not a number (' + typeof value + '):', expr);
                return NaN;
            }
            return mathMax(minEase, mathMin(maxEase, value)); // NaN stays NaN.
        },
        
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
        
        /*  Evaluates check expressions for checks such as investigating. An expression is plain 
            JavaScript that evaluates to an ease: the number added to a roll of 0 to 999, where a 
            result of 0 or more succeeds. It can use:
                agent - The AgentModel making the check. agent.skills.<id> is 0 for any skill the
                    agent doesn't have.
                event - The EventModel the check happens at.
                timeline - The root Model.
                difficulty - The check's difficulty.
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
                no-roll check doesn't roll, so its roll is null and its result is 0. */
            evaluate: (expr, cfg={}) => {
                const difficulty = cfg.difficulty ?? 0,
                    ease = getEase(expr, cfg),
                    dieRoll = isNoRollDifficulty(difficulty) ? null : roll(),
                    result = (dieRoll ?? 0) + ease;
                return {success:result >= 0, result, roll:dieRoll, difficulty, ease};
            },
            
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
                    const {success, roll, ease} = checkResult,
                        // A no-roll check has no margin or roll to show.
                        text = roll == null ? 'Succeeded' : 
                            (success ? 'Succeeded' : 'Failed') + ' by ' + mathAbs(roll + ease) + (CHECK_EXPR_SHOW_DIE_ROLL ? pkg.ICON_SEPARATOR + '⚅' + roll : '');
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
