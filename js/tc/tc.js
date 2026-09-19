(pkg => {
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
        
        ICON_CHRONAL ='⏲', // ⏲ ⌚ ♾
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
                colorMegaDark:'#310',
                colorUltraDark:'#420',
                colorDark:'#530',
                colorMedium:'#990',
                colorMedLight:'#bb0',
                colorLight:'#cc0',
                colorExtraLight:'#dd0',
                colorUltraLight:'#ff9', 
                colorBtn:'#a50',
                fontSizeMedium:'14px',
                fontSizeLarge:'16px',
                fontSizeVeryLarge:'20px',
                fontFamilyMono:'SpaceMono'
            },
            
            // Game Config
            cfg: {
                EVENT_ID_THE_VOID:'the_void',
                EVENT_ID_TIME_CORPS_HQ:'time_corps_hq',
                
                TRAVEL_MODE_WAIT:'wait',
                TRAVEL_MODE_WALK:'walk',
                
                // The absolute minimum chronal needed to deploy an Agent from HQ or jump from
                // another Event.
                MIN_DEPLOY_CHRONAL:1,
                
                // The absolute minimum chronal needed to recall an Agent to HQ.
                MIN_RECALL_CHRONAL:1,
                
                // The starting maximum chronal an Agent can have.
                AGENT_CHRONAL_LIMIT:15,
                
                // The starting maximum paradox an Agent can have.
                AGENT_PARADOX_LIMIT:3,
                
                // The absolute maximum discovery per investigate.
                MAX_DISCOVERY_PER_INVESTIGATE:25,
                
                // The starting maximum paradox an Event can have.
                EVENT_PARADOX_LIMIT:4,
                
                // The default actions allowed by an Agent per visit within an Event.
                DEFAULT_ACTION_LIMIT:1,
                
                // FIXME: I'm not sure we have a use for these two. Possibly this is the HQ limit 
                // for resupply.
                TIMELINE_STARTING_CHRONAL:16,
                TIMELINE_CHRONAL_LIMIT:24,
                
                // The amount of paradox the Timeline begins the game with.
                TIMELINE_STARTING_PARADOX:0,
                
                // The starting maximum paradox for the Timeline.
                TIMELINE_PARADOX_LIMIT:9,
                
                
                //// Timeline UI Config ////
                TL_COMPACT:true,
                
                // The maximum length of the next/prev Event history.
                MAX_HISTORY_LENGTH:1000,
                
                // The curvature value used by Splines within the Timeline.
                SPLINE_CURVATURE:0.25,
                
                TL_BOX_VISIBLE_HEIGHT_THRESHOLD:20,
                TL_SCROLL_TO_PADDING:-16,
                TL_ROW_HEADER_WIDTH:125,
                TL_COL_WIDTH:120,
                TL_COL_SPACING:1,
                TL_CLICK_TO_DESELECT:false
            },
            
            // Chronal Util
            getChronalToDeploy: (agentModel, eventModel) => {
                const eventTime = eventModel.getStart(),
                    agentEvent = agentModel.getEventModel(),
                    getFunc = agentEvent.id === TC.cfg.EVENT_ID_TIME_CORPS_HQ ? getChronalEfficiently : getChronalByTimeDiff,
                    cost = getFunc(agentEvent.getEnd(), eventTime);
                return mathMax(TC.cfg.MIN_DEPLOY_CHRONAL, cost);
            },
            
            getChronalToRecall: agentModel => {
                const agentEvent = agentModel.getEventModel(),
                    cost = getChronalEfficiently(TC.model.getEventModel(TC.cfg.EVENT_ID_TIME_CORPS_HQ).getStart(), agentEvent.getEnd()) / 2;
                return mathMax(TC.cfg.MIN_RECALL_CHRONAL, cost);
            },
            
            // Constraint Scopes
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
            
            // Icons
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
            ICON_SEARCH:'?'
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
