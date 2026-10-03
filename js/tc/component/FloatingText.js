(pkg => {
    'use strict';
    
    let pool;
    
    const M = myt,
        
        {theme:{colorBtn, fontSizeSmall, fontFamilyMono}} = pkg,
        
        DEFAULT_DURATION = 2000,
        DEFAULT_RISE = 20,
        
        /*  Text style for each show. All of these are set every time so a reused instance doesn't
            keep the style of whatever it showed before. */
        STYLE_DEFAULTS = {
            textColor:colorBtn,
            bgColor:'', // Not undefined, which the DOM ignores, leaving the last bgColor.
            fontFamily:fontFamilyMono,
            fontSize:fontSizeSmall,
            fontWeight:'normal',
            fontStyle:'normal'
        },
        
        /*  A short piece of text that floats up and fades away, e.g. a die roll result. It never
            intercepts the mouse so it can't get in the way of the UI under it. Use 
            pkg.showFloatingText rather than making these directly so they're pooled. */
        FloatingText = pkg.FloatingText = new JS.Class('FloatingText', M.PaddedText, {
            include: [M.Reusable],
            
            
            // Life Cycle //////////////////////////////////////////////////////
            initNode: function(parent, attrs) {
                attrs.pointerEvents = 'none';
                attrs.ignoreLayout = true;
                attrs.visible = false;
                attrs.paddingTop = 4;
                attrs.paddingRight = 8;
                attrs.paddingBottom = 4;
                attrs.paddingLeft = 8;
                attrs.roundedCorners = 12;
                
                this.callSuper(parent, attrs);
                
                // Centers the text on x with its bottom at y, whatever its size.
                this.getODS().transform = 'translate(-50%, -100%)';
            },
            
            
            // Methods /////////////////////////////////////////////////////////
            /*  Shows the text at x,y (its bottom center) then floats it up and fades it out. The 
                callback is called once it's gone. */
            float: function(text, x, y, attrs, callback) {
                const self = this,
                    {duration=DEFAULT_DURATION, rise=DEFAULT_RISE, ...styleAttrs} = attrs ?? {};
                
                self.callSetters({...STYLE_DEFAULTS, ...styleAttrs, text, x, y, opacity:1, visible:true});
                self.makeHighestZIndex();
                
                self.animate({attribute:'y', to:y - rise, duration, easingFunction:'outQuad'});
                self.animate({attribute:'opacity', to:0, duration, easingFunction:'inQuad', callback});
            },
            
            /** @overrides myt.Reusable */
            clean: function() {
                this.stopActiveAnimators();
                this.setVisible(false);
            }
        }),
        
        getPool = () => pool ??= new M.TrackActivesPool(FloatingText, pkg.app);
    
    /*  Shows text at x,y in the App's coordinates (the same as page coordinates). The text is 
        centered on x with its bottom at y, then floats up and fades away. Any number can be 
        showing at once.
        
        attrs is optional:
            duration:number - Milliseconds to float and fade. Defaults to 2000.
            rise:number - Pixels to float up. Defaults to 20.
            Any Text attribute, e.g. textColor, bgColor, fontSize, fontWeight, fontStyle or 
                fontFamily. The defaults are colorBtn on no background and the monospaced font 
                at fontSizeSmall.
        
        Returns the FloatingText. */
    pkg.showFloatingText = (text, attrs, x, y) => {
        const p = getPool(),
            floatingText = p.getInstance();
        
        // Putting it back stops its animations, so this only runs for a show that finished.
        floatingText.float(text, x, y, attrs, () => {p.putInstance(floatingText);});
        return floatingText;
    };
    
    /*  Shows text centered just above a view. Returns the FloatingText. */
    pkg.showFloatingTextAboveView = (view, text, attrs) => {
        const pos = view.getPagePosition();
        // More pleasing to begin centered over the view.
        return pkg.showFloatingText(text, attrs, pos.x + view.width / 2, pos.y);
    };
})(tc);
