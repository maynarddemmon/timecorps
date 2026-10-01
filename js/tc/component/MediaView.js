(pkg => {
    'use strict';
    
    const M = myt,
        {View, SizeToParent, NOOP} = M,
        
        {cornerRadius} = pkg.theme,
        
        FILL_ATTRS = {percentOfParentWidth:100, percentOfParentHeight:100};
    
    /*  Shows a video with an image as its fallback, or just an image. The video is muted,
        looping and autoplaying, so it behaves like an animated photo. If the video can't play
        (a missing file, or a browser without WebM support) the image is shown instead.
        
        Attributes:
            fit:string - How the media fits the view: 'contain' (the default) or 'cover'. Only
                read at init.
        
        Hooks:
            doMediaReady() - The image or video loaded and is showing.
            doMediaFailed() - Nothing could be shown, i.e. there's no image or it failed too. */
    pkg.MediaView = new JS.Class('MediaView', View, {
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            const self = this,
                fit = attrs.fit ?? 'contain';
            delete attrs.fit;
            attrs.roundedCorners ??= cornerRadius;
            attrs.overflow ??= 'hidden'; // Clips the media to roundedCorners.
            
            self.callSuper(parent, attrs);
            
            self._image = new View(self, {
                ...FILL_ATTRS, imageSize:fit, visible:false,
                calculateNaturalSize:true // Makes setNaturalWidth/setImageLoadingError fire.
            }, [SizeToParent, M.ImageSupport, {
                setNaturalWidth: function(v) {
                    this.callSuper(v);
                    if (v > 0 && self._isShowingImage()) self.doMediaReady();
                },
                setImageLoadingError: function(v) {
                    this.callSuper(v);
                    if (v && self._isShowingImage()) {
                        this.setVisible(false);
                        self.doMediaFailed();
                    }
                }
            }]);
            
            // Muted so browsers allow it to autoplay. Inline so iOS doesn't go fullscreen.
            const video = self._video = new View(self, {...FILL_ATTRS, tagName:'video', visible:false}, [SizeToParent]),
                videoElem = video.getIDE();
            videoElem.muted = videoElem.loop = videoElem.autoplay = videoElem.playsInline = true;
            videoElem.style.objectFit = fit;
            
            // The guards ignore events from a video that has since been cleared or replaced.
            videoElem.addEventListener('loadeddata', () => {
                if (self._isShowingVideo()) self.doMediaReady();
            });
            videoElem.addEventListener('error', () => {
                if (self._isShowingVideo()) self._showImage();
            });
        },
        
        
        // Accessors ///////////////////////////////////////////////////////////
        getImageView: function() {return this._image;},
        getVideoView: function() {return this._video;},
        
        /*  True while the video, rather than the fallback image, is the media being shown. */
        isShowingVideo: function() {return this._isShowingVideo();},
        
        
        // Methods /////////////////////////////////////////////////////////////
        /*  Shows the video if a videoUrl is given, falling back to the image, otherwise just
            the image. */
        setMedia: function(imageUrl, videoUrl) {
            const self = this;
            self._imageUrl = imageUrl || null;
            self._videoUrl = videoUrl || null;
            if (self._videoUrl) {
                self._showVideo();
            } else {
                self._showImage();
            }
        },
        
        /*  Hides everything and stops the video so a hidden view isn't decoding video. */
        clearMedia: function() {
            this._imageUrl = this._videoUrl = null;
            this._stopVideo();
            this._image.setVisible(false);
        },
        
        doMediaReady: NOOP, // () => {}
        doMediaFailed: NOOP, // () => {}
        
        /** @private */
        _isShowingImage: function() {return this._imageUrl != null && this._image.visible;},
        
        /** @private */
        _isShowingVideo: function() {return this._videoUrl != null && this._video.visible;},
        
        /** @private */
        _showImage: function() {
            const self = this,
                image = self._image,
                imageUrl = self._imageUrl;
            self._stopVideo();
            if (imageUrl) {
                image.setVisible(true);
                image.setImageUrl(imageUrl);
            } else {
                image.setVisible(false);
                self.doMediaFailed();
            }
        },
        
        /** @private */
        _showVideo: function() {
            const video = this._video,
                videoElem = video.getIDE();
            this._image.setVisible(false);
            video.setVisible(true);
            videoElem.src = this._videoUrl;
            
            // play() rejects if playback is interrupted, e.g. the view is cleared first, which
            // is fine to ignore. A real load failure goes to the error listener.
            videoElem.play()?.catch(NOOP);
        },
        
        /** @private */
        _stopVideo: function() {
            const video = this._video,
                videoElem = video.getIDE();
            video.setVisible(false);
            if (videoElem.getAttribute('src')) {
                videoElem.pause();
                videoElem.removeAttribute('src');
                videoElem.load();
            }
        }
    });
})(tc);
