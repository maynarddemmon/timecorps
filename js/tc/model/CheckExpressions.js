(pkg => {
    'use strict';
    
    const M = myt,
        
        {min:mathMin, max:mathMax} = Math,
        
        {
            SCOPE_SKILLS,
            rng:{roll, D1000},
            cfg:{MAX_SKILL_EASE, MIN_SKILL_EASE}
        } = pkg,
        
        PARAM_DIFFICULTY = 'difficulty',
        FUNC_PARAMS = ['agent', 'event', 'timeline', PARAM_DIFFICULTY],
        
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
            return new Function(...FUNC_PARAMS, '"use strict";return (' + expr + ');');
        },
        
        /*  Returns why an expression can't be compiled, or null if it can. For validating data. */
        getCompileError = expr => {
            try {
                build(expr);
                return null;
            } catch (err) {
                return err.message;
            }
        },
        
        compile = expr => {
            let func = COMPILED.get(expr);
            if (!func) {
                try {
                    func = build(expr);
                } catch (err) {
                    console.warn('Check expression does not compile (' + err.message + '):', expr);
                    // Stands in for an expression that doesn't compile. It's cached like any 
                    // other, so the warning only happens once per expression.
                    func = () => -1; // Negative values are generally failures.
                }
                COMPILED.set(expr, func);
            }
            return func;
        },
        
        /*  Evaluates success expressions for checks such as investigating. An expression is plain
            JavaScript that is truthy when the check succeeds. It can use:
                agent - The AgentModel making the check. agent.skills.<id> is 0 for any skill the
                    agent doesn't have.
                event - The EventModel the check happens at.
                timeline - The root Model.
                difficulty - The check's difficulty.
            For example "difficulty - agent.skills.deception <= random" succeeds more often the
            lower the difficulty and the higher the skill. With skill 0 and difficulty 500 that's
            a 50% chance, and each skill point adds 0.1%.
            
            An expression that doesn't compile or throws fails, with a warning. */
        CHECK = pkg.checks = {
            getCompileError,
            
            /*  The compiled function for an expression, cached by the expression text. */
            compile,
            
            /*  Rolls and evaluates. Returns {success, roll, difficulty}. */
            evaluate: (expr, {agent, event, difficulty=0, maxEase=0, minEase=-1000}={}) => {
                const dieRoll = roll(D1000);
                let success = false,
                    ease,
                    result;
                try {
                    ease = mathMax(minEase, mathMin(maxEase, compile(expr)(getAgentView(agent), event, pkg.model, difficulty)));
                    result = dieRoll + ease;
                    success = result >= 0;
                } catch (err) {
                    console.warn('Check expression threw (' + err.message + '):', expr);
                }
                return {success, result, roll:dieRoll, difficulty, ease};
            },
            
            /*  Tests a skill expression for success against a provided config {agent, event, difficulty}.
                success is calculated as: random + (skillExpr) - difficulty. Success is any result 
                0 or greater. The parentheses keep an expression using ||, ?: or comparisons from 
                changing what's added. */
            skill: (skillExpr, cfg={}) => {
                cfg.maxEase ??= MAX_SKILL_EASE;
                cfg.minEase = MIN_SKILL_EASE;
                return CHECK.evaluate('(' + skillExpr + ')-' + PARAM_DIFFICULTY, cfg);
            },
            
            getSkillEase: (skillExpr, cfg) => CHECK.skill(skillExpr, cfg).ease,
            
            getEasePhrase: (skillExpr, cfg) => {
                const ease = CHECK.getSkillEase(skillExpr, cfg);
                if (ease >= 0) {           // 100% chance
                    return 'guaranteed';
                } else if (ease >= -1) {   // 99.9% chance
                    return 'sure thing';
                } else if (ease >= -99) {  // 90% chance
                    return 'trivial';
                } else if (ease >= -199) { // 80% chance
                    return 'very easy';
                } else if (ease >= -299) { // 70% chance
                    return 'easy';
                } else if (ease >= -399) { // 60% chance
                    return 'moderate';
                } else if (ease >= -499) { // 50% chance
                    return 'toss-up';
                } else if (ease >= -599) { // 40% chance
                    return 'difficult';
                } else if (ease >= -699) { // 30% chance
                    return 'hard';
                } else if (ease >= -799) { // 20% chance
                    return 'very hard';
                } else if (ease >= -899) { // 10% chance
                    return 'extreme';
                } else if (ease >= -999) { // 0.1% chance
                    return 'insurmountable';
                } else {                   // 0% chance
                    return 'impossible';
                }
            }
        };
})(tc);
