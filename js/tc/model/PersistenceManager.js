(pkg => {
    'use strict';
    
    const {stableStringify, downloadObjectAsJSON} = myt,
        
        SAVE_FORMAT_VERSION = 1,
        DEFAULT_STORAGE_KEY = 'tc.save',
        
        isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v),
        
        /*  The parts of cur that differ from base. Objects recurse so only changed keys are
            kept and unchanged models drop out entirely. Arrays and primitives are kept whole
            when they differ. Returns undefined when nothing differs. */
        diff = pkg.diffForSave = (base, cur) => {
            if (isObj(base) && isObj(cur)) {
                let retval;
                for (const key in cur) {
                    const d = diff(base[key], cur[key]);
                    if (d !== undefined) (retval ??= {})[key] = d;
                }
                return retval;
            }
            return stableStringify(base) === stableStringify(cur) ? undefined : cur;
        },
        
        readStorage = key => {
            try {
                const txt = localStorage.getItem(key);
                return txt ? JSON.parse(txt) : null;
            } catch (err) {
                console.warn('Unable to read save', key, err);
                return null;
            }
        },
        
        prepareData = persistanceManager => {
            return {
                version:SAVE_FORMAT_VERSION,
                savedAt:new Date().toISOString(),
                data:persistanceManager.exportDiff()
            };
        },
        
        /*  Returns why a record can't be used as a save, or null if it can. Only checks the
            outline. Problems deeper in the data are caught when it is restored. */
        validateRecord = record => {
            if (!isObj(record)) return 'it is not a Time Corps save file';
            if (record.version !== SAVE_FORMAT_VERSION) return 'it is from an unsupported version (' + record.version + ')';
            if (!isObj(record.data)) return 'it has no save data';
            return null;
        };
    
    /*  Saves and restores a campaign to localStorage. Only what differs from a baseline is
        saved, where the baseline is the model's export taken right after a fresh campaign
        starts. A save is later applied on top of that same fresh campaign.
        
        Saved record: {version, savedAt:<ISO string>, data:<diff of model.exportToObj()>} */
    pkg.PersistenceManager = new JS.Class('PersistenceManager', {
        // Life Cycle //////////////////////////////////////////////////////////
        initialize: function(model, storageKey=DEFAULT_STORAGE_KEY) {
            this.model = model;
            this.storageKey = storageKey;
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        /*  False until captureBaseline is called, which happens once startup finishes. */
        hasBaseline: function() {return this.baseline != null;},
        
        /*  The Date of the last save, or null if there is no save. */
        getLastSavedDate: function() {
            const savedAt = readStorage(this.storageKey)?.savedAt;
            return savedAt ? new Date(savedAt) : null;
        },
        
        hasSave: function() {return readStorage(this.storageKey) != null;},
        
        
        // Methods /////////////////////////////////////////////////////////////
        captureBaseline: function() {
            this.baseline = structuredClone(this.model.exportToObj());
        },
        
        exportDiff: function() {
            if (!this.baseline) throw new Error('PersistenceManager: no baseline captured');
            return diff(this.baseline, this.model.exportToObj()) ?? {};
        },
        
        save: function(record=prepareData(this)) {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(record));
                return true;
            } catch (err) {
                console.error('Save failed', err);
                return false;
            }
        },
        
        /*  Returns null on success, otherwise the reason it failed. Nothing is written on failure,
            so the existing save is untouched. */
        importRecord: function(record) {
            const problem = validateRecord(record);
            if (problem) return problem;
            return this.save({...record, savedAt:record.savedAt ?? new Date().toISOString()}) ? null : 'the browser blocked storage for this site';
        },
        
        /*  Returns null if a save was restored or there was none, otherwise the reason it failed. 
            A failed restore may have partly changed the model, so the save is cleared and the 
            caller should reload. */
        restore: function() {
            const record = readStorage(this.storageKey);
            if (!record) return null;
            
            let problem = validateRecord(record);
            if (!problem) {
                try {
                    this.importDiff(record.data);
                } catch (err) {
                    console.error('Restore failed', err);
                    problem = 'it could not be applied';
                }
            }
            if (problem) this.clear();
            return problem;
        },
        
        export: function() {
            downloadObjectAsJSON(prepareData(this), 'timecorps-save');
        },
        
        /*  Constraint binding is paused so restored constraints bind in one pass once
            everything is in place. Some state can only be applied after that. */
        importDiff: function(data) {
            const model = this.model;
            pkg.pauseConstraintBinding();
            try {
                model.importFromObj(data);
            } finally {
                pkg.resumeConstraintBinding();
            }
            model.completeImportFromObj(data);
        },
        
        clear: function() {
            try {
                localStorage.removeItem(this.storageKey);
            } catch (err) {
                console.warn('Unable to clear save', err);
            }
        }
    });
})(tc);
