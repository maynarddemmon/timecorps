(pkg => {
    'use strict';
    
    const {
            max:mathMax, floor:mathFloor, ceil:mathCeil, 
            log2:mathLog2, log:mathLog, abs:mathAbs, E:EULER, random:mathRandom
        } = Math,
        
        // Chronal Util
        calculateSkillFactor = agentModel => 2 ** (agentModel.getSkillChronogation() / 100),
        
        getChronalByTimeDiff = (a, b, scaleFunc, fixed, divisor) => {
            return a === b ? 0 : mathFloor(scaleFunc(fixed + fixed*mathAbs(a - b) / divisor));
        },
        
        getChronalByTimeDiffOrdinary = (a, b, agentModel) => getChronalByTimeDiff(
            a, b, mathLog2, 2, 3*TC.timeUtil.MILLIS_PER_HOUR * calculateSkillFactor(agentModel)
        ),
        
        getChronalByTimeDiffEfficiently = (a, b, agentModel) => getChronalByTimeDiff(
            a, b, mathLog, EULER, TC.timeUtil.MILLIS_PER_WEEK * calculateSkillFactor(agentModel)
        ),
        
        // RNG Util
        D1000 = 1000,
        
        // Values handed out, in order, before falling back to Math.random. Tests use this to
        // force outcomes.
        queuedRNGs = [],
        
        checkRNGRollable = (v, max) => {
            if (!Number.isInteger(v) || v < 0 || v >= max) {
                throw new RangeError('Queued roll ' + v + ' is not an integer in [0, ' + max + ')');
            }
        },
        
        ICON_CHRONAL ='⏲', // ⏲ ⏱ ⌚ ♾ ⧖
        ICON_PARADOX = '⥁', // ⥁ ☣ ꩜
        
        SKILL_ID_CHRONOGATION = 'chronogation',
        SKILL_ID_INVESTIGATION = 'investigation',
        
        // Avoid notice, either unseen and unheard or simply unremarkable in a crowd. This absorbs incognito.
        SKILL_ID_STEALTH = 'stealth',
        
        // Pass as someone you are not. Can depend on props obtained elsewhere.
        SKILL_ID_DISGUISE = 'disguise',
        
        // Lie and interact socially without drawing suspicion.
        SKILL_ID_DECEPTION = 'deception',
        
        TC = pkg.tc = {
            app:null, // Holds the App instance.
            model:null, // Holds the Model instance.
            
            theme:{
                layoutSpacing:1,
                spacing:2,
                padding:8,
                cornerRadius:3,
                btnHeight:24,
                rowHeight:26,
                
                fontSizeMicro:'10px',
                fontSizeSmall:'12px',
                fontSizeMedium:'14px',
                fontSizeLarge:'16px',
                fontSizeVeryLarge:'20px',
                fontSizeHuge:'24px',
                
                fontFamilyMono:'SpaceMono',
                
                fontFamilyHandwritten:'RockSalt',
                fontSizeHandwritten:'13px',
                
                colorMegaDark:'#310',
                colorUltraDark:'#420',
                colorDark:'#530',
                colorDarkMedium:'#750',
                
                colorMediumDark:'#770',
                colorMedium:'#990',
                colorMedLight:'#bb0',
                colorLight:'#cc0',
                colorExtraLight:'#dd0',
                colorUltraLight:'#ff9',
                
                colorBtn:'#a70',
                colorBtnLight:'#f70',
                
                colorParadox:'#f39',
                colorChronal:'#39f',
                colorHistoricity:'#da6',
                colorAttestation:'#fc0',
                colorAction:'#6f0',
                
                colorSuccess:'#0c0',
                colorError:'#c00',
            },
            
            // Game Config
            cfg: {
                STANDARD_DEBOUNCE_MILLIS:50,
                
                EVENT_ID_THE_VOID:'the_void',
                EVENT_ID_TIME_CORPS_HQ:'time_corps_hq',
                
                TRAVEL_MODE_WAIT:'wait',
                TRAVEL_MODE_WALK:'walk',
                
                // The amount of chronal granted when reloading at HQ.
                RELOAD_CHRONAL_AMOUNT:5,
                
                // The absolute minimum chronal needed to deploy an Agent from HQ to an Event.
                MIN_DEPLOY_CHRONAL:2,
                
                // The absolute minimum chronal needed to recall an Agent to HQ.
                MIN_RECALL_CHRONAL:1,
                
                // The absolute minimum chronal needed to jump from an Agent to another Event.
                MIN_JUMP_CHRONAL:1,
                
                // The starting maximum chronal an Agent can have.
                AGENT_DEFAULT_STARTING_CHRONAL:75,
                AGENT_CHRONAL_LIMIT:100,
                
                // These ensure that any skill check has at least a 0.1% chance of success/failure.
                MAX_SKILL_EASE:-1,
                MIN_SKILL_EASE:-999,
                
                DEFAULT_ATTESTATION_EFFECT_ON_INVESTIGATE:-3,
                
                // The starting maximum paradox an Agent can have.
                AGENT_PARADOX_LIMIT:3,
                
                // The absolute maximum discovery per investigate.
                MAX_DISCOVERY_PER_INVESTIGATE:25,
                
                // The starting maximum paradox an Event can have.
                EVENT_PARADOX_LIMIT:4,
                
                // The default actions allowed by an Agent per visit within an Event.
                DEFAULT_ACTION_LIMIT:1,
                
                // This is the HQ chronal used to resupply Agents.
                TIMELINE_STARTING_CHRONAL:25,
                TIMELINE_CHRONAL_LIMIT:100,
                
                // The amount of paradox the Timeline begins the game with.
                TIMELINE_STARTING_PARADOX:0,
                
                // The starting maximum paradox for the Timeline.
                TIMELINE_PARADOX_LIMIT:9,
                
                
                //// Timeline UI Config ////
                // The maximum length of the next/prev Event history.
                MAX_HISTORY_LENGTH:1000,
                
                // The curvature value used by Splines within the Timeline.
                SPLINE_CURVATURE:0.25,
                
                TL_ROW_HEADER_WIDTH:123,
                TL_COL_WIDTH:120,
                TL_COL_HEADER_HEIGHT:52,
                TL_COL_SPACING:1,
                TL_EVENT_BOX_HEIGHT:80,
                TL_EVENT_BOX_Y_MARGIN:4,
                TL_EVENT_BOX_X_MARGIN:4,
                TL_TICK_LINE_HEIGHT:1,
                TL_CLICK_TO_DESELECT:false,
                TL_AGENT_TOKEN_FIRST_ROW_Y_OFFSET:32, // A few pixels below the progess bars in an EventBox.
                
                TL_AGENT_TOKEN_SIZE:0, // Set programatically below
                TL_AGENTS_PER_ROW:0, // Set programmatically below
                
                // Compact rows showing idle time between tiers when no Event is in progress.
                TL_GAP_ROW_HEIGHT:20,
                TL_GAP_MIN_MILLIS:5 * 60 * 1000, // Idle stretches shorter than this don't get a row.
                
                // Scoring
                SCORE_PER_ATTESTATION:3,
                MISSION_SCORE_MULTIPLIER:1,
                PARADOX_SCORE_MULTIPLIER:-500,
                
                // Dialogs
                DEFAULT_TALL_DIALOG_WIDTH:550,
                DIALOG_FOOTER_HEIGHT:0, // Set programmatically below
                
                CHECK_EXPR_SHOW_DIE_ROLL:false,
            },
            
            /*  The game's single source of randomness, so tests can force outcomes. Game code 
                should use this rather than Math.random directly.
                
                Rolls are integers in [0, max). A d1000 roll is 0-999, so every value is equally 
                likely and a check's chance of success comes out as an exact percentage. */
            rng: {
                D1000,
                
                /*  An integer in [0, max). Uses the next queued value if there is one. */
                roll: (max=D1000) => {
                    if (queuedRNGs.length > 0) {
                        const v = queuedRNGs.shift();
                        checkRNGRollable(v, max);
                        return v;
                    }
                    return mathFloor(mathRandom() * max);
                },
                
                /*  An integer in from min to max, inclusive at both ends. Note: max is provided
                    first because calls to randomInt use a min of 0 (the default when
                    not provided.) */
                randomInt: (max, min=0) => min + TC.rng.roll(max - min + 1),
                
                // Testing //
                /*  The next rolls return these values, in order, then rolls are random again. */
                queueRolls: (...values) => {queuedRNGs.push(...values);},
                clearQueuedRolls: () => {queuedRNGs.length = 0;},
                getQueuedRollCount: () => queuedRNGs.length
            },
            
            // Misc Formatters
            formatChronalAndParadox: (chronal, paradox) => {
                const THEME = TC.theme,
                    hasChronal = chronal > 0,
                    hasParadox = paradox > 0;
                return '[' + 
                    (hasChronal ? '<span style="color:' + THEME.colorChronal + ';">' + chronal + ICON_CHRONAL + '</span>' : '') + 
                    (hasChronal && hasParadox ? ' + ' : '') +
                    (hasParadox ? '<span style="color:' + THEME.colorParadox + ';">' + paradox + ICON_PARADOX + '</span>' : '') + 
                    ']';
            },
            
            // Chronal Util
            getChronalToDeploy: (agentModel, eventModel) => {
                const eventTime = eventModel.getStart(),
                    agentEvent = agentModel.getEventModel();
                
                // The Agent isn't anywhere which is odd.
                if (!agentEvent) {
                    console.warn('getChronalToDeploy: no agent event', agentModel);
                    return Number.MAX_SAFE_INTEGER;
                }
                
                const cfg = TC.cfg,
                    isDeploy = agentEvent.isHQ(),
                    getFunc = isDeploy ? getChronalByTimeDiffEfficiently : getChronalByTimeDiffOrdinary,
                    cost = getFunc(agentEvent.getEnd(), eventTime, agentModel);
                return mathMax(isDeploy ? cfg.MIN_DEPLOY_CHRONAL : cfg.MIN_JUMP_CHRONAL, cost);
            },
            
            getChronalToRecall: agentModel => {
                const agentEvent = agentModel.getEventModel();
                
                // The Agent isn't anywhere which is odd.
                if (!agentEvent) {
                    console.warn('getChronalToRecall: no agent event', agentModel);
                    return Number.MAX_SAFE_INTEGER;
                }
                
                const cost = mathCeil(getChronalByTimeDiffEfficiently(TC.model.getHQEventModel().getStart(), agentEvent.getEnd(), agentModel) / 2);
                return mathMax(TC.cfg.MIN_RECALL_CHRONAL, cost);
            },
            
            loadTxt: (url, callback) => {
                myt.doFetch(url, {}, true,
                    response => {
                        callback?.(true, response);
                    },
                    err => {
                        console.error('err', err);
                        callback?.(false, err);
                    }
                );
            },
            
            loadTxtIntoElement: (url, targetView, isStillWanted) => {
                targetView.setValue('Retrieving…');
                
                TC.loadTxt(url, (success, txt) => {
                    if (isStillWanted()) {
                        if (success) {
                            targetView.setValue(txt);
                        } else {
                            targetView.setValue('MISSING / REDACTED: ' + txt);
                        }
                    }
                });
            },
            
            // Constraint Scopes
            SCOPE_TIMELINE:'timeline',
            SCOPE_LOCATIONS:'locations',
            SCOPE_OPERATIONS:'operations',
            SCOPE_OPERATION:'operation',
            SCOPE_AGENTS:'agents',
            SCOPE_AGENT:'agent',
            SCOPE_EVENTS:'events',
            SCOPE_EVENT:'event',
            
            // Agent Scopes
            SCOPE_SKILLS:'skills',
            
            // Stat IDs
            STAT_ID_PARADOX:'paradox',
            STAT_ID_CHRONAL:'chronal',
            STAT_ID_HISTORICITY:'historicity',
            STAT_ID_ATTESTATION:'attestation',
            
            // Skill IDS
            SKILL_ID_CHRONOGATION,
            SKILL_ID_INVESTIGATION,
            SKILL_ID_STEALTH,
            SKILL_ID_DISGUISE,
            SKILL_ID_DECEPTION,
            
            AGENT_SKILL_IDS:[SKILL_ID_CHRONOGATION, SKILL_ID_INVESTIGATION, SKILL_ID_STEALTH, SKILL_ID_DISGUISE, SKILL_ID_DECEPTION],
            
            // Text Constants
            I18N_CHRONAL:'Chr' + ICON_CHRONAL + 'nal',
            I18N_PARADOX:'Parad' + ICON_PARADOX + 'x',
            I18N_HISTORICITY:'Historicity',
            I18N_ATTESTATION:'Attestation',
            
            // Icons
            ICON_SEPARATOR:'\u00A0·\u00A0',
            ICON_ARROW:'\u00A0→\u00A0',
            ICON_NAV_BACK:'❮',
            ICON_NAV_FORWARD:'❯',
            ICON_ACTION:'⎇', // ⎌ ⎇ ☟
            ICON_JUMP:'⎌',
            ICON_TRAVEL:'⎆', // ⎈
            ICON_VIEW:'⏿',
            ICON_CHRONAL,
            ICON_PARADOX,
            ICON_THE_VOID:'⦰',
            ICON_HQ:'❉',
            ICON_SEARCH:'?',
            ICON_HELP:'?',
            ICON_NIL:'–',
            ICON_NEXT:'➜',
            ICON_CHECKED:'✓',
            ICON_UNCHECKED:'✗',
            ICON_CANCEL:'X',
            ICON_APPROX:'~',
            ICON_SAVE:'✇',
            ICON_SETTINGS:'⚙',
            ICON_RESTART:'⌫',
            ICON_EXPANDED:'⊟',
            ICON_COLLAPSED:'⊞',
            ICON_IMPORT:'↥',
            ICON_EXPORT:'↧'
        };
    
    // Apply config overrides
    const CFG = TC.cfg,
        OVERRIDES = pkg.TC_CFG_OVERRIDES,
        VERBOSE_INFO = OVERRIDES?._TC_CFG_OVERRIDES_INFO ?? true,
        VERBOSE_WARN = OVERRIDES?._TC_CFG_OVERRIDES_WARN ?? true,
        VERBOSE_ERROR = OVERRIDES?._TC_CFG_OVERRIDES_ERROR ?? true;
    if (OVERRIDES) {
        delete OVERRIDES._TC_CFG_OVERRIDES_INFO;
        delete OVERRIDES._TC_CFG_OVERRIDES_WARN;
        delete OVERRIDES._TC_CFG_OVERRIDES_ERROR;
    }
    for (const key in OVERRIDES) {
        if (Object.hasOwn(CFG, key)) {
            const cfgValue = CFG[key],
                newCfgValue = OVERRIDES[key];
            if (cfgValue !== newCfgValue) {
                CFG[key] = OVERRIDES[key];
                if (VERBOSE_INFO) console.log('Override cfg:', key, cfgValue, '->', newCfgValue);
            } else {
                if (VERBOSE_WARN) console.warn('Override cfg no change:', key, cfgValue, '->', newCfgValue);
            }
        } else {
            if (VERBOSE_ERROR) console.error('Unknown cfg override:', key, OVERRIDES[key]);
        }
    }
    
    // Programatically set some of the default CFG
    const {padding, btnHeight} = TC.theme;
    CFG.TL_AGENT_TOKEN_SIZE ||= btnHeight;
    CFG.TL_AGENTS_PER_ROW ||= mathFloor(CFG.TL_COL_WIDTH / CFG.TL_AGENT_TOKEN_SIZE);
    CFG.DIALOG_FOOTER_HEIGHT ||= btnHeight + 2*padding;
})(window);
