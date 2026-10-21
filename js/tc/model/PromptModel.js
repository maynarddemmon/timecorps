(pkg => {
    'use strict';
    
    const PROMPT_TYPE_ACK = 'ack',
        PROMPT_TYPE_CONFIRM = 'confirm',
        
        BUTTON_ID_CONFIRM = 'confirm',
        BUTTON_ID_CANCEL = 'cancel',
        
        // The buttons each type of prompt has, by ID.
        BUTTON_IDS_BY_TYPE = {
            [PROMPT_TYPE_ACK]:[BUTTON_ID_CONFIRM],
            [PROMPT_TYPE_CONFIRM]:[BUTTON_ID_CONFIRM, BUTTON_ID_CANCEL]
        },
        
        isPlainObject = pkg.isPlainObject;
    
    /*  A message the player answers with a button, e.g. an offer to join the Time Corps.
        Actions, exits and Operations open one by its ID with "prompt". Configured in the
        "prompts" data, in any data file, as:
            type - "ack", one button, or "confirm", two. Defaults to "ack".
            title - The dialog's title.
            description - Describable phrases, the message.
            hidden - A constraint expression. A hidden prompt doesn't open.
            buttons - By ID: "confirm" for either type, and "cancel" for a confirm. Each is
                {label, onClick}, both optional. label replaces the dialog's default, and
                onClick is {set, adj}, applied as a success when the button is clicked.
                Cancel's also applies when the dialog is closed any other way.
        
        A prompt has no agent or Event of its own, so its expressions name them by ID, e.g.
        "agents.ME.faction", as an Operation's do. */
    pkg.PromptModel = new JS.Class('PromptModel', myt.BaseModel, {
        include: [pkg.DescribableHideable],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        init: function(attrs) {
            this.hidden = false;
            
            // Applied after the id, which warnings name. The type first, since it says which
            // buttons there can be.
            const {type, buttons} = attrs;
            delete attrs.type;
            delete attrs.buttons;
            
            this.callSuper(attrs);
            
            if (type !== undefined) this.setType(type);
            this.setButtons(buttons);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setType: function(type) {
            if (!Object.hasOwn(BUTTON_IDS_BY_TYPE, type)) {
                console.warn('Prompt', this.id, 'type must be "' + PROMPT_TYPE_ACK + '" or "' + PROMPT_TYPE_CONFIRM + '" (using "' + PROMPT_TYPE_ACK + '"):', type);
                type = PROMPT_TYPE_ACK;
            }
            this.set('type', type, true);
        },
        getType: function() {return this.type ?? PROMPT_TYPE_ACK;},
        
        setTitle: function(title) {this.set('title', title, true);},
        getTitle: function() {return this.title ?? '';},
        
        setButtons: function(buttons) {
            const buttonIds = BUTTON_IDS_BY_TYPE[this.getType()],
                retval = {};
            for (const buttonId in buttons ?? {}) {
                const where = 'Prompt ' + this.id + ' button ' + buttonId,
                    {label, onClick, ...rest} = buttons[buttonId] ?? {};
                if (!buttonIds.includes(buttonId)) {
                    console.warn(where, 'is not a button of its type, "' + this.getType() + '", which has', buttonIds.join(' and '), '(ignoring it)');
                    continue;
                }
                if (Object.keys(rest).length > 0) console.warn(where, 'has keys other than label and onClick (ignoring them):', Object.keys(rest).join(', '));
                if (label !== undefined && typeof label !== 'string') console.warn(where, 'label must be a string (ignoring it):', label);
                if (onClick !== undefined && !isPlainObject(onClick)) console.warn(where, 'onClick must be an object of set and adj (ignoring it):', onClick);
                retval[buttonId] = {
                    label:typeof label === 'string' ? label : undefined,
                    changes:isPlainObject(onClick) ? pkg.readSuccessChanges(where + ' onClick', onClick, 'a prompt') : null
                };
            }
            this.buttons = retval;
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Shows the prompt once the dialogs ahead of it have closed. It's waiting until a 
            button is clicked. */
        show: function(finallyCallback) {
            const {openAckMsgDialog, openConfirmMsgDialog} = pkg.dialogUtil,
                {confirm, cancel} = this.buttons,
                click = button => () => {
                    pkg.applySuccessChanges(button?.changes);
                    finallyCallback?.();
                },
                title = this.getTitle(),
                msg = this.getDescription();
            if (this.getType() === PROMPT_TYPE_CONFIRM) {
                openConfirmMsgDialog(title, msg, click(confirm), click(cancel), confirm?.label, cancel?.label);
            } else {
                openAckMsgDialog(title, msg, click(confirm), null, confirm?.label);
            }
        }
    });
    
    /*  Reads the "prompt" of an action, exit or Operation: a prompt's ID, or undefined, with a
        warning starting with where, if it isn't one. Prompts can be in data loaded later, so
        whether the ID names a prompt is only known when it's opened. */
    pkg.readPromptId = (where, promptId) => {
        if (promptId === undefined || (typeof promptId === 'string' && promptId.trim() !== '')) return promptId;
        console.warn(where, 'prompt must be the ID of a prompt (ignoring it):', promptId);
    };
    
    /*  Requests the prompt with the ID, and shows it if it's waiting. */
    pkg.openPrompt = (where, promptId, finallyCallback) => {
        if (promptId) {
            const promptModel = pkg.model.getPromptModel(promptId);
            if (promptModel) {
                if (promptModel.isNotHidden()) {
                    promptModel.show(finallyCallback);
                    return;
                }
            } else {
                console.warn(where, 'opens no prompt', promptId);
            }
        }
        finallyCallback?.();
    };
})(tc);
