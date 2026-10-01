(pkg => {
    'use strict';
    
    /*  For models with a still image and, optionally, a video version of it. The files live 
        at IMAGE_ROOT/<folder>/<id>.jpg and .webm. The .jpg is always required since it's 
        the fallback if the video can't play, and it's what small views like timeline 
        headers and agent markers use.
        
        Attributes:
            video:boolean - True if there's also a .webm. Set with "video":true in the data.
        
        Hooks:
            getMediaFolder() - Required. The folder under IMAGE_ROOT, e.g. "agent". */
    pkg.MediaSupport = new JS.Module('MediaSupport', {
        setVideo: function(v) {this.video = v === true;},
        hasVideo: function() {return this.video === true;},
        
        getImageUrl: function() {return pkg.IMAGE_ROOT + this.getMediaFolder() + '/' + this.id + '.jpg';},
        getVideoUrl: function() {return this.hasVideo() ? pkg.IMAGE_ROOT + this.getMediaFolder() + '/' + this.id + '.webm' : null;},
        
        /*  The arguments for MediaView.setMedia, i.e. [imageUrl, videoUrl or null]. */
        getMediaUrls: function() {return [this.getImageUrl(), this.getVideoUrl()];}
    });
})(tc);
