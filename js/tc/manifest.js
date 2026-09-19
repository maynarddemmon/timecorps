JS.Packages(file => {
    const TC_ROOT = globalThis.TC_ROOT ?? '',
        COMPONENT_ROOT = TC_ROOT + 'component/',
        MODEL_ROOT = TC_ROOT + 'model/';
    
    file(TC_ROOT + '../../lib/myt.min.js').provides('myt.all');
    file(TC_ROOT + 'tc.js').provides('tc').requires('myt.all');
    file(TC_ROOT + 'timeUtil.js').provides('tc.timeUtil').requires('tc');
    
    file(COMPONENT_ROOT + 'Misc.js').provides(
        'tc.Spacer','tc.WideView','tc.Panel','tc.MiniPanel','tc.LabeledValue'
    ).requires('tc');
    file(COMPONENT_ROOT + 'Btn.js').provides('tc.Btn','tc.SquareBtn').requires('tc');
    file(COMPONENT_ROOT + 'Grid.js').provides('tc.InfiniteGridWrapper').requires('tc.Btn');
    
    file(MODEL_ROOT + 'Constraints.js').provides('tc.setConstrainedValue').requires('tc');
    file(MODEL_ROOT + 'NumericStatModel.js').provides('tc.NumericStatModel','tc.NotifyingNumericStatModel').requires('tc');
    file(MODEL_ROOT + 'LocationModel.js').provides('tc.LocationModel').requires('tc');
    file(MODEL_ROOT + 'AgentModel.js').provides('tc.AgentModel').requires('tc.NotifyingNumericStatModel');
    file(MODEL_ROOT + 'EventModel.js').provides('tc.EventModel').requires(
        'tc.timeUtil','tc.setConstrainedValue','tc.NotifyingNumericStatModel'
    );
    file(MODEL_ROOT + 'Model.js').provides('tc.Model').requires(
        'tc.LocationModel','tc.AgentModel','tc.EventModel'
    );
    
    file(TC_ROOT + 'Agents.js').provides('tc.Agents').requires(
        'tc.timeUtil','tc.Panel','tc.InfiniteGridWrapper'
    );
    file(TC_ROOT + 'TimelineCompact.js').provides('tc.TimelineCompact').requires(
        'tc.timeUtil','tc.Panel','tc.SquareBtn'
    );
    file(TC_ROOT + 'EventDetails.js').provides('tc.EventDetails').requires(
        'tc.timeUtil','tc.WideView','tc.Panel','tc.MiniPanel','tc.Btn'
    );
    file(TC_ROOT + 'App.js').provides('tc.App').requires(
        'tc.Model','tc.Agents','tc.Spacer','tc.WideView','tc.Panel',
        'tc.TimelineCompact','tc.EventDetails'
    );
    
    // Include Everything
    file(TC_ROOT + 'all.js').provides('tc.all').requires('tc.App');
});
