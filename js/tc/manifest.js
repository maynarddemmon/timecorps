JS.Packages(file => {
    const TC_ROOT = globalThis.TC_ROOT ?? '',
        COMPONENT_ROOT = TC_ROOT + 'component/',
        MODEL_ROOT = TC_ROOT + 'model/',
        VIEW_ROOT = TC_ROOT + 'view/';
    
    file(TC_ROOT + '../../lib/myt.min.js').provides('myt.all');
    file(TC_ROOT + 'tc.js').provides('tc').requires('myt.all');
    file(TC_ROOT + 'timeUtil.js').provides('tc.timeUtil').requires('tc');
    
    // Component //
    file(COMPONENT_ROOT + 'AgentMarker.js').provides('tc.SimpleAgentMarker','tc.SimpleAgentGridMarker').requires('tc');
    file(COMPONENT_ROOT + 'Btn.js').provides('tc.Btn','tc.AgentBtn','tc.SquareBtn','tc.UnderlineBtn').requires('tc.SimpleAgentMarker');
    file(COMPONENT_ROOT + 'Grid.js').provides('tc.InfiniteGridWrapper').requires('tc.Btn');
    file(COMPONENT_ROOT + 'ProgressBars.js').provides(
        'tc.HistoricityBar','tc.AttestationBar','tc.ParadoxBar','tc.ChronalBar','tc.MiniStatBar','tc.BigStatBar'
    ).requires('tc');
    file(COMPONENT_ROOT + 'Misc.js').provides(
        'tc.Spacer','tc.WideView','tc.Panel','tc.MiniPanel','tc.LabeledValue'
    ).requires('tc');
    file(COMPONENT_ROOT + 'Dialogs.js').provides('tc.dialogUtil','tc.ModalDialog').requires('tc.SquareBtn','tc.WideView','tc.Panel');
    
    // Model //
    file(MODEL_ROOT + 'Constraints.js').provides('tc.setConstrainedValue').requires('tc');
    file(MODEL_ROOT + 'NumericStatModel.js').provides('tc.NumericStatModel','tc.NotifyingNumericStatModel').requires('tc');
    file(MODEL_ROOT + 'Hideable.js').provides('tc.Hideable','tc.ConstrainableAttrSupport').requires('tc.setConstrainedValue');
    file(MODEL_ROOT + 'Describable.js').provides('tc.Describable','tc.DescriptionPhraseModel').requires('tc.Hideable');
    
    file(MODEL_ROOT + 'LocationModel.js').provides('tc.LocationModel').requires('tc.Describable');
    file(MODEL_ROOT + 'AgentModel.js').provides('tc.AgentModel').requires(
        'tc.NotifyingNumericStatModel','tc.Describable'
    );
    file(MODEL_ROOT + 'EventModel.js').provides('tc.EventModel').requires(
        'tc.timeUtil','tc.Describable','tc.NotifyingNumericStatModel'
    );
    file(MODEL_ROOT + 'OperationModel.js').provides('tc.OperationModel').requires('tc.Describable');
    file(MODEL_ROOT + 'Model.js').provides('tc.Model').requires(
        'tc.LocationModel','tc.AgentModel','tc.EventModel','tc.OperationModel'
    );
    file(MODEL_ROOT + 'PersistenceManager.js').provides('tc.PersistenceManager').requires('tc.Model');
    file(MODEL_ROOT + 'Settings.js').provides('tc.settings').requires('tc');
    
    // View //
    file(VIEW_ROOT + 'Agents.js').provides('tc.Agents').requires(
        'tc.timeUtil','tc.Panel','tc.InfiniteGridWrapper','tc.SimpleAgentGridMarker','tc.ParadoxBar','tc.ChronalBar','tc.BigStatBar'
    );
    file(VIEW_ROOT + 'TimelineCompact.js').provides('tc.TimelineCompact').requires(
        'tc.timeUtil','tc.Panel','tc.SquareBtn','tc.SimpleAgentMarker','tc.HistoricityBar','tc.AttestationBar','tc.ParadoxBar','tc.MiniStatBar','tc.BigStatBar'
    );
    file(VIEW_ROOT + 'EventDetails.js').provides('tc.EventDetails').requires(
        'tc.timeUtil','tc.WideView','tc.Panel','tc.MiniPanel','tc.AgentBtn','tc.SimpleAgentMarker','tc.HistoricityBar','tc.AttestationBar','tc.ParadoxBar'
    );
    file(VIEW_ROOT + 'OperationDetails.js').provides('tc.OperationDetails').requires(
        'tc.timeUtil','tc.WideView','tc.Panel','tc.MiniPanel','tc.UnderlineBtn'
    );
    file(VIEW_ROOT + 'AgentDossier.js').provides('tc.AgentDossier').requires('tc.ModalDialog');
    file(VIEW_ROOT + 'AreaBrief.js').provides('tc.AreaBrief').requires('tc.ModalDialog');
    file(VIEW_ROOT + 'SettingsDialog.js').provides('tc.SettingsDialog').requires('tc.ModalDialog','tc.settings');
    
    // Include Everything
    file(TC_ROOT + 'App.js').provides('tc.App').requires(
        'tc.Model','tc.PersistenceManager','tc.Agents','tc.Spacer','tc.WideView','tc.Panel','tc.dialogUtil',
        'tc.TimelineCompact','tc.EventDetails','tc.OperationDetails','tc.AgentDossier','tc.AreaBrief','tc.SettingsDialog'
    );
});
