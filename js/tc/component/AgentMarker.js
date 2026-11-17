(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, PlainText, RadialGauge} = M,
        
        {
            theme:{
                btnHeight,
                colorUltraLight, colorLight, colorMedium, colorMegaDark,
                fontSizeMicro, fontSizeMedium,
                colorParadox, colorChronal, colorHealth, colorAction
            },
            STAT_ID_CHRONAL, STAT_ID_PARADOX, STAT_ID_HEALTH
        } = pkg,
        
        /*  The rings of a StatusAgentMarker, from the outside in. */
        GAUGE_TYPES = [
            ['action', colorAction],
            [STAT_ID_HEALTH, colorHealth],
            [STAT_ID_CHRONAL, colorChronal],
            [STAT_ID_PARADOX, colorParadox]
        ],
        
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
                attrs.photoInset ??= 1;
                attrs.statusFontSize ??= '23px';
                attrs.idFontSize ??= fontSizeMicro;
                const size = attrs.size ??= btnHeight;
                attrs.width = attrs.height = size;
                
                // Everything is drawn at this size, and scaled with the size from it, so a 
                // marker can be resized, e.g. grown on mouseover, and stay sharp.
                self._baseSize = size;
                self._statusOffset = [5, -4];
                
                self.callSuper(parent, attrs);
                
                self.attachDomObserver(self, '_doDblClick', 'dblclick');
                
                self._photo = new View(self, {imageSize:'contain'}, [M.ImageSupport]);
                self._statusTxt = new PlainText(self, {textColor:colorLight});
                self._idTxt = new PlainText(self, {
                    align:'center', valign:'middle', textColor:colorUltraLight, visible:false
                });
                
                self._updateLook();
                self._updateForAgentModel();
            },
            
            setSize: function(v) {
                this.set('size', v, true);
                if (this.inited) this._updateLook();
            },
            
            /*  How much bigger the marker is than the size it was made at. */
            getLookScale: function() {return this.size / this._baseSize;},
            
            _updateLook: function() {
                const {_photo, _idTxt, idFontSize, statusFontSize, size, photoInset, photoBgColor} = this,
                    scale = this.getLookScale();
                
                this.setWidth(size);
                this.setHeight(size);
                this.setRoundedCorners(size / 2);
                
                // Update Photo
                const inset = photoInset * scale,
                    photoSize = size - 2*inset;
                _photo.setX(inset);
                _photo.setY(inset);
                _photo.setWidth(photoSize);
                _photo.setHeight(photoSize);
                _photo.setRoundedCorners(photoSize/2);
                _photo.setBgColor(photoBgColor);
                
                _idTxt.setFontSize((parseFloat(idFontSize) * scale) + 'px');
                this._statusTxt.setFontSize((parseFloat(statusFontSize) * scale) + 'px');
                this.placeStatusTxt(...this._statusOffset);
            },
            
            /*  Puts the status icon at x, y for the marker at the size it was made at. */
            placeStatusTxt: function(x, y) {
                this._statusOffset = [x, y];
                const scale = this.getLookScale();
                this._statusTxt.setX(x * scale);
                this._statusTxt.setY(y * scale);
            },
            
            setModel: function(v) {
                this.set('model', v, true);
                if (this.inited) this._updateForAgentModel();
            },
            
            _updateForAgentModel: function() {
                const self = this,
                    model = self.model;
                if (model) {
                    self._photo.setImageUrl(model.getImageUrl());
                    self._idTxt.setText(model.id);
                    
                    const statusTxt = self._statusTxt;
                    statusTxt.setText('');
                    if (model.isDead()) {
                        self.addDomClass('agent-dead');
                        statusTxt.setText(pkg.ICON_DEATH);
                        self.placeStatusTxt(5, -4);
                    } else {
                        self.removeDomClass('agent-dead');
                    }
                    
                    if (model.isDevoured()) {
                        self.addDomClass('agent-devoured');
                        statusTxt.setText(pkg.ICON_THE_VOID);
                        self.placeStatusTxt(4, -3);
                    } else {
                        self.removeDomClass('agent-devoured');
                    }
                }
            },
            
            updateUI: function() {
                const self = this,
                    mouseOver = self.mouseOver,
                    isAgentToken = self.isA(pkg.AgentToken);
                
                self.callSuper();
                
                if (!isAgentToken) {
                    self._idTxt?.setVisible(mouseOver);
                    self._photo?.setOpacity(mouseOver ? 0.5 : 1);
                }
                self._statusTxt?.setVisible(!mouseOver);
            },
            
            _doDblClick: function(_event) {
                if (!this.disabled) this.doDoubleClick();
            },
            doDoubleClick: M.NOOP
        }),
        
        SimpleAgentMarker = pkg.SimpleAgentMarker = new JSClass('SimpleAgentMarker', AbstractAgentMarker, {
            doActivated: function() {this.model.selectRow();},
            doDoubleClick: function() {pkg.app.openAgentDossier(this.model);}
        }),
        
        StatusAgentMarker = pkg.StatusAgentMarker = new JSClass('StatusAgentMarker', SimpleAgentMarker, {
            initNode: function(parent, attrs) {
                const self = this,
                    thickness = attrs.thickness ??= 1;
                delete attrs.thickness;
                
                attrs.bgColor ??= '#000';
                
                self.callSuper(parent, attrs);
                
                self._gauges = GAUGE_TYPES.map(([type, color]) => self[type + 'Gauge'] = new RadialGauge(self, {
                    thickness, color, borderColor:'#0009', bgColor:'transparent'
                }, [{
                    getTooltipByValue: _value => '',
                    getTextByValue: _value => ''
                }]));
                self._thickness = thickness;
                self._updateLook();
                
                self._updateForAgentModel();
            },
            
            /*  The rings nest inside one another, from the edge in, each as thick as the 
                thickness, scaled with the marker. RadialGauge can't be resized, so its ring 
                (an Annulus) is resized here too. */
            _updateLook: function() {
                this.callSuper();
                
                const gauges = this._gauges;
                if (gauges) {
                    const thickness = this._thickness * this.getLookScale();
                    let radius = (this.size / 2) - thickness,
                        inset = 0;
                    for (const gauge of gauges) {
                        gauge.setX(inset);
                        gauge.setY(inset);
                        gauge.setWidth(2*radius);
                        gauge.setHeight(2*radius);
                        gauge.setRoundedCorners(radius + thickness);
                        gauge.setBorderWidth(thickness);
                        gauge.thickness = thickness;
                        gauge.radius = radius;
                        const ring = gauge.__prgsVw;
                        ring.setX(-thickness);
                        ring.setY(-thickness);
                        ring.setRadius(radius);
                        ring.setThickness(thickness);
                        radius -= thickness;
                        inset += thickness;
                    }
                }
            },
            
            _updateForAgentModel: function() {
                const {model, healthGauge, chronalGauge, paradoxGauge, actionGauge} = this;
                if (model && chronalGauge) {
                    this.callSuper();
                    
                    for (const [gauge, statModel] of [
                        [healthGauge, model[STAT_ID_HEALTH]],
                        [chronalGauge, model[STAT_ID_CHRONAL]],
                        [paradoxGauge, model[STAT_ID_PARADOX]]
                    ]) {
                        gauge.setMinValue(statModel.getMin());
                        gauge.setMaxValue(statModel.getMax());
                        gauge.setValue(statModel.getValue());
                    }
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
            attrs.statusFontSize ??= '46px';
            this.callSuper(parent, attrs);
            
            this.placeStatusTxt(10, -9);
        },
        
        _updateForAgentModel: function() {
            const self = this,
                model = self.model;
            if (model) {
                self.callSuper();
                
                if (model.isDead()) self.placeStatusTxt(10, -9);
                if (model.isDevoured()) self.placeStatusTxt(8, -7);
            }
        }
    });
    
    pkg.SimpleAgentGridMarker = new JSClass('SimpleAgentGridMarker', SimpleAgentMarker, {
        initNode: function(parent, attrs) {
            attrs.y ??= 1;
            this.callSuper(parent, attrs);
        }
    });
})(tc);
