(pkg => {
    'use strict';
    
    const {Class:JSClass, Module:JSModule} = JS,
        
        {BaseModel, NOOP} = myt,
        
        /*  One phrase of a description. "hidden" accepts a boolean or a constraint expression
            resolved against the owner's constraint scope, so a phrase on an Event sees 
            "event..." as that Event and a phrase on a Causator sees its parent Event. */
        DescriptionPhraseModel = pkg.DescriptionPhraseModel = new JSClass('DescriptionPhraseModel', BaseModel, {
            include: [pkg.ConstrainableAttrSupport, pkg.Hideable],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            init: function(attrs) {
                this.owner = attrs.owner;
                delete attrs.owner;
                this.hidden = false;
                this.callSuper(attrs);
            },
            
            
            // Accessors ///////////////////////////////////////////////////////
            setText: function(text) {this.set('text', text, true);},
            getText: function() {return this.text;},
            
            getConstraintScope: function() {return this.owner.getConstraintScope();},
            
            doHiddenChanged: function(_hidden) {
                // Changes during our own init, or the owner's, are not news to anyone.
                const owner = this.owner;
                if (this.inited && owner.inited) owner.doDescriptionChanged();
            }
        });
    
    /*  Gives a model a "description" configured as an Array of zero or more phrases. Each 
        phrase is a String or an Object {text, hidden} where hidden is a boolean or a 
        constraint expression. A bare String is treated as a single phrase.
        
        Requires: ConstrainableAttrSupport (directly or via a sibling mixin) since phrase
        constraints resolve against the host's getConstraintScope().
        
        Hooks:
            doDescriptionChanged() - Called after init when the visible text may have changed. */
    pkg.Describable = new JSModule('Describable', {
        // Life Cycle //////////////////////////////////////////////////////////
        destroy: function() {
            this._destroyDescriptionPhrases();
            this.callSuper();
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        setDescription: function(description) {
            const self = this;
            self._destroyDescriptionPhrases();
            
            if (description == null) {
                description = [];
            } else if (!Array.isArray(description)) {
                description = [description];
            }
            
            const phrases = self._descPhrases ??= [];
            for (const phrase of description) {
                const attrs = typeof phrase === 'string' ? {text:phrase} : phrase;
                attrs.owner = self;
                phrases.push(new DescriptionPhraseModel(attrs));
            }
            
            if (self.inited) self.doDescriptionChanged();
        },
        
        /*  The visible phrases joined into a single String. Empty if nothing is visible. */
        getDescription: function(joiner=' ') {
            return this.getVisibleDescriptionPhrases().map(phrase => phrase.getText()).join(joiner);
        },
        
        getDescriptionPhrases: function() {return this._descPhrases ?? [];},
        getVisibleDescriptionPhrases: function() {
            return this.getDescriptionPhrases().filter(phrase => !phrase.isHidden());
        },
        
        doDescriptionChanged: NOOP, // function() {}
        
        
        // Methods /////////////////////////////////////////////////////////////
        _destroyDescriptionPhrases: function() {
            const phrases = this._descPhrases;
            if (phrases) {
                for (const phrase of phrases) phrase.destroy();
                phrases.length = 0;
            }
        }
    });
})(tc);