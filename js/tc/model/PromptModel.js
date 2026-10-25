(pkg => {
    'use strict';
    
    const PROMPT_TYPE_ACK = 'ack',
        PROMPT_TYPE_CONFIRM = 'confirm',
        PROMPT_TYPE_TEXT = 'text',
        PROMPT_TYPES = [PROMPT_TYPE_ACK, PROMPT_TYPE_CONFIRM, PROMPT_TYPE_TEXT],
        
        BUTTON_ID_CONFIRM = 'confirm',
        BUTTON_ID_CANCEL = 'cancel',
        
        // The buttons each type of prompt has, by ID.
        BUTTON_IDS_BY_TYPE = {
            [PROMPT_TYPE_ACK]:[BUTTON_ID_CONFIRM],
            [PROMPT_TYPE_CONFIRM]:[BUTTON_ID_CONFIRM, BUTTON_ID_CANCEL],
            [PROMPT_TYPE_TEXT]:[BUTTON_ID_CONFIRM]
        },
        
        INPUT_KEYS = ['scratch', 'maxLength', 'allowedChars', 'placeholder'],
        
        isPlainObject = pkg.isPlainObject;
    
    /*  A message the player answers with a button, e.g. an offer to join the Time Corps.
        Actions, exits and Operations open one by its ID with "prompt". Configured in the
        "prompts" data, in any data file, as:
            type - "ack", one button, "confirm", two, or "text", a text field and one 
                button. Defaults to "ack".
            title - The dialog's title.
            description - Describable phrases, the message.
            hidden - A constraint expression. A hidden prompt doesn't open.
            buttons - By ID: "confirm" for either type, and "cancel" for a confirm. Each is
                {label, onClick}, both optional. label replaces the dialog's default, and
                onClick is {set, adj}, applied as a success when the button is clicked.
                Cancel's also applies when the dialog is closed any other way.
            input - For a "text" prompt: {scratch, maxLength, allowedChars, placeholder}.
                scratch, required, names the scratch entry the text is put in, trimmed, when
                confirm is clicked, before its onClick. The field starts with that entry's
                value, and confirm can't be clicked while the field is blank. maxLength 
                limits the length, allowedChars is a string of the characters that can be 
                typed, and placeholder shows while the field is empty.
        
        A prompt has no agent or Event of its own, so its expressions name them by ID, e.g.
        "agents.ME.faction", as an Operation's do. */
    pkg.PromptModel = new JS.Class('PromptModel', myt.BaseModel, {
        include: [pkg.DescribableHideable],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        init: function(attrs) {
            this.hidden = false;
            
            // Applied after the id, which warnings name. The type first, since it says which
            // buttons there can be.
            const {type, buttons, input} = attrs;
            delete attrs.type;
            delete attrs.buttons;
            delete attrs.input;
            
            this.callSuper(attrs);
            
            if (type !== undefined) this.setType(type);
            this.setButtons(buttons);
            this.setInput(input);
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setType: function(type) {
            if (!PROMPT_TYPES.includes(type)) {
                console.warn('Prompt', this.id, 'type must be "' + PROMPT_TYPES.join('", "') + '" (using "' + PROMPT_TYPE_ACK + '"):', type);
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
        
        /*  Only a "text" prompt has an input, and it must have one with a scratch entry. 
            Anything else wrong with it is left out, with a warning. */
        setInput: function(input) {
            const where = 'Prompt ' + this.id + ' input',
                isText = this.getType() === PROMPT_TYPE_TEXT;
            this.input = null;
            if (input === undefined) {
                if (isText) console.warn(where, 'is missing, which a "' + PROMPT_TYPE_TEXT + '" prompt needs (using "' + PROMPT_TYPE_ACK + '")');
            } else if (!isText) {
                console.warn(where, 'is only for a "' + PROMPT_TYPE_TEXT + '" prompt (ignoring it)');
            } else if (!isPlainObject(input) || typeof input.scratch !== 'string' || input.scratch.trim() === '') {
                console.warn(where, 'must be an object with the name of a scratch entry as "scratch" (using "' + PROMPT_TYPE_ACK + '"):', input);
            } else {
                const {scratch, maxLength, allowedChars, placeholder, ...rest} = input;
                if (Object.keys(rest).length > 0) console.warn(where, 'has keys other than', INPUT_KEYS.join(', '), '(ignoring them):', Object.keys(rest).join(', '));
                const validMaxLength = Number.isInteger(maxLength) && maxLength > 0,
                    validAllowedChars = typeof allowedChars === 'string' && allowedChars !== '',
                    validPlaceholder = typeof placeholder === 'string';
                if (maxLength !== undefined && !validMaxLength) console.warn(where, 'maxLength must be a whole number above 0 (ignoring it):', maxLength);
                if (allowedChars !== undefined && !validAllowedChars) console.warn(where, 'allowedChars must be a string of characters (ignoring it):', allowedChars);
                if (placeholder !== undefined && !validPlaceholder) console.warn(where, 'placeholder must be a string (ignoring it):', placeholder);
                this.input = {
                    scratch,
                    maxLength:validMaxLength ? maxLength : undefined,
                    allowedChars:validAllowedChars ? allowedChars : undefined,
                    placeholder:validPlaceholder ? placeholder : undefined
                };
            }
            
            // A text prompt that can't take text is shown as an ack.
            if (isText && !this.input) this.set('type', PROMPT_TYPE_ACK, true);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Shows the prompt once the dialogs ahead of it have closed, worked out as it 
            opens. Clicking a button applies its changes, then calls finallyCallback, so 
            whatever comes next waits for the answer. */
        show: function(finallyCallback) {
            const {openAckMsgDialog, openConfirmMsgDialog, openTextInputDialog, openWhenClear} = pkg.dialogUtil,
                {buttons:{confirm, cancel}, input} = this,
                click = button => () => {
                    pkg.applySuccessChanges(button?.changes);
                    finallyCallback?.();
                };
            openWhenClear(() => {
                const title = this.getTitle(),
                    msg = this.getDescription(),
                    type = this.getType();
                if (type === PROMPT_TYPE_CONFIRM) {
                    openConfirmMsgDialog(title, msg, click(confirm), click(cancel), confirm?.label, cancel?.label);
                } else if (type === PROMPT_TYPE_TEXT) {
                    const rootModel = pkg.model,
                        current = rootModel[pkg.SCOPE_SCRATCH][input.scratch];
                    openTextInputDialog(title, msg, text => {
                        rootModel.setScratch(input.scratch, text);
                        click(confirm)();
                    }, {...input, value:typeof current === 'string' ? current : ''}, confirm?.label);
                } else {
                    openAckMsgDialog(title, msg, click(confirm), null, confirm?.label);
                }
            });
        }
    });
    
    /*  Reads the "prompt" of an action, exit or Operation: a prompt's ID, or undefined, with a
        warning starting with where, if it isn't one. Prompts can be in data loaded later, so
        whether the ID names a prompt is only known when it's opened. */
    pkg.readPromptId = (where, promptId) => {
        if (promptId === undefined || (typeof promptId === 'string' && promptId.trim() !== '')) return promptId;
        console.warn(where, 'prompt must be the ID of a prompt (ignoring it):', promptId);
    };
    
    /*  Shows the prompt with the ID, unless it's hidden, and calls finallyCallback once it's 
        answered, or at once if there's no prompt to show. where starts the warning if there's
        no such prompt. */
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
