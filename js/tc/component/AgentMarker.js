(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, RadialGauge} = M,
        
        {
            theme:{
                spacing, padding, btnHeight,
                colorUltraLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                fontSizeMicro, fontSizeMedium,
                colorHistoricity, colorAttestation, colorParadox, colorChronal, colorAction
            },
            STAT_ID_CHRONAL, STAT_ID_PARADOX
        } = pkg,
        
        /** A circular AgentMarker that shows a photo and the ID on mouseover. */
        AbstractAgentMarker = new JSClass('AbstractAgentMarker', View, {
            include: [M.Button],
            
            initNode: function(parent, attrs) {
                const self = this;
                
                // Do disabled late since domClass will step on it.
                self.appendToLateAttrs('disabled');
                
                attrs.userUnselectable ??= true;
                attrs.focusable ??= true;
                attrs.focusIndicator ??= false;
                
                attrs.bgColor ??= colorMegaDark;
                attrs.photoBgColor ??= colorMedium;
                const idFontSize = attrs.idFontSize ??= fontSizeMicro,
                    photoInset = attrs.photoInset ??= 1,
                    size = attrs.size ??= btnHeight;
                attrs.width = attrs.height = size;
                
                self.callSuper(parent, attrs);
                
                self.attachDomObserver(self, '_doDblClick', 'dblclick');
                
                self._photo = new View(self, {imageSize:'contain'}, [M.ImageSupport]);
                self._idTxt = new M.PlainText(self, {
                    align:'center', valign:'middle', fontSize:idFontSize, textColor:colorUltraLight,
                    visible:false
                });
                
                self._updateLook();
                self._updateForAgentModel();
            },
            
            setSize: function(v) {
                this.set('size', v, true);
                if (this.inited) this._updateLook();
            },
            
            _updateLook: function() {
                const {_photo, _idTxt, idFontSize, size, photoInset, photoBgColor} = this;
                
                this.setWidth(size);
                this.setHeight(size);
                this.setRoundedCorners(size / 2);
                
                // Update Photo
                const photoSize = size - 2*photoInset;
                _photo.setX(photoInset);
                _photo.setY(photoInset);
                _photo.setWidth(photoSize);
                _photo.setHeight(photoSize);
                _photo.setRoundedCorners(photoSize/2);
                _photo.setBgColor(photoBgColor);
                
                _idTxt.setFontSize(idFontSize);
            },
            
            setModel: function(v) {
                this.set('model', v, true);
                if (this.inited) this._updateForAgentModel();
            },
            
            _updateForAgentModel: function() {
                const model = this.model;
                if (model) {
                    const id = model.id;
                    this._photo.setImageUrl(pkg.IMAGE_ROOT + id + '.jpg');
                    this._idTxt.setText(id);
                }
            },
            
            updateUI: function() {
                this.callSuper();
                this._idTxt?.setVisible(this.mouseOver);
                this._photo?.setOpacity(this.mouseOver ? 0.25 : 1);
            },
            
            _doDblClick: function(event) {
                if (!this.disabled) this.doDoubleClick();
            },
            doDoubleClick: M.NOOP
        }),
        
        SimpleAgentMarker = pkg.SimpleAgentMarker = new JSClass('SimpleAgentMarker', AbstractAgentMarker, {
            doActivated: function() {
                pkg.app.selectAgentRow(this.model);
            },
            doDoubleClick: function() {
                console.log('FIXME: open an agent dossier dialog.', this.model);
            }
        }),
        
        StatusAgentMarker = pkg.StatusAgentMarker = new JSClass('StatusAgentMarker', SimpleAgentMarker, {
            initNode: function(parent, attrs) {
                const self = this,
                    thickness = attrs.thickness ??= 1;
                delete attrs.thickness;
                
                attrs.bgColor ??= '#000';
                
                self.callSuper(parent, attrs);
                
                let w = (self.width / 2) - thickness,
                    inset = 0;
                for (const [type,color] of [
                    ['action',colorAction],
                    ['chronal',colorChronal],
                    ['paradox',colorParadox]
                ]) {
                    self[type + 'Gauge'] = new RadialGauge(self, {
                        x:inset, y:inset, radius:w, thickness, color,
                        borderColor:'#0009', bgColor:'transparent'
                    }, [{
                        getTooltipByValue: value => '',
                        getTextByValue: value => ''
                    }]);
                    w -= thickness;
                    inset += thickness;
                }
                
                self._updateForAgentModel();
            },
            
            _updateForAgentModel: function() {
                const {model, chronalGauge, paradoxGauge, actionGauge} = this;
                if (model && chronalGauge) {
                    this.callSuper();
                    
                    const statChronal = model[STAT_ID_CHRONAL],
                        statParadox = model[STAT_ID_PARADOX];
                    chronalGauge.setMinValue(statChronal.getMin());
                    chronalGauge.setMaxValue(statChronal.getMax());
                    chronalGauge.setValue(statChronal.getValue());
                    paradoxGauge.setMinValue(statParadox.getMin());
                    paradoxGauge.setMaxValue(statParadox.getMax());
                    paradoxGauge.setValue(statParadox.getValue());
                    actionGauge.setMaxValue(model.getEventActionLimit());
                    actionGauge.setValue(model.getActionsRemaining());
                }
            },
        });
    
    pkg.StatusAgentMarkerMedium = new JSClass('StatusAgentMarkerMedium', StatusAgentMarker, {
        initNode: function(parent, attrs) {
            attrs.thickness ??= 2;
            attrs.size ??= 2*btnHeight;
            attrs.idFontSize ??= fontSizeMedium;
            this.callSuper(parent, attrs);
        }
    });
    
    pkg.SimpleAgentGridMarker = new JSClass('SimpleAgentGridMarker', SimpleAgentMarker, {
        include: [M.MouseEventsBubbleUp],
        
        initNode: function(parent, attrs) {
            attrs.y ??= 1;
            this.callSuper(parent, attrs);
        }
    });
})(tc);
