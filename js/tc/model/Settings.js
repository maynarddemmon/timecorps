(pkg => {
    'use strict';
    
    const STORAGE_KEY = 'tc.settings',
        
        SETTING_SAVE_ON_OPERATION_COMPLETION = pkg.SETTING_SAVE_ON_OPERATION_COMPLETION = 'saveOnOperationCompletion',
        
        /*  Every player setting. The SettingsDialog builds its UI from this list, so adding a
            setting here is enough to make it appear there. */
        DEFINITIONS = [{
            id:SETTING_SAVE_ON_OPERATION_COMPLETION,
            type:'boolean',
            defaultValue:true,
            label:'Save on mission completion',
            description:'Automatically save your progress each time a mission is completed.'
        }],
        
        DEFINITIONS_BY_ID = new Map(DEFINITIONS.map(def => [def.id, def])),
        
        /*  Only settings that differ from their defaults are stored, so changing a default
            later reaches every player who hasn't changed that setting. Unknown or mistyped
            entries are dropped. */
        readOverrides = () => {
            const retval = {};
            try {
                const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
                if (stored && typeof stored === 'object') {
                    for (const id in stored) {
                        const def = DEFINITIONS_BY_ID.get(id),
                            value = stored[id];
                        if (def && typeof value === def.type && value !== def.defaultValue) retval[id] = value;
                    }
                }
            } catch (err) {
                console.warn('Unable to read settings', err);
            }
            return retval;
        },
        
        writeOverrides = overrides => {
            try {
                if (Object.keys(overrides).length > 0) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }
            } catch (err) {
                console.warn('Unable to store settings', err);
            }
        },
        
        overrides = readOverrides();
    
    /*  Player settings that persist across campaigns. Kept apart from the campaign save so
        Restart Campaign and importing a save leave them alone. */
    pkg.settings = {
        getDefinitions: () => DEFINITIONS,
        
        get: id => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (def) {
                return id in overrides ? overrides[id] : def.defaultValue;
            } else {
                console.warn('Unknown setting', id);
            }
        },
        
        set: (id, value) => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (!def) {
                console.warn('Unknown setting', id);
            } else if (typeof value !== def.type) {
                console.warn('Setting', id, 'must be a', def.type, 'but got:', value);
            } else {
                if (value === def.defaultValue) {
                    delete overrides[id];
                } else {
                    overrides[id] = value;
                }
                writeOverrides(overrides);
            }
        }
    };
})(tc);
