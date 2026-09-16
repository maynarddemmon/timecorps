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
                cornerRadius:5,
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
            
            // Game Properties //
            EVENT_ID_THE_VOID:'the_void',
            EVENT_ID_TIME_CORPS_HQ:'time_corps_hq',
            
            MIN_DEPLOY_CHRONAL:1,
            MIN_RECALL_CHRONAL:1,
            
            // Chronal Util
            getChronalToDeploy: (agentModel, eventModel) => {
                const eventTime = eventModel.getStart(),
                    agentEvent = agentModel.getEventModel(),
                    getFunc = agentEvent.id === TC.EVENT_ID_TIME_CORPS_HQ ? getChronalEfficiently : getChronalByTimeDiff,
                    cost = getFunc(agentEvent.getEnd(), eventTime);
                return mathMax(TC.MIN_DEPLOY_CHRONAL, cost);
            },
            
            getChronalToRecall: agentModel => {
                const agentEvent = agentModel.getEventModel(),
                    cost = getChronalEfficiently(pkg.tc.model.getEventModel(TC.EVENT_ID_TIME_CORPS_HQ).getStart(), agentEvent.getEnd()) / 2;
                return mathMax(TC.MIN_RECALL_CHRONAL, cost);
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
})(window);
