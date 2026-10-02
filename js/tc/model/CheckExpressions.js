(pkg => {
    'use strict';
    
    const M = myt,
        
        FUNC_PARAMS = ['agent', 'event', 'random', 'difficulty'],
        
        // Compiled check functions by expression text. The parameters are the same for every
        // check, so events that share an expression share one function.
        COMPILED = new Map(),
        
        // Skills an agent doesn't have count as 0, so a check can name any skill without error.
        SKILLS_HANDLER = {
            get: (skills, key) => typeof key === 'string' ? (skills[key] ?? 0) : skills[key]
        },
        
        // The agent as an expression sees it: the AgentModel, except skills default to 0.
        AGENT_HANDLER = {
            get: (agentModel, key) => key === 'skills' ? new Proxy(agentModel.getSkills(), SKILLS_HANDLER) : agentModel[key]
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
                    func = M.FALSE_FUNC;
                }
                COMPILED.set(expr, func);
            }
            return func;
        };
    
    /*  Evaluates success expressions for checks such as investigating. An expression is plain
        JavaScript that is truthy when the check succeeds. It can use:
            agent - The AgentModel making the check. agent.skills.<id> is 0 for any skill the
                agent doesn't have.
            event - The EventModel the check happens at.
            random - The roll, an integer from 0 to 999.
            difficulty - The check's difficulty.
        For example "difficulty - agent.skills.deception <= random" succeeds more often the
        lower the difficulty and the higher the skill. With skill 0 and difficulty 500 that's
        a 50% chance, and each skill point adds 0.1%.
        
        An expression that doesn't compile or throws fails, with a warning. */
    pkg.checks = {
        getCompileError,
        
        /*  The compiled function for an expression, cached by the expression text. */
        compile,
        
        /*  Rolls and evaluates. Returns {success, roll, difficulty}. */
        evaluate: (expr, {agent, event, difficulty=0} = {}) => {
            const roll = pkg.rng.roll(pkg.rng.D1000);
            let success = false;
            try {
                success = !!compile(expr)(getAgentView(agent), event, roll, difficulty);
            } catch (err) {
                console.warn('Check expression threw (' + err.message + '):', expr);
            }
            return {success, roll, difficulty};
        }
    };
})(tc);
