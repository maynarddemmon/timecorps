JS.Packages(file => {
    const TC_ROOT = globalThis.TC_ROOT ?? '';
    
    file(TC_ROOT + '../../lib/myt.min.js').provides('myt.all');
    file(TC_ROOT + 'tc.js').provides('tc').requires('myt.all');
    
    file(TC_ROOT + 'Model.js').provides('tc.Model').requires('tc');
    file(TC_ROOT + 'Agents.js').provides('tc.Agents').requires('tc');
    file(TC_ROOT + 'Timeline.js').provides('tc.Timeline').requires('tc');
    file(TC_ROOT + 'EventDetails.js').provides('tc.EventDetails').requires('tc');
    file(TC_ROOT + 'App.js').provides('tc.App').requires('tc.Model','tc.Agents','tc.Timeline','tc.EventDetails');
    
    // Include Everything
    file(TC_ROOT + 'all.js').provides('tc.all').requires('tc.App');
});
