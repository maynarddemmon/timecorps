(pkg => {
    'use strict';
    
    const {max:mathMax, floor:mathFloor, log2:mathLog2, log10:mathLog10, abs:mathAbs} = Math,
        
        // Chronal Util
        getChronalByTimeDiff = (a, b) => {
            if (a === b) return 0;
            return mathFloor(mathLog2(2 + 2* mathAbs(a - b) / TC.timeUtil.MILLIS_PER_WEEK));
        },
        
        getChronalEfficiently = (a, b) => {
            if (a === b) return 0;
            return mathFloor(mathLog10(2 + 2* mathAbs(a - b) / TC.timeUtil.MILLIS_PER_YEAR));
        },
        
        ICON_CHRONAL ='⏲', // ⏲ ⏱ ⌚ ♾ ⧖
        ICON_PARADOX = '⥁', // ⥁ ☣ ꩜
        
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
                fontFamilyMono:'SpaceMono',
                
                colorMegaDark:'#310',
                colorUltraDark:'#420',
                colorDark:'#530',
                
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
                RELOAD_CHRONAL_AMOUNT:1,
                
                // The absolute minimum chronal needed to deploy an Agent from HQ or jump from
                // another Event.
                MIN_DEPLOY_CHRONAL:1,
                
                // The absolute minimum chronal needed to recall an Agent to HQ.
                MIN_RECALL_CHRONAL:1,
                
                // The starting maximum chronal an Agent can have.
                AGENT_DEFAULT_STARTING_CHRONAL:10,
                AGENT_CHRONAL_LIMIT:15,
                
                // The starting maximum paradox an Agent can have.
                AGENT_PARADOX_LIMIT:3,
                
                // The absolute maximum discovery per investigate.
                MAX_DISCOVERY_PER_INVESTIGATE:25,
                
                // The starting maximum paradox an Event can have.
                EVENT_PARADOX_LIMIT:4,
                
                // The default actions allowed by an Agent per visit within an Event.
                DEFAULT_ACTION_LIMIT:1,
                
                // This is the HQ chronal used to resupply Agents.
                TIMELINE_STARTING_CHRONAL:10,
                TIMELINE_CHRONAL_LIMIT:25,
                
                // The amount of paradox the Timeline begins the game with.
                TIMELINE_STARTING_PARADOX:0,
                
                // The starting maximum paradox for the Timeline.
                TIMELINE_PARADOX_LIMIT:9,
                
                
                //// Timeline UI Config ////
                // The maximum length of the next/prev Event history.
                MAX_HISTORY_LENGTH:1000,
                
                // The curvature value used by Splines within the Timeline.
                SPLINE_CURVATURE:0.25,
                
                TL_ROW_HEADER_WIDTH:125,
                TL_COL_WIDTH:120,
                TL_COL_HEADER_HEIGHT:26,
                TL_COL_SPACING:1,
                TL_EVENT_BOX_HEIGHT:75,
                TL_EVENT_BOX_Y_MARGIN:4,
                TL_EVENT_BOX_X_MARGIN:4,
                TL_TICK_LINE_HEIGHT:1,
                TL_CLICK_TO_DESELECT:false,
                
                // Scoring
                SCORE_PER_ATTESTATION:3,
                MISSION_SCORE_MULTIPLIER:1,
                PARADOX_SCORE_MULTIPLIER:-500,
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
                    agentEvent = agentModel.getEventModel(),
                    getFunc = agentEvent.isHQ() ? getChronalEfficiently : getChronalByTimeDiff,
                    cost = getFunc(agentEvent.getEnd(), eventTime);
                return mathMax(TC.cfg.MIN_DEPLOY_CHRONAL, cost);
            },
            
            getChronalToRecall: agentModel => {
                const agentEvent = agentModel.getEventModel(),
                    cost = getChronalEfficiently(TC.model.getHQEventModel().getStart(), agentEvent.getEnd()) / 2;
                return mathMax(TC.cfg.MIN_RECALL_CHRONAL, cost);
            },
            
            // Constraint Scopes
            SCOPE_OPERATIONS:'operations',
            SCOPE_TIMELINE: 'timeline',
            SCOPE_AGENTS: 'agents',
            SCOPE_LOCATIONS: 'locations',
            SCOPE_EVENTS: 'events',
            SCOPE_EVENT: 'event',
            
            // Stat IDs
            STAT_ID_PARADOX:'paradox',
            STAT_ID_CHRONAL:'chronal',
            STAT_ID_HISTORICITY:'historicity',
            STAT_ID_ATTESTATION:'attestation',
            
            // Text Constants
            I18N_CHRONAL:'Chr' + ICON_CHRONAL + 'nal',
            I18N_PARADOX:'Parad' + ICON_PARADOX + 'x',
            I18N_HISTORICITY:'Historicity',
            I18N_ATTESTATION:'Attestation',
            
            // Icons
            ICON_SEPARATOR:' · ',
            ICON_ARROW:' → ',
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
            ICON_NIL:'–',
            ICON_NEXT:'➜'
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
})(window);
