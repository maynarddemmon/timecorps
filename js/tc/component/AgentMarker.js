(pkg => {
    'use strict';
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, PlainText} = M,
        
        {
            theme:{
                spacing, padding, btnHeight,
                colorUltraLight, colorMedium, colorDark, colorUltraDark, colorMegaDark,
                fontSizeMicro, fontSizeMedium,
                colorHistoricity, colorAttestation, colorParadox
            }
        } = pkg,
        
        /** A circular AgentMarker that shows a photo and the ID on mouseover. */
        BaseAgentMarker = pkg.BaseAgentMarker = new JSClass('BaseAgentMarker', View, {
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
                
                const photoInset = attrs.photoInset ??= 1,
                    size = attrs.size ??= btnHeight;
                attrs.width = attrs.height = size;
                
                self.callSuper(parent, attrs);
                
                self._photo = new View(self, {imageSize:'contain'}, [M.ImageSupport]);
                self._idTxt = new PlainText(self, {
                    align:'center', valign:'middle', fontSize:fontSizeMicro, textColor:colorUltraLight,
                    visible:false
                });
                
                self._updateLook();
            },
            
            setSize: function(v) {
                this.set('size', v, true);
                if (this.inited) this._updateLook();
            },
            
            _updateLook: function() {
                const {_photo, size, photoInset, photoBgColor} = this;
                
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
            },
            
            setModel: function(v) {
                this.set('model', v, true);
                this._updateForAgentModel();
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
            }
        }),
        
        SimpleAgentMarker = pkg.SimpleAgentMarker = new JSClass('SimpleAgentMarker', BaseAgentMarker, {
            doActivated: function() {
                console.log('FIXME: open an agent dossier dialog.', this.model);
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
