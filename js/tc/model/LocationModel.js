(pkg => {
    pkg.LocationModel = new JS.Class('LocationModel', myt.BaseModel, {
        setName: function(name) {this.set('name', name, true);},
        setColor: function(color) {this.set('color', color, true);},
        setTextColor: function(color) {this.set('textColor', color, true);},
        setOrder: function(order) {this.set('order', order, true);}
    });
})(tc);