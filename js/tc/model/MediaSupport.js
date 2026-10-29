(pkg => {
    'use strict';
    
    const
        /*  The file the model shows, relative to its folder: what imageExpr works out to, if 
            that's a non-empty string, otherwise image, otherwise the model's default. */
        resolveImageFile = model => {
            const fromExpr = model.imageFromExpr;
            if (typeof fromExpr === 'string' && fromExpr.trim() !== '') return fromExpr.trim();
            return model.imageData ?? model.getDefaultImageFile();
        },
        
        /*  Lets what shows the model's media know the file may have changed. */
        notifyImageChanged = model => {
            if (model.inited) model.notifyCollectionOfUpdate();
        };
    
    /*  For models with a still image and, optionally, a video version of it. The files live 
        at cfg.IMAGE_BASE_DIR/<folder>/, by default <id>.jpg and <id>.webm. The .jpg is always 
        required since it's the fallback if the video can't play, and it's what small views 
        like timeline headers and agent markers use.
        
        Attributes:
            image:string - The .jpg to show instead of the default, as a path from the folder, 
                e.g. "collision_struck.jpg" or "../location/titanic_bridge.jpg".
            imageExpr:string - A constraint expression for such a path, so the image can 
                follow the game, e.g. "event.values.struck.value ? 'collision_struck.jpg' : ''".
                While it works out to a non-empty string it's shown instead of image.
            video:boolean - True if there's also a <id>.webm. Set with "video":true in the data.
        
        Hooks:
            getMediaFolder() - Required. The folder under cfg.IMAGE_BASE_DIR, e.g. "agent".
            getDefaultImageFile() - The file shown without image or imageExpr, or null for 
                none. Defaults to "<id>.jpg". */
    pkg.MediaSupport = new JS.Module('MediaSupport', {
        setImage: function(v) {
            if (v == null || typeof v === 'string') {
                this.imageData = v || null;
                notifyImageChanged(this);
            } else if (v === true) {
                console.warn(this.getMediaFolder(), this.id, 'image:true isn\'t needed, since it shows', this.getDefaultImageFile(), 'by default (ignoring it)');
            } else {
                console.warn(this.getMediaFolder(), this.id, 'image must be a path to a .jpg from its folder (ignoring it):', v);
            }
        },
        
        setImageExpr: function(v, isActual) {
            if (isActual) {
                if (this.imageFromExpr !== v) {
                    this.imageFromExpr = v;
                    notifyImageChanged(this);
                }
            } else {
                pkg.setConstrainedValue(this.getConstraintScope(), this, 'imageExpr', String(v));
            }
        },
        
        getDefaultImageFile: function() {return this.id + '.jpg';},
        
        /*  The .jpg shown, as a path from the folder, or null for none. */
        getImageFile: function() {return resolveImageFile(this);},
        
        setVideo: function(v) {this.video = v === true;},
        hasVideo: function() {return this.video === true;},
        
        getImageUrl: function() {
            const file = this.getImageFile();
            return file ? pkg.cfg.IMAGE_BASE_DIR + this.getMediaFolder() + '/' + file : null;
        },
        getVideoUrl: function() {return this.hasVideo() ? pkg.cfg.IMAGE_BASE_DIR + this.getMediaFolder() + '/' + this.id + '.webm' : null;},
        
        /*  The arguments for MediaView.setMedia, i.e. [imageUrl or null, videoUrl or null]. */
        getMediaUrls: function() {return [this.getImageUrl(), this.getVideoUrl()];}
    });
})(tc);
