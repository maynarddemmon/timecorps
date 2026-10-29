(pkg => {
    'use strict';
    
    const {
            max:mathMax, min:mathMin, floor:mathFloor, ceil:mathCeil, 
            log2:mathLog2, log:mathLog, abs:mathAbs, E:EULER, random:mathRandom,
            exp:mathExp
        } = Math,
        
        logToBase = (v, base) => mathLog(v) / mathLog(base),
        
        // Chronal Util //
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
        
        // Util //
        wrapInStyledSpan = (txt, color, fontFamily) => {
            let css = '';
            if (color) css += 'color:' + color + ';';
            if (fontFamily) css += 'font-family:' + fontFamily + ';';
            return '<span style="' + css + '">' + txt + '</span>';
        },
        
        DOM_PARSER = new DOMParser(), // Used by stripMarkup
        
        // RNG Util //
        // Values handed out, in order, before falling back to Math.random. Tests use this to
        // force outcomes.
        queuedRNGs = [],
        
        /*  An integer in [0, max). Uses the next queued value if there is one. */
        roll = (max=TC.cfg.DIE_SIZE) => {
            if (queuedRNGs.length > 0) {
                const v = queuedRNGs.shift();
                
                // Validate the queued value is valid.
                if (!Number.isInteger(v) || v < 0 || v >= max) {
                    throw new RangeError('Queued roll ' + v + ' is not an integer in [0, ' + max + ')');
                }
                return v;
            }
            return mathFloor(mathRandom() * max);
        },
        
        ICON_CHRONAL ='⏲', // ⏲ ⏱ ♾ ⧖
        ICON_PARADOX = '⥁', // ⥁ ☣ ꩜
        ICON_HEALTH = '♥',
        
        STAT_ID_PARADOX = 'paradox',
        STAT_ID_CHRONAL = 'chronal',
        STAT_ID_HEALTH = 'health',
        STAT_ID_HISTORICITY = 'historicity',
        STAT_ID_ATTESTATION = 'attestation',
        STAT_ID_EFFECTIVE_AGE = 'effectiveAge',
        
        I18N_PARADOX = 'Parad' + ICON_PARADOX + 'x',
        I18N_CHRONAL = 'Chr' + ICON_CHRONAL + 'nal',
        I18N_HEALTH = 'Health',
        I18N_HISTORICITY = 'Historicity',
        I18N_ATTESTATION = 'Attestation',
        
        STAT_NAME_BY_ID = {
            [STAT_ID_PARADOX]:I18N_PARADOX,
            [STAT_ID_CHRONAL]:I18N_CHRONAL,
            [STAT_ID_HEALTH]:I18N_HEALTH,
            [STAT_ID_HISTORICITY]:I18N_HISTORICITY,
            [STAT_ID_ATTESTATION]:I18N_ATTESTATION,
            // An agent's, in years, which set and adj can change like a stat.
            [STAT_ID_EFFECTIVE_AGE]:'Effective Age',
            // The timeline's, which set and adj can change like stats.
            score:'Score',
            credits:'Credits'
        },
        
        STAT_ICON_BY_ID = {
            [STAT_ID_PARADOX]:ICON_PARADOX,
            [STAT_ID_CHRONAL]:ICON_CHRONAL,
            [STAT_ID_HEALTH]:ICON_HEALTH
        },
        
        /*  A stat's name, e.g. for describing an adjustment on it. A skill, as an adjustment names it,
            e.g. "skills.agl", is named by its config, e.g. "Agility". */
        getStatName = statId => STAT_NAME_BY_ID[statId] ?? 
            (statId.startsWith(SCOPE_SKILLS + '.') ? TC.getSkillConfig?.(statId.slice(SCOPE_SKILLS.length + 1))?.name : undefined) ?? 
            statId,
        
        // A difficulty in the data that skips the roll, so the check always succeeds. It's
        // stored as DIFFICULTY_NO_ROLL_THRESHOLD, or any difficulty at or below it.
        DIFFICULTY_NO_ROLL = 'no-roll',
        DIFFICULTY_NO_ROLL_THRESHOLD = -999999,
        
        SCOPE_AGENT = 'agent',
        SCOPE_SKILLS = 'skills',
        
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
                
                colorParadox:'#c0f',
                colorParadoxDark:'#a0d',
                colorParadoxLight:'#e6f',
                colorChronal:'#36f',
                colorHealth:'#f00',
                colorHistoricity:'#da6',
                colorAttestation:'#fc0',
                colorAction:'#6f0',
                
                colorSuccess:'#0c0',
                colorError:'#c00',
            },
            
            // Game Config
            cfg: {
                // Where the data files, and the media they refer to, are loaded from.
                DATA_BASE_DIR:'./data/',
                IMAGE_BASE_DIR:'./img/',
                
                STANDARD_DEBOUNCE_MILLIS:50,
                
                EVENT_ID_THE_VOID:'the_void',
                
                // The Faction of any Agent not really in a specific Faction.
                FACTION_ID_UNALIGNED:'unaligned',
                
                // The Faction of an Agent of the Time Corps.
                FACTION_ID_TIMECORPS:'timecorps',
                
                // The absolute minimum chronal needed to deploy an Agent from HQ to an Event.
                MIN_DEPLOY_CHRONAL:2,
                
                // The absolute minimum chronal needed to recall an Agent to HQ.
                MIN_RECALL_CHRONAL:1,
                
                // The absolute minimum chronal needed to jump from an Agent to another Event.
                MIN_JUMP_CHRONAL:1,
                
                // The starting maximum chronal an Agent can have.
                AGENT_DEFAULT_CHRONAL:45,
                AGENT_CHRONAL_LIMIT:50,
                
                // An Agent's normal maximum health, and the most it can ever be raised to.
                AGENT_DEFAULT_HEALTH:100,
                AGENT_HEALTH_LIMIT:150,
                
                // Ages, in years. An Agent without a birth date in the data is this old.
                AGENT_DEFAULT_AGE:30,
                // From this effective age an Agent's maximum health declines, slowly at first
                // and faster with age, reaching 0, and death, at AGE_HEALTH_ZERO. The larger
                // the curve, the more the decline is held back until late.
                AGE_HEALTH_DECLINE_START:35,
                AGE_HEALTH_ZERO:85,
                AGE_HEALTH_DECLINE_CURVE:3,
                // Treatments can't wind an Agent's effective age back below this.
                AGE_MIN_EFFECTIVE:25,
                
                // The most an Agent's skill can be raised to by purchasing it.
                MAX_SKILL_VALUE:1000,
                
                // These ensure that any skill check has at least a 0.1% chance of success/failure.
                MAX_SKILL_EASE:-1,
                MIN_SKILL_EASE:-999,
                
                MIN_CHRONOGATION_TO_LOOPBACK:50,
                
                // The starting maximum paradox an Agent can have.
                AGENT_DEFAULT_PARADOX:0,
                AGENT_PARADOX_LIMIT:5,
                
                // The starting maximum paradox an Event can have.
                EVENT_PARADOX_LIMIT:6,
                
                // The default actions allowed by an Agent per visit within an Event.
                DEFAULT_ACTION_LIMIT:5,
                
                // This is the HQ chronal used to resupply Agents.
                TIMELINE_STARTING_CHRONAL:25,
                TIMELINE_CHRONAL_LIMIT:100,
                
                // The amount of paradox the Timeline begins the game with.
                TIMELINE_STARTING_PARADOX:0,
                
                // The maximum paradox for the Timeline is this fixed amount plus 
                // TIMELINE_PARADOX_LIMIT_PER_EVENT for each non-hub Event that isn't hidden, so
                // it grows as Events are revealed.
                TIMELINE_PARADOX_LIMIT:9,
                TIMELINE_PARADOX_LIMIT_PER_EVENT:0.25,
                
                //// Timeline UI Config ////
                // The maximum length of the next/prev Event history.
                MAX_HISTORY_LENGTH:1000,
                
                // The height of the top "header" view in the App.
                TOP_VIEW_HEIGHT:40,
                
                // The curvature value used by Splines within the Timeline.
                SPLINE_CURVATURE:0.35,
                
                TL_ROW_HEADER_WIDTH:96,
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
                TL_GAP_MIN_MILLIS:1 * 60 * 1000, // Idle stretches shorter than this don't get a row.
                
                // Scoring
                SCORE_PER_ATTESTATION:3,
                PARADOX_SCORE_MULTIPLIER:-500,
                
                // A credit is earned for each time the score reaches a new multiple of this.
                SCORE_TO_CREDITS_EARN_AMOUNT:100,
                
                // Dialogs
                DEFAULT_TALL_DIALOG_WIDTH:648,
                DIALOG_FOOTER_HEIGHT:0, // Set programmatically below
                
                CHECK_EXPR_SHOW_DIE_ROLL:false,
                
                // Gameplay //
                DIE_SIZE:1000, // The range [0-DIE_SIZE-1] of randomly generated integers for a die roll.
                
                DEFAULT_SKILL_DIFFICULTY:250, // 75% for a skill of 0.
                DEFAULT_SKILL_EXPR:'0', // Default to no skill
                
                DEFAULT_DESCENDANT_ATTESTATION_FOR_REVEAL: 15,
                DEFAULT_PRECURSOR_ATTESTATION_FOR_REVEAL: 25,
            },
            
            /*  The game's single source of randomness, so tests can force outcomes. Game code 
                should use this rather than Math.random directly. Rolls are integers in [0, max). 
                The default roll is [0-DIE_SIZE-1]. */
            rng: {
                roll,
                
                /*  An integer in from min to max, inclusive at both ends. Note: max is provided
                    first because calls to randomInt use a min of 0 (the default when
                    not provided.) */
                randomInt: (max, min=0) => min + roll(max - min + 1),
                
                // Testing //
                /*  The next rolls return these values, in order, then rolls are random again. */
                queueRolls: (...values) => {queuedRNGs.push(...values);},
                clearQueuedRolls: () => {queuedRNGs.length = 0;},
                getQueuedRollCount: () => queuedRNGs.length
            },
            
            // Misc Formatters
            formatAgentRisks: (chronal, paradox, healthRisk) => {
                const THEME = TC.theme,
                    parts = [];
                for (const [value, icon, color] of [
                    [chronal, ICON_CHRONAL, THEME.colorChronal],
                    [paradox, ICON_PARADOX, THEME.colorParadox],
                    [healthRisk, ICON_HEALTH, THEME.colorHealth]
                ]) {
                    if (value > 0) { // Works for boolean and number
                        parts.push(wrapInStyledSpan((typeof value === 'number' ? value : '') + icon, color));
                    }
                }
                return parts.length > 0 ? ' [' + parts.join(' + ') + ']' : '';
            },
            
            getStatName,
            
            /*  An amount a stat changed by, e.g. "-7♥", "+2⥁" or "+5 Attestation". */
            formatStatAdj: (statId, amount) => {
                const label = STAT_ICON_BY_ID[statId] ?? ' ' + getStatName(statId);
                return (amount < 0 ? '-' : '+') + mathAbs(amount) + label;
            },
            
            // Chronal Util
            /*  The fraction of an Agent's maximum health left at an effective age, in years: 1 
                up to AGE_HEALTH_DECLINE_START, falling exponentially faster to 0 at 
                AGE_HEALTH_ZERO. */
            getAgeHealthFactor: effectiveAge => {
                const {AGE_HEALTH_DECLINE_START:start, AGE_HEALTH_ZERO:end, AGE_HEALTH_DECLINE_CURVE:curve} = TC.cfg,
                    t = mathMin(1, mathMax(0, (effectiveAge - start) / (end - start)));
                return 1 - (mathExp(curve * t) - 1) / (mathExp(curve) - 1);
            },
            
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
            
            /*  The chronal to recall the Agent to hqEventModel, their Faction's HQ. */
            getChronalToRecall: (agentModel, hqEventModel) => {
                const agentEvent = agentModel.getEventModel();
                
                // The Agent isn't anywhere which is odd.
                if (!agentEvent) {
                    console.warn('getChronalToRecall: no agent event', agentModel);
                    return Number.MAX_SAFE_INTEGER;
                }
                
                const cost = mathCeil(getChronalByTimeDiffEfficiently(hqEventModel.getStart(), agentEvent.getEnd(), agentModel) / 2);
                return mathMax(TC.cfg.MIN_RECALL_CHRONAL, cost);
            },
            
            getMinChronogationToLoopbackAtEvent: eventModel => {
                // Gets a spread of difficulties where the shorter the duration of the Event the
                // more difficult it is to loop back to it. The idea is the short duration requires
                // more precision to arrive accurately. The calculation below creates an ease of
                // about 500 at 100 years and 0 at 1 second.
                return TC.cfg.MIN_CHRONOGATION_TO_LOOPBACK - mathMax(0, mathMin(500, logToBase(eventModel.getDuration(), 1.0447) - 158));
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
            
            DIFFICULTY_NO_ROLL,
            DIFFICULTY_NO_ROLL_THRESHOLD,
            
            /*  A difficulty from the data as a number, so DIFFICULTY_NO_ROLL becomes the 
                threshold. Anything else is returned as is. */
            toDifficulty: v => v === DIFFICULTY_NO_ROLL ? DIFFICULTY_NO_ROLL_THRESHOLD : v,
            
            /*  True if a check at this difficulty skips the roll and always succeeds. */
            isNoRollDifficulty: difficulty => difficulty <= DIFFICULTY_NO_ROLL_THRESHOLD,
            
            CHECK_SKILL_EXPR_PREFIX: SCOPE_AGENT + '.' + SCOPE_SKILLS + '.',
            
            // Constraint Scopes
            SCOPE_TIMELINE:'timeline',
            SCOPE_SCRATCH:'scratch',
            SCOPE_LOCATIONS:'locations',
            SCOPE_FACTIONS:'factions',
            SCOPE_PROMPTS:'prompts',
            SCOPE_OPERATIONS:'operations',
            SCOPE_OPERATION:'operation',
            SCOPE_AGENTS:'agents',
            SCOPE_AGENT,
            SCOPE_EVENTS:'events',
            SCOPE_EVENT:'event',
            
            // Agent Scopes
            SCOPE_SKILLS,
            
            // Stat IDs
            STAT_ID_PARADOX,
            STAT_ID_CHRONAL,
            STAT_ID_HEALTH,
            STAT_ID_HISTORICITY,
            STAT_ID_ATTESTATION,
            STAT_ID_EFFECTIVE_AGE,
            
            // Skill IDS: these should match up to the ID of skills defined in init.json5.
            SKILL_ID_CHRONOGATION:'chronogation',
            SKILL_ID_INVESTIGATION:'investigation',
            SKILL_ID_STEALTH:'stealth',
            SKILL_ID_DISGUISE:'disguise',
            SKILL_ID_DECEPTION:'deception',
            
            // Text Constants
            I18N_CHRONAL,
            I18N_PARADOX,
            I18N_HEALTH,
            I18N_HISTORICITY,
            I18N_ATTESTATION,
            
            // Icons
            ICON_SEPARATOR:'\u00A0·\u00A0',
            ICON_ARROW:'\u00A0→\u00A0',
            ICON_NAV_BACK:'❮',
            ICON_NAV_FORWARD:'❯',
            ICON_ACTION:'⎇', // ⎌ ⎇ ☟
            ICON_JUMP:'⎌',
            ICON_VIEW:'⏿',
            ICON_CHRONAL,
            ICON_PARADOX,
            ICON_HEALTH,
            ICON_THE_VOID:'⦰',
            ICON_HQ:'❉',
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
            ICON_EXPORT:'↧',
            ICON_MISSION:'⚑',
            ICON_EVENT:'⧉', // ⧉, ⚭
            ICON_DEATH:'☠',
            
            logToBase,
            
            /*  A number in [0, 1) that's always the same for the same value: myt's hash, mixed so that
                similar strings, e.g. IDs that differ in one character, land far apart. */
            hashToUnit: value => {
                let h = myt.hash(typeof value === 'string' ? value : myt.stableStringify(value));
                h ^= h >>> 16;
                h = Math.imul(h, 0x85ebca6b);
                h ^= h >>> 13;
                h = Math.imul(h, 0xc2b2ae35);
                h ^= h >>> 16;
                return (h >>> 0) / 2 ** 32;
            },
            hashToRange: (value, min, max) => {
                const actualMin = mathMin(min, max);
                return mathFloor(TC.hashToUnit(value) * (mathMax(min, max) - actualMin + 1) + actualMin);
            },
            
            isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
            
            // Formatting //
            wrapInStyledSpan,
            stripMarkup: str => str ? DOM_PARSER.parseFromString(str, 'text/html').body.textContent || '' : ''
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
