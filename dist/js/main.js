/*
 * Hammer.JS
 * version 0.4
 * author: Eight Media
 * https://github.com/EightMedia/hammer.js
 */
function Hammer(element, options, undefined)
{
    var self = this;

    var defaults = {
        // prevent the default event or not... might be buggy when false
        prevent_default    : false,
        css_hacks          : true,

        drag               : true,
        drag_vertical      : true,
        drag_horizontal    : true,
        // minimum distance before the drag event starts
        drag_min_distance  : 20, // pixels

        // pinch zoom and rotation
        transform          : true,
        scale_treshold     : 0.1,
        rotation_treshold  : 15, // degrees

        tap                : true,
        tap_double         : true,
        tap_max_interval   : 300,
        tap_double_distance: 20,

        hold               : true,
        hold_timeout       : 500
    };
    options = mergeObject(defaults, options);

    // some css hacks
    (function() {
        if(!options.css_hacks) {
            return false;
        }

        var vendors = ['webkit','moz','ms','o',''];
        var css_props = {
            "userSelect": "none",
            "touchCallout": "none",
            "userDrag": "none",
            "tapHighlightColor": "rgba(0,0,0,0)"
        };

        var prop = '';
        for(var i = 0; i < vendors.length; i++) {
            for(var p in css_props) {
                prop = p;
                if(vendors[i]) {
                    prop = vendors[i] + prop.substring(0, 1).toUpperCase() + prop.substring(1);
                }
                element.style[ prop ] = css_props[p];
            }
        }
    })();

    // holds the distance that has been moved
    var _distance = 0;

    // holds the exact angle that has been moved
    var _angle = 0;

    // holds the diraction that has been moved
    var _direction = 0;

    // holds position movement for sliding
    var _pos = { };

    // how many fingers are on the screen
    var _fingers = 0;

    var _first = false;

    var _gesture = null;
    var _prev_gesture = null;

    var _touch_start_time = null;
    var _prev_tap_pos = {x: 0, y: 0};
    var _prev_tap_end_time = null;

    var _hold_timer = null;

    var _offset = {};

    // keep track of the mouse status
    var _mousedown = false;

    var _event_start;
    var _event_move;
    var _event_end;


    /**
     * angle to direction define
     * @param  float    angle
     * @return string   direction
     */
    this.getDirectionFromAngle = function( angle )
    {
        var directions = {
            down: angle >= 45 && angle < 135, //90
            left: angle >= 135 || angle <= -135, //180
            up: angle < -45 && angle > -135, //270
            right: angle >= -45 && angle <= 45 //0
        };

        var direction, key;
        for(key in directions){
            if(directions[key]){
                direction = key;
                break;
            }
        }
        return direction;
    };


    /**
     * count the number of fingers in the event
     * when no fingers are detected, one finger is returned (mouse pointer)
     * @param  event
     * @return int  fingers
     */
    function countFingers( event )
    {
        // there is a bug on android (until v4?) that touches is always 1,
        // so no multitouch is supported, e.g. no, zoom and rotation...
        return event.touches ? event.touches.length : 1;
    }


    /**
     * get the x and y positions from the event object
     * @param  event
     * @return array  [{ x: int, y: int }]
     */
    function getXYfromEvent( event )
    {
        event = event || window.event;

        // no touches, use the event pageX and pageY
        if(!event.touches) {
            var doc = document,
                body = doc.body;

            return [{
                x: event.pageX || event.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && doc.clientLeft || 0 ),
                y: event.pageY || event.clientY + ( doc && doc.scrollTop || body && body.scrollTop || 0 ) - ( doc && doc.clientTop || body && doc.clientTop || 0 )
            }];
        }
        // multitouch, return array with positions
        else {
            var pos = [], src;
            for(var t=0, len=event.touches.length; t<len; t++) {
                src = event.touches[t];
                pos.push({ x: src.pageX, y: src.pageY });
            }
            return pos;
        }
    }


    /**
     * calculate the angle between two points
     * @param object pos1 { x: int, y: int }
     * @param object pos2 { x: int, y: int }
     */
    function getAngle( pos1, pos2 )
    {
        return Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x) * 180 / Math.PI;
    }

    /**
     * trigger an event/callback by name with params
     * @param string name
     * @param array  params
     */
    function triggerEvent( eventName, params )
    {
        // return touches object
        params.touches = getXYfromEvent(params.originalEvent);
        params.type = eventName;

        // trigger callback
        if(isFunction(self["on"+ eventName])) {
            self["on"+ eventName].call(self, params);
        }
    }


    /**
     * cancel event
     * @param   object  event
     * @return  void
     */

    function cancelEvent(event){
        event = event || window.event;
        if(event.preventDefault){
            event.preventDefault();
        }else{
            event.returnValue = false;
            event.cancelBubble = true;
        }
    }


    /**
     * reset the internal vars to the start values
     */
    function reset()
    {
        _pos = {};
        _first = false;
        _fingers = 0;
        _distance = 0;
        _angle = 0;
        _gesture = null;
    }


    var gestures = {
        // hold gesture
        // fired on touchstart
        hold : function(event)
        {
            // only when one finger is on the screen
            if(options.hold) {
                _gesture = 'hold';
                clearTimeout(_hold_timer);

                _hold_timer = setTimeout(function() {
                    if(_gesture == 'hold') {
                        triggerEvent("hold", {
                            originalEvent   : event,
                            position        : _pos.start
                        });
                    }
                }, options.hold_timeout);
            }
        },


        // drag gesture
        // fired on mousemove
        drag : function(event)
        {
            // get the distance we moved
            var _distance_x = _pos.move[0].x - _pos.start[0].x;
            var _distance_y = _pos.move[0].y - _pos.start[0].y;
            _distance = Math.sqrt(_distance_x * _distance_x + _distance_y * _distance_y);

            // drag
            // minimal movement required
            if(options.drag && (_distance > options.drag_min_distance) || _gesture == 'drag') {
                // calculate the angle
                _angle = getAngle(_pos.start[0], _pos.move[0]);
                _direction = self.getDirectionFromAngle(_angle);

                // check the movement and stop if we go in the wrong direction
                var is_vertical = (_direction == 'up' || _direction == 'down');
                if(((is_vertical && !options.drag_vertical) || (!is_vertical && !options.drag_horizontal))
                    && (_distance > options.drag_min_distance)) {
                    return;
                }

                _gesture = 'drag';

                var position = { x: _pos.move[0].x - _offset.left,
                    y: _pos.move[0].y - _offset.top };

                var event_obj = {
                    originalEvent   : event,
                    position        : position,
                    direction       : _direction,
                    distance        : _distance,
                    distanceX       : _distance_x,
                    distanceY       : _distance_y,
                    angle           : _angle
                };

                // on the first time trigger the start event
                if(_first) {
                    triggerEvent("dragstart", event_obj);

                    _first = false;
                }

                // normal slide event
                triggerEvent("drag", event_obj);

                cancelEvent(event);
            }
        },


        // transform gesture
        // fired on touchmove
        transform : function(event)
        {
            if(options.transform) {
                var scale = event.scale || 1;
                var rotation = event.rotation || 0;

                if(countFingers(event) != 2) {
                    return false;
                }

                if(_gesture != 'drag' &&
                    (_gesture == 'transform' || Math.abs(1-scale) > options.scale_treshold
                        || Math.abs(rotation) > options.rotation_treshold)) {
                    _gesture = 'transform';

                    _pos.center = {  x: ((_pos.move[0].x + _pos.move[1].x) / 2) - _offset.left,
                        y: ((_pos.move[0].y + _pos.move[1].y) / 2) - _offset.top };

                    var event_obj = {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : scale,
                        rotation        : rotation
                    };

                    // on the first time trigger the start event
                    if(_first) {
                        triggerEvent("transformstart", event_obj);
                        _first = false;
                    }

                    triggerEvent("transform", event_obj);

                    cancelEvent(event);

                    return true;
                }
            }

            return false;
        },


        // tap and double tap gesture
        // fired on touchend
        tap : function(event)
        {
            // compare the kind of gesture by time
            var now = new Date().getTime();
            var touch_time = now - _touch_start_time;

            // dont fire when hold is fired
            if(options.hold && !(options.hold && options.hold_timeout > touch_time)) {
                return;
            }

            // when previous event was tap and the tap was max_interval ms ago
            var is_double_tap = (function(){
                if (_prev_tap_pos && options.tap_double && _prev_gesture == 'tap' && (_touch_start_time - _prev_tap_end_time) < options.tap_max_interval) {
                    var x_distance = Math.abs(_prev_tap_pos[0].x - _pos.start[0].x);
                    var y_distance = Math.abs(_prev_tap_pos[0].y - _pos.start[0].y);
                    return (_prev_tap_pos && _pos.start && Math.max(x_distance, y_distance) < options.tap_double_distance);

                }
                return false;
            })();

            if(is_double_tap) {
                _gesture = 'double_tap';
                _prev_tap_end_time = null;

                triggerEvent("doubletap", {
                    originalEvent   : event,
                    position        : _pos.start
                });
                cancelEvent(event);
            }

            // single tap is single touch
            else {
                _gesture = 'tap';
                _prev_tap_end_time = now;
                _prev_tap_pos = _pos.start;

                if(options.tap) {
                    triggerEvent("tap", {
                        originalEvent   : event,
                        position        : _pos.start
                    });
                    cancelEvent(event);
                }
            }

        }

    };


    function handleEvents(event)
    {
        switch(event.type)
        {
            case 'mousedown':
            case 'touchstart':
                _pos.start = getXYfromEvent(event);
                _touch_start_time = new Date().getTime();
                _fingers = countFingers(event);
                _first = true;
                _event_start = event;

                // borrowed from jquery offset https://github.com/jquery/jquery/blob/master/src/offset.js
                var box = element.getBoundingClientRect();
                var clientTop  = element.clientTop  || document.body.clientTop  || 0;
                var clientLeft = element.clientLeft || document.body.clientLeft || 0;
                var scrollTop  = window.pageYOffset || element.scrollTop  || document.body.scrollTop;
                var scrollLeft = window.pageXOffset || element.scrollLeft || document.body.scrollLeft;

                _offset = {
                    top: box.top + scrollTop - clientTop,
                    left: box.left + scrollLeft - clientLeft
                };

                _mousedown = true;

                // hold gesture
                gestures.hold(event);

                if(options.prevent_default) {
                    cancelEvent(event);
                }
                break;

            case 'mousemove':
            case 'touchmove':
                if(!_mousedown) {
                    return false;
                }
                _event_move = event;
                _pos.move = getXYfromEvent(event);

                if(!gestures.transform(event)) {
                    gestures.drag(event);
                }
                break;

            case 'mouseup':
            case 'mouseout':
            case 'touchcancel':
            case 'touchend':
                if(!_mousedown || (_gesture != 'transform' && event.touches && event.touches.length > 0)) {
                    return false;
                }

                _mousedown = false;
                _event_end = event;

                // drag gesture
                // dragstart is triggered, so dragend is possible
                if(_gesture == 'drag') {
                    triggerEvent("dragend", {
                        originalEvent   : event,
                        direction       : _direction,
                        distance        : _distance,
                        angle           : _angle
                    });
                }

                // transform
                // transformstart is triggered, so transformed is possible
                else if(_gesture == 'transform') {
                    triggerEvent("transformend", {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : event.scale,
                        rotation        : event.rotation
                    });
                }
                else {
                    gestures.tap(_event_start);
                }

                _prev_gesture = _gesture;

                // reset vars
                reset();
                break;
        }
    }


    // bind events for touch devices
    // except for windows phone 7.5, it doesnt support touch events..!
    if('ontouchstart' in window) {
        element.addEventListener("touchstart", handleEvents, false);
        element.addEventListener("touchmove", handleEvents, false);
        element.addEventListener("touchend", handleEvents, false);
        element.addEventListener("touchcancel", handleEvents, false);
    }
    // for non-touch
    else {

        if(element.addEventListener){ // prevent old IE errors
            element.addEventListener("mouseout", function(event) {
                if(!isInsideHammer(element, event.relatedTarget)) {
                    handleEvents(event);
                }
            }, false);
            element.addEventListener("mouseup", handleEvents, false);
            element.addEventListener("mousedown", handleEvents, false);
            element.addEventListener("mousemove", handleEvents, false);

            // events for older IE
        }else if(document.attachEvent){
            element.attachEvent("onmouseout", function(event) {
                if(!isInsideHammer(element, event.relatedTarget)) {
                    handleEvents(event);
                }
            }, false);
            element.attachEvent("onmouseup", handleEvents);
            element.attachEvent("onmousedown", handleEvents);
            element.attachEvent("onmousemove", handleEvents);
        }
    }


    /**
     * find if element is (inside) given parent element
     * @param   object  element
     * @param   object  parent
     * @return  bool    inside
     */
    function isInsideHammer(parent, child) {
        // get related target for IE
        if(!child && window.event && window.event.toElement){
            child = window.event.toElement;
        }

        if(parent === child){
            return true;
        }

        // loop over parentNodes of child until we find hammer element
        if(child){
            var node = child.parentNode;
            while(node !== null){
                if(node === parent){
                    return true;
                };
                node = node.parentNode;
            }
        }
        return false;
    }


    /**
     * merge 2 objects into a new object
     * @param   object  obj1
     * @param   object  obj2
     * @return  object  merged object
     */
    function mergeObject(obj1, obj2) {
        var output = {};

        if(!obj2) {
            return obj1;
        }

        for (var prop in obj1) {
            if (prop in obj2) {
                output[prop] = obj2[prop];
            } else {
                output[prop] = obj1[prop];
            }
        }
        return output;
    }

    function isFunction( obj ){
        return Object.prototype.toString.call( obj ) == "[object Function]";
    }
}
/*
 * Hammer.JS
 * version 0.4
 * author: Eight Media
 * https://github.com/EightMedia/hammer.js
 */
function Hammer(element, options, undefined)
{
    var self = this;

    var defaults = {
        // prevent the default event or not... might be buggy when false
        prevent_default    : false,
        css_hacks          : true,

        drag               : true,
        drag_vertical      : true,
        drag_horizontal    : true,
        // minimum distance before the drag event starts
        drag_min_distance  : 20, // pixels

        // pinch zoom and rotation
        transform          : true,
        scale_treshold     : 0.1,
        rotation_treshold  : 15, // degrees

        tap                : true,
        tap_double         : true,
        tap_max_interval   : 300,
        tap_double_distance: 20,

        hold               : true,
        hold_timeout       : 500
    };
    options = mergeObject(defaults, options);

    // some css hacks
    (function() {
        if(!options.css_hacks) {
            return false;
        }

        var vendors = ['webkit','moz','ms','o',''];
        var css_props = {
            "userSelect": "none",
            "touchCallout": "none",
            "userDrag": "none",
            "tapHighlightColor": "rgba(0,0,0,0)"
        };

        var prop = '';
        for(var i = 0; i < vendors.length; i++) {
            for(var p in css_props) {
                prop = p;
                if(vendors[i]) {
                    prop = vendors[i] + prop.substring(0, 1).toUpperCase() + prop.substring(1);
                }
                element.style[ prop ] = css_props[p];
            }
        }
    })();

    // holds the distance that has been moved
    var _distance = 0;

    // holds the exact angle that has been moved
    var _angle = 0;

    // holds the diraction that has been moved
    var _direction = 0;

    // holds position movement for sliding
    var _pos = { };

    // how many fingers are on the screen
    var _fingers = 0;

    var _first = false;

    var _gesture = null;
    var _prev_gesture = null;

    var _touch_start_time = null;
    var _prev_tap_pos = {x: 0, y: 0};
    var _prev_tap_end_time = null;

    var _hold_timer = null;

    var _offset = {};

    // keep track of the mouse status
    var _mousedown = false;

    var _event_start;
    var _event_move;
    var _event_end;


    /**
     * angle to direction define
     * @param  float    angle
     * @return string   direction
     */
    this.getDirectionFromAngle = function( angle )
    {
        var directions = {
            down: angle >= 45 && angle < 135, //90
            left: angle >= 135 || angle <= -135, //180
            up: angle < -45 && angle > -135, //270
            right: angle >= -45 && angle <= 45 //0
        };

        var direction, key;
        for(key in directions){
            if(directions[key]){
                direction = key;
                break;
            }
        }
        return direction;
    };


    /**
     * count the number of fingers in the event
     * when no fingers are detected, one finger is returned (mouse pointer)
     * @param  event
     * @return int  fingers
     */
    function countFingers( event )
    {
        // there is a bug on android (until v4?) that touches is always 1,
        // so no multitouch is supported, e.g. no, zoom and rotation...
        return event.touches ? event.touches.length : 1;
    }


    /**
     * get the x and y positions from the event object
     * @param  event
     * @return array  [{ x: int, y: int }]
     */
    function getXYfromEvent( event )
    {
        event = event || window.event;

        // no touches, use the event pageX and pageY
        if(!event.touches) {
            var doc = document,
                body = doc.body;

            return [{
                x: event.pageX || event.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && doc.clientLeft || 0 ),
                y: event.pageY || event.clientY + ( doc && doc.scrollTop || body && body.scrollTop || 0 ) - ( doc && doc.clientTop || body && doc.clientTop || 0 )
            }];
        }
        // multitouch, return array with positions
        else {
            var pos = [], src;
            for(var t=0, len=event.touches.length; t<len; t++) {
                src = event.touches[t];
                pos.push({ x: src.pageX, y: src.pageY });
            }
            return pos;
        }
    }


    /**
     * calculate the angle between two points
     * @param object pos1 { x: int, y: int }
     * @param object pos2 { x: int, y: int }
     */
    function getAngle( pos1, pos2 )
    {
        return Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x) * 180 / Math.PI;
    }

    /**
     * trigger an event/callback by name with params
     * @param string name
     * @param array  params
     */
    function triggerEvent( eventName, params )
    {
        // return touches object
        params.touches = getXYfromEvent(params.originalEvent);
        params.type = eventName;

        // trigger callback
        if(isFunction(self["on"+ eventName])) {
            self["on"+ eventName].call(self, params);
        }
    }


    /**
     * cancel event
     * @param   object  event
     * @return  void
     */

    function cancelEvent(event){
        event = event || window.event;
        if(event.preventDefault){
            event.preventDefault();
        }else{
            event.returnValue = false;
            event.cancelBubble = true;
        }
    }


    /**
     * reset the internal vars to the start values
     */
    function reset()
    {
        _pos = {};
        _first = false;
        _fingers = 0;
        _distance = 0;
        _angle = 0;
        _gesture = null;
    }


    var gestures = {
        // hold gesture
        // fired on touchstart
        hold : function(event)
        {
            // only when one finger is on the screen
            if(options.hold) {
                _gesture = 'hold';
                clearTimeout(_hold_timer);

                _hold_timer = setTimeout(function() {
                    if(_gesture == 'hold') {
                        triggerEvent("hold", {
                            originalEvent   : event,
                            position        : _pos.start
                        });
                    }
                }, options.hold_timeout);
            }
        },


        // drag gesture
        // fired on mousemove
        drag : function(event)
        {
            // get the distance we moved
            var _distance_x = _pos.move[0].x - _pos.start[0].x;
            var _distance_y = _pos.move[0].y - _pos.start[0].y;
            _distance = Math.sqrt(_distance_x * _distance_x + _distance_y * _distance_y);

            // drag
            // minimal movement required
            if(options.drag && (_distance > options.drag_min_distance) || _gesture == 'drag') {
                // calculate the angle
                _angle = getAngle(_pos.start[0], _pos.move[0]);
                _direction = self.getDirectionFromAngle(_angle);

                // check the movement and stop if we go in the wrong direction
                var is_vertical = (_direction == 'up' || _direction == 'down');
                if(((is_vertical && !options.drag_vertical) || (!is_vertical && !options.drag_horizontal))
                    && (_distance > options.drag_min_distance)) {
                    return;
                }

                _gesture = 'drag';

                var position = { x: _pos.move[0].x - _offset.left,
                    y: _pos.move[0].y - _offset.top };

                var event_obj = {
                    originalEvent   : event,
                    position        : position,
                    direction       : _direction,
                    distance        : _distance,
                    distanceX       : _distance_x,
                    distanceY       : _distance_y,
                    angle           : _angle
                };

                // on the first time trigger the start event
                if(_first) {
                    triggerEvent("dragstart", event_obj);

                    _first = false;
                }

                // normal slide event
                triggerEvent("drag", event_obj);

                cancelEvent(event);
            }
        },


        // transform gesture
        // fired on touchmove
        transform : function(event)
        {
            if(options.transform) {
                var scale = event.scale || 1;
                var rotation = event.rotation || 0;

                if(countFingers(event) != 2) {
                    return false;
                }

                if(_gesture != 'drag' &&
                    (_gesture == 'transform' || Math.abs(1-scale) > options.scale_treshold
                        || Math.abs(rotation) > options.rotation_treshold)) {
                    _gesture = 'transform';

                    _pos.center = {  x: ((_pos.move[0].x + _pos.move[1].x) / 2) - _offset.left,
                        y: ((_pos.move[0].y + _pos.move[1].y) / 2) - _offset.top };

                    var event_obj = {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : scale,
                        rotation        : rotation
                    };

                    // on the first time trigger the start event
                    if(_first) {
                        triggerEvent("transformstart", event_obj);
                        _first = false;
                    }

                    triggerEvent("transform", event_obj);

                    cancelEvent(event);

                    return true;
                }
            }

            return false;
        },


        // tap and double tap gesture
        // fired on touchend
        tap : function(event)
        {
            // compare the kind of gesture by time
            var now = new Date().getTime();
            var touch_time = now - _touch_start_time;

            // dont fire when hold is fired
            if(options.hold && !(options.hold && options.hold_timeout > touch_time)) {
                return;
            }

            // when previous event was tap and the tap was max_interval ms ago
            var is_double_tap = (function(){
                if (_prev_tap_pos && options.tap_double && _prev_gesture == 'tap' && (_touch_start_time - _prev_tap_end_time) < options.tap_max_interval) {
                    var x_distance = Math.abs(_prev_tap_pos[0].x - _pos.start[0].x);
                    var y_distance = Math.abs(_prev_tap_pos[0].y - _pos.start[0].y);
                    return (_prev_tap_pos && _pos.start && Math.max(x_distance, y_distance) < options.tap_double_distance);

                }
                return false;
            })();

            if(is_double_tap) {
                _gesture = 'double_tap';
                _prev_tap_end_time = null;

                triggerEvent("doubletap", {
                    originalEvent   : event,
                    position        : _pos.start
                });
                cancelEvent(event);
            }

            // single tap is single touch
            else {
                _gesture = 'tap';
                _prev_tap_end_time = now;
                _prev_tap_pos = _pos.start;

                if(options.tap) {
                    triggerEvent("tap", {
                        originalEvent   : event,
                        position        : _pos.start
                    });
                    cancelEvent(event);
                }
            }

        }

    };


    function handleEvents(event)
    {
        switch(event.type)
        {
            case 'mousedown':
            case 'touchstart':
                _pos.start = getXYfromEvent(event);
                _touch_start_time = new Date().getTime();
                _fingers = countFingers(event);
                _first = true;
                _event_start = event;

                // borrowed from jquery offset https://github.com/jquery/jquery/blob/master/src/offset.js
                var box = element.getBoundingClientRect();
                var clientTop  = element.clientTop  || document.body.clientTop  || 0;
                var clientLeft = element.clientLeft || document.body.clientLeft || 0;
                var scrollTop  = window.pageYOffset || element.scrollTop  || document.body.scrollTop;
                var scrollLeft = window.pageXOffset || element.scrollLeft || document.body.scrollLeft;

                _offset = {
                    top: box.top + scrollTop - clientTop,
                    left: box.left + scrollLeft - clientLeft
                };

                _mousedown = true;

                // hold gesture
                gestures.hold(event);

                if(options.prevent_default) {
                    cancelEvent(event);
                }
                break;

            case 'mousemove':
            case 'touchmove':
                if(!_mousedown) {
                    return false;
                }
                _event_move = event;
                _pos.move = getXYfromEvent(event);

                if(!gestures.transform(event)) {
                    gestures.drag(event);
                }
                break;

            case 'mouseup':
            case 'mouseout':
            case 'touchcancel':
            case 'touchend':
                if(!_mousedown || (_gesture != 'transform' && event.touches && event.touches.length > 0)) {
                    return false;
                }

                _mousedown = false;
                _event_end = event;

                // drag gesture
                // dragstart is triggered, so dragend is possible
                if(_gesture == 'drag') {
                    triggerEvent("dragend", {
                        originalEvent   : event,
                        direction       : _direction,
                        distance        : _distance,
                        angle           : _angle
                    });
                }

                // transform
                // transformstart is triggered, so transformed is possible
                else if(_gesture == 'transform') {
                    triggerEvent("transformend", {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : event.scale,
                        rotation        : event.rotation
                    });
                }
                else {
                    gestures.tap(_event_start);
                }

                _prev_gesture = _gesture;

                // reset vars
                reset();
                break;
        }
    }


    // bind events for touch devices
    // except for windows phone 7.5, it doesnt support touch events..!
    if('ontouchstart' in window) {
        element.addEventListener("touchstart", handleEvents, false);
        element.addEventListener("touchmove", handleEvents, false);
        element.addEventListener("touchend", handleEvents, false);
        element.addEventListener("touchcancel", handleEvents, false);
    }
    // for non-touch
    else {

        if(element.addEventListener){ // prevent old IE errors
            element.addEventListener("mouseout", function(event) {
                if(!isInsideHammer(element, event.relatedTarget)) {
                    handleEvents(event);
                }
            }, false);
            element.addEventListener("mouseup", handleEvents, false);
            element.addEventListener("mousedown", handleEvents, false);
            element.addEventListener("mousemove", handleEvents, false);

            // events for older IE
        }else if(document.attachEvent){
            element.attachEvent("onmouseout", function(event) {
                if(!isInsideHammer(element, event.relatedTarget)) {
                    handleEvents(event);
                }
            }, false);
            element.attachEvent("onmouseup", handleEvents);
            element.attachEvent("onmousedown", handleEvents);
            element.attachEvent("onmousemove", handleEvents);
        }
    }


    /**
     * find if element is (inside) given parent element
     * @param   object  element
     * @param   object  parent
     * @return  bool    inside
     */
    function isInsideHammer(parent, child) {
        // get related target for IE
        if(!child && window.event && window.event.toElement){
            child = window.event.toElement;
        }

        if(parent === child){
            return true;
        }

        // loop over parentNodes of child until we find hammer element
        if(child){
            var node = child.parentNode;
            while(node !== null){
                if(node === parent){
                    return true;
                };
                node = node.parentNode;
            }
        }
        return false;
    }


    /**
     * merge 2 objects into a new object
     * @param   object  obj1
     * @param   object  obj2
     * @return  object  merged object
     */
    function mergeObject(obj1, obj2) {
        var output = {};

        if(!obj2) {
            return obj1;
        }

        for (var prop in obj1) {
            if (prop in obj2) {
                output[prop] = obj2[prop];
            } else {
                output[prop] = obj1[prop];
            }
        }
        return output;
    }

    function isFunction( obj ){
        return Object.prototype.toString.call( obj ) == "[object Function]";
    }
}
/*
 * Hammer.JS
 * version 0.4
 * author: Eight Media
 * https://github.com/EightMedia/hammer.js
 */
function Hammer(element, options, undefined)
{
    var self = this;

    var defaults = {
        // prevent the default event or not... might be buggy when false
        prevent_default    : false,
        css_hacks          : true,

        drag               : true,
        drag_vertical      : true,
        drag_horizontal    : true,
        // minimum distance before the drag event starts
        drag_min_distance  : 20, // pixels

        // pinch zoom and rotation
        transform          : true,
        scale_treshold     : 0.1,
        rotation_treshold  : 15, // degrees

        tap                : true,
        tap_double         : true,
        tap_max_interval   : 300,
        tap_double_distance: 20,

        hold               : true,
        hold_timeout       : 500
    };
    options = mergeObject(defaults, options);

    // some css hacks
    (function() {
        if(!options.css_hacks) {
            return false;
        }

        var vendors = ['webkit','moz','ms','o',''];
        var css_props = {
            "userSelect": "none",
            "touchCallout": "none",
            "userDrag": "none",
            "tapHighlightColor": "rgba(0,0,0,0)"
        };

        var prop = '';
        for(var i = 0; i < vendors.length; i++) {
            for(var p in css_props) {
                prop = p;
                if(vendors[i]) {
                    prop = vendors[i] + prop.substring(0, 1).toUpperCase() + prop.substring(1);
                }
                element.style[ prop ] = css_props[p];
            }
        }
    })();

    // holds the distance that has been moved
    var _distance = 0;

    // holds the exact angle that has been moved
    var _angle = 0;

    // holds the diraction that has been moved
    var _direction = 0;

    // holds position movement for sliding
    var _pos = { };

    // how many fingers are on the screen
    var _fingers = 0;

    var _first = false;

    var _gesture = null;
    var _prev_gesture = null;

    var _touch_start_time = null;
    var _prev_tap_pos = {x: 0, y: 0};
    var _prev_tap_end_time = null;

    var _hold_timer = null;

    var _offset = {};

    // keep track of the mouse status
    var _mousedown = false;

    var _event_start;
    var _event_move;
    var _event_end;


    /**
     * angle to direction define
     * @param  float    angle
     * @return string   direction
     */
    this.getDirectionFromAngle = function( angle )
    {
        var directions = {
            down: angle >= 45 && angle < 135, //90
            left: angle >= 135 || angle <= -135, //180
            up: angle < -45 && angle > -135, //270
            right: angle >= -45 && angle <= 45 //0
        };

        var direction, key;
        for(key in directions){
            if(directions[key]){
                direction = key;
                break;
            }
        }
        return direction;
    };


    /**
     * count the number of fingers in the event
     * when no fingers are detected, one finger is returned (mouse pointer)
     * @param  event
     * @return int  fingers
     */
    function countFingers( event )
    {
        // there is a bug on android (until v4?) that touches is always 1,
        // so no multitouch is supported, e.g. no, zoom and rotation...
        return event.touches ? event.touches.length : 1;
    }


    /**
     * get the x and y positions from the event object
     * @param  event
     * @return array  [{ x: int, y: int }]
     */
    function getXYfromEvent( event )
    {
        event = event || window.event;

        // no touches, use the event pageX and pageY
        if(!event.touches) {
            var doc = document,
                body = doc.body;

            return [{
                x: event.pageX || event.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && doc.clientLeft || 0 ),
                y: event.pageY || event.clientY + ( doc && doc.scrollTop || body && body.scrollTop || 0 ) - ( doc && doc.clientTop || body && doc.clientTop || 0 )
            }];
        }
        // multitouch, return array with positions
        else {
            var pos = [], src;
            for(var t=0, len=event.touches.length; t<len; t++) {
                src = event.touches[t];
                pos.push({ x: src.pageX, y: src.pageY });
            }
            return pos;
        }
    }


    /**
     * calculate the angle between two points
     * @param object pos1 { x: int, y: int }
     * @param object pos2 { x: int, y: int }
     */
    function getAngle( pos1, pos2 )
    {
        return Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x) * 180 / Math.PI;
    }

    /**
     * trigger an event/callback by name with params
     * @param string name
     * @param array  params
     */
    function triggerEvent( eventName, params )
    {
        // return touches object
        params.touches = getXYfromEvent(params.originalEvent);
        params.type = eventName;

        // trigger callback
        if(isFunction(self["on"+ eventName])) {
            self["on"+ eventName].call(self, params);
        }
    }


    /**
     * cancel event
     * @param   object  event
     * @return  void
     */

    function cancelEvent(event){
        event = event || window.event;
        if(event.preventDefault){
            event.preventDefault();
        }else{
            event.returnValue = false;
            event.cancelBubble = true;
        }
    }


    /**
     * reset the internal vars to the start values
     */
    function reset()
    {
        _pos = {};
        _first = false;
        _fingers = 0;
        _distance = 0;
        _angle = 0;
        _gesture = null;
    }


    var gestures = {
        // hold gesture
        // fired on touchstart
        hold : function(event)
        {
            // only when one finger is on the screen
            if(options.hold) {
                _gesture = 'hold';
                clearTimeout(_hold_timer);

                _hold_timer = setTimeout(function() {
                    if(_gesture == 'hold') {
                        triggerEvent("hold", {
                            originalEvent   : event,
                            position        : _pos.start
                        });
                    }
                }, options.hold_timeout);
            }
        },


        // drag gesture
        // fired on mousemove
        drag : function(event)
        {
            // get the distance we moved
            var _distance_x = _pos.move[0].x - _pos.start[0].x;
            var _distance_y = _pos.move[0].y - _pos.start[0].y;
            _distance = Math.sqrt(_distance_x * _distance_x + _distance_y * _distance_y);

            // drag
            // minimal movement required
            if(options.drag && (_distance > options.drag_min_distance) || _gesture == 'drag') {
                // calculate the angle
                _angle = getAngle(_pos.start[0], _pos.move[0]);
                _direction = self.getDirectionFromAngle(_angle);

                // check the movement and stop if we go in the wrong direction
                var is_vertical = (_direction == 'up' || _direction == 'down');
                if(((is_vertical && !options.drag_vertical) || (!is_vertical && !options.drag_horizontal))
                    && (_distance > options.drag_min_distance)) {
                    return;
                }

                _gesture = 'drag';

                var position = { x: _pos.move[0].x - _offset.left,
                    y: _pos.move[0].y - _offset.top };

                var event_obj = {
                    originalEvent   : event,
                    position        : position,
                    direction       : _direction,
                    distance        : _distance,
                    distanceX       : _distance_x,
                    distanceY       : _distance_y,
                    angle           : _angle
                };

                // on the first time trigger the start event
                if(_first) {
                    triggerEvent("dragstart", event_obj);

                    _first = false;
                }

                // normal slide event
                triggerEvent("drag", event_obj);

                cancelEvent(event);
            }
        },


        // transform gesture
        // fired on touchmove
        transform : function(event)
        {
            if(options.transform) {
                var scale = event.scale || 1;
                var rotation = event.rotation || 0;

                if(countFingers(event) != 2) {
                    return false;
                }

                if(_gesture != 'drag' &&
                    (_gesture == 'transform' || Math.abs(1-scale) > options.scale_treshold
                        || Math.abs(rotation) > options.rotation_treshold)) {
                    _gesture = 'transform';

                    _pos.center = {  x: ((_pos.move[0].x + _pos.move[1].x) / 2) - _offset.left,
                        y: ((_pos.move[0].y + _pos.move[1].y) / 2) - _offset.top };

                    var event_obj = {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : scale,
                        rotation        : rotation
                    };

                    // on the first time trigger the start event
                    if(_first) {
                        triggerEvent("transformstart", event_obj);
                        _first = false;
                    }

                    triggerEvent("transform", event_obj);

                    cancelEvent(event);

                    return true;
                }
            }

            return false;
        },


        // tap and double tap gesture
        // fired on touchend
        tap : function(event)
        {
            // compare the kind of gesture by time
            var now = new Date().getTime();
            var touch_time = now - _touch_start_time;

            // dont fire when hold is fired
            if(options.hold && !(options.hold && options.hold_timeout > touch_time)) {
                return;
            }

            // when previous event was tap and the tap was max_interval ms ago
            var is_double_tap = (function(){
                if (_prev_tap_pos && options.tap_double && _prev_gesture == 'tap' && (_touch_start_time - _prev_tap_end_time) < options.tap_max_interval) {
                    var x_distance = Math.abs(_prev_tap_pos[0].x - _pos.start[0].x);
                    var y_distance = Math.abs(_prev_tap_pos[0].y - _pos.start[0].y);
                    return (_prev_tap_pos && _pos.start && Math.max(x_distance, y_distance) < options.tap_double_distance);

                }
                return false;
            })();

            if(is_double_tap) {
                _gesture = 'double_tap';
                _prev_tap_end_time = null;

                triggerEvent("doubletap", {
                    originalEvent   : event,
                    position        : _pos.start
                });
                cancelEvent(event);
            }

            // single tap is single touch
            else {
                _gesture = 'tap';
                _prev_tap_end_time = now;
                _prev_tap_pos = _pos.start;

                if(options.tap) {
                    triggerEvent("tap", {
                        originalEvent   : event,
                        position        : _pos.start
                    });
                    cancelEvent(event);
                }
            }

        }

    };


    function handleEvents(event)
    {
        switch(event.type)
        {
            case 'mousedown':
            case 'touchstart':
                _pos.start = getXYfromEvent(event);
                _touch_start_time = new Date().getTime();
                _fingers = countFingers(event);
                _first = true;
                _event_start = event;

                // borrowed from jquery offset https://github.com/jquery/jquery/blob/master/src/offset.js
                var box = element.getBoundingClientRect();
                var clientTop  = element.clientTop  || document.body.clientTop  || 0;
                var clientLeft = element.clientLeft || document.body.clientLeft || 0;
                var scrollTop  = window.pageYOffset || element.scrollTop  || document.body.scrollTop;
                var scrollLeft = window.pageXOffset || element.scrollLeft || document.body.scrollLeft;

                _offset = {
                    top: box.top + scrollTop - clientTop,
                    left: box.left + scrollLeft - clientLeft
                };

                _mousedown = true;

                // hold gesture
                gestures.hold(event);

                if(options.prevent_default) {
                    cancelEvent(event);
                }
                break;

            case 'mousemove':
            case 'touchmove':
                if(!_mousedown) {
                    return false;
                }
                _event_move = event;
                _pos.move = getXYfromEvent(event);

                if(!gestures.transform(event)) {
                    gestures.drag(event);
                }
                break;

            case 'mouseup':
            case 'mouseout':
            case 'touchcancel':
            case 'touchend':
                if(!_mousedown || (_gesture != 'transform' && event.touches && event.touches.length > 0)) {
                    return false;
                }

                _mousedown = false;
                _event_end = event;

                // drag gesture
                // dragstart is triggered, so dragend is possible
                if(_gesture == 'drag') {
                    triggerEvent("dragend", {
                        originalEvent   : event,
                        direction       : _direction,
                        distance        : _distance,
                        angle           : _angle
                    });
                }

                // transform
                // transformstart is triggered, so transformed is possible
                else if(_gesture == 'transform') {
                    triggerEvent("transformend", {
                        originalEvent   : event,
                        position        : _pos.center,
                        scale           : event.scale,
                        rotation        : event.rotation
                    });
                }
                else {
                    gestures.tap(_event_start);
                }

                _prev_gesture = _gesture;

                // reset vars
                reset();
                break;
        }
    }


    // bind events for touch devices
    // except for windows phone 7.5, it doesnt support touch events..!
    if('ontouchstart' in window) {
        element.addEventListener("touchstart", handleEvents, false);
        element.addEventListener("touchmove", handleEvents, false);
        element.addEventListener("touchend", handleEvents, false);
        element.addEventListener("touchcancel", handleEvents, false);
    }
    // for non-touch
    else {

        if(element.addEventListener){ // prevent old IE errors
            element.addEventListener("mouseout", function(event) {
                if(!isInsideHammer(element, event.relatedTarget)) {
                    handleEvents(event);
                }
            }, false);
            element.addEventListener("mouseup", handleEvents, false);
            element.addEventListener("mousedown", handleEvents, false);
            element.addEventListener("mousemove", handleEvents, false);

            // events for older IE
        }else if(document.attachEvent){
            element.attachEvent("onmouseout", function(event) {
                if(!isInsideHammer(element, event.relatedTarget)) {
                    handleEvents(event);
                }
            }, false);
            element.attachEvent("onmouseup", handleEvents);
            element.attachEvent("onmousedown", handleEvents);
            element.attachEvent("onmousemove", handleEvents);
        }
    }


    /**
     * find if element is (inside) given parent element
     * @param   object  element
     * @param   object  parent
     * @return  bool    inside
     */
    function isInsideHammer(parent, child) {
        // get related target for IE
        if(!child && window.event && window.event.toElement){
            child = window.event.toElement;
        }

        if(parent === child){
            return true;
        }

        // loop over parentNodes of child until we find hammer element
        if(child){
            var node = child.parentNode;
            while(node !== null){
                if(node === parent){
                    return true;
                };
                node = node.parentNode;
            }
        }
        return false;
    }


    /**
     * merge 2 objects into a new object
     * @param   object  obj1
     * @param   object  obj2
     * @return  object  merged object
     */
    function mergeObject(obj1, obj2) {
        var output = {};

        if(!obj2) {
            return obj1;
        }

        for (var prop in obj1) {
            if (prop in obj2) {
                output[prop] = obj2[prop];
            } else {
                output[prop] = obj1[prop];
            }
        }
        return output;
    }

    function isFunction( obj ){
        return Object.prototype.toString.call( obj ) == "[object Function]";
    }
}
/* Modernizr 2.5.3 (Custom Build) | MIT & BSD
 * Build: http://www.modernizr.com/download/#-fontface-backgroundsize-borderimage-borderradius-boxshadow-flexbox-flexbox_legacy-hsla-multiplebgs-opacity-rgba-textshadow-cssanimations-csscolumns-generatedcontent-cssgradients-cssreflections-csstransforms-csstransforms3d-csstransitions-applicationcache-canvas-canvastext-draganddrop-hashchange-history-audio-video-indexeddb-input-inputtypes-localstorage-postmessage-sessionstorage-websockets-websqldatabase-webworkers-geolocation-inlinesvg-smil-svg-svgclippaths-touch-webgl-mq-prefixed-teststyles-testprop-testallprops-hasevent-prefixes-domprefixes-load
 */
;window.Modernizr=function(a,b,c){function C(a){i.cssText=a}function D(a,b){return C(m.join(a+";")+(b||""))}function E(a,b){return typeof a===b}function F(a,b){return!!~(""+a).indexOf(b)}function G(a,b){for(var d in a)if(i[a[d]]!==c)return b=="pfx"?a[d]:!0;return!1}function H(a,b,d){for(var e in a){var f=b[a[e]];if(f!==c)return d===!1?a[e]:E(f,"function")?f.bind(d||b):f}return!1}function I(a,b,c){var d=a.charAt(0).toUpperCase()+a.substr(1),e=(a+" "+o.join(d+" ")+d).split(" ");return E(b,"string")||E(b,"undefined")?G(e,b):(e=(a+" "+p.join(d+" ")+d).split(" "),H(e,b,c))}function K(){e.input=function(c){for(var d=0,e=c.length;d<e;d++)t[c[d]]=c[d]in j;return t.list&&(t.list=!!b.createElement("datalist")&&!!a.HTMLDataListElement),t}("autocomplete autofocus list placeholder max min multiple pattern required step".split(" ")),e.inputtypes=function(a){for(var d=0,e,g,h,i=a.length;d<i;d++)j.setAttribute("type",g=a[d]),e=j.type!=="text",e&&(j.value=k,j.style.cssText="position:absolute;visibility:hidden;",/^range$/.test(g)&&j.style.WebkitAppearance!==c?(f.appendChild(j),h=b.defaultView,e=h.getComputedStyle&&h.getComputedStyle(j,null).WebkitAppearance!=="textfield"&&j.offsetHeight!==0,f.removeChild(j)):/^(search|tel)$/.test(g)||(/^(url|email)$/.test(g)?e=j.checkValidity&&j.checkValidity()===!1:/^color$/.test(g)?(f.appendChild(j),f.offsetWidth,e=j.value!=k,f.removeChild(j)):e=j.value!=k)),s[a[d]]=!!e;return s}("search tel url email datetime date month week time datetime-local number range color".split(" "))}var d="2.5.3",e={},f=b.documentElement,g="modernizr",h=b.createElement(g),i=h.style,j=b.createElement("input"),k=":)",l={}.toString,m=" -webkit- -moz- -o- -ms- ".split(" "),n="Webkit Moz O ms",o=n.split(" "),p=n.toLowerCase().split(" "),q={svg:"http://www.w3.org/2000/svg"},r={},s={},t={},u=[],v=u.slice,w,x=function(a,c,d,e){var h,i,j,k=b.createElement("div"),l=b.body,m=l?l:b.createElement("body");if(parseInt(d,10))while(d--)j=b.createElement("div"),j.id=e?e[d]:g+(d+1),k.appendChild(j);return h=["&#173;","<style>",a,"</style>"].join(""),k.id=g,(l?k:m).innerHTML+=h,m.appendChild(k),l||(m.style.background="",f.appendChild(m)),i=c(k,a),l?k.parentNode.removeChild(k):m.parentNode.removeChild(m),!!i},y=function(b){var c=a.matchMedia||a.msMatchMedia;if(c)return c(b).matches;var d;return x("@media "+b+" { #"+g+" { position: absolute; } }",function(b){d=(a.getComputedStyle?getComputedStyle(b,null):b.currentStyle)["position"]=="absolute"}),d},z=function(){function d(d,e){e=e||b.createElement(a[d]||"div"),d="on"+d;var f=d in e;return f||(e.setAttribute||(e=b.createElement("div")),e.setAttribute&&e.removeAttribute&&(e.setAttribute(d,""),f=E(e[d],"function"),E(e[d],"undefined")||(e[d]=c),e.removeAttribute(d))),e=null,f}var a={select:"input",change:"input",submit:"form",reset:"form",error:"img",load:"img",abort:"img"};return d}(),A={}.hasOwnProperty,B;!E(A,"undefined")&&!E(A.call,"undefined")?B=function(a,b){return A.call(a,b)}:B=function(a,b){return b in a&&E(a.constructor.prototype[b],"undefined")},Function.prototype.bind||(Function.prototype.bind=function(b){var c=this;if(typeof c!="function")throw new TypeError;var d=v.call(arguments,1),e=function(){if(this instanceof e){var a=function(){};a.prototype=c.prototype;var f=new a,g=c.apply(f,d.concat(v.call(arguments)));return Object(g)===g?g:f}return c.apply(b,d.concat(v.call(arguments)))};return e});var J=function(c,d){var f=c.join(""),g=d.length;x(f,function(c,d){var f=b.styleSheets[b.styleSheets.length-1],h=f?f.cssRules&&f.cssRules[0]?f.cssRules[0].cssText:f.cssText||"":"",i=c.childNodes,j={};while(g--)j[i[g].id]=i[g];e.touch="ontouchstart"in a||a.DocumentTouch&&b instanceof DocumentTouch||(j.touch&&j.touch.offsetTop)===9,e.csstransforms3d=(j.csstransforms3d&&j.csstransforms3d.offsetLeft)===9&&j.csstransforms3d.offsetHeight===3,e.generatedcontent=(j.generatedcontent&&j.generatedcontent.offsetHeight)>=1,e.fontface=/src/i.test(h)&&h.indexOf(d.split(" ")[0])===0},g,d)}(['@font-face {font-family:"font";src:url("https://")}',["@media (",m.join("touch-enabled),("),g,")","{#touch{top:9px;position:absolute}}"].join(""),["@media (",m.join("transform-3d),("),g,")","{#csstransforms3d{left:9px;position:absolute;height:3px;}}"].join(""),['#generatedcontent:after{content:"',k,'";visibility:hidden}'].join("")],["fontface","touch","csstransforms3d","generatedcontent"]);r.flexbox=function(){return I("flexOrder")},r["flexbox-legacy"]=function(){return I("boxDirection")},r.canvas=function(){var a=b.createElement("canvas");return!!a.getContext&&!!a.getContext("2d")},r.canvastext=function(){return!!e.canvas&&!!E(b.createElement("canvas").getContext("2d").fillText,"function")},r.webgl=function(){try{var d=b.createElement("canvas"),e;e=!(!a.WebGLRenderingContext||!d.getContext("experimental-webgl")&&!d.getContext("webgl")),d=c}catch(f){e=!1}return e},r.touch=function(){return e.touch},r.geolocation=function(){return!!navigator.geolocation},r.postmessage=function(){return!!a.postMessage},r.websqldatabase=function(){return!!a.openDatabase},r.indexedDB=function(){return!!I("indexedDB",a)},r.hashchange=function(){return z("hashchange",a)&&(b.documentMode===c||b.documentMode>7)},r.history=function(){return!!a.history&&!!history.pushState},r.draganddrop=function(){var a=b.createElement("div");return"draggable"in a||"ondragstart"in a&&"ondrop"in a},r.websockets=function(){for(var b=-1,c=o.length;++b<c;)if(a[o[b]+"WebSocket"])return!0;return"WebSocket"in a},r.rgba=function(){return C("background-color:rgba(150,255,150,.5)"),F(i.backgroundColor,"rgba")},r.hsla=function(){return C("background-color:hsla(120,40%,100%,.5)"),F(i.backgroundColor,"rgba")||F(i.backgroundColor,"hsla")},r.multiplebgs=function(){return C("background:url(https://),url(https://),red url(https://)"),/(url\s*\(.*?){3}/.test(i.background)},r.backgroundsize=function(){return I("backgroundSize")},r.borderimage=function(){return I("borderImage")},r.borderradius=function(){return I("borderRadius")},r.boxshadow=function(){return I("boxShadow")},r.textshadow=function(){return b.createElement("div").style.textShadow===""},r.opacity=function(){return D("opacity:.55"),/^0.55$/.test(i.opacity)},r.cssanimations=function(){return I("animationName")},r.csscolumns=function(){return I("columnCount")},r.cssgradients=function(){var a="background-image:",b="gradient(linear,left top,right bottom,from(#9f9),to(white));",c="linear-gradient(left top,#9f9, white);";return C((a+"-webkit- ".split(" ").join(b+a)+m.join(c+a)).slice(0,-a.length)),F(i.backgroundImage,"gradient")},r.cssreflections=function(){return I("boxReflect")},r.csstransforms=function(){return!!I("transform")},r.csstransforms3d=function(){var a=!!I("perspective");return a&&"webkitPerspective"in f.style&&(a=e.csstransforms3d),a},r.csstransitions=function(){return I("transition")},r.fontface=function(){return e.fontface},r.generatedcontent=function(){return e.generatedcontent},r.video=function(){var a=b.createElement("video"),c=!1;try{if(c=!!a.canPlayType)c=new Boolean(c),c.ogg=a.canPlayType('video/ogg; codecs="theora"').replace(/^no$/,""),c.h264=a.canPlayType('video/mp4; codecs="avc1.42E01E"').replace(/^no$/,""),c.webm=a.canPlayType('video/webm; codecs="vp8, vorbis"').replace(/^no$/,"")}catch(d){}return c},r.audio=function(){var a=b.createElement("audio"),c=!1;try{if(c=!!a.canPlayType)c=new Boolean(c),c.ogg=a.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/,""),c.mp3=a.canPlayType("audio/mpeg;").replace(/^no$/,""),c.wav=a.canPlayType('audio/wav; codecs="1"').replace(/^no$/,""),c.m4a=(a.canPlayType("audio/x-m4a;")||a.canPlayType("audio/aac;")).replace(/^no$/,"")}catch(d){}return c},r.localstorage=function(){try{return localStorage.setItem(g,g),localStorage.removeItem(g),!0}catch(a){return!1}},r.sessionstorage=function(){try{return sessionStorage.setItem(g,g),sessionStorage.removeItem(g),!0}catch(a){return!1}},r.webworkers=function(){return!!a.Worker},r.applicationcache=function(){return!!a.applicationCache},r.svg=function(){return!!b.createElementNS&&!!b.createElementNS(q.svg,"svg").createSVGRect},r.inlinesvg=function(){var a=b.createElement("div");return a.innerHTML="<svg/>",(a.firstChild&&a.firstChild.namespaceURI)==q.svg},r.smil=function(){return!!b.createElementNS&&/SVGAnimate/.test(l.call(b.createElementNS(q.svg,"animate")))},r.svgclippaths=function(){return!!b.createElementNS&&/SVGClipPath/.test(l.call(b.createElementNS(q.svg,"clipPath")))};for(var L in r)B(r,L)&&(w=L.toLowerCase(),e[w]=r[L](),u.push((e[w]?"":"no-")+w));return e.input||K(),C(""),h=j=null,e._version=d,e._prefixes=m,e._domPrefixes=p,e._cssomPrefixes=o,e.mq=y,e.hasEvent=z,e.testProp=function(a){return G([a])},e.testAllProps=I,e.testStyles=x,e.prefixed=function(a,b,c){return b?I(a,b,c):I(a,"pfx")},e}(this,this.document),function(a,b,c){function d(a){return o.call(a)=="[object Function]"}function e(a){return typeof a=="string"}function f(){}function g(a){return!a||a=="loaded"||a=="complete"||a=="uninitialized"}function h(){var a=p.shift();q=1,a?a.t?m(function(){(a.t=="c"?B.injectCss:B.injectJs)(a.s,0,a.a,a.x,a.e,1)},0):(a(),h()):q=0}function i(a,c,d,e,f,i,j){function k(b){if(!o&&g(l.readyState)&&(u.r=o=1,!q&&h(),l.onload=l.onreadystatechange=null,b)){a!="img"&&m(function(){t.removeChild(l)},50);for(var d in y[c])y[c].hasOwnProperty(d)&&y[c][d].onload()}}var j=j||B.errorTimeout,l={},o=0,r=0,u={t:d,s:c,e:f,a:i,x:j};y[c]===1&&(r=1,y[c]=[],l=b.createElement(a)),a=="object"?l.data=c:(l.src=c,l.type=a),l.width=l.height="0",l.onerror=l.onload=l.onreadystatechange=function(){k.call(this,r)},p.splice(e,0,u),a!="img"&&(r||y[c]===2?(t.insertBefore(l,s?null:n),m(k,j)):y[c].push(l))}function j(a,b,c,d,f){return q=0,b=b||"j",e(a)?i(b=="c"?v:u,a,b,this.i++,c,d,f):(p.splice(this.i++,0,a),p.length==1&&h()),this}function k(){var a=B;return a.loader={load:j,i:0},a}var l=b.documentElement,m=a.setTimeout,n=b.getElementsByTagName("script")[0],o={}.toString,p=[],q=0,r="MozAppearance"in l.style,s=r&&!!b.createRange().compareNode,t=s?l:n.parentNode,l=a.opera&&o.call(a.opera)=="[object Opera]",l=!!b.attachEvent&&!l,u=r?"object":l?"script":"img",v=l?"script":u,w=Array.isArray||function(a){return o.call(a)=="[object Array]"},x=[],y={},z={timeout:function(a,b){return b.length&&(a.timeout=b[0]),a}},A,B;B=function(a){function b(a){var a=a.split("!"),b=x.length,c=a.pop(),d=a.length,c={url:c,origUrl:c,prefixes:a},e,f,g;for(f=0;f<d;f++)g=a[f].split("="),(e=z[g.shift()])&&(c=e(c,g));for(f=0;f<b;f++)c=x[f](c);return c}function g(a,e,f,g,i){var j=b(a),l=j.autoCallback;j.url.split(".").pop().split("?").shift(),j.bypass||(e&&(e=d(e)?e:e[a]||e[g]||e[a.split("/").pop().split("?")[0]]||h),j.instead?j.instead(a,e,f,g,i):(y[j.url]?j.noexec=!0:y[j.url]=1,f.load(j.url,j.forceCSS||!j.forceJS&&"css"==j.url.split(".").pop().split("?").shift()?"c":c,j.noexec,j.attrs,j.timeout),(d(e)||d(l))&&f.load(function(){k(),e&&e(j.origUrl,i,g),l&&l(j.origUrl,i,g),y[j.url]=2})))}function i(a,b){function c(a,c){if(a){if(e(a))c||(j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}),g(a,j,b,0,h);else if(Object(a)===a)for(n in m=function(){var b=0,c;for(c in a)a.hasOwnProperty(c)&&b++;return b}(),a)a.hasOwnProperty(n)&&(!c&&!--m&&(d(j)?j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}:j[n]=function(a){return function(){var b=[].slice.call(arguments);a&&a.apply(this,b),l()}}(k[n])),g(a[n],j,b,n,h))}else!c&&l()}var h=!!a.test,i=a.load||a.both,j=a.callback||f,k=j,l=a.complete||f,m,n;c(h?a.yep:a.nope,!!i),i&&c(i)}var j,l,m=this.yepnope.loader;if(e(a))g(a,0,m,0);else if(w(a))for(j=0;j<a.length;j++)l=a[j],e(l)?g(l,0,m,0):w(l)?B(l):Object(l)===l&&i(l,m);else Object(a)===a&&i(a,m)},B.addPrefix=function(a,b){z[a]=b},B.addFilter=function(a){x.push(a)},B.errorTimeout=1e4,b.readyState==null&&b.addEventListener&&(b.readyState="loading",b.addEventListener("DOMContentLoaded",A=function(){b.removeEventListener("DOMContentLoaded",A,0),b.readyState="complete"},0)),a.yepnope=k(),a.yepnope.executeStack=h,a.yepnope.injectJs=function(a,c,d,e,i,j){var k=b.createElement("script"),l,o,e=e||B.errorTimeout;k.src=a;for(o in d)k.setAttribute(o,d[o]);c=j?h:c||f,k.onreadystatechange=k.onload=function(){!l&&g(k.readyState)&&(l=1,c(),k.onload=k.onreadystatechange=null)},m(function(){l||(l=1,c(1))},e),i?k.onload():n.parentNode.insertBefore(k,n)},a.yepnope.injectCss=function(a,c,d,e,g,i){var e=b.createElement("link"),j,c=i?h:c||f;e.href=a,e.rel="stylesheet",e.type="text/css";for(j in d)e.setAttribute(j,d[j]);g||(n.parentNode.insertBefore(e,n),m(c,0))}}(this,document),Modernizr.load=function(){yepnope.apply(window,[].slice.call(arguments,0))};
/*
 RequireJS order 1.0.5 Copyright (c) 2010-2011, The Dojo Foundation All Rights Reserved.
 Available via the MIT or new BSD license.
 see: http://github.com/jrburke/requirejs for details
*/
(function(){function k(a){var b=a.currentTarget||a.srcElement,c;if(a.type==="load"||l.test(b.readyState)){a=b.getAttribute("data-requiremodule");j[a]=!0;for(a=0;c=g[a];a++)if(j[c.name])c.req([c.name],c.onLoad);else break;a>0&&g.splice(0,a);setTimeout(function(){b.parentNode.removeChild(b)},15)}}function m(a){var b,c;a.setAttribute("data-orderloaded","loaded");for(a=0;c=h[a];a++)if((b=i[c])&&b.getAttribute("data-orderloaded")==="loaded")delete i[c],require.addScriptToDom(b);else break;a>0&&h.splice(0,
a)}var f=typeof document!=="undefined"&&typeof window!=="undefined"&&document.createElement("script"),n=f&&(f.async||window.opera&&Object.prototype.toString.call(window.opera)==="[object Opera]"||"MozAppearance"in document.documentElement.style),o=f&&f.readyState==="uninitialized",l=/^(complete|loaded)$/,g=[],j={},i={},h=[],f=null;define({version:"1.0.5",load:function(a,b,c,e){var d;b.nameToUrl?(d=b.nameToUrl(a,null),require.s.skipAsync[d]=!0,n||e.isBuild?b([a],c):o?(e=require.s.contexts._,!e.urlFetched[d]&&
!e.loaded[a]&&(e.urlFetched[d]=!0,require.resourcesReady(!1),e.scriptCount+=1,d=require.attach(d,e,a,null,null,m),i[a]=d,h.push(a)),b([a],c)):b.specified(a)?b([a],c):(g.push({name:a,req:b,onLoad:c}),require.attach(d,null,a,k,"script/cache"))):b([a],c)}})})();

/*
 RequireJS 1.0.8 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 Available via the MIT or new BSD license.
 see: http://github.com/jrburke/requirejs for details
*/
var requirejs,require,define;
(function(r){function K(a){return O.call(a)==="[object Function]"}function G(a){return O.call(a)==="[object Array]"}function $(a,c,l){for(var j in c)if(!(j in L)&&(!(j in a)||l))a[j]=c[j];return d}function P(a,c,d){a=Error(c+"\nhttp://requirejs.org/docs/errors.html#"+a);if(d)a.originalError=d;return a}function aa(a,c,d){var j,k,t;for(j=0;t=c[j];j++){t=typeof t==="string"?{name:t}:t;k=t.location;if(d&&(!k||k.indexOf("/")!==0&&k.indexOf(":")===-1))k=d+"/"+(k||t.name);a[t.name]={name:t.name,location:k||
t.name,main:(t.main||"main").replace(fa,"").replace(ba,"")}}}function V(a,c){a.holdReady?a.holdReady(c):c?a.readyWait+=1:a.ready(!0)}function ga(a){function c(b,f){var g,m;if(b&&b.charAt(0)===".")if(f){q.pkgs[f]?f=[f]:(f=f.split("/"),f=f.slice(0,f.length-1));g=b=f.concat(b.split("/"));var a;for(m=0;a=g[m];m++)if(a===".")g.splice(m,1),m-=1;else if(a==="..")if(m===1&&(g[2]===".."||g[0]===".."))break;else m>0&&(g.splice(m-1,2),m-=2);m=q.pkgs[g=b[0]];b=b.join("/");m&&b===g+"/"+m.main&&(b=g)}else b.indexOf("./")===
0&&(b=b.substring(2));return b}function l(b,f){var g=b?b.indexOf("!"):-1,m=null,a=f?f.name:null,h=b,e,d;g!==-1&&(m=b.substring(0,g),b=b.substring(g+1,b.length));m&&(m=c(m,a));b&&(m?e=(g=n[m])&&g.normalize?g.normalize(b,function(b){return c(b,a)}):c(b,a):(e=c(b,a),d=G[e],d||(d=i.nameToUrl(b,null,f),G[e]=d)));return{prefix:m,name:e,parentMap:f,url:d,originalName:h,fullName:m?m+"!"+(e||""):e}}function j(){var b=!0,f=q.priorityWait,g,a;if(f){for(a=0;g=f[a];a++)if(!s[g]){b=!1;break}b&&delete q.priorityWait}return b}
function k(b,f,g){return function(){var a=ha.call(arguments,0),c;if(g&&K(c=a[a.length-1]))c.__requireJsBuild=!0;a.push(f);return b.apply(null,a)}}function t(b,f,g){f=k(g||i.require,b,f);$(f,{nameToUrl:k(i.nameToUrl,b),toUrl:k(i.toUrl,b),defined:k(i.requireDefined,b),specified:k(i.requireSpecified,b),isBrowser:d.isBrowser});return f}function p(b){var f,g,a,c=b.callback,h=b.map,e=h.fullName,ca=b.deps;a=b.listeners;var j=q.requireExecCb||d.execCb;if(c&&K(c)){if(q.catchError.define)try{g=j(e,b.callback,
ca,n[e])}catch(k){f=k}else g=j(e,b.callback,ca,n[e]);if(e)(c=b.cjsModule)&&c.exports!==r&&c.exports!==n[e]?g=n[e]=b.cjsModule.exports:g===r&&b.usingExports?g=n[e]:(n[e]=g,H[e]&&(T[e]=!0))}else e&&(g=n[e]=c,H[e]&&(T[e]=!0));if(x[b.id])delete x[b.id],b.isDone=!0,i.waitCount-=1,i.waitCount===0&&(J=[]);delete M[e];if(d.onResourceLoad&&!b.placeholder)d.onResourceLoad(i,h,b.depArray);if(f)return g=(e?l(e).url:"")||f.fileName||f.sourceURL,a=f.moduleTree,f=P("defineerror",'Error evaluating module "'+e+'" at location "'+
g+'":\n'+f+"\nfileName:"+g+"\nlineNumber: "+(f.lineNumber||f.line),f),f.moduleName=e,f.moduleTree=a,d.onError(f);for(f=0;c=a[f];f++)c(g);return r}function u(b,f){return function(g){b.depDone[f]||(b.depDone[f]=!0,b.deps[f]=g,b.depCount-=1,b.depCount||p(b))}}function o(b,f){var g=f.map,a=g.fullName,c=g.name,h=N[b]||(N[b]=n[b]),e;if(!f.loading)f.loading=!0,e=function(b){f.callback=function(){return b};p(f);s[f.id]=!0;A()},e.fromText=function(b,f){var g=Q;s[b]=!1;i.scriptCount+=1;i.fake[b]=!0;g&&(Q=!1);
d.exec(f);g&&(Q=!0);i.completeLoad(b)},a in n?e(n[a]):h.load(c,t(g.parentMap,!0,function(b,a){var c=[],e,m;for(e=0;m=b[e];e++)m=l(m,g.parentMap),b[e]=m.fullName,m.prefix||c.push(b[e]);f.moduleDeps=(f.moduleDeps||[]).concat(c);return i.require(b,a)}),e,q)}function y(b){x[b.id]||(x[b.id]=b,J.push(b),i.waitCount+=1)}function D(b){this.listeners.push(b)}function v(b,f){var g=b.fullName,a=b.prefix,c=a?N[a]||(N[a]=n[a]):null,h,e;g&&(h=M[g]);if(!h&&(e=!0,h={id:(a&&!c?O++ +"__p@:":"")+(g||"__r@"+O++),map:b,
depCount:0,depDone:[],depCallbacks:[],deps:[],listeners:[],add:D},B[h.id]=!0,g&&(!a||N[a])))M[g]=h;a&&!c?(g=l(a),a in n&&!n[a]&&(delete n[a],delete R[g.url]),a=v(g,!0),a.add(function(){var f=l(b.originalName,b.parentMap),f=v(f,!0);h.placeholder=!0;f.add(function(b){h.callback=function(){return b};p(h)})})):e&&f&&(s[h.id]=!1,i.paused.push(h),y(h));return h}function C(b,f,a,c){var b=l(b,c),d=b.name,h=b.fullName,e=v(b),j=e.id,k=e.deps,o;if(h){if(h in n||s[j]===!0||h==="jquery"&&q.jQuery&&q.jQuery!==
a().fn.jquery)return;B[j]=!0;s[j]=!0;h==="jquery"&&a&&W(a())}e.depArray=f;e.callback=a;for(a=0;a<f.length;a++)if(j=f[a])j=l(j,d?b:c),o=j.fullName,f[a]=o,o==="require"?k[a]=t(b):o==="exports"?(k[a]=n[h]={},e.usingExports=!0):o==="module"?e.cjsModule=k[a]={id:d,uri:d?i.nameToUrl(d,null,c):r,exports:n[h]}:o in n&&!(o in x)&&(!(h in H)||h in H&&T[o])?k[a]=n[o]:(h in H&&(H[o]=!0,delete n[o],R[j.url]=!1),e.depCount+=1,e.depCallbacks[a]=u(e,a),v(j,!0).add(e.depCallbacks[a]));e.depCount?y(e):p(e)}function w(b){C.apply(null,
b)}function F(b,f){var a=b.map.fullName,c=b.depArray,d=!0,h,e,i,l;if(b.isDone||!a||!s[a])return l;if(f[a])return b;f[a]=!0;if(c){for(h=0;h<c.length;h++){e=c[h];if(!s[e]&&!ia[e]){d=!1;break}if((i=x[e])&&!i.isDone&&s[e])if(l=F(i,f))break}d||(l=r,delete f[a])}return l}function z(b,a){var g=b.map.fullName,c=b.depArray,d,h,e,i;if(b.isDone||!g||!s[g])return r;if(g){if(a[g])return n[g];a[g]=!0}if(c)for(d=0;d<c.length;d++)if(h=c[d])if((e=l(h).prefix)&&(i=x[e])&&z(i,a),(e=x[h])&&!e.isDone&&s[h])h=z(e,a),b.depCallbacks[d](h);
return n[g]}function E(){var b=q.waitSeconds*1E3,b=b&&i.startTime+b<(new Date).getTime(),a="",c=!1,l=!1,k=[],h,e;if(i.pausedCount>0)return r;if(q.priorityWait)if(j())A();else return r;for(h in s)if(!(h in L)&&(c=!0,!s[h]))if(b)a+=h+" ";else if(l=!0,h.indexOf("!")===-1){k=[];break}else(e=M[h]&&M[h].moduleDeps)&&k.push.apply(k,e);if(!c&&!i.waitCount)return r;if(b&&a)return b=P("timeout","Load timeout for modules: "+a),b.requireType="timeout",b.requireModules=a,b.contextName=i.contextName,d.onError(b);
if(l&&k.length)for(a=0;h=x[k[a]];a++)if(h=F(h,{})){z(h,{});break}if(!b&&(l||i.scriptCount)){if((I||da)&&!X)X=setTimeout(function(){X=0;E()},50);return r}if(i.waitCount){for(a=0;h=J[a];a++)z(h,{});i.paused.length&&A();Y<5&&(Y+=1,E())}Y=0;d.checkReadyState();return r}var i,A,q={waitSeconds:7,baseUrl:"./",paths:{},pkgs:{},catchError:{}},S=[],B={require:!0,exports:!0,module:!0},G={},n={},s={},x={},J=[],R={},O=0,M={},N={},H={},T={},Z=0;W=function(b){if(!i.jQuery&&(b=b||(typeof jQuery!=="undefined"?jQuery:
null))&&!(q.jQuery&&b.fn.jquery!==q.jQuery)&&("holdReady"in b||"readyWait"in b))if(i.jQuery=b,w(["jquery",[],function(){return jQuery}]),i.scriptCount)V(b,!0),i.jQueryIncremented=!0};A=function(){var b,a,c,l,k,h;i.takeGlobalQueue();Z+=1;if(i.scriptCount<=0)i.scriptCount=0;for(;S.length;)if(b=S.shift(),b[0]===null)return d.onError(P("mismatch","Mismatched anonymous define() module: "+b[b.length-1]));else w(b);if(!q.priorityWait||j())for(;i.paused.length;){k=i.paused;i.pausedCount+=k.length;i.paused=
[];for(l=0;b=k[l];l++)a=b.map,c=a.url,h=a.fullName,a.prefix?o(a.prefix,b):!R[c]&&!s[h]&&((q.requireLoad||d.load)(i,h,c),c.indexOf("empty:")!==0&&(R[c]=!0));i.startTime=(new Date).getTime();i.pausedCount-=k.length}Z===1&&E();Z-=1;return r};i={contextName:a,config:q,defQueue:S,waiting:x,waitCount:0,specified:B,loaded:s,urlMap:G,urlFetched:R,scriptCount:0,defined:n,paused:[],pausedCount:0,plugins:N,needFullExec:H,fake:{},fullExec:T,managerCallbacks:M,makeModuleMap:l,normalize:c,configure:function(b){var a,
c,d;b.baseUrl&&b.baseUrl.charAt(b.baseUrl.length-1)!=="/"&&(b.baseUrl+="/");a=q.paths;d=q.pkgs;$(q,b,!0);if(b.paths){for(c in b.paths)c in L||(a[c]=b.paths[c]);q.paths=a}if((a=b.packagePaths)||b.packages){if(a)for(c in a)c in L||aa(d,a[c],c);b.packages&&aa(d,b.packages);q.pkgs=d}if(b.priority)c=i.requireWait,i.requireWait=!1,A(),i.require(b.priority),A(),i.requireWait=c,q.priorityWait=b.priority;if(b.deps||b.callback)i.require(b.deps||[],b.callback)},requireDefined:function(b,a){return l(b,a).fullName in
n},requireSpecified:function(b,a){return l(b,a).fullName in B},require:function(b,c,g){if(typeof b==="string"){if(K(c))return d.onError(P("requireargs","Invalid require call"));if(d.get)return d.get(i,b,c);c=l(b,c);b=c.fullName;return!(b in n)?d.onError(P("notloaded","Module name '"+c.fullName+"' has not been loaded yet for context: "+a)):n[b]}(b&&b.length||c)&&C(null,b,c,g);if(!i.requireWait)for(;!i.scriptCount&&i.paused.length;)A();return i.require},takeGlobalQueue:function(){U.length&&(ja.apply(i.defQueue,
[i.defQueue.length-1,0].concat(U)),U=[])},completeLoad:function(b){var a;for(i.takeGlobalQueue();S.length;)if(a=S.shift(),a[0]===null){a[0]=b;break}else if(a[0]===b)break;else w(a),a=null;a?w(a):w([b,[],b==="jquery"&&typeof jQuery!=="undefined"?function(){return jQuery}:null]);d.isAsync&&(i.scriptCount-=1);A();d.isAsync||(i.scriptCount-=1)},toUrl:function(b,a){var c=b.lastIndexOf("."),d=null;c!==-1&&(d=b.substring(c,b.length),b=b.substring(0,c));return i.nameToUrl(b,d,a)},nameToUrl:function(b,a,g){var l,
k,h,e,j=i.config,b=c(b,g&&g.fullName);if(d.jsExtRegExp.test(b))a=b+(a?a:"");else{l=j.paths;k=j.pkgs;g=b.split("/");for(e=g.length;e>0;e--)if(h=g.slice(0,e).join("/"),l[h]){g.splice(0,e,l[h]);break}else if(h=k[h]){b=b===h.name?h.location+"/"+h.main:h.location;g.splice(0,e,b);break}a=g.join("/")+(a||".js");a=(a.charAt(0)==="/"||a.match(/^[\w\+\.\-]+:/)?"":j.baseUrl)+a}return j.urlArgs?a+((a.indexOf("?")===-1?"?":"&")+j.urlArgs):a}};i.jQueryCheck=W;i.resume=A;return i}function ka(){var a,c,d;if(C&&C.readyState===
"interactive")return C;a=document.getElementsByTagName("script");for(c=a.length-1;c>-1&&(d=a[c]);c--)if(d.readyState==="interactive")return C=d;return null}var la=/(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,ma=/require\(\s*["']([^'"\s]+)["']\s*\)/g,fa=/^\.\//,ba=/\.js$/,O=Object.prototype.toString,u=Array.prototype,ha=u.slice,ja=u.splice,I=!!(typeof window!=="undefined"&&navigator&&document),da=!I&&typeof importScripts!=="undefined",na=I&&navigator.platform==="PLAYSTATION 3"?/^complete$/:/^(complete|loaded)$/,
ea=typeof opera!=="undefined"&&opera.toString()==="[object Opera]",L={},D={},U=[],C=null,Y=0,Q=!1,ia={require:!0,module:!0,exports:!0},d,u={},J,y,v,E,o,w,F,B,z,W,X;if(typeof define==="undefined"){if(typeof requirejs!=="undefined")if(K(requirejs))return;else u=requirejs,requirejs=r;typeof require!=="undefined"&&!K(require)&&(u=require,require=r);d=requirejs=function(a,c,d){var j="_",k;!G(a)&&typeof a!=="string"&&(k=a,G(c)?(a=c,c=d):a=[]);if(k&&k.context)j=k.context;d=D[j]||(D[j]=ga(j));k&&d.configure(k);
return d.require(a,c)};d.config=function(a){return d(a)};require||(require=d);d.toUrl=function(a){return D._.toUrl(a)};d.version="1.0.8";d.jsExtRegExp=/^\/|:|\?|\.js$/;y=d.s={contexts:D,skipAsync:{}};if(d.isAsync=d.isBrowser=I)if(v=y.head=document.getElementsByTagName("head")[0],E=document.getElementsByTagName("base")[0])v=y.head=E.parentNode;d.onError=function(a){throw a;};d.load=function(a,c,l){d.resourcesReady(!1);a.scriptCount+=1;d.attach(l,a,c);if(a.jQuery&&!a.jQueryIncremented)V(a.jQuery,!0),
a.jQueryIncremented=!0};define=function(a,c,d){var j,k;typeof a!=="string"&&(d=c,c=a,a=null);G(c)||(d=c,c=[]);!c.length&&K(d)&&d.length&&(d.toString().replace(la,"").replace(ma,function(a,d){c.push(d)}),c=(d.length===1?["require"]:["require","exports","module"]).concat(c));if(Q&&(j=J||ka()))a||(a=j.getAttribute("data-requiremodule")),k=D[j.getAttribute("data-requirecontext")];(k?k.defQueue:U).push([a,c,d]);return r};define.amd={multiversion:!0,plugins:!0,jQuery:!0};d.exec=function(a){return eval(a)};
d.execCb=function(a,c,d,j){return c.apply(j,d)};d.addScriptToDom=function(a){J=a;E?v.insertBefore(a,E):v.appendChild(a);J=null};d.onScriptLoad=function(a){var c=a.currentTarget||a.srcElement,l;if(a.type==="load"||c&&na.test(c.readyState))C=null,a=c.getAttribute("data-requirecontext"),l=c.getAttribute("data-requiremodule"),D[a].completeLoad(l),c.detachEvent&&!ea?c.detachEvent("onreadystatechange",d.onScriptLoad):c.removeEventListener("load",d.onScriptLoad,!1)};d.attach=function(a,c,l,j,k,o){var p;
if(I)return j=j||d.onScriptLoad,p=c&&c.config&&c.config.xhtml?document.createElementNS("http://www.w3.org/1999/xhtml","html:script"):document.createElement("script"),p.type=k||c&&c.config.scriptType||"text/javascript",p.charset="utf-8",p.async=!y.skipAsync[a],c&&p.setAttribute("data-requirecontext",c.contextName),p.setAttribute("data-requiremodule",l),p.attachEvent&&!(p.attachEvent.toString&&p.attachEvent.toString().indexOf("[native code]")<0)&&!ea?(Q=!0,o?p.onreadystatechange=function(){if(p.readyState===
"loaded")p.onreadystatechange=null,p.attachEvent("onreadystatechange",j),o(p)}:p.attachEvent("onreadystatechange",j)):p.addEventListener("load",j,!1),p.src=a,o||d.addScriptToDom(p),p;else da&&(importScripts(a),c.completeLoad(l));return null};if(I){o=document.getElementsByTagName("script");for(B=o.length-1;B>-1&&(w=o[B]);B--){if(!v)v=w.parentNode;if(F=w.getAttribute("data-main")){if(!u.baseUrl)o=F.split("/"),w=o.pop(),o=o.length?o.join("/")+"/":"./",u.baseUrl=o,F=w.replace(ba,"");u.deps=u.deps?u.deps.concat(F):
[F];break}}}d.checkReadyState=function(){var a=y.contexts,c;for(c in a)if(!(c in L)&&a[c].waitCount)return;d.resourcesReady(!0)};d.resourcesReady=function(a){var c,l;d.resourcesDone=a;if(d.resourcesDone)for(l in a=y.contexts,a)if(!(l in L)&&(c=a[l],c.jQueryIncremented))V(c.jQuery,!1),c.jQueryIncremented=!1};d.pageLoaded=function(){if(document.readyState!=="complete")document.readyState="complete"};if(I&&document.addEventListener&&!document.readyState)document.readyState="loading",window.addEventListener("load",
d.pageLoaded,!1);d(u);if(d.isAsync&&typeof setTimeout!=="undefined")z=y.contexts[u.context||"_"],z.requireWait=!0,setTimeout(function(){z.requireWait=!1;z.scriptCount||z.resume();d.checkReadyState()},0)}})();

(function(window) {

var ORIGIN_ = location.protocol + '//' + location.host;

function SlideController() {
  this.popup = null;
  this.isPopup = window.opener;

  if (this.setupDone()) {
    window.addEventListener('message', this.onMessage_.bind(this), false);

    // Close popups if we reload the main window.
    window.addEventListener('beforeunload', function(e) {
      if (this.popup) {
        this.popup.close();
      }
    }.bind(this), false);
  }
}

SlideController.PRESENTER_MODE_PARAM = 'presentme';

SlideController.prototype.setupDone = function() {
  var params = location.search.substring(1).split('&').map(function(el) {
    return el.split('=');
  });

  var presentMe = null;
  for (var i = 0, param; param = params[i]; ++i) {
    if (param[0].toLowerCase() == SlideController.PRESENTER_MODE_PARAM) {
      presentMe = param[1] == 'true';
      break;
    }
  }

  if (presentMe !== null) {
    localStorage.ENABLE_PRESENTOR_MODE = presentMe;
    // TODO: use window.history.pushState to update URL instead of the redirect.
    if (window.history.replaceState) {
      window.history.replaceState({}, '', location.pathname);
    } else {
      location.replace(location.pathname);
      return false;
    }
  }

  var enablePresenterMode = localStorage.getItem('ENABLE_PRESENTOR_MODE');
  if (enablePresenterMode && JSON.parse(enablePresenterMode)) {
    // Only open popup from main deck. Don't want recursive popup opening!
    if (!this.isPopup) {
      var opts = 'menubar=no,location=yes,resizable=yes,scrollbars=no,status=no';
      this.popup = window.open(location.href, 'mywindow', opts);

      // Loading in the popup? Trigger the hotkey for turning presenter mode on.
      this.popup.addEventListener('load', function(e) {
        var evt = this.popup.document.createEvent('Event');
        evt.initEvent('keydown', true, true);
        evt.keyCode = 'P'.charCodeAt(0);
        this.popup.document.dispatchEvent(evt);
        // this.popup.document.body.classList.add('with-notes');
        // document.body.classList.add('popup');
      }.bind(this), false);
    }
  }

  return true;
}

SlideController.prototype.onMessage_ = function(e) {
  var data = e.data;

  // Restrict messages to being from this origin. Allow local developmet
  // from file:// though.
  // TODO: It would be dope if FF implemented location.origin!
  if (e.origin != ORIGIN_ && ORIGIN_.indexOf('file://') != 0) {
    alert('Someone tried to postMessage from an unknown origin');
    return;
  }

  // if (e.source.location.hostname != 'localhost') {
  //   alert('Someone tried to postMessage from an unknown origin');
  //   return;
  // }

  if ('keyCode' in data) {
    var evt = document.createEvent('Event');
    evt.initEvent('keydown', true, true);
    evt.keyCode = data.keyCode;
    document.dispatchEvent(evt);
  }
};

SlideController.prototype.sendMsg = function(msg) {
  // // Send message to popup window.
  // if (this.popup) {
  //   this.popup.postMessage(msg, ORIGIN_);
  // }

  // Send message to main window.
  if (this.isPopup) {
    // TODO: It would be dope if FF implemented location.origin.
    window.opener.postMessage(msg, '*');
  }
};

window.SlideController = SlideController;

})(window);


/**
 * @authors Luke Mahe
 * @authors Eric Bidelman
 * @fileoverview TODO
 */
document.cancelFullScreen = document.webkitCancelFullScreen ||
                            document.mozCancelFullScreen;

/**
 * @constructor
 */
function SlideDeck(el) {
  this.curSlide_ = 0;
  this.prevSlide_ = 0;
  this.config_ = null;
  this.container = el || document.querySelector('slides');
  this.slides = [];
  this.controller = null;

  this.getCurrentSlideFromHash_();

  // Call this explicitly. Modernizr.load won't be done until after DOM load.
  this.onDomLoaded_.bind(this)();
}

/**
 * @const
 * @private
 */
SlideDeck.prototype.SLIDE_CLASSES_ = [
  'far-past', 'past', 'current', 'next', 'far-next'];

/**
 * @const
 * @private
 */
SlideDeck.prototype.CSS_DIR_ = 'theme/css/';

/**
 * @private
 */
SlideDeck.prototype.getCurrentSlideFromHash_ = function() {
  var slideNo = parseInt(document.location.hash.substr(1));

  if (slideNo) {
    this.curSlide_ = slideNo - 1;
  } else {
    this.curSlide_ = 0;
  }
};

/**
 * @param {number} slideNo
 */
SlideDeck.prototype.loadSlide = function(slideNo) {
  if (slideNo) {
    this.curSlide_ = slideNo - 1;
    this.updateSlides_();
  }
};

/**
 * @private
 */
SlideDeck.prototype.onDomLoaded_ = function(e) {
  document.body.classList.add('loaded'); // Add loaded class for templates to use.

  this.slides = this.container.querySelectorAll('slide:not([hidden]):not(.hidden):not(.backdrop)');

  // If we're on a smartphone, apply special sauce.
  if (Modernizr.mq('only screen and (max-device-width: 480px)')) {
    // var style = document.createElement('link');
    // style.rel = 'stylesheet';
    // style.type = 'text/css';
    // style.href = this.CSS_DIR_ + 'phone.css';
    // document.querySelector('head').appendChild(style);

    // No need for widescreen layout on a phone.
    this.container.classList.remove('layout-widescreen');
  }

  this.loadConfig_(SLIDE_CONFIG);
  this.addEventListeners_();
  this.updateSlides_();

  // Add slide numbers and total slide count metadata to each slide.
  var that = this;
  for (var i = 0, slide; slide = this.slides[i]; ++i) {
    slide.dataset.slideNum = i + 1;
    slide.dataset.totalSlides = this.slides.length;

    slide.addEventListener('click', function(e) {
      if (document.body.classList.contains('overview')) {
        that.loadSlide(this.dataset.slideNum);
        e.preventDefault();
        window.setTimeout(function() {
          that.toggleOverview();
        }, 500);
      }
    }, false);
  }

  // Note: this needs to come after addEventListeners_(), which adds a
  // 'keydown' listener that this controller relies on.

  // Modernizr.touch isn't a sufficient check for devices that support both
  // touch and mouse. Create the controller in all cases.
  // // Also, no need to set this up if we're on mobile.
  // if (!Modernizr.touch) {
    this.controller = new SlideController(this);
    if (this.controller.isPopup) {
      document.body.classList.add('popup');
    }
  //}
};

/**
 * @private
 */
SlideDeck.prototype.addEventListeners_ = function() {
  document.addEventListener('keydown', this.onBodyKeyDown_.bind(this), false);
  window.addEventListener('popstate', this.onPopState_.bind(this), false);

  // var transEndEventNames = {
  //   'WebkitTransition': 'webkitTransitionEnd',
  //   'MozTransition': 'transitionend',
  //   'OTransition': 'oTransitionEnd',
  //   'msTransition': 'MSTransitionEnd',
  //   'transition': 'transitionend'
  // };
  // 
  // // Find the correct transitionEnd vendor prefix.
  // window.transEndEventName = transEndEventNames[
  //     Modernizr.prefixed('transition')];
  // 
  // // When slides are done transitioning, kickoff loading iframes.
  // // Note: we're only looking at a single transition (on the slide). This
  // // doesn't include autobuilds the slides may have. Also, if the slide
  // // transitions on multiple properties (e.g. not just 'all'), this doesn't
  // // handle that case.
  // this.container.addEventListener(transEndEventName, function(e) {
  //     this.enableSlideFrames_(this.curSlide_);
  // }.bind(this), false);

  // document.addEventListener('slideenter', function(e) {
  //   var slide = e.target;
  //   window.setTimeout(function() {
  //     this.enableSlideFrames_(e.slideNumber);
  //     this.enableSlideFrames_(e.slideNumber + 1);
  //   }.bind(this), 300);
  // }.bind(this), false);
};

/**
 * @private
 * @param {Event} e The pop event.
 */
SlideDeck.prototype.onPopState_ = function(e) {
  if (e.state != null) {
    this.curSlide_ = e.state;
    this.updateSlides_(true);
  }
};

/**
 * @param {Event} e
 */
SlideDeck.prototype.onBodyKeyDown_ = function(e) {
  if (/^(input|textarea)$/i.test(e.target.nodeName) ||
      e.target.isContentEditable) {
    return;
  }

  // Forward keydowns to the main slides if we're the popup.
  if (this.controller && this.controller.isPopup) {
    this.controller.sendMsg({keyCode: e.keyCode});
  }

  switch (e.keyCode) {
    case 13: // Enter
      if (document.body.classList.contains('overview')) {
        this.toggleOverview();
      }
      break;

    case 39: // right arrow
    case 32: // space
    case 34: // PgDn
      this.nextSlide();
      e.preventDefault();
      break;

    case 37: // left arrow
    case 8: // Backspace
    case 33: // PgUp
      this.prevSlide();
      e.preventDefault();
      break;

    case 40: // down arrow
      this.nextSlide();
      e.preventDefault();
      break;

    case 38: // up arrow
      this.prevSlide();
      e.preventDefault();
      break;

    case 72: // H: Toggle code highlighting
      document.body.classList.toggle('highlight-code');
      break;

    case 79: // O: Toggle overview
      this.toggleOverview();
      break;

    case 80: // P
      if (this.controller && this.controller.isPopup) {
        document.body.classList.toggle('with-notes');
      } else if (this.controller && !this.controller.popup) {
        document.body.classList.toggle('with-notes');
      }
      break;

    case 82: // R
      // TODO: implement refresh on main slides when popup is refreshed.
      break;

    case 27: // ESC: Hide notes and highlighting
      document.body.classList.remove('with-notes');
      document.body.classList.remove('highlight-code');

      if (document.body.classList.contains('overview')) {
        this.toggleOverview();
      }
      break;

    case 70: // F: Toggle fullscreen
       // Only respect 'f' on body. Don't want to capture keys from an <input>.
       // Also, ignore browser's fullscreen shortcut (cmd+shift+f) so we don't
       // get trapped in fullscreen!
      if (e.target == document.body && !(e.shiftKey && e.metaKey)) {
        if (document.mozFullScreen !== undefined && !document.mozFullScreen) {
          document.body.mozRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        } else if (document.webkitIsFullScreen !== undefined && !document.webkitIsFullScreen) {
          document.body.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        } else {
          document.cancelFullScreen();
        }
      }
      break;

    case 87: // W: Toggle widescreen
      // Only respect 'w' on body. Don't want to capture keys from an <input>.
      if (e.target == document.body && !(e.shiftKey && e.metaKey)) {
        this.container.classList.toggle('layout-widescreen');
      }
      break;
  }
};

/**
 *
 */
SlideDeck.prototype.focusOverview_ = function() {
  var overview = document.body.classList.contains('overview');

  for (var i = 0, slide; slide = this.slides[i]; i++) {
    slide.style[Modernizr.prefixed('transform')] = overview ?
        'translateZ(-2500px) translate(' + (( i - this.curSlide_ ) * 105) +
                                       '%, 0%)' : '';
  }
};

/**
 */
SlideDeck.prototype.toggleOverview = function() {
  document.body.classList.toggle('overview');

  this.focusOverview_();
};

/**
 * @private
 */
SlideDeck.prototype.loadConfig_ = function(config) {
  if (!config) {
    return;
  }

  this.config_ = config;

  var settings = this.config_.settings;

  this.loadTheme_(settings.theme || []);

  if (settings.favIcon) {
    this.addFavIcon_(settings.favIcon);
  }

  // Prettyprint. Default to on.
  if (!!!('usePrettify' in settings) || settings.usePrettify) {
    prettyPrint();
  }

  if (settings.analytics) {
    this.loadAnalytics_();
  }

  if (settings.fonts) {
    this.addFonts_(settings.fonts);
  }

  // Builds. Default to on.
  if (!!!('useBuilds' in settings) || settings.useBuilds) {
    this.makeBuildLists_();
  }

  if (settings.title) {
    document.title = settings.title.replace(/<br\/?>/, ' ');
    if (settings.eventInfo && settings.eventInfo.title) {
      document.title +=  ' - ' + settings.eventInfo.title;
    }
    document.querySelector('[data-config-title]').innerHTML = settings.title;
  }

  if (settings.subtitle) {
    document.querySelector('[data-config-subtitle]').innerHTML = settings.subtitle;
  }

  if (this.config_.presenters) {
    var presenters = this.config_.presenters;
    var dataConfigContact = document.querySelector('[data-config-contact]');

    var html = [];
    if (presenters.length == 1) {
      var p = presenters[0];

      var presenterTitle = [p.name];
      if (p.company) {
        presenterTitle.push(p.company);
      }
      html = presenterTitle.join(' - ') + '<br>';

      var gplus = p.gplus ? '<span>g+</span><a href="' + p.gplus +
          '">' + p.gplus.replace(/https?:\/\//, '') + '</a>' : '';

      var twitter = p.twitter ? '<span>twitter</span>' +
          '<a href="http://twitter.com/' + p.twitter + '">' +
          p.twitter + '</a>' : '';

      var www = p.www ? '<span>www</span><a href="' + p.www +
                        '">' + p.www.replace(/https?:\/\//, '') + '</a>' : '';

      var github = p.github ? '<span>github</span><a href="' + p.github +
          '">' + p.github.replace(/https?:\/\//, '') + '</a>' : '';

      var html2 = [gplus, twitter, www, github].join('<br>');

      if (dataConfigContact) {
        dataConfigContact.innerHTML = html2;
      }
    } else {
      for (var i = 0, p; p = presenters[i]; ++i) {
        html.push(p.name + ' - ' + p.company);
      }
      html = html.join('<br>');
      if (dataConfigContact) {
        dataConfigContact.innerHTML = html;
      }
    }

    var dataConfigPresenter = document.querySelector('[data-config-presenter]');
    if (dataConfigPresenter) {
      dataConfigPresenter.innerHTML = html;
      if (settings.eventInfo) {
        var date = settings.eventInfo.date;
        var dateInfo = date ? ' - <time>' + date + '</time>' : '';
        dataConfigPresenter.innerHTML += settings.eventInfo.title + dateInfo;
      }
    }
  }

  /* Left/Right tap areas. Default to including. */
  if (!!!('enableSlideAreas' in settings) || settings.enableSlideAreas) {
    var el = document.createElement('div');
    el.classList.add('slide-area');
    el.id = 'prev-slide-area';
    el.addEventListener('click', this.prevSlide.bind(this), false);
    this.container.appendChild(el);

    var el = document.createElement('div');
    el.classList.add('slide-area');
    el.id = 'next-slide-area';
    el.addEventListener('click', this.nextSlide.bind(this), false);
    this.container.appendChild(el);
  }

  if (Modernizr.touch && (!!!('enableTouch' in settings) ||
      settings.enableTouch)) {
    var self = this;

    // Note: this prevents mobile zoom in/out but prevents iOS from doing
    // it's crazy scroll over effect and disaligning the slides.
    window.addEventListener('touchstart', function(e) {
      e.preventDefault();
    }, false);

    var hammer = new Hammer(this.container);
    hammer.ondragend = function(e) {
      if (e.direction == 'right' || e.direction == 'down') {
        self.prevSlide();
      } else if (e.direction == 'left' || e.direction == 'up') {
        self.nextSlide();
      }
    };
  }
};

/**
 * @private
 * @param {Array.<string>} fonts
 */
SlideDeck.prototype.addFonts_ = function(fonts) {
  var el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = ('https:' == document.location.protocol ? 'https' : 'http') +
      '://fonts.googleapis.com/css?family=' + fonts.join('|') + '&v2';
  document.querySelector('head').appendChild(el);
};

/**
 * @private
 */
SlideDeck.prototype.buildNextItem_ = function() {
  var slide = this.slides[this.curSlide_];
  var toBuild = slide.querySelector('.to-build');
  var built = slide.querySelector('.build-current');

  if (built) {
    built.classList.remove('build-current');
    if (built.classList.contains('fade')) {
      built.classList.add('build-fade');
    }
  }

  if (!toBuild) {
    var items = slide.querySelectorAll('.build-fade');
    for (var j = 0, item; item = items[j]; j++) {
      item.classList.remove('build-fade');
    }
    return false;
  }

  toBuild.classList.remove('to-build');
  toBuild.classList.add('build-current');

  return true;
};

/**
 * @param {boolean=} opt_dontPush
 */
SlideDeck.prototype.prevSlide = function(opt_dontPush) {
  if (this.curSlide_ > 0) {
    var bodyClassList = document.body.classList;
    bodyClassList.remove('highlight-code');

    // Toggle off speaker notes if they're showing when we move backwards on the
    // main slides. If we're the speaker notes popup, leave them up.
    if (this.controller && !this.controller.isPopup) {
      bodyClassList.remove('with-notes');
    } else if (!this.controller) {
      bodyClassList.remove('with-notes');
    }

    this.prevSlide_ = this.curSlide_--;

    this.updateSlides_(opt_dontPush);
  }
};

/**
 * @param {boolean=} opt_dontPush
 */
SlideDeck.prototype.nextSlide = function(opt_dontPush) {
  if (!document.body.classList.contains('overview') && this.buildNextItem_()) {
    return;
  }

  if (this.curSlide_ < this.slides.length - 1) {
    var bodyClassList = document.body.classList;
    bodyClassList.remove('highlight-code');

    // Toggle off speaker notes if they're showing when we advanced on the main
    // slides. If we're the speaker notes popup, leave them up.
    if (this.controller && !this.controller.isPopup) {
      bodyClassList.remove('with-notes');
    } else if (!this.controller) {
      bodyClassList.remove('with-notes');
    }

    this.prevSlide_ = this.curSlide_++;

    this.updateSlides_(opt_dontPush);
  }
};

/* Slide events */

/**
 * Triggered when a slide enter/leave event should be dispatched.
 *
 * @param {string} type The type of event to trigger
 *     (e.g. 'slideenter', 'slideleave').
 * @param {number} slideNo The index of the slide that is being left.
 */
SlideDeck.prototype.triggerSlideEvent = function(type, slideNo) {
  var el = this.getSlideEl_(slideNo);
  if (!el) {
    return;
  }

  // Call onslideenter/onslideleave if the attribute is defined on this slide.
  var func = el.getAttribute(type);
  if (func) {
    new Function(func).call(el); // TODO: Don't use new Function() :(
  }

  // Dispatch event to listeners setup using addEventListener.
  var evt = document.createEvent('Event');
  evt.initEvent(type, true, true);
  evt.slideNumber = slideNo + 1; // Make it readable
  evt.slide = el;

  el.dispatchEvent(evt);
};

/**
 * @private
 */
SlideDeck.prototype.updateSlides_ = function(opt_dontPush) {
  var dontPush = opt_dontPush || false;

  var curSlide = this.curSlide_;
  for (var i = 0; i < this.slides.length; ++i) {
    switch (i) {
      case curSlide - 2:
        this.updateSlideClass_(i, 'far-past');
        break;
      case curSlide - 1:
        this.updateSlideClass_(i, 'past');
        break;
      case curSlide:
        this.updateSlideClass_(i, 'current');
        break;
      case curSlide + 1:
        this.updateSlideClass_(i, 'next');
        break;
      case curSlide + 2:
        this.updateSlideClass_(i, 'far-next');
        break;
      default:
        this.updateSlideClass_(i);
        break;
    }
  };

  this.triggerSlideEvent('slideleave', this.prevSlide_);
  this.triggerSlideEvent('slideenter', curSlide);

// window.setTimeout(this.disableSlideFrames_.bind(this, curSlide - 2), 301);
// 
// this.enableSlideFrames_(curSlide - 1); // Previous slide.
// this.enableSlideFrames_(curSlide + 1); // Current slide.
// this.enableSlideFrames_(curSlide + 2); // Next slide.

   // Enable current slide's iframes (needed for page loat at current slide).
   this.enableSlideFrames_(curSlide + 1);

   // No way to tell when all slide transitions + auto builds are done.
   // Give ourselves a good buffer to preload the next slide's iframes.
   window.setTimeout(this.enableSlideFrames_.bind(this, curSlide + 2), 1000);

  this.updateHash_(dontPush);

  if (document.body.classList.contains('overview')) {
    this.focusOverview_();
    return;
  }

};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.enableSlideFrames_ = function(slideNo) {
  var el = this.slides[slideNo - 1];
  if (!el) {
    return;
  }

  var frames = el.querySelectorAll('iframe');
  for (var i = 0, frame; frame = frames[i]; i++) {
    this.enableFrame_(frame);
  }
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.enableFrame_ = function(frame) {
  var src = frame.dataset.src;
  if (src && frame.src != src) {
    frame.src = src;
  }
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.disableSlideFrames_ = function(slideNo) {
  var el = this.slides[slideNo - 1];
  if (!el) {
    return;
  }

  var frames = el.querySelectorAll('iframe');
  for (var i = 0, frame; frame = frames[i]; i++) {
    this.disableFrame_(frame);
  }
};

/**
 * @private
 * @param {Node} frame
 */
SlideDeck.prototype.disableFrame_ = function(frame) {
  frame.src = 'about:blank';
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.getSlideEl_ = function(no) {
  if ((no < 0) || (no >= this.slides.length)) {
    return null;
  } else {
    return this.slides[no];
  }
};

/**
 * @private
 * @param {number} slideNo
 * @param {string} className
 */
SlideDeck.prototype.updateSlideClass_ = function(slideNo, className) {
  var el = this.getSlideEl_(slideNo);

  if (!el) {
    return;
  }

  if (className) {
    el.classList.add(className);
  }

  for (var i = 0, slideClass; slideClass = this.SLIDE_CLASSES_[i]; ++i) {
    if (className != slideClass) {
      el.classList.remove(slideClass);
    }
  }
};

/**
 * @private
 */
SlideDeck.prototype.makeBuildLists_ = function () {
  for (var i = this.curSlide_, slide; slide = this.slides[i]; ++i) {
    var items = slide.querySelectorAll('.build > *');
    for (var j = 0, item; item = items[j]; ++j) {
      if (item.classList) {
        item.classList.add('to-build');
        if (item.parentNode.classList.contains('fade')) {
          item.classList.add('fade');
        }
      }
    }
  }
};

/**
 * @private
 * @param {boolean} dontPush
 */
SlideDeck.prototype.updateHash_ = function(dontPush) {
  if (!dontPush) {
    var slideNo = this.curSlide_ + 1;
    var hash = '#' + slideNo;
    if (window.history.pushState) {
      window.history.pushState(this.curSlide_, 'Slide ' + slideNo, hash);
    } else {
      window.location.replace(hash);
    }

    // Record GA hit on this slide.
    window['_gaq'] && window['_gaq'].push(['_trackPageview',
                                          document.location.href]);
  }
};


/**
 * @private
 * @param {string} favIcon
 */
SlideDeck.prototype.addFavIcon_ = function(favIcon) {
  var el = document.createElement('link');
  el.rel = 'icon';
  el.type = 'image/png';
  el.href = favIcon;
  document.querySelector('head').appendChild(el);
};

/**
 * @private
 * @param {string} theme
 */
SlideDeck.prototype.loadTheme_ = function(theme) {
  var styles = [];
  if (theme.constructor.name === 'String') {
    styles.push(theme);
  } else {
    styles = theme;
  }

  for (var i = 0, style; themeUrl = styles[i]; i++) {
    var style = document.createElement('link');
    style.rel = 'stylesheet';
    style.type = 'text/css';
    if (themeUrl.indexOf('http') == -1) {
      style.href = this.CSS_DIR_ + themeUrl + '.css';
    } else {
      style.href = themeUrl;
    }
    document.querySelector('head').appendChild(style);
  }
};

/**
 * @private
 */
SlideDeck.prototype.loadAnalytics_ = function() {
  var _gaq = window['_gaq'] || [];
  _gaq.push(['_setAccount', this.config_.settings.analytics]);
  _gaq.push(['_trackPageview']);

  (function() {
    var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
    ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
  })();
};


// Polyfill missing APIs (if we need to), then create the slide deck.
// iOS < 5 needs classList, dataset, and window.matchMedia. Modernizr contains
// the last one.
(function() {
  Modernizr.load({
    test: !!document.body.classList && !!document.body.dataset,
    nope: ['js/polyfills/classList.min.js', 'js/polyfills/dataset.min.js'],
    complete: function() {
      window.slidedeck = new SlideDeck();
    }
  });
})();

require(['order!../slide_config', 'order!modernizr.custom.45394',
         'order!prettify/prettify', 'order!hammer', 'order!slide-controller',
         'order!slide-deck'], function(someModule) {

});

/* @source http://purl.eligrey.com/github/classList.js/blob/master/classList.js*/
"use strict";if(typeof document!=="undefined"&&!("classList" in document.createElement("a"))){(function(a){var f="classList",d="prototype",e=(a.HTMLElement||a.Element)[d],g=Object;strTrim=String[d].trim||function(){return this.replace(/^\s+|\s+$/g,"")},arrIndexOf=Array[d].indexOf||function(k){for(var j=0,h=this.length;j<h;j++){if(j in this&&this[j]===k){return j}}return -1},DOMEx=function(h,i){this.name=h;this.code=DOMException[h];this.message=i},checkTokenAndGetIndex=function(i,h){if(h===""){throw new DOMEx("SYNTAX_ERR","An invalid or illegal string was specified")}if(/\s/.test(h)){throw new DOMEx("INVALID_CHARACTER_ERR","String contains an invalid character")}return arrIndexOf.call(i,h)},ClassList=function(m){var l=strTrim.call(m.className),k=l?l.split(/\s+/):[];for(var j=0,h=k.length;j<h;j++){this.push(k[j])}this._updateClassName=function(){m.className=this.toString()}},classListProto=ClassList[d]=[],classListGetter=function(){return new ClassList(this)};DOMEx[d]=Error[d];classListProto.item=function(h){return this[h]||null};classListProto.contains=function(h){h+="";return checkTokenAndGetIndex(this,h)!==-1};classListProto.add=function(h){h+="";if(checkTokenAndGetIndex(this,h)===-1){this.push(h);this._updateClassName()}};classListProto.remove=function(i){i+="";var h=checkTokenAndGetIndex(this,i);if(h!==-1){this.splice(h,1);this._updateClassName()}};classListProto.toggle=function(h){h+="";if(checkTokenAndGetIndex(this,h)===-1){this.add(h)}else{this.remove(h)}};classListProto.toString=function(){return this.join(" ")};if(g.defineProperty){var c={get:classListGetter,enumerable:true,configurable:true};try{g.defineProperty(e,f,c)}catch(b){if(b.number===-2146823252){c.enumerable=false;g.defineProperty(e,f,c)}}}else{if(g[d].__defineGetter__){e.__defineGetter__(f,classListGetter)}}}(self))};
(function(){function c(){d=!0;this.removeEventListener("DOMAttrModified",c,!1)}function g(b){return b.replace(h,function(b,a){return a.toUpperCase()})}function e(){var b={};i.call(this.attributes,function(a){if(f=a.name.match(j))b[g(f[1])]=a.value});return b}var i=[].forEach,j=/^data-(.+)/,h=/\-([a-z])/ig,a=document.createElement("div"),d=!1,f;a.dataset==void 0&&(a.addEventListener("DOMAttrModified",c,!1),a.setAttribute("foo","bar"),Element.prototype.__defineGetter__("dataset",d?function(){if(!this._datasetCache)this._datasetCache=
e.call(this);return this._datasetCache}:e),document.addEventListener("DOMAttrModified",function(a){delete a.target._datasetCache},!1))})();
(function(a,b){"use strict";var c=a.console||b,d=a.document,e=a.navigator,f=a.sessionStorage||!1,g=a.setTimeout,h=a.clearTimeout,i=a.setInterval,j=a.clearInterval,k=a.JSON,l=a.alert,m=a.History=a.History||{},n=a.history;k.stringify=k.stringify||k.encode,k.parse=k.parse||k.decode;if(typeof m.init!="undefined")throw new Error("History.js Core has already been loaded...");m.init=function(){return typeof m.Adapter=="undefined"?!1:(typeof m.initCore!="undefined"&&m.initCore(),typeof m.initHtml4!="undefined"&&m.initHtml4(),!0)},m.initCore=function(){if(typeof m.initCore.initialized!="undefined")return!1;m.initCore.initialized=!0,m.options=m.options||{},m.options.hashChangeInterval=m.options.hashChangeInterval||100,m.options.safariPollInterval=m.options.safariPollInterval||500,m.options.doubleCheckInterval=m.options.doubleCheckInterval||500,m.options.storeInterval=m.options.storeInterval||1e3,m.options.busyDelay=m.options.busyDelay||250,m.options.debug=m.options.debug||!1,m.options.initialTitle=m.options.initialTitle||d.title,m.intervalList=[],m.clearAllIntervals=function(){var a,b=m.intervalList;if(typeof b!="undefined"&&b!==null){for(a=0;a<b.length;a++)j(b[a]);m.intervalList=null}},m.debug=function(){(m.options.debug||!1)&&m.log.apply(m,arguments)},m.log=function(){var a=typeof c!="undefined"&&typeof c.log!="undefined"&&typeof c.log.apply!="undefined",b=d.getElementById("log"),e,f,g,h,i;a?(h=Array.prototype.slice.call(arguments),e=h.shift(),typeof c.debug!="undefined"?c.debug.apply(c,[e,h]):c.log.apply(c,[e,h])):e="\n"+arguments[0]+"\n";for(f=1,g=arguments.length;f<g;++f){i=arguments[f];if(typeof i=="object"&&typeof k!="undefined")try{i=k.stringify(i)}catch(j){}e+="\n"+i+"\n"}return b?(b.value+=e+"\n-----\n",b.scrollTop=b.scrollHeight-b.clientHeight):a||l(e),!0},m.getInternetExplorerMajorVersion=function(){var a=m.getInternetExplorerMajorVersion.cached=typeof m.getInternetExplorerMajorVersion.cached!="undefined"?m.getInternetExplorerMajorVersion.cached:function(){var a=3,b=d.createElement("div"),c=b.getElementsByTagName("i");while((b.innerHTML="<!--[if gt IE "+ ++a+"]><i></i><![endif]-->")&&c[0]);return a>4?a:!1}();return a},m.isInternetExplorer=function(){var a=m.isInternetExplorer.cached=typeof m.isInternetExplorer.cached!="undefined"?m.isInternetExplorer.cached:Boolean(m.getInternetExplorerMajorVersion());return a},m.emulated={pushState:!Boolean(a.history&&a.history.pushState&&a.history.replaceState&&!/ Mobile\/([1-7][a-z]|(8([abcde]|f(1[0-8]))))/i.test(e.userAgent)&&!/AppleWebKit\/5([0-2]|3[0-2])/i.test(e.userAgent)),hashChange:Boolean(!("onhashchange"in a||"onhashchange"in d)||m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<8)},m.enabled=!m.emulated.pushState,m.bugs={setHash:Boolean(!m.emulated.pushState&&e.vendor==="Apple Computer, Inc."&&/AppleWebKit\/5([0-2]|3[0-3])/.test(e.userAgent)),safariPoll:Boolean(!m.emulated.pushState&&e.vendor==="Apple Computer, Inc."&&/AppleWebKit\/5([0-2]|3[0-3])/.test(e.userAgent)),ieDoubleCheck:Boolean(m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<8),hashEscape:Boolean(m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<7)},m.isEmptyObject=function(a){for(var b in a)return!1;return!0},m.cloneObject=function(a){var b,c;return a?(b=k.stringify(a),c=k.parse(b)):c={},c},m.getRootUrl=function(){var a=d.location.protocol+"//"+(d.location.hostname||d.location.host);if(d.location.port||!1)a+=":"+d.location.port;return a+="/",a},m.getBaseHref=function(){var a=d.getElementsByTagName("base"),b=null,c="";return a.length===1&&(b=a[0],c=b.href.replace(/[^\/]+$/,"")),c=c.replace(/\/+$/,""),c&&(c+="/"),c},m.getBaseUrl=function(){var a=m.getBaseHref()||m.getBasePageUrl()||m.getRootUrl();return a},m.getPageUrl=function(){var a=m.getState(!1,!1),b=(a||{}).url||d.location.href,c;return c=b.replace(/\/+$/,"").replace(/[^\/]+$/,function(a,b,c){return/\./.test(a)?a:a+"/"}),c},m.getBasePageUrl=function(){var a=d.location.href.replace(/[#\?].*/,"").replace(/[^\/]+$/,function(a,b,c){return/[^\/]$/.test(a)?"":a}).replace(/\/+$/,"")+"/";return a},m.getFullUrl=function(a,b){var c=a,d=a.substring(0,1);return b=typeof b=="undefined"?!0:b,/[a-z]+\:\/\//.test(a)||(d==="/"?c=m.getRootUrl()+a.replace(/^\/+/,""):d==="#"?c=m.getPageUrl().replace(/#.*/,"")+a:d==="?"?c=m.getPageUrl().replace(/[\?#].*/,"")+a:b?c=m.getBaseUrl()+a.replace(/^(\.\/)+/,""):c=m.getBasePageUrl()+a.replace(/^(\.\/)+/,"")),c.replace(/\#$/,"")},m.getShortUrl=function(a){var b=a,c=m.getBaseUrl(),d=m.getRootUrl();return m.emulated.pushState&&(b=b.replace(c,"")),b=b.replace(d,"/"),m.isTraditionalAnchor(b)&&(b="./"+b),b=b.replace(/^(\.\/)+/g,"./").replace(/\#$/,""),b},m.store={},m.idToState=m.idToState||{},m.stateToId=m.stateToId||{},m.urlToId=m.urlToId||{},m.storedStates=m.storedStates||[],m.savedStates=m.savedStates||[],m.normalizeStore=function(){m.store.idToState=m.store.idToState||{},m.store.urlToId=m.store.urlToId||{},m.store.stateToId=m.store.stateToId||{}},m.getState=function(a,b){typeof a=="undefined"&&(a=!0),typeof b=="undefined"&&(b=!0);var c=m.getLastSavedState();return!c&&b&&(c=m.createStateObject()),a&&(c=m.cloneObject(c),c.url=c.cleanUrl||c.url),c},m.getIdByState=function(a){var b=m.extractId(a.url),c;if(!b){c=m.getStateString(a);if(typeof m.stateToId[c]!="undefined")b=m.stateToId[c];else if(typeof m.store.stateToId[c]!="undefined")b=m.store.stateToId[c];else{for(;;){b=(new Date).getTime()+String(Math.random()).replace(/\D/g,"");if(typeof m.idToState[b]=="undefined"&&typeof m.store.idToState[b]=="undefined")break}m.stateToId[c]=b,m.idToState[b]=a}}return b},m.normalizeState=function(a){var b,c;if(!a||typeof a!="object")a={};if(typeof a.normalized!="undefined")return a;if(!a.data||typeof a.data!="object")a.data={};b={},b.normalized=!0,b.title=a.title||"",b.url=m.getFullUrl(m.unescapeString(a.url||d.location.href)),b.hash=m.getShortUrl(b.url),b.data=m.cloneObject(a.data),b.id=m.getIdByState(b),b.cleanUrl=b.url.replace(/\??\&_suid.*/,""),b.url=b.cleanUrl,c=!m.isEmptyObject(b.data);if(b.title||c)b.hash=m.getShortUrl(b.url).replace(/\??\&_suid.*/,""),/\?/.test(b.hash)||(b.hash+="?"),b.hash+="&_suid="+b.id;return b.hashedUrl=m.getFullUrl(b.hash),(m.emulated.pushState||m.bugs.safariPoll)&&m.hasUrlDuplicate(b)&&(b.url=b.hashedUrl),b},m.createStateObject=function(a,b,c){var d={data:a,title:b,url:c};return d=m.normalizeState(d),d},m.getStateById=function(a){a=String(a);var c=m.idToState[a]||m.store.idToState[a]||b;return c},m.getStateString=function(a){var b,c,d;return b=m.normalizeState(a),c={data:b.data,title:a.title,url:a.url},d=k.stringify(c),d},m.getStateId=function(a){var b,c;return b=m.normalizeState(a),c=b.id,c},m.getHashByState=function(a){var b,c;return b=m.normalizeState(a),c=b.hash,c},m.extractId=function(a){var b,c,d;return c=/(.*)\&_suid=([0-9]+)$/.exec(a),d=c?c[1]||a:a,b=c?String(c[2]||""):"",b||!1},m.isTraditionalAnchor=function(a){var b=!/[\/\?\.]/.test(a);return b},m.extractState=function(a,b){var c=null,d,e;return b=b||!1,d=m.extractId(a),d&&(c=m.getStateById(d)),c||(e=m.getFullUrl(a),d=m.getIdByUrl(e)||!1,d&&(c=m.getStateById(d)),!c&&b&&!m.isTraditionalAnchor(a)&&(c=m.createStateObject(null,null,e))),c},m.getIdByUrl=function(a){var c=m.urlToId[a]||m.store.urlToId[a]||b;return c},m.getLastSavedState=function(){return m.savedStates[m.savedStates.length-1]||b},m.getLastStoredState=function(){return m.storedStates[m.storedStates.length-1]||b},m.hasUrlDuplicate=function(a){var b=!1,c;return c=m.extractState(a.url),b=c&&c.id!==a.id,b},m.storeState=function(a){return m.urlToId[a.url]=a.id,m.storedStates.push(m.cloneObject(a)),a},m.isLastSavedState=function(a){var b=!1,c,d,e;return m.savedStates.length&&(c=a.id,d=m.getLastSavedState(),e=d.id,b=c===e),b},m.saveState=function(a){return m.isLastSavedState(a)?!1:(m.savedStates.push(m.cloneObject(a)),!0)},m.getStateByIndex=function(a){var b=null;return typeof a=="undefined"?b=m.savedStates[m.savedStates.length-1]:a<0?b=m.savedStates[m.savedStates.length+a]:b=m.savedStates[a],b},m.getHash=function(){var a=m.unescapeHash(d.location.hash);return a},m.unescapeString=function(b){var c=b,d;for(;;){d=a.unescape(c);if(d===c)break;c=d}return c},m.unescapeHash=function(a){var b=m.normalizeHash(a);return b=m.unescapeString(b),b},m.normalizeHash=function(a){var b=a.replace(/[^#]*#/,"").replace(/#.*/,"");return b},m.setHash=function(a,b){var c,e,f;return b!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.setHash,args:arguments,queue:b}),!1):(c=m.escapeHash(a),m.busy(!0),e=m.extractState(a,!0),e&&!m.emulated.pushState?m.pushState(e.data,e.title,e.url,!1):d.location.hash!==c&&(m.bugs.setHash?(f=m.getPageUrl(),m.pushState(null,null,f+"#"+c,!1)):d.location.hash=c),m)},m.escapeHash=function(b){var c=m.normalizeHash(b);return c=a.escape(c),m.bugs.hashEscape||(c=c.replace(/\%21/g,"!").replace(/\%26/g,"&").replace(/\%3D/g,"=").replace(/\%3F/g,"?")),c},m.getHashByUrl=function(a){var b=String(a).replace(/([^#]*)#?([^#]*)#?(.*)/,"$2");return b=m.unescapeHash(b),b},m.setTitle=function(a){var b=a.title,c;b||(c=m.getStateByIndex(0),c&&c.url===a.url&&(b=c.title||m.options.initialTitle));try{d.getElementsByTagName("title")[0].innerHTML=b.replace("<","&lt;").replace(">","&gt;").replace(" & "," &amp; ")}catch(e){}return d.title=b,m},m.queues=[],m.busy=function(a){typeof a!="undefined"?m.busy.flag=a:typeof m.busy.flag=="undefined"&&(m.busy.flag=!1);if(!m.busy.flag){h(m.busy.timeout);var b=function(){var a,c,d;if(m.busy.flag)return;for(a=m.queues.length-1;a>=0;--a){c=m.queues[a];if(c.length===0)continue;d=c.shift(),m.fireQueueItem(d),m.busy.timeout=g(b,m.options.busyDelay)}};m.busy.timeout=g(b,m.options.busyDelay)}return m.busy.flag},m.busy.flag=!1,m.fireQueueItem=function(a){return a.callback.apply(a.scope||m,a.args||[])},m.pushQueue=function(a){return m.queues[a.queue||0]=m.queues[a.queue||0]||[],m.queues[a.queue||0].push(a),m},m.queue=function(a,b){return typeof a=="function"&&(a={callback:a}),typeof b!="undefined"&&(a.queue=b),m.busy()?m.pushQueue(a):m.fireQueueItem(a),m},m.clearQueue=function(){return m.busy.flag=!1,m.queues=[],m},m.stateChanged=!1,m.doubleChecker=!1,m.doubleCheckComplete=function(){return m.stateChanged=!0,m.doubleCheckClear(),m},m.doubleCheckClear=function(){return m.doubleChecker&&(h(m.doubleChecker),m.doubleChecker=!1),m},m.doubleCheck=function(a){return m.stateChanged=!1,m.doubleCheckClear(),m.bugs.ieDoubleCheck&&(m.doubleChecker=g(function(){return m.doubleCheckClear(),m.stateChanged||a(),!0},m.options.doubleCheckInterval)),m},m.safariStatePoll=function(){var b=m.extractState(d.location.href),c;if(!m.isLastSavedState(b))c=b;else return;return c||(c=m.createStateObject()),m.Adapter.trigger(a,"popstate"),m},m.back=function(a){return a!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.back,args:arguments,queue:a}),!1):(m.busy(!0),m.doubleCheck(function(){m.back(!1)}),n.go(-1),!0)},m.forward=function(a){return a!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.forward,args:arguments,queue:a}),!1):(m.busy(!0),m.doubleCheck(function(){m.forward(!1)}),n.go(1),!0)},m.go=function(a,b){var c;if(a>0)for(c=1;c<=a;++c)m.forward(b);else{if(!(a<0))throw new Error("History.go: History.go requires a positive or negative integer passed.");for(c=-1;c>=a;--c)m.back(b)}return m};if(m.emulated.pushState){var o=function(){};m.pushState=m.pushState||o,m.replaceState=m.replaceState||o}else m.onPopState=function(b,c){var e=!1,f=!1,g,h;return m.doubleCheckComplete(),g=m.getHash(),g?(h=m.extractState(g||d.location.href,!0),h?m.replaceState(h.data,h.title,h.url,!1):(m.Adapter.trigger(a,"anchorchange"),m.busy(!1)),m.expectedStateId=!1,!1):(e=m.Adapter.extractEventData("state",b,c)||!1,e?f=m.getStateById(e):m.expectedStateId?f=m.getStateById(m.expectedStateId):f=m.extractState(d.location.href),f||(f=m.createStateObject(null,null,d.location.href)),m.expectedStateId=!1,m.isLastSavedState(f)?(m.busy(!1),!1):(m.storeState(f),m.saveState(f),m.setTitle(f),m.Adapter.trigger(a,"statechange"),m.busy(!1),!0))},m.Adapter.bind(a,"popstate",m.onPopState),m.pushState=function(b,c,d,e){if(m.getHashByUrl(d)&&m.emulated.pushState)throw new Error("History.js does not support states with fragement-identifiers (hashes/anchors).");if(e!==!1&&m.busy())return m.pushQueue({scope:m,callback:m.pushState,args:arguments,queue:e}),!1;m.busy(!0);var f=m.createStateObject(b,c,d);return m.isLastSavedState(f)?m.busy(!1):(m.storeState(f),m.expectedStateId=f.id,n.pushState(f.id,f.title,f.url),m.Adapter.trigger(a,"popstate")),!0},m.replaceState=function(b,c,d,e){if(m.getHashByUrl(d)&&m.emulated.pushState)throw new Error("History.js does not support states with fragement-identifiers (hashes/anchors).");if(e!==!1&&m.busy())return m.pushQueue({scope:m,callback:m.replaceState,args:arguments,queue:e}),!1;m.busy(!0);var f=m.createStateObject(b,c,d);return m.isLastSavedState(f)?m.busy(!1):(m.storeState(f),m.expectedStateId=f.id,n.replaceState(f.id,f.title,f.url),m.Adapter.trigger(a,"popstate")),!0};if(f){try{m.store=k.parse(f.getItem("History.store"))||{}}catch(p){m.store={}}m.normalizeStore()}else m.store={},m.normalizeStore();m.Adapter.bind(a,"beforeunload",m.clearAllIntervals),m.Adapter.bind(a,"unload",m.clearAllIntervals),m.saveState(m.storeState(m.extractState(d.location.href,!0))),f&&(m.onUnload=function(){var a,b;try{a=k.parse(f.getItem("History.store"))||{}}catch(c){a={}}a.idToState=a.idToState||{},a.urlToId=a.urlToId||{},a.stateToId=a.stateToId||{};for(b in m.idToState){if(!m.idToState.hasOwnProperty(b))continue;a.idToState[b]=m.idToState[b]}for(b in m.urlToId){if(!m.urlToId.hasOwnProperty(b))continue;a.urlToId[b]=m.urlToId[b]}for(b in m.stateToId){if(!m.stateToId.hasOwnProperty(b))continue;a.stateToId[b]=m.stateToId[b]}m.store=a,m.normalizeStore(),f.setItem("History.store",k.stringify(a))},m.intervalList.push(i(m.onUnload,m.options.storeInterval)),m.Adapter.bind(a,"beforeunload",m.onUnload),m.Adapter.bind(a,"unload",m.onUnload));if(!m.emulated.pushState){m.bugs.safariPoll&&m.intervalList.push(i(m.safariStatePoll,m.options.safariPollInterval));if(e.vendor==="Apple Computer, Inc."||(e.appCodeName||"")==="Mozilla")m.Adapter.bind(a,"hashchange",function(){m.Adapter.trigger(a,"popstate")}),m.getHash()&&m.Adapter.onDomLoad(function(){m.Adapter.trigger(a,"hashchange")})}},m.init()})(window)
PR.registerLangHandler(PR.createSimpleLexer([["com",/^#[^\n\r]*/,null,"#"],["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,null,'"']],[["kwd",/^(?:ADS|AD|AUG|BZF|BZMF|CAE|CAF|CA|CCS|COM|CS|DAS|DCA|DCOM|DCS|DDOUBL|DIM|DOUBLE|DTCB|DTCF|DV|DXCH|EDRUPT|EXTEND|INCR|INDEX|NDX|INHINT|LXCH|MASK|MSK|MP|MSU|NOOP|OVSK|QXCH|RAND|READ|RELINT|RESUME|RETURN|ROR|RXOR|SQUARE|SU|TCR|TCAA|OVSK|TCF|TC|TS|WAND|WOR|WRITE|XCH|XLQ|XXALQ|ZL|ZQ|ADD|ADZ|SUB|SUZ|MPY|MPR|MPZ|DVP|COM|ABS|CLA|CLZ|LDQ|STO|STQ|ALS|LLS|LRS|TRA|TSQ|TMI|TOV|AXT|TIX|DLY|INP|OUT)\s/,
null],["typ",/^(?:-?GENADR|=MINUS|2BCADR|VN|BOF|MM|-?2CADR|-?[1-6]DNADR|ADRES|BBCON|[ES]?BANK=?|BLOCK|BNKSUM|E?CADR|COUNT\*?|2?DEC\*?|-?DNCHAN|-?DNPTR|EQUALS|ERASE|MEMORY|2?OCT|REMADR|SETLOC|SUBRO|ORG|BSS|BES|SYN|EQU|DEFINE|END)\s/,null],["lit",/^'(?:-*(?:\w|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?)?/],["pln",/^-*(?:[!-z]|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?/],["pun",/^[^\w\t\n\r "'-);\\\xa0]+/]]),["apollo","agc","aea"]);

/*
 Copyright (C) 2011 Google Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/
var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["opn",/^[([{]+/,a,"([{"],["clo",/^[)\]}]+/,a,")]}"],["com",/^;[^\n\r]*/,a,";"],["pln",/^[\t\n\r \xa0]+/,a,"\t\n\r \xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,a,'"']],[["kwd",/^(?:def|if|do|let|quote|var|fn|loop|recur|throw|try|monitor-enter|monitor-exit|defmacro|defn|defn-|macroexpand|macroexpand-1|for|doseq|dosync|dotimes|and|or|when|not|assert|doto|proxy|defstruct|first|rest|cons|defprotocol|deftype|defrecord|reify|defmulti|defmethod|meta|with-meta|ns|in-ns|create-ns|import|intern|refer|alias|namespace|resolve|ref|deref|refset|new|set!|memfn|to-array|into-array|aset|gen-class|reduce|map|filter|find|nil?|empty?|hash-map|hash-set|vec|vector|seq|flatten|reverse|assoc|dissoc|list|list?|disj|get|union|difference|intersection|extend|extend-type|extend-protocol|prn)\b/,a],
["typ",/^:[\dA-Za-z-]+/]]),["clj"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\f\r ]+/,null," \t\r\n"]],[["str",/^"(?:[^\n\f\r"\\]|\\(?:\r\n?|\n|\f)|\\[\S\s])*"/,null],["str",/^'(?:[^\n\f\r'\\]|\\(?:\r\n?|\n|\f)|\\[\S\s])*'/,null],["lang-css-str",/^url\(([^"')]*)\)/i],["kwd",/^(?:url|rgb|!important|@import|@page|@media|@charset|inherit)(?=[^\w-]|$)/i,null],["lang-css-kw",/^(-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*)\s*:/i],["com",/^\/\*[^*]*\*+(?:[^*/][^*]*\*+)*\//],["com",
/^(?:<\!--|--\>)/],["lit",/^(?:\d+|\d*\.\d+)(?:%|[a-z]+)?/i],["lit",/^#[\da-f]{3,6}/i],["pln",/^-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*/i],["pun",/^[^\s\w"']+/]]),["css"]);PR.registerLangHandler(PR.createSimpleLexer([],[["kwd",/^-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*/i]]),["css-kw"]);PR.registerLangHandler(PR.createSimpleLexer([],[["str",/^[^"')]+/]]),["css-str"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["pln",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])+(?:'|$)|`[^`]*(?:`|$))/,null,"\"'"]],[["com",/^(?:\/\/[^\n\r]*|\/\*[\S\s]*?\*\/)/],["pln",/^(?:[^"'/`]|\/(?![*/]))+/]]),["go"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t-\r ]+/,null,"\t\n\r "],["str",/^"(?:[^\n\f\r"\\]|\\[\S\s])*(?:"|$)/,null,'"'],["str",/^'(?:[^\n\f\r'\\]|\\[^&])'?/,null,"'"],["lit",/^(?:0o[0-7]+|0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i,null,"0123456789"]],[["com",/^(?:--+[^\n\f\r]*|{-(?:[^-]|-+[^}-])*-})/],["kwd",/^(?:case|class|data|default|deriving|do|else|if|import|in|infix|infixl|infixr|instance|let|module|newtype|of|then|type|where|_)(?=[^\d'A-Za-z]|$)/,
null],["pln",/^(?:[A-Z][\w']*\.)*[A-Za-z][\w']*/],["pun",/^[^\d\t-\r "'A-Za-z]+/]]),["hs"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["opn",/^\(+/,a,"("],["clo",/^\)+/,a,")"],["com",/^;[^\n\r]*/,a,";"],["pln",/^[\t\n\r \xa0]+/,a,"\t\n\r \xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,a,'"']],[["kwd",/^(?:block|c[ad]+r|catch|con[ds]|def(?:ine|un)|do|eq|eql|equal|equalp|eval-when|flet|format|go|if|labels|lambda|let|load-time-value|locally|macrolet|multiple-value-call|nil|progn|progv|quote|require|return-from|setq|symbol-macrolet|t|tagbody|the|throw|unwind)\b/,a],
["lit",/^[+-]?(?:[#0]x[\da-f]+|\d+\/\d+|(?:\.\d+|\d+(?:\.\d*)?)(?:[de][+-]?\d+)?)/i],["lit",/^'(?:-*(?:\w|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?)?/],["pln",/^-*(?:[_a-z]|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?/i],["pun",/^[^\w\t\n\r "'-);\\\xa0]+/]]),["cl","el","lisp","scm"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])*(?:'|$))/,null,"\"'"]],[["com",/^--(?:\[(=*)\[[\S\s]*?(?:]\1]|$)|[^\n\r]*)/],["str",/^\[(=*)\[[\S\s]*?(?:]\1]|$)/],["kwd",/^(?:and|break|do|else|elseif|end|false|for|function|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b/,null],["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],
["pln",/^[_a-z]\w*/i],["pun",/^[^\w\t\n\r \xa0][^\w\t\n\r "'+=\xa0-]*/]]),["lua"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["com",/^#(?:if[\t\n\r \xa0]+(?:[$_a-z][\w']*|``[^\t\n\r`]*(?:``|$))|else|endif|light)/i,null,"#"],["str",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])(?:'|$))/,null,"\"'"]],[["com",/^(?:\/\/[^\n\r]*|\(\*[\S\s]*?\*\))/],["kwd",/^(?:abstract|and|as|assert|begin|class|default|delegate|do|done|downcast|downto|elif|else|end|exception|extern|false|finally|for|fun|function|if|in|inherit|inline|interface|internal|lazy|let|match|member|module|mutable|namespace|new|null|of|open|or|override|private|public|rec|return|static|struct|then|to|true|try|type|upcast|use|val|void|when|while|with|yield|asr|land|lor|lsl|lsr|lxor|mod|sig|atomic|break|checked|component|const|constraint|constructor|continue|eager|event|external|fixed|functor|global|include|method|mixin|object|parallel|process|protected|pure|sealed|trait|virtual|volatile)\b/],
["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],["pln",/^(?:[_a-z][\w']*[!#?]?|``[^\t\n\r`]*(?:``|$))/i],["pun",/^[^\w\t\n\r "'\xa0]+/]]),["fs","ml"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["str",/^(?:'(?:[^\n\r'\\]|\\.)*'|"(?:[^\n\r"\\]|\\.)*(?:"|$))/,a,'"'],["com",/^#(?:(?:define|elif|else|endif|error|ifdef|include|ifndef|line|pragma|undef|warning)\b|[^\n\r]*)/,a,"#"],["pln",/^\s+/,a," \r\n\t\xa0"]],[["str",/^@"(?:[^"]|"")*(?:"|$)/,a],["str",/^<#[^#>]*(?:#>|$)/,a],["str",/^<(?:(?:(?:\.\.\/)*|\/?)(?:[\w-]+(?:\/[\w-]+)+)?[\w-]+\.h|[a-z]\w*)>/,a],["com",/^\/\/[^\n\r]*/,a],["com",/^\/\*[\S\s]*?(?:\*\/|$)/,
a],["kwd",/^(?:abstract|and|as|base|catch|class|def|delegate|enum|event|extern|false|finally|fun|implements|interface|internal|is|macro|match|matches|module|mutable|namespace|new|null|out|override|params|partial|private|protected|public|ref|sealed|static|struct|syntax|this|throw|true|try|type|typeof|using|variant|virtual|volatile|when|where|with|assert|assert2|async|break|checked|continue|do|else|ensures|for|foreach|if|late|lock|new|nolate|otherwise|regexp|repeat|requires|return|surroundwith|unchecked|unless|using|while|yield)\b/,
a],["typ",/^(?:array|bool|byte|char|decimal|double|float|int|list|long|object|sbyte|short|string|ulong|uint|ufloat|ulong|ushort|void)\b/,a],["lit",/^@[$_a-z][\w$@]*/i,a],["typ",/^@[A-Z]+[a-z][\w$@]*/,a],["pln",/^'?[$_a-z][\w$@]*/i,a],["lit",/^(?:0x[\da-f]+|(?:\d(?:_\d+)*\d*(?:\.\d*)?|\.\d\+)(?:e[+-]?\d+)?)[a-z]*/i,a,"0123456789"],["pun",/^.[^\s\w"-$'./@`]*/,a]]),["n","nemerle"]);

PR.registerLangHandler(PR.sourceDecorator({keywords:"bytes,default,double,enum,extend,extensions,false,group,import,max,message,option,optional,package,repeated,required,returns,rpc,service,syntax,to,true",types:/^(bool|(double|s?fixed|[su]?int)(32|64)|float|string)\b/,cStyleComments:!0}),["proto"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^"(?:""(?:""?(?!")|[^"\\]|\\.)*"{0,3}|(?:[^\n\r"\\]|\\.)*"?)/,null,'"'],["lit",/^`(?:[^\n\r\\`]|\\.)*`?/,null,"`"],["pun",/^[!#%&(--:-@[-^{-~]+/,null,"!#%&()*+,-:;<=>?@[\\]^{|}~"]],[["str",/^'(?:[^\n\r'\\]|\\(?:'|[^\n\r']+))'/],["lit",/^'[$A-Z_a-z][\w$]*(?![\w$'])/],["kwd",/^(?:abstract|case|catch|class|def|do|else|extends|final|finally|for|forSome|if|implicit|import|lazy|match|new|object|override|package|private|protected|requires|return|sealed|super|throw|trait|try|type|val|var|while|with|yield)\b/],
["lit",/^(?:true|false|null|this)\b/],["lit",/^(?:0(?:[0-7]+|x[\da-f]+)l?|(?:0|[1-9]\d*)(?:(?:\.\d+)?(?:e[+-]?\d+)?f?|l?)|\\.\d+(?:e[+-]?\d+)?f?)/i],["typ",/^[$_]*[A-Z][\d$A-Z_]*[a-z][\w$]*/],["pln",/^[$A-Z_a-z][\w$]*/],["com",/^\/(?:\/.*|\*(?:\/|\**[^*/])*(?:\*+\/?)?)/],["pun",/^(?:\.+|\/)/]]),["scala"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,null,"\"'"]],[["com",/^(?:--[^\n\r]*|\/\*[\S\s]*?(?:\*\/|$))/],["kwd",/^(?:add|all|alter|and|any|as|asc|authorization|backup|begin|between|break|browse|bulk|by|cascade|case|check|checkpoint|close|clustered|coalesce|collate|column|commit|compute|constraint|contains|containstable|continue|convert|create|cross|current|current_date|current_time|current_timestamp|current_user|cursor|database|dbcc|deallocate|declare|default|delete|deny|desc|disk|distinct|distributed|double|drop|dummy|dump|else|end|errlvl|escape|except|exec|execute|exists|exit|fetch|file|fillfactor|for|foreign|freetext|freetexttable|from|full|function|goto|grant|group|having|holdlock|identity|identitycol|identity_insert|if|in|index|inner|insert|intersect|into|is|join|key|kill|left|like|lineno|load|match|merge|national|nocheck|nonclustered|not|null|nullif|of|off|offsets|on|open|opendatasource|openquery|openrowset|openxml|option|or|order|outer|over|percent|plan|precision|primary|print|proc|procedure|public|raiserror|read|readtext|reconfigure|references|replication|restore|restrict|return|revoke|right|rollback|rowcount|rowguidcol|rule|save|schema|select|session_user|set|setuser|shutdown|some|statistics|system_user|table|textsize|then|to|top|tran|transaction|trigger|truncate|tsequal|union|unique|update|updatetext|use|user|using|values|varying|view|waitfor|when|where|while|with|writetext)(?=[^\w-]|$)/i,
null],["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],["pln",/^[_a-z][\w-]*/i],["pun",/^[^\w\t\n\r "'\xa0][^\w\t\n\r "'+\xa0-]*/]]),["sql"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["com",/^%[^\n\r]*/,null,"%"]],[["kwd",/^\\[@-Za-z]+/],["kwd",/^\\./],["typ",/^[$&]/],["lit",/[+-]?(?:\.\d+|\d+(?:\.\d*)?)(cm|em|ex|in|pc|pt|bp|mm)/i],["pun",/^[()=[\]{}]+/]]),["latex","tex"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0\u2028\u2029]+/,null,"\t\n\r ¬\xa0‚Ä®‚Ä©"],["str",/^(?:["\u201c\u201d](?:[^"\u201c\u201d]|["\u201c\u201d]{2})(?:["\u201c\u201d]c|$)|["\u201c\u201d](?:[^"\u201c\u201d]|["\u201c\u201d]{2})*(?:["\u201c\u201d]|$))/i,null,'"‚Äú‚Äù'],["com",/^['\u2018\u2019].*/,null,"'‚Äò‚Äô"]],[["kwd",/^(?:addhandler|addressof|alias|and|andalso|ansi|as|assembly|auto|boolean|byref|byte|byval|call|case|catch|cbool|cbyte|cchar|cdate|cdbl|cdec|char|cint|class|clng|cobj|const|cshort|csng|cstr|ctype|date|decimal|declare|default|delegate|dim|directcast|do|double|each|else|elseif|end|endif|enum|erase|error|event|exit|finally|for|friend|function|get|gettype|gosub|goto|handles|if|implements|imports|in|inherits|integer|interface|is|let|lib|like|long|loop|me|mod|module|mustinherit|mustoverride|mybase|myclass|namespace|new|next|not|notinheritable|notoverridable|object|on|option|optional|or|orelse|overloads|overridable|overrides|paramarray|preserve|private|property|protected|public|raiseevent|readonly|redim|removehandler|resume|return|select|set|shadows|shared|short|single|static|step|stop|string|structure|sub|synclock|then|throw|to|try|typeof|unicode|until|variant|wend|when|while|with|withevents|writeonly|xor|endif|gosub|let|variant|wend)\b/i,
null],["com",/^rem.*/i],["lit",/^(?:true\b|false\b|nothing\b|\d+(?:e[+-]?\d+[dfr]?|[dfilrs])?|(?:&h[\da-f]+|&o[0-7]+)[ils]?|\d*\.\d+(?:e[+-]?\d+)?[dfr]?|#\s+(?:\d+[/-]\d+[/-]\d+(?:\s+\d+:\d+(?::\d+)?(\s*(?:am|pm))?)?|\d+:\d+(?::\d+)?(\s*(?:am|pm))?)\s+#)/i],["pln",/^(?:(?:[a-z]|_\w)\w*|\[(?:[a-z]|_\w)\w*])/i],["pun",/^[^\w\t\n\r "'[\]\xa0\u2018\u2019\u201c\u201d\u2028\u2029]+/],["pun",/^(?:\[|])/]]),["vb","vbs"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"]],[["str",/^(?:[box]?"(?:[^"]|"")*"|'.')/i],["com",/^--[^\n\r]*/],["kwd",/^(?:abs|access|after|alias|all|and|architecture|array|assert|attribute|begin|block|body|buffer|bus|case|component|configuration|constant|disconnect|downto|else|elsif|end|entity|exit|file|for|function|generate|generic|group|guarded|if|impure|in|inertial|inout|is|label|library|linkage|literal|loop|map|mod|nand|new|next|nor|not|null|of|on|open|or|others|out|package|port|postponed|procedure|process|pure|range|record|register|reject|rem|report|return|rol|ror|select|severity|shared|signal|sla|sll|sra|srl|subtype|then|to|transport|type|unaffected|units|until|use|variable|wait|when|while|with|xnor|xor)(?=[^\w-]|$)/i,
null],["typ",/^(?:bit|bit_vector|character|boolean|integer|real|time|string|severity_level|positive|natural|signed|unsigned|line|text|std_u?logic(?:_vector)?)(?=[^\w-]|$)/i,null],["typ",/^'(?:active|ascending|base|delayed|driving|driving_value|event|high|image|instance_name|last_active|last_event|last_value|left|leftof|length|low|path_name|pos|pred|quiet|range|reverse_range|right|rightof|simple_name|stable|succ|transaction|val|value)(?=[^\w-]|$)/i,null],["lit",/^\d+(?:_\d+)*(?:#[\w.\\]+#(?:[+-]?\d+(?:_\d+)*)?|(?:\.\d+(?:_\d+)*)?(?:e[+-]?\d+(?:_\d+)*)?)/i],
["pln",/^(?:[a-z]\w*|\\[^\\]*\\)/i],["pun",/^[^\w\t\n\r "'\xa0][^\w\t\n\r "'\xa0-]*/]]),["vhdl","vhd"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\d\t a-gi-z\xa0]+/,null,"\t ¬\xa0abcdefgijklmnopqrstuvwxyz0123456789"],["pun",/^[*=[\]^~]+/,null,"=*~^[]"]],[["lang-wiki.meta",/(?:^^|\r\n?|\n)(#[a-z]+)\b/],["lit",/^[A-Z][a-z][\da-z]+[A-Z][a-z][^\W_]+\b/],["lang-",/^{{{([\S\s]+?)}}}/],["lang-",/^`([^\n\r`]+)`/],["str",/^https?:\/\/[^\s#/?]*(?:\/[^\s#?]*)?(?:\?[^\s#]*)?(?:#\S*)?/i],["pln",/^(?:\r\n|[\S\s])[^\n\r#*=A-[^`h{~]*/]]),["wiki"]);
PR.registerLangHandler(PR.createSimpleLexer([["kwd",/^#[a-z]+/i,null,"#"]],[]),["wiki.meta"]);

PR.registerLangHandler(PR.createSimpleLexer([["var pln",/^\$[\w-]+/,null,"$"]],[["pln",/^[\s=][<>][\s=]/],["lit",/^@[\w-]+/],["tag",/^<\/?[a-z](?:[\w-.:]*\w)?|\/?>$/i],["com",/^\(:[\S\s]*?:\)/],["pln",/^[(),/;[\]{}]$/],["str",/^(?:"(?:[^"\\{]|\\[\S\s])*(?:"|$)|'(?:[^'\\{]|\\[\S\s])*(?:'|$))/,null,"\"'"],["kwd",/^(?:xquery|where|version|variable|union|typeswitch|treat|to|then|text|stable|sortby|some|self|schema|satisfies|returns|return|ref|processing-instruction|preceding-sibling|preceding|precedes|parent|only|of|node|namespace|module|let|item|intersect|instance|in|import|if|function|for|follows|following-sibling|following|external|except|every|else|element|descending|descendant-or-self|descendant|define|default|declare|comment|child|cast|case|before|attribute|assert|ascending|as|ancestor-or-self|ancestor|after|eq|order|by|or|and|schema-element|document-node|node|at)\b/],
["typ",/^(?:xs:yearMonthDuration|xs:unsignedLong|xs:time|xs:string|xs:short|xs:QName|xs:Name|xs:long|xs:integer|xs:int|xs:gYearMonth|xs:gYear|xs:gMonthDay|xs:gDay|xs:float|xs:duration|xs:double|xs:decimal|xs:dayTimeDuration|xs:dateTime|xs:date|xs:byte|xs:boolean|xs:anyURI|xf:yearMonthDuration)\b/,null],["fun pln",/^(?:xp:dereference|xinc:node-expand|xinc:link-references|xinc:link-expand|xhtml:restructure|xhtml:clean|xhtml:add-lists|xdmp:zip-manifest|xdmp:zip-get|xdmp:zip-create|xdmp:xquery-version|xdmp:word-convert|xdmp:with-namespaces|xdmp:version|xdmp:value|xdmp:user-roles|xdmp:user-last-login|xdmp:user|xdmp:url-encode|xdmp:url-decode|xdmp:uri-is-file|xdmp:uri-format|xdmp:uri-content-type|xdmp:unquote|xdmp:unpath|xdmp:triggers-database|xdmp:trace|xdmp:to-json|xdmp:tidy|xdmp:subbinary|xdmp:strftime|xdmp:spawn-in|xdmp:spawn|xdmp:sleep|xdmp:shutdown|xdmp:set-session-field|xdmp:set-response-encoding|xdmp:set-response-content-type|xdmp:set-response-code|xdmp:set-request-time-limit|xdmp:set|xdmp:servers|xdmp:server-status|xdmp:server-name|xdmp:server|xdmp:security-database|xdmp:security-assert|xdmp:schema-database|xdmp:save|xdmp:role-roles|xdmp:role|xdmp:rethrow|xdmp:restart|xdmp:request-timestamp|xdmp:request-status|xdmp:request-cancel|xdmp:request|xdmp:redirect-response|xdmp:random|xdmp:quote|xdmp:query-trace|xdmp:query-meters|xdmp:product-edition|xdmp:privilege-roles|xdmp:privilege|xdmp:pretty-print|xdmp:powerpoint-convert|xdmp:platform|xdmp:permission|xdmp:pdf-convert|xdmp:path|xdmp:octal-to-integer|xdmp:node-uri|xdmp:node-replace|xdmp:node-kind|xdmp:node-insert-child|xdmp:node-insert-before|xdmp:node-insert-after|xdmp:node-delete|xdmp:node-database|xdmp:mul64|xdmp:modules-root|xdmp:modules-database|xdmp:merging|xdmp:merge-cancel|xdmp:merge|xdmp:md5|xdmp:logout|xdmp:login|xdmp:log-level|xdmp:log|xdmp:lock-release|xdmp:lock-acquire|xdmp:load|xdmp:invoke-in|xdmp:invoke|xdmp:integer-to-octal|xdmp:integer-to-hex|xdmp:http-put|xdmp:http-post|xdmp:http-options|xdmp:http-head|xdmp:http-get|xdmp:http-delete|xdmp:hosts|xdmp:host-status|xdmp:host-name|xdmp:host|xdmp:hex-to-integer|xdmp:hash64|xdmp:hash32|xdmp:has-privilege|xdmp:groups|xdmp:group-serves|xdmp:group-servers|xdmp:group-name|xdmp:group-hosts|xdmp:group|xdmp:get-session-field-names|xdmp:get-session-field|xdmp:get-response-encoding|xdmp:get-response-code|xdmp:get-request-username|xdmp:get-request-user|xdmp:get-request-url|xdmp:get-request-protocol|xdmp:get-request-path|xdmp:get-request-method|xdmp:get-request-header-names|xdmp:get-request-header|xdmp:get-request-field-names|xdmp:get-request-field-filename|xdmp:get-request-field-content-type|xdmp:get-request-field|xdmp:get-request-client-certificate|xdmp:get-request-client-address|xdmp:get-request-body|xdmp:get-current-user|xdmp:get-current-roles|xdmp:get|xdmp:function-name|xdmp:function-module|xdmp:function|xdmp:from-json|xdmp:forests|xdmp:forest-status|xdmp:forest-restore|xdmp:forest-restart|xdmp:forest-name|xdmp:forest-delete|xdmp:forest-databases|xdmp:forest-counts|xdmp:forest-clear|xdmp:forest-backup|xdmp:forest|xdmp:filesystem-file|xdmp:filesystem-directory|xdmp:exists|xdmp:excel-convert|xdmp:eval-in|xdmp:eval|xdmp:estimate|xdmp:email|xdmp:element-content-type|xdmp:elapsed-time|xdmp:document-set-quality|xdmp:document-set-property|xdmp:document-set-properties|xdmp:document-set-permissions|xdmp:document-set-collections|xdmp:document-remove-properties|xdmp:document-remove-permissions|xdmp:document-remove-collections|xdmp:document-properties|xdmp:document-locks|xdmp:document-load|xdmp:document-insert|xdmp:document-get-quality|xdmp:document-get-properties|xdmp:document-get-permissions|xdmp:document-get-collections|xdmp:document-get|xdmp:document-forest|xdmp:document-delete|xdmp:document-add-properties|xdmp:document-add-permissions|xdmp:document-add-collections|xdmp:directory-properties|xdmp:directory-locks|xdmp:directory-delete|xdmp:directory-create|xdmp:directory|xdmp:diacritic-less|xdmp:describe|xdmp:default-permissions|xdmp:default-collections|xdmp:databases|xdmp:database-restore-validate|xdmp:database-restore-status|xdmp:database-restore-cancel|xdmp:database-restore|xdmp:database-name|xdmp:database-forests|xdmp:database-backup-validate|xdmp:database-backup-status|xdmp:database-backup-purge|xdmp:database-backup-cancel|xdmp:database-backup|xdmp:database|xdmp:collection-properties|xdmp:collection-locks|xdmp:collection-delete|xdmp:collation-canonical-uri|xdmp:castable-as|xdmp:can-grant-roles|xdmp:base64-encode|xdmp:base64-decode|xdmp:architecture|xdmp:apply|xdmp:amp-roles|xdmp:amp|xdmp:add64|xdmp:add-response-header|xdmp:access|trgr:trigger-set-recursive|trgr:trigger-set-permissions|trgr:trigger-set-name|trgr:trigger-set-module|trgr:trigger-set-event|trgr:trigger-set-description|trgr:trigger-remove-permissions|trgr:trigger-module|trgr:trigger-get-permissions|trgr:trigger-enable|trgr:trigger-disable|trgr:trigger-database-online-event|trgr:trigger-data-event|trgr:trigger-add-permissions|trgr:remove-trigger|trgr:property-content|trgr:pre-commit|trgr:post-commit|trgr:get-trigger-by-id|trgr:get-trigger|trgr:document-scope|trgr:document-content|trgr:directory-scope|trgr:create-trigger|trgr:collection-scope|trgr:any-property-content|thsr:set-entry|thsr:remove-term|thsr:remove-synonym|thsr:remove-entry|thsr:query-lookup|thsr:lookup|thsr:load|thsr:insert|thsr:expand|thsr:add-synonym|spell:suggest-detailed|spell:suggest|spell:remove-word|spell:make-dictionary|spell:load|spell:levenshtein-distance|spell:is-correct|spell:insert|spell:double-metaphone|spell:add-word|sec:users-collection|sec:user-set-roles|sec:user-set-password|sec:user-set-name|sec:user-set-description|sec:user-set-default-permissions|sec:user-set-default-collections|sec:user-remove-roles|sec:user-privileges|sec:user-get-roles|sec:user-get-description|sec:user-get-default-permissions|sec:user-get-default-collections|sec:user-doc-permissions|sec:user-doc-collections|sec:user-add-roles|sec:unprotect-collection|sec:uid-for-name|sec:set-realm|sec:security-version|sec:security-namespace|sec:security-installed|sec:security-collection|sec:roles-collection|sec:role-set-roles|sec:role-set-name|sec:role-set-description|sec:role-set-default-permissions|sec:role-set-default-collections|sec:role-remove-roles|sec:role-privileges|sec:role-get-roles|sec:role-get-description|sec:role-get-default-permissions|sec:role-get-default-collections|sec:role-doc-permissions|sec:role-doc-collections|sec:role-add-roles|sec:remove-user|sec:remove-role-from-users|sec:remove-role-from-role|sec:remove-role-from-privileges|sec:remove-role-from-amps|sec:remove-role|sec:remove-privilege|sec:remove-amp|sec:protect-collection|sec:privileges-collection|sec:privilege-set-roles|sec:privilege-set-name|sec:privilege-remove-roles|sec:privilege-get-roles|sec:privilege-add-roles|sec:priv-doc-permissions|sec:priv-doc-collections|sec:get-user-names|sec:get-unique-elem-id|sec:get-role-names|sec:get-role-ids|sec:get-privilege|sec:get-distinct-permissions|sec:get-collection|sec:get-amp|sec:create-user-with-role|sec:create-user|sec:create-role|sec:create-privilege|sec:create-amp|sec:collections-collection|sec:collection-set-permissions|sec:collection-remove-permissions|sec:collection-get-permissions|sec:collection-add-permissions|sec:check-admin|sec:amps-collection|sec:amp-set-roles|sec:amp-remove-roles|sec:amp-get-roles|sec:amp-doc-permissions|sec:amp-doc-collections|sec:amp-add-roles|search:unparse|search:suggest|search:snippet|search:search|search:resolve-nodes|search:resolve|search:remove-constraint|search:parse|search:get-default-options|search:estimate|search:check-options|prof:value|prof:reset|prof:report|prof:invoke|prof:eval|prof:enable|prof:disable|prof:allowed|ppt:clean|pki:template-set-request|pki:template-set-name|pki:template-set-key-type|pki:template-set-key-options|pki:template-set-description|pki:template-in-use|pki:template-get-version|pki:template-get-request|pki:template-get-name|pki:template-get-key-type|pki:template-get-key-options|pki:template-get-id|pki:template-get-description|pki:need-certificate|pki:is-temporary|pki:insert-trusted-certificates|pki:insert-template|pki:insert-signed-certificates|pki:insert-certificate-revocation-list|pki:get-trusted-certificate-ids|pki:get-template-ids|pki:get-template-certificate-authority|pki:get-template-by-name|pki:get-template|pki:get-pending-certificate-requests-xml|pki:get-pending-certificate-requests-pem|pki:get-pending-certificate-request|pki:get-certificates-for-template-xml|pki:get-certificates-for-template|pki:get-certificates|pki:get-certificate-xml|pki:get-certificate-pem|pki:get-certificate|pki:generate-temporary-certificate-if-necessary|pki:generate-temporary-certificate|pki:generate-template-certificate-authority|pki:generate-certificate-request|pki:delete-template|pki:delete-certificate|pki:create-template|pdf:make-toc|pdf:insert-toc-headers|pdf:get-toc|pdf:clean|p:status-transition|p:state-transition|p:remove|p:pipelines|p:insert|p:get-by-id|p:get|p:execute|p:create|p:condition|p:collection|p:action|ooxml:runs-merge|ooxml:package-uris|ooxml:package-parts-insert|ooxml:package-parts|msword:clean|mcgm:polygon|mcgm:point|mcgm:geospatial-query-from-elements|mcgm:geospatial-query|mcgm:circle|math:tanh|math:tan|math:sqrt|math:sinh|math:sin|math:pow|math:modf|math:log10|math:log|math:ldexp|math:frexp|math:fmod|math:floor|math:fabs|math:exp|math:cosh|math:cos|math:ceil|math:atan2|math:atan|math:asin|math:acos|map:put|map:map|map:keys|map:get|map:delete|map:count|map:clear|lnk:to|lnk:remove|lnk:insert|lnk:get|lnk:from|lnk:create|kml:polygon|kml:point|kml:interior-polygon|kml:geospatial-query-from-elements|kml:geospatial-query|kml:circle|kml:box|gml:polygon|gml:point|gml:interior-polygon|gml:geospatial-query-from-elements|gml:geospatial-query|gml:circle|gml:box|georss:point|georss:geospatial-query|georss:circle|geo:polygon|geo:point|geo:interior-polygon|geo:geospatial-query-from-elements|geo:geospatial-query|geo:circle|geo:box|fn:zero-or-one|fn:years-from-duration|fn:year-from-dateTime|fn:year-from-date|fn:upper-case|fn:unordered|fn:true|fn:translate|fn:trace|fn:tokenize|fn:timezone-from-time|fn:timezone-from-dateTime|fn:timezone-from-date|fn:sum|fn:subtract-dateTimes-yielding-yearMonthDuration|fn:subtract-dateTimes-yielding-dayTimeDuration|fn:substring-before|fn:substring-after|fn:substring|fn:subsequence|fn:string-to-codepoints|fn:string-pad|fn:string-length|fn:string-join|fn:string|fn:static-base-uri|fn:starts-with|fn:seconds-from-time|fn:seconds-from-duration|fn:seconds-from-dateTime|fn:round-half-to-even|fn:round|fn:root|fn:reverse|fn:resolve-uri|fn:resolve-QName|fn:replace|fn:remove|fn:QName|fn:prefix-from-QName|fn:position|fn:one-or-more|fn:number|fn:not|fn:normalize-unicode|fn:normalize-space|fn:node-name|fn:node-kind|fn:nilled|fn:namespace-uri-from-QName|fn:namespace-uri-for-prefix|fn:namespace-uri|fn:name|fn:months-from-duration|fn:month-from-dateTime|fn:month-from-date|fn:minutes-from-time|fn:minutes-from-duration|fn:minutes-from-dateTime|fn:min|fn:max|fn:matches|fn:lower-case|fn:local-name-from-QName|fn:local-name|fn:last|fn:lang|fn:iri-to-uri|fn:insert-before|fn:index-of|fn:in-scope-prefixes|fn:implicit-timezone|fn:idref|fn:id|fn:hours-from-time|fn:hours-from-duration|fn:hours-from-dateTime|fn:floor|fn:false|fn:expanded-QName|fn:exists|fn:exactly-one|fn:escape-uri|fn:escape-html-uri|fn:error|fn:ends-with|fn:encode-for-uri|fn:empty|fn:document-uri|fn:doc-available|fn:doc|fn:distinct-values|fn:distinct-nodes|fn:default-collation|fn:deep-equal|fn:days-from-duration|fn:day-from-dateTime|fn:day-from-date|fn:data|fn:current-time|fn:current-dateTime|fn:current-date|fn:count|fn:contains|fn:concat|fn:compare|fn:collection|fn:codepoints-to-string|fn:codepoint-equal|fn:ceiling|fn:boolean|fn:base-uri|fn:avg|fn:adjust-time-to-timezone|fn:adjust-dateTime-to-timezone|fn:adjust-date-to-timezone|fn:abs|feed:unsubscribe|feed:subscription|feed:subscribe|feed:request|feed:item|feed:description|excel:clean|entity:enrich|dom:set-pipelines|dom:set-permissions|dom:set-name|dom:set-evaluation-context|dom:set-domain-scope|dom:set-description|dom:remove-pipeline|dom:remove-permissions|dom:remove|dom:get|dom:evaluation-context|dom:domains|dom:domain-scope|dom:create|dom:configuration-set-restart-user|dom:configuration-set-permissions|dom:configuration-set-evaluation-context|dom:configuration-set-default-domain|dom:configuration-get|dom:configuration-create|dom:collection|dom:add-pipeline|dom:add-permissions|dls:retention-rules|dls:retention-rule-remove|dls:retention-rule-insert|dls:retention-rule|dls:purge|dls:node-expand|dls:link-references|dls:link-expand|dls:documents-query|dls:document-versions-query|dls:document-version-uri|dls:document-version-query|dls:document-version-delete|dls:document-version-as-of|dls:document-version|dls:document-update|dls:document-unmanage|dls:document-set-quality|dls:document-set-property|dls:document-set-properties|dls:document-set-permissions|dls:document-set-collections|dls:document-retention-rules|dls:document-remove-properties|dls:document-remove-permissions|dls:document-remove-collections|dls:document-purge|dls:document-manage|dls:document-is-managed|dls:document-insert-and-manage|dls:document-include-query|dls:document-history|dls:document-get-permissions|dls:document-extract-part|dls:document-delete|dls:document-checkout-status|dls:document-checkout|dls:document-checkin|dls:document-add-properties|dls:document-add-permissions|dls:document-add-collections|dls:break-checkout|dls:author-query|dls:as-of-query|dbk:convert|dbg:wait|dbg:value|dbg:stopped|dbg:stop|dbg:step|dbg:status|dbg:stack|dbg:out|dbg:next|dbg:line|dbg:invoke|dbg:function|dbg:finish|dbg:expr|dbg:eval|dbg:disconnect|dbg:detach|dbg:continue|dbg:connect|dbg:clear|dbg:breakpoints|dbg:break|dbg:attached|dbg:attach|cvt:save-converted-documents|cvt:part-uri|cvt:destination-uri|cvt:basepath|cvt:basename|cts:words|cts:word-query-weight|cts:word-query-text|cts:word-query-options|cts:word-query|cts:word-match|cts:walk|cts:uris|cts:uri-match|cts:train|cts:tokenize|cts:thresholds|cts:stem|cts:similar-query-weight|cts:similar-query-nodes|cts:similar-query|cts:shortest-distance|cts:search|cts:score|cts:reverse-query-weight|cts:reverse-query-nodes|cts:reverse-query|cts:remainder|cts:registered-query-weight|cts:registered-query-options|cts:registered-query-ids|cts:registered-query|cts:register|cts:query|cts:quality|cts:properties-query-query|cts:properties-query|cts:polygon-vertices|cts:polygon|cts:point-longitude|cts:point-latitude|cts:point|cts:or-query-queries|cts:or-query|cts:not-query-weight|cts:not-query-query|cts:not-query|cts:near-query-weight|cts:near-query-queries|cts:near-query-options|cts:near-query-distance|cts:near-query|cts:highlight|cts:geospatial-co-occurrences|cts:frequency|cts:fitness|cts:field-words|cts:field-word-query-weight|cts:field-word-query-text|cts:field-word-query-options|cts:field-word-query-field-name|cts:field-word-query|cts:field-word-match|cts:entity-highlight|cts:element-words|cts:element-word-query-weight|cts:element-word-query-text|cts:element-word-query-options|cts:element-word-query-element-name|cts:element-word-query|cts:element-word-match|cts:element-values|cts:element-value-ranges|cts:element-value-query-weight|cts:element-value-query-text|cts:element-value-query-options|cts:element-value-query-element-name|cts:element-value-query|cts:element-value-match|cts:element-value-geospatial-co-occurrences|cts:element-value-co-occurrences|cts:element-range-query-weight|cts:element-range-query-value|cts:element-range-query-options|cts:element-range-query-operator|cts:element-range-query-element-name|cts:element-range-query|cts:element-query-query|cts:element-query-element-name|cts:element-query|cts:element-pair-geospatial-values|cts:element-pair-geospatial-value-match|cts:element-pair-geospatial-query-weight|cts:element-pair-geospatial-query-region|cts:element-pair-geospatial-query-options|cts:element-pair-geospatial-query-longitude-name|cts:element-pair-geospatial-query-latitude-name|cts:element-pair-geospatial-query-element-name|cts:element-pair-geospatial-query|cts:element-pair-geospatial-boxes|cts:element-geospatial-values|cts:element-geospatial-value-match|cts:element-geospatial-query-weight|cts:element-geospatial-query-region|cts:element-geospatial-query-options|cts:element-geospatial-query-element-name|cts:element-geospatial-query|cts:element-geospatial-boxes|cts:element-child-geospatial-values|cts:element-child-geospatial-value-match|cts:element-child-geospatial-query-weight|cts:element-child-geospatial-query-region|cts:element-child-geospatial-query-options|cts:element-child-geospatial-query-element-name|cts:element-child-geospatial-query-child-name|cts:element-child-geospatial-query|cts:element-child-geospatial-boxes|cts:element-attribute-words|cts:element-attribute-word-query-weight|cts:element-attribute-word-query-text|cts:element-attribute-word-query-options|cts:element-attribute-word-query-element-name|cts:element-attribute-word-query-attribute-name|cts:element-attribute-word-query|cts:element-attribute-word-match|cts:element-attribute-values|cts:element-attribute-value-ranges|cts:element-attribute-value-query-weight|cts:element-attribute-value-query-text|cts:element-attribute-value-query-options|cts:element-attribute-value-query-element-name|cts:element-attribute-value-query-attribute-name|cts:element-attribute-value-query|cts:element-attribute-value-match|cts:element-attribute-value-geospatial-co-occurrences|cts:element-attribute-value-co-occurrences|cts:element-attribute-range-query-weight|cts:element-attribute-range-query-value|cts:element-attribute-range-query-options|cts:element-attribute-range-query-operator|cts:element-attribute-range-query-element-name|cts:element-attribute-range-query-attribute-name|cts:element-attribute-range-query|cts:element-attribute-pair-geospatial-values|cts:element-attribute-pair-geospatial-value-match|cts:element-attribute-pair-geospatial-query-weight|cts:element-attribute-pair-geospatial-query-region|cts:element-attribute-pair-geospatial-query-options|cts:element-attribute-pair-geospatial-query-longitude-name|cts:element-attribute-pair-geospatial-query-latitude-name|cts:element-attribute-pair-geospatial-query-element-name|cts:element-attribute-pair-geospatial-query|cts:element-attribute-pair-geospatial-boxes|cts:document-query-uris|cts:document-query|cts:distance|cts:directory-query-uris|cts:directory-query-depth|cts:directory-query|cts:destination|cts:deregister|cts:contains|cts:confidence|cts:collections|cts:collection-query-uris|cts:collection-query|cts:collection-match|cts:classify|cts:circle-radius|cts:circle-center|cts:circle|cts:box-west|cts:box-south|cts:box-north|cts:box-east|cts:box|cts:bearing|cts:arc-intersection|cts:and-query-queries|cts:and-query-options|cts:and-query|cts:and-not-query-positive-query|cts:and-not-query-negative-query|cts:and-not-query|css:get|css:convert|cpf:success|cpf:failure|cpf:document-set-state|cpf:document-set-processing-status|cpf:document-set-last-updated|cpf:document-set-error|cpf:document-get-state|cpf:document-get-processing-status|cpf:document-get-last-updated|cpf:document-get-error|cpf:check-transition|alert:spawn-matching-actions|alert:rule-user-id-query|alert:rule-set-user-id|alert:rule-set-query|alert:rule-set-options|alert:rule-set-name|alert:rule-set-description|alert:rule-set-action|alert:rule-remove|alert:rule-name-query|alert:rule-insert|alert:rule-id-query|alert:rule-get-user-id|alert:rule-get-query|alert:rule-get-options|alert:rule-get-name|alert:rule-get-id|alert:rule-get-description|alert:rule-get-action|alert:rule-action-query|alert:remove-triggers|alert:make-rule|alert:make-log-action|alert:make-config|alert:make-action|alert:invoke-matching-actions|alert:get-my-rules|alert:get-all-rules|alert:get-actions|alert:find-matching-rules|alert:create-triggers|alert:config-set-uri|alert:config-set-trigger-ids|alert:config-set-options|alert:config-set-name|alert:config-set-description|alert:config-set-cpf-domain-names|alert:config-set-cpf-domain-ids|alert:config-insert|alert:config-get-uri|alert:config-get-trigger-ids|alert:config-get-options|alert:config-get-name|alert:config-get-id|alert:config-get-description|alert:config-get-cpf-domain-names|alert:config-get-cpf-domain-ids|alert:config-get|alert:config-delete|alert:action-set-options|alert:action-set-name|alert:action-set-module-root|alert:action-set-module-db|alert:action-set-module|alert:action-set-description|alert:action-remove|alert:action-insert|alert:action-get-options|alert:action-get-name|alert:action-get-module-root|alert:action-get-module-db|alert:action-get-module|alert:action-get-description|zero-or-one|years-from-duration|year-from-dateTime|year-from-date|upper-case|unordered|true|translate|trace|tokenize|timezone-from-time|timezone-from-dateTime|timezone-from-date|sum|subtract-dateTimes-yielding-yearMonthDuration|subtract-dateTimes-yielding-dayTimeDuration|substring-before|substring-after|substring|subsequence|string-to-codepoints|string-pad|string-length|string-join|string|static-base-uri|starts-with|seconds-from-time|seconds-from-duration|seconds-from-dateTime|round-half-to-even|round|root|reverse|resolve-uri|resolve-QName|replace|remove|QName|prefix-from-QName|position|one-or-more|number|not|normalize-unicode|normalize-space|node-name|node-kind|nilled|namespace-uri-from-QName|namespace-uri-for-prefix|namespace-uri|name|months-from-duration|month-from-dateTime|month-from-date|minutes-from-time|minutes-from-duration|minutes-from-dateTime|min|max|matches|lower-case|local-name-from-QName|local-name|last|lang|iri-to-uri|insert-before|index-of|in-scope-prefixes|implicit-timezone|idref|id|hours-from-time|hours-from-duration|hours-from-dateTime|floor|false|expanded-QName|exists|exactly-one|escape-uri|escape-html-uri|error|ends-with|encode-for-uri|empty|document-uri|doc-available|doc|distinct-values|distinct-nodes|default-collation|deep-equal|days-from-duration|day-from-dateTime|day-from-date|data|current-time|current-dateTime|current-date|count|contains|concat|compare|collection|codepoints-to-string|codepoint-equal|ceiling|boolean|base-uri|avg|adjust-time-to-timezone|adjust-dateTime-to-timezone|adjust-date-to-timezone|abs)\b/],
["pln",/^[\w:-]+/],["pln",/^[\t\n\r \xa0]+/]]),["xq","xquery"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["pun",/^[:>?|]+/,a,":|>?"],["dec",/^%(?:YAML|TAG)[^\n\r#]+/,a,"%"],["typ",/^&\S+/,a,"&"],["typ",/^!\S*/,a,"!"],["str",/^"(?:[^"\\]|\\.)*(?:"|$)/,a,'"'],["str",/^'(?:[^']|'')*(?:'|$)/,a,"'"],["com",/^#[^\n\r]*/,a,"#"],["pln",/^\s+/,a," \t\r\n"]],[["dec",/^(?:---|\.\.\.)(?:[\n\r]|$)/],["pun",/^-/],["kwd",/^\w+:[\n\r ]/],["pln",/^\w+/]]),["yaml","yml"]);

var q=null;window.PR_SHOULD_USE_CONTINUATION=!0;
(function(){function L(a){function m(a){var f=a.charCodeAt(0);if(f!==92)return f;var b=a.charAt(1);return(f=r[b])?f:"0"<=b&&b<="7"?parseInt(a.substring(1),8):b==="u"||b==="x"?parseInt(a.substring(2),16):a.charCodeAt(1)}function e(a){if(a<32)return(a<16?"\\x0":"\\x")+a.toString(16);a=String.fromCharCode(a);if(a==="\\"||a==="-"||a==="["||a==="]")a="\\"+a;return a}function h(a){for(var f=a.substring(1,a.length-1).match(/\\u[\dA-Fa-f]{4}|\\x[\dA-Fa-f]{2}|\\[0-3][0-7]{0,2}|\\[0-7]{1,2}|\\[\S\s]|[^\\]/g),a=
[],b=[],o=f[0]==="^",c=o?1:0,i=f.length;c<i;++c){var j=f[c];if(/\\[bdsw]/i.test(j))a.push(j);else{var j=m(j),d;c+2<i&&"-"===f[c+1]?(d=m(f[c+2]),c+=2):d=j;b.push([j,d]);d<65||j>122||(d<65||j>90||b.push([Math.max(65,j)|32,Math.min(d,90)|32]),d<97||j>122||b.push([Math.max(97,j)&-33,Math.min(d,122)&-33]))}}b.sort(function(a,f){return a[0]-f[0]||f[1]-a[1]});f=[];j=[NaN,NaN];for(c=0;c<b.length;++c)i=b[c],i[0]<=j[1]+1?j[1]=Math.max(j[1],i[1]):f.push(j=i);b=["["];o&&b.push("^");b.push.apply(b,a);for(c=0;c<
f.length;++c)i=f[c],b.push(e(i[0])),i[1]>i[0]&&(i[1]+1>i[0]&&b.push("-"),b.push(e(i[1])));b.push("]");return b.join("")}function y(a){for(var f=a.source.match(/\[(?:[^\\\]]|\\[\S\s])*]|\\u[\dA-Fa-f]{4}|\\x[\dA-Fa-f]{2}|\\\d+|\\[^\dux]|\(\?[!:=]|[()^]|[^()[\\^]+/g),b=f.length,d=[],c=0,i=0;c<b;++c){var j=f[c];j==="("?++i:"\\"===j.charAt(0)&&(j=+j.substring(1))&&j<=i&&(d[j]=-1)}for(c=1;c<d.length;++c)-1===d[c]&&(d[c]=++t);for(i=c=0;c<b;++c)j=f[c],j==="("?(++i,d[i]===void 0&&(f[c]="(?:")):"\\"===j.charAt(0)&&
(j=+j.substring(1))&&j<=i&&(f[c]="\\"+d[i]);for(i=c=0;c<b;++c)"^"===f[c]&&"^"!==f[c+1]&&(f[c]="");if(a.ignoreCase&&s)for(c=0;c<b;++c)j=f[c],a=j.charAt(0),j.length>=2&&a==="["?f[c]=h(j):a!=="\\"&&(f[c]=j.replace(/[A-Za-z]/g,function(a){a=a.charCodeAt(0);return"["+String.fromCharCode(a&-33,a|32)+"]"}));return f.join("")}for(var t=0,s=!1,l=!1,p=0,d=a.length;p<d;++p){var g=a[p];if(g.ignoreCase)l=!0;else if(/[a-z]/i.test(g.source.replace(/\\u[\da-f]{4}|\\x[\da-f]{2}|\\[^UXux]/gi,""))){s=!0;l=!1;break}}for(var r=
{b:8,t:9,n:10,v:11,f:12,r:13},n=[],p=0,d=a.length;p<d;++p){g=a[p];if(g.global||g.multiline)throw Error(""+g);n.push("(?:"+y(g)+")")}return RegExp(n.join("|"),l?"gi":"g")}function M(a){function m(a){switch(a.nodeType){case 1:if(e.test(a.className))break;for(var g=a.firstChild;g;g=g.nextSibling)m(g);g=a.nodeName;if("BR"===g||"LI"===g)h[s]="\n",t[s<<1]=y++,t[s++<<1|1]=a;break;case 3:case 4:g=a.nodeValue,g.length&&(g=p?g.replace(/\r\n?/g,"\n"):g.replace(/[\t\n\r ]+/g," "),h[s]=g,t[s<<1]=y,y+=g.length,
t[s++<<1|1]=a)}}var e=/(?:^|\s)nocode(?:\s|$)/,h=[],y=0,t=[],s=0,l;a.currentStyle?l=a.currentStyle.whiteSpace:window.getComputedStyle&&(l=document.defaultView.getComputedStyle(a,q).getPropertyValue("white-space"));var p=l&&"pre"===l.substring(0,3);m(a);return{a:h.join("").replace(/\n$/,""),c:t}}function B(a,m,e,h){m&&(a={a:m,d:a},e(a),h.push.apply(h,a.e))}function x(a,m){function e(a){for(var l=a.d,p=[l,"pln"],d=0,g=a.a.match(y)||[],r={},n=0,z=g.length;n<z;++n){var f=g[n],b=r[f],o=void 0,c;if(typeof b===
"string")c=!1;else{var i=h[f.charAt(0)];if(i)o=f.match(i[1]),b=i[0];else{for(c=0;c<t;++c)if(i=m[c],o=f.match(i[1])){b=i[0];break}o||(b="pln")}if((c=b.length>=5&&"lang-"===b.substring(0,5))&&!(o&&typeof o[1]==="string"))c=!1,b="src";c||(r[f]=b)}i=d;d+=f.length;if(c){c=o[1];var j=f.indexOf(c),k=j+c.length;o[2]&&(k=f.length-o[2].length,j=k-c.length);b=b.substring(5);B(l+i,f.substring(0,j),e,p);B(l+i+j,c,C(b,c),p);B(l+i+k,f.substring(k),e,p)}else p.push(l+i,b)}a.e=p}var h={},y;(function(){for(var e=a.concat(m),
l=[],p={},d=0,g=e.length;d<g;++d){var r=e[d],n=r[3];if(n)for(var k=n.length;--k>=0;)h[n.charAt(k)]=r;r=r[1];n=""+r;p.hasOwnProperty(n)||(l.push(r),p[n]=q)}l.push(/[\S\s]/);y=L(l)})();var t=m.length;return e}function u(a){var m=[],e=[];a.tripleQuotedStrings?m.push(["str",/^(?:'''(?:[^'\\]|\\[\S\s]|''?(?=[^']))*(?:'''|$)|"""(?:[^"\\]|\\[\S\s]|""?(?=[^"]))*(?:"""|$)|'(?:[^'\\]|\\[\S\s])*(?:'|$)|"(?:[^"\\]|\\[\S\s])*(?:"|$))/,q,"'\""]):a.multiLineStrings?m.push(["str",/^(?:'(?:[^'\\]|\\[\S\s])*(?:'|$)|"(?:[^"\\]|\\[\S\s])*(?:"|$)|`(?:[^\\`]|\\[\S\s])*(?:`|$))/,
q,"'\"`"]):m.push(["str",/^(?:'(?:[^\n\r'\\]|\\.)*(?:'|$)|"(?:[^\n\r"\\]|\\.)*(?:"|$))/,q,"\"'"]);a.verbatimStrings&&e.push(["str",/^@"(?:[^"]|"")*(?:"|$)/,q]);var h=a.hashComments;h&&(a.cStyleComments?(h>1?m.push(["com",/^#(?:##(?:[^#]|#(?!##))*(?:###|$)|.*)/,q,"#"]):m.push(["com",/^#(?:(?:define|elif|else|endif|error|ifdef|include|ifndef|line|pragma|undef|warning)\b|[^\n\r]*)/,q,"#"]),e.push(["str",/^<(?:(?:(?:\.\.\/)*|\/?)(?:[\w-]+(?:\/[\w-]+)+)?[\w-]+\.h|[a-z]\w*)>/,q])):m.push(["com",/^#[^\n\r]*/,
q,"#"]));a.cStyleComments&&(e.push(["com",/^\/\/[^\n\r]*/,q]),e.push(["com",/^\/\*[\S\s]*?(?:\*\/|$)/,q]));a.regexLiterals&&e.push(["lang-regex",/^(?:^^\.?|[!+-]|!=|!==|#|%|%=|&|&&|&&=|&=|\(|\*|\*=|\+=|,|-=|->|\/|\/=|:|::|;|<|<<|<<=|<=|=|==|===|>|>=|>>|>>=|>>>|>>>=|[?@[^]|\^=|\^\^|\^\^=|{|\||\|=|\|\||\|\|=|~|break|case|continue|delete|do|else|finally|instanceof|return|throw|try|typeof)\s*(\/(?=[^*/])(?:[^/[\\]|\\[\S\s]|\[(?:[^\\\]]|\\[\S\s])*(?:]|$))+\/)/]);(h=a.types)&&e.push(["typ",h]);a=(""+a.keywords).replace(/^ | $/g,
"");a.length&&e.push(["kwd",RegExp("^(?:"+a.replace(/[\s,]+/g,"|")+")\\b"),q]);m.push(["pln",/^\s+/,q," \r\n\t\xa0"]);e.push(["lit",/^@[$_a-z][\w$@]*/i,q],["typ",/^(?:[@_]?[A-Z]+[a-z][\w$@]*|\w+_t\b)/,q],["pln",/^[$_a-z][\w$@]*/i,q],["lit",/^(?:0x[\da-f]+|(?:\d(?:_\d+)*\d*(?:\.\d*)?|\.\d\+)(?:e[+-]?\d+)?)[a-z]*/i,q,"0123456789"],["pln",/^\\[\S\s]?/,q],["pun",/^.[^\s\w"-$'./@\\`]*/,q]);return x(m,e)}function D(a,m){function e(a){switch(a.nodeType){case 1:if(k.test(a.className))break;if("BR"===a.nodeName)h(a),
a.parentNode&&a.parentNode.removeChild(a);else for(a=a.firstChild;a;a=a.nextSibling)e(a);break;case 3:case 4:if(p){var b=a.nodeValue,d=b.match(t);if(d){var c=b.substring(0,d.index);a.nodeValue=c;(b=b.substring(d.index+d[0].length))&&a.parentNode.insertBefore(s.createTextNode(b),a.nextSibling);h(a);c||a.parentNode.removeChild(a)}}}}function h(a){function b(a,d){var e=d?a.cloneNode(!1):a,f=a.parentNode;if(f){var f=b(f,1),g=a.nextSibling;f.appendChild(e);for(var h=g;h;h=g)g=h.nextSibling,f.appendChild(h)}return e}
for(;!a.nextSibling;)if(a=a.parentNode,!a)return;for(var a=b(a.nextSibling,0),e;(e=a.parentNode)&&e.nodeType===1;)a=e;d.push(a)}var k=/(?:^|\s)nocode(?:\s|$)/,t=/\r\n?|\n/,s=a.ownerDocument,l;a.currentStyle?l=a.currentStyle.whiteSpace:window.getComputedStyle&&(l=s.defaultView.getComputedStyle(a,q).getPropertyValue("white-space"));var p=l&&"pre"===l.substring(0,3);for(l=s.createElement("LI");a.firstChild;)l.appendChild(a.firstChild);for(var d=[l],g=0;g<d.length;++g)e(d[g]);m===(m|0)&&d[0].setAttribute("value",
m);var r=s.createElement("OL");r.className="linenums";for(var n=Math.max(0,m-1|0)||0,g=0,z=d.length;g<z;++g)l=d[g],l.className="L"+(g+n)%10,l.firstChild||l.appendChild(s.createTextNode("\xa0")),r.appendChild(l);a.appendChild(r)}function k(a,m){for(var e=m.length;--e>=0;){var h=m[e];A.hasOwnProperty(h)?window.console&&console.warn("cannot override language handler %s",h):A[h]=a}}function C(a,m){if(!a||!A.hasOwnProperty(a))a=/^\s*</.test(m)?"default-markup":"default-code";return A[a]}function E(a){var m=
a.g;try{var e=M(a.h),h=e.a;a.a=h;a.c=e.c;a.d=0;C(m,h)(a);var k=/\bMSIE\b/.test(navigator.userAgent),m=/\n/g,t=a.a,s=t.length,e=0,l=a.c,p=l.length,h=0,d=a.e,g=d.length,a=0;d[g]=s;var r,n;for(n=r=0;n<g;)d[n]!==d[n+2]?(d[r++]=d[n++],d[r++]=d[n++]):n+=2;g=r;for(n=r=0;n<g;){for(var z=d[n],f=d[n+1],b=n+2;b+2<=g&&d[b+1]===f;)b+=2;d[r++]=z;d[r++]=f;n=b}for(d.length=r;h<p;){var o=l[h+2]||s,c=d[a+2]||s,b=Math.min(o,c),i=l[h+1],j;if(i.nodeType!==1&&(j=t.substring(e,b))){k&&(j=j.replace(m,"\r"));i.nodeValue=
j;var u=i.ownerDocument,v=u.createElement("SPAN");v.className=d[a+1];var x=i.parentNode;x.replaceChild(v,i);v.appendChild(i);e<o&&(l[h+1]=i=u.createTextNode(t.substring(b,o)),x.insertBefore(i,v.nextSibling))}e=b;e>=o&&(h+=2);e>=c&&(a+=2)}}catch(w){"console"in window&&console.log(w&&w.stack?w.stack:w)}}var v=["break,continue,do,else,for,if,return,while"],w=[[v,"auto,case,char,const,default,double,enum,extern,float,goto,int,long,register,short,signed,sizeof,static,struct,switch,typedef,union,unsigned,void,volatile"],
"catch,class,delete,false,import,new,operator,private,protected,public,this,throw,true,try,typeof"],F=[w,"alignof,align_union,asm,axiom,bool,concept,concept_map,const_cast,constexpr,decltype,dynamic_cast,explicit,export,friend,inline,late_check,mutable,namespace,nullptr,reinterpret_cast,static_assert,static_cast,template,typeid,typename,using,virtual,where"],G=[w,"abstract,boolean,byte,extends,final,finally,implements,import,instanceof,null,native,package,strictfp,super,synchronized,throws,transient"],
H=[G,"as,base,by,checked,decimal,delegate,descending,dynamic,event,fixed,foreach,from,group,implicit,in,interface,internal,into,is,lock,object,out,override,orderby,params,partial,readonly,ref,sbyte,sealed,stackalloc,string,select,uint,ulong,unchecked,unsafe,ushort,var"],w=[w,"debugger,eval,export,function,get,null,set,undefined,var,with,Infinity,NaN"],I=[v,"and,as,assert,class,def,del,elif,except,exec,finally,from,global,import,in,is,lambda,nonlocal,not,or,pass,print,raise,try,with,yield,False,True,None"],
J=[v,"alias,and,begin,case,class,def,defined,elsif,end,ensure,false,in,module,next,nil,not,or,redo,rescue,retry,self,super,then,true,undef,unless,until,when,yield,BEGIN,END"],v=[v,"case,done,elif,esac,eval,fi,function,in,local,set,then,until"],K=/^(DIR|FILE|vector|(de|priority_)?queue|list|stack|(const_)?iterator|(multi)?(set|map)|bitset|u?(int|float)\d*)/,N=/\S/,O=u({keywords:[F,H,w,"caller,delete,die,do,dump,elsif,eval,exit,foreach,for,goto,if,import,last,local,my,next,no,our,print,package,redo,require,sub,undef,unless,until,use,wantarray,while,BEGIN,END"+
I,J,v],hashComments:!0,cStyleComments:!0,multiLineStrings:!0,regexLiterals:!0}),A={};k(O,["default-code"]);k(x([],[["pln",/^[^<?]+/],["dec",/^<!\w[^>]*(?:>|$)/],["com",/^<\!--[\S\s]*?(?:--\>|$)/],["lang-",/^<\?([\S\s]+?)(?:\?>|$)/],["lang-",/^<%([\S\s]+?)(?:%>|$)/],["pun",/^(?:<[%?]|[%?]>)/],["lang-",/^<xmp\b[^>]*>([\S\s]+?)<\/xmp\b[^>]*>/i],["lang-js",/^<script\b[^>]*>([\S\s]*?)(<\/script\b[^>]*>)/i],["lang-css",/^<style\b[^>]*>([\S\s]*?)(<\/style\b[^>]*>)/i],["lang-in.tag",/^(<\/?[a-z][^<>]*>)/i]]),
["default-markup","htm","html","mxml","xhtml","xml","xsl"]);k(x([["pln",/^\s+/,q," \t\r\n"],["atv",/^(?:"[^"]*"?|'[^']*'?)/,q,"\"'"]],[["tag",/^^<\/?[a-z](?:[\w-.:]*\w)?|\/?>$/i],["atn",/^(?!style[\s=]|on)[a-z](?:[\w:-]*\w)?/i],["lang-uq.val",/^=\s*([^\s"'>]*(?:[^\s"'/>]|\/(?=\s)))/],["pun",/^[/<->]+/],["lang-js",/^on\w+\s*=\s*"([^"]+)"/i],["lang-js",/^on\w+\s*=\s*'([^']+)'/i],["lang-js",/^on\w+\s*=\s*([^\s"'>]+)/i],["lang-css",/^style\s*=\s*"([^"]+)"/i],["lang-css",/^style\s*=\s*'([^']+)'/i],["lang-css",
/^style\s*=\s*([^\s"'>]+)/i]]),["in.tag"]);k(x([],[["atv",/^[\S\s]+/]]),["uq.val"]);k(u({keywords:F,hashComments:!0,cStyleComments:!0,types:K}),["c","cc","cpp","cxx","cyc","m"]);k(u({keywords:"null,true,false"}),["json"]);k(u({keywords:H,hashComments:!0,cStyleComments:!0,verbatimStrings:!0,types:K}),["cs"]);k(u({keywords:G,cStyleComments:!0}),["java"]);k(u({keywords:v,hashComments:!0,multiLineStrings:!0}),["bsh","csh","sh"]);k(u({keywords:I,hashComments:!0,multiLineStrings:!0,tripleQuotedStrings:!0}),
["cv","py"]);k(u({keywords:"caller,delete,die,do,dump,elsif,eval,exit,foreach,for,goto,if,import,last,local,my,next,no,our,print,package,redo,require,sub,undef,unless,until,use,wantarray,while,BEGIN,END",hashComments:!0,multiLineStrings:!0,regexLiterals:!0}),["perl","pl","pm"]);k(u({keywords:J,hashComments:!0,multiLineStrings:!0,regexLiterals:!0}),["rb"]);k(u({keywords:w,cStyleComments:!0,regexLiterals:!0}),["js"]);k(u({keywords:"all,and,by,catch,class,else,extends,false,finally,for,if,in,is,isnt,loop,new,no,not,null,of,off,on,or,return,super,then,true,try,unless,until,when,while,yes",
hashComments:3,cStyleComments:!0,multilineStrings:!0,tripleQuotedStrings:!0,regexLiterals:!0}),["coffee"]);k(x([],[["str",/^[\S\s]+/]]),["regex"]);window.prettyPrintOne=function(a,m,e){var h=document.createElement("PRE");h.innerHTML=a;e&&D(h,e);E({g:m,i:e,h:h});return h.innerHTML};window.prettyPrint=function(a){function m(){for(var e=window.PR_SHOULD_USE_CONTINUATION?l.now()+250:Infinity;p<h.length&&l.now()<e;p++){var n=h[p],k=n.className;if(k.indexOf("prettyprint")>=0){var k=k.match(g),f,b;if(b=
!k){b=n;for(var o=void 0,c=b.firstChild;c;c=c.nextSibling)var i=c.nodeType,o=i===1?o?b:c:i===3?N.test(c.nodeValue)?b:o:o;b=(f=o===b?void 0:o)&&"CODE"===f.tagName}b&&(k=f.className.match(g));k&&(k=k[1]);b=!1;for(o=n.parentNode;o;o=o.parentNode)if((o.tagName==="pre"||o.tagName==="code"||o.tagName==="xmp")&&o.className&&o.className.indexOf("prettyprint")>=0){b=!0;break}b||((b=(b=n.className.match(/\blinenums\b(?::(\d+))?/))?b[1]&&b[1].length?+b[1]:!0:!1)&&D(n,b),d={g:k,h:n,i:b},E(d))}}p<h.length?setTimeout(m,
250):a&&a()}for(var e=[document.getElementsByTagName("pre"),document.getElementsByTagName("code"),document.getElementsByTagName("xmp")],h=[],k=0;k<e.length;++k)for(var t=0,s=e[k].length;t<s;++t)h.push(e[k][t]);var e=q,l=Date;l.now||(l={now:function(){return+new Date}});var p=0,d,g=/\blang(?:uage)?-([\w.]+)(?!\S)/;m()};window.PR={createSimpleLexer:x,registerLangHandler:k,sourceDecorator:u,PR_ATTRIB_NAME:"atn",PR_ATTRIB_VALUE:"atv",PR_COMMENT:"com",PR_DECLARATION:"dec",PR_KEYWORD:"kwd",PR_LITERAL:"lit",
PR_NOCODE:"nocode",PR_PLAIN:"pln",PR_PUNCTUATION:"pun",PR_SOURCE:"src",PR_STRING:"str",PR_TAG:"tag",PR_TYPE:"typ"}})();

/* Modernizr 2.5.3 (Custom Build) | MIT & BSD
 * Build: http://www.modernizr.com/download/#-fontface-backgroundsize-borderimage-borderradius-boxshadow-flexbox-flexbox_legacy-hsla-multiplebgs-opacity-rgba-textshadow-cssanimations-csscolumns-generatedcontent-cssgradients-cssreflections-csstransforms-csstransforms3d-csstransitions-applicationcache-canvas-canvastext-draganddrop-hashchange-history-audio-video-indexeddb-input-inputtypes-localstorage-postmessage-sessionstorage-websockets-websqldatabase-webworkers-geolocation-inlinesvg-smil-svg-svgclippaths-touch-webgl-mq-prefixed-teststyles-testprop-testallprops-hasevent-prefixes-domprefixes-load
 */
;window.Modernizr=function(a,b,c){function C(a){i.cssText=a}function D(a,b){return C(m.join(a+";")+(b||""))}function E(a,b){return typeof a===b}function F(a,b){return!!~(""+a).indexOf(b)}function G(a,b){for(var d in a)if(i[a[d]]!==c)return b=="pfx"?a[d]:!0;return!1}function H(a,b,d){for(var e in a){var f=b[a[e]];if(f!==c)return d===!1?a[e]:E(f,"function")?f.bind(d||b):f}return!1}function I(a,b,c){var d=a.charAt(0).toUpperCase()+a.substr(1),e=(a+" "+o.join(d+" ")+d).split(" ");return E(b,"string")||E(b,"undefined")?G(e,b):(e=(a+" "+p.join(d+" ")+d).split(" "),H(e,b,c))}function K(){e.input=function(c){for(var d=0,e=c.length;d<e;d++)t[c[d]]=c[d]in j;return t.list&&(t.list=!!b.createElement("datalist")&&!!a.HTMLDataListElement),t}("autocomplete autofocus list placeholder max min multiple pattern required step".split(" ")),e.inputtypes=function(a){for(var d=0,e,g,h,i=a.length;d<i;d++)j.setAttribute("type",g=a[d]),e=j.type!=="text",e&&(j.value=k,j.style.cssText="position:absolute;visibility:hidden;",/^range$/.test(g)&&j.style.WebkitAppearance!==c?(f.appendChild(j),h=b.defaultView,e=h.getComputedStyle&&h.getComputedStyle(j,null).WebkitAppearance!=="textfield"&&j.offsetHeight!==0,f.removeChild(j)):/^(search|tel)$/.test(g)||(/^(url|email)$/.test(g)?e=j.checkValidity&&j.checkValidity()===!1:/^color$/.test(g)?(f.appendChild(j),f.offsetWidth,e=j.value!=k,f.removeChild(j)):e=j.value!=k)),s[a[d]]=!!e;return s}("search tel url email datetime date month week time datetime-local number range color".split(" "))}var d="2.5.3",e={},f=b.documentElement,g="modernizr",h=b.createElement(g),i=h.style,j=b.createElement("input"),k=":)",l={}.toString,m=" -webkit- -moz- -o- -ms- ".split(" "),n="Webkit Moz O ms",o=n.split(" "),p=n.toLowerCase().split(" "),q={svg:"http://www.w3.org/2000/svg"},r={},s={},t={},u=[],v=u.slice,w,x=function(a,c,d,e){var h,i,j,k=b.createElement("div"),l=b.body,m=l?l:b.createElement("body");if(parseInt(d,10))while(d--)j=b.createElement("div"),j.id=e?e[d]:g+(d+1),k.appendChild(j);return h=["&#173;","<style>",a,"</style>"].join(""),k.id=g,(l?k:m).innerHTML+=h,m.appendChild(k),l||(m.style.background="",f.appendChild(m)),i=c(k,a),l?k.parentNode.removeChild(k):m.parentNode.removeChild(m),!!i},y=function(b){var c=a.matchMedia||a.msMatchMedia;if(c)return c(b).matches;var d;return x("@media "+b+" { #"+g+" { position: absolute; } }",function(b){d=(a.getComputedStyle?getComputedStyle(b,null):b.currentStyle)["position"]=="absolute"}),d},z=function(){function d(d,e){e=e||b.createElement(a[d]||"div"),d="on"+d;var f=d in e;return f||(e.setAttribute||(e=b.createElement("div")),e.setAttribute&&e.removeAttribute&&(e.setAttribute(d,""),f=E(e[d],"function"),E(e[d],"undefined")||(e[d]=c),e.removeAttribute(d))),e=null,f}var a={select:"input",change:"input",submit:"form",reset:"form",error:"img",load:"img",abort:"img"};return d}(),A={}.hasOwnProperty,B;!E(A,"undefined")&&!E(A.call,"undefined")?B=function(a,b){return A.call(a,b)}:B=function(a,b){return b in a&&E(a.constructor.prototype[b],"undefined")},Function.prototype.bind||(Function.prototype.bind=function(b){var c=this;if(typeof c!="function")throw new TypeError;var d=v.call(arguments,1),e=function(){if(this instanceof e){var a=function(){};a.prototype=c.prototype;var f=new a,g=c.apply(f,d.concat(v.call(arguments)));return Object(g)===g?g:f}return c.apply(b,d.concat(v.call(arguments)))};return e});var J=function(c,d){var f=c.join(""),g=d.length;x(f,function(c,d){var f=b.styleSheets[b.styleSheets.length-1],h=f?f.cssRules&&f.cssRules[0]?f.cssRules[0].cssText:f.cssText||"":"",i=c.childNodes,j={};while(g--)j[i[g].id]=i[g];e.touch="ontouchstart"in a||a.DocumentTouch&&b instanceof DocumentTouch||(j.touch&&j.touch.offsetTop)===9,e.csstransforms3d=(j.csstransforms3d&&j.csstransforms3d.offsetLeft)===9&&j.csstransforms3d.offsetHeight===3,e.generatedcontent=(j.generatedcontent&&j.generatedcontent.offsetHeight)>=1,e.fontface=/src/i.test(h)&&h.indexOf(d.split(" ")[0])===0},g,d)}(['@font-face {font-family:"font";src:url("https://")}',["@media (",m.join("touch-enabled),("),g,")","{#touch{top:9px;position:absolute}}"].join(""),["@media (",m.join("transform-3d),("),g,")","{#csstransforms3d{left:9px;position:absolute;height:3px;}}"].join(""),['#generatedcontent:after{content:"',k,'";visibility:hidden}'].join("")],["fontface","touch","csstransforms3d","generatedcontent"]);r.flexbox=function(){return I("flexOrder")},r["flexbox-legacy"]=function(){return I("boxDirection")},r.canvas=function(){var a=b.createElement("canvas");return!!a.getContext&&!!a.getContext("2d")},r.canvastext=function(){return!!e.canvas&&!!E(b.createElement("canvas").getContext("2d").fillText,"function")},r.webgl=function(){try{var d=b.createElement("canvas"),e;e=!(!a.WebGLRenderingContext||!d.getContext("experimental-webgl")&&!d.getContext("webgl")),d=c}catch(f){e=!1}return e},r.touch=function(){return e.touch},r.geolocation=function(){return!!navigator.geolocation},r.postmessage=function(){return!!a.postMessage},r.websqldatabase=function(){return!!a.openDatabase},r.indexedDB=function(){return!!I("indexedDB",a)},r.hashchange=function(){return z("hashchange",a)&&(b.documentMode===c||b.documentMode>7)},r.history=function(){return!!a.history&&!!history.pushState},r.draganddrop=function(){var a=b.createElement("div");return"draggable"in a||"ondragstart"in a&&"ondrop"in a},r.websockets=function(){for(var b=-1,c=o.length;++b<c;)if(a[o[b]+"WebSocket"])return!0;return"WebSocket"in a},r.rgba=function(){return C("background-color:rgba(150,255,150,.5)"),F(i.backgroundColor,"rgba")},r.hsla=function(){return C("background-color:hsla(120,40%,100%,.5)"),F(i.backgroundColor,"rgba")||F(i.backgroundColor,"hsla")},r.multiplebgs=function(){return C("background:url(https://),url(https://),red url(https://)"),/(url\s*\(.*?){3}/.test(i.background)},r.backgroundsize=function(){return I("backgroundSize")},r.borderimage=function(){return I("borderImage")},r.borderradius=function(){return I("borderRadius")},r.boxshadow=function(){return I("boxShadow")},r.textshadow=function(){return b.createElement("div").style.textShadow===""},r.opacity=function(){return D("opacity:.55"),/^0.55$/.test(i.opacity)},r.cssanimations=function(){return I("animationName")},r.csscolumns=function(){return I("columnCount")},r.cssgradients=function(){var a="background-image:",b="gradient(linear,left top,right bottom,from(#9f9),to(white));",c="linear-gradient(left top,#9f9, white);";return C((a+"-webkit- ".split(" ").join(b+a)+m.join(c+a)).slice(0,-a.length)),F(i.backgroundImage,"gradient")},r.cssreflections=function(){return I("boxReflect")},r.csstransforms=function(){return!!I("transform")},r.csstransforms3d=function(){var a=!!I("perspective");return a&&"webkitPerspective"in f.style&&(a=e.csstransforms3d),a},r.csstransitions=function(){return I("transition")},r.fontface=function(){return e.fontface},r.generatedcontent=function(){return e.generatedcontent},r.video=function(){var a=b.createElement("video"),c=!1;try{if(c=!!a.canPlayType)c=new Boolean(c),c.ogg=a.canPlayType('video/ogg; codecs="theora"').replace(/^no$/,""),c.h264=a.canPlayType('video/mp4; codecs="avc1.42E01E"').replace(/^no$/,""),c.webm=a.canPlayType('video/webm; codecs="vp8, vorbis"').replace(/^no$/,"")}catch(d){}return c},r.audio=function(){var a=b.createElement("audio"),c=!1;try{if(c=!!a.canPlayType)c=new Boolean(c),c.ogg=a.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/,""),c.mp3=a.canPlayType("audio/mpeg;").replace(/^no$/,""),c.wav=a.canPlayType('audio/wav; codecs="1"').replace(/^no$/,""),c.m4a=(a.canPlayType("audio/x-m4a;")||a.canPlayType("audio/aac;")).replace(/^no$/,"")}catch(d){}return c},r.localstorage=function(){try{return localStorage.setItem(g,g),localStorage.removeItem(g),!0}catch(a){return!1}},r.sessionstorage=function(){try{return sessionStorage.setItem(g,g),sessionStorage.removeItem(g),!0}catch(a){return!1}},r.webworkers=function(){return!!a.Worker},r.applicationcache=function(){return!!a.applicationCache},r.svg=function(){return!!b.createElementNS&&!!b.createElementNS(q.svg,"svg").createSVGRect},r.inlinesvg=function(){var a=b.createElement("div");return a.innerHTML="<svg/>",(a.firstChild&&a.firstChild.namespaceURI)==q.svg},r.smil=function(){return!!b.createElementNS&&/SVGAnimate/.test(l.call(b.createElementNS(q.svg,"animate")))},r.svgclippaths=function(){return!!b.createElementNS&&/SVGClipPath/.test(l.call(b.createElementNS(q.svg,"clipPath")))};for(var L in r)B(r,L)&&(w=L.toLowerCase(),e[w]=r[L](),u.push((e[w]?"":"no-")+w));return e.input||K(),C(""),h=j=null,e._version=d,e._prefixes=m,e._domPrefixes=p,e._cssomPrefixes=o,e.mq=y,e.hasEvent=z,e.testProp=function(a){return G([a])},e.testAllProps=I,e.testStyles=x,e.prefixed=function(a,b,c){return b?I(a,b,c):I(a,"pfx")},e}(this,this.document),function(a,b,c){function d(a){return o.call(a)=="[object Function]"}function e(a){return typeof a=="string"}function f(){}function g(a){return!a||a=="loaded"||a=="complete"||a=="uninitialized"}function h(){var a=p.shift();q=1,a?a.t?m(function(){(a.t=="c"?B.injectCss:B.injectJs)(a.s,0,a.a,a.x,a.e,1)},0):(a(),h()):q=0}function i(a,c,d,e,f,i,j){function k(b){if(!o&&g(l.readyState)&&(u.r=o=1,!q&&h(),l.onload=l.onreadystatechange=null,b)){a!="img"&&m(function(){t.removeChild(l)},50);for(var d in y[c])y[c].hasOwnProperty(d)&&y[c][d].onload()}}var j=j||B.errorTimeout,l={},o=0,r=0,u={t:d,s:c,e:f,a:i,x:j};y[c]===1&&(r=1,y[c]=[],l=b.createElement(a)),a=="object"?l.data=c:(l.src=c,l.type=a),l.width=l.height="0",l.onerror=l.onload=l.onreadystatechange=function(){k.call(this,r)},p.splice(e,0,u),a!="img"&&(r||y[c]===2?(t.insertBefore(l,s?null:n),m(k,j)):y[c].push(l))}function j(a,b,c,d,f){return q=0,b=b||"j",e(a)?i(b=="c"?v:u,a,b,this.i++,c,d,f):(p.splice(this.i++,0,a),p.length==1&&h()),this}function k(){var a=B;return a.loader={load:j,i:0},a}var l=b.documentElement,m=a.setTimeout,n=b.getElementsByTagName("script")[0],o={}.toString,p=[],q=0,r="MozAppearance"in l.style,s=r&&!!b.createRange().compareNode,t=s?l:n.parentNode,l=a.opera&&o.call(a.opera)=="[object Opera]",l=!!b.attachEvent&&!l,u=r?"object":l?"script":"img",v=l?"script":u,w=Array.isArray||function(a){return o.call(a)=="[object Array]"},x=[],y={},z={timeout:function(a,b){return b.length&&(a.timeout=b[0]),a}},A,B;B=function(a){function b(a){var a=a.split("!"),b=x.length,c=a.pop(),d=a.length,c={url:c,origUrl:c,prefixes:a},e,f,g;for(f=0;f<d;f++)g=a[f].split("="),(e=z[g.shift()])&&(c=e(c,g));for(f=0;f<b;f++)c=x[f](c);return c}function g(a,e,f,g,i){var j=b(a),l=j.autoCallback;j.url.split(".").pop().split("?").shift(),j.bypass||(e&&(e=d(e)?e:e[a]||e[g]||e[a.split("/").pop().split("?")[0]]||h),j.instead?j.instead(a,e,f,g,i):(y[j.url]?j.noexec=!0:y[j.url]=1,f.load(j.url,j.forceCSS||!j.forceJS&&"css"==j.url.split(".").pop().split("?").shift()?"c":c,j.noexec,j.attrs,j.timeout),(d(e)||d(l))&&f.load(function(){k(),e&&e(j.origUrl,i,g),l&&l(j.origUrl,i,g),y[j.url]=2})))}function i(a,b){function c(a,c){if(a){if(e(a))c||(j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}),g(a,j,b,0,h);else if(Object(a)===a)for(n in m=function(){var b=0,c;for(c in a)a.hasOwnProperty(c)&&b++;return b}(),a)a.hasOwnProperty(n)&&(!c&&!--m&&(d(j)?j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}:j[n]=function(a){return function(){var b=[].slice.call(arguments);a&&a.apply(this,b),l()}}(k[n])),g(a[n],j,b,n,h))}else!c&&l()}var h=!!a.test,i=a.load||a.both,j=a.callback||f,k=j,l=a.complete||f,m,n;c(h?a.yep:a.nope,!!i),i&&c(i)}var j,l,m=this.yepnope.loader;if(e(a))g(a,0,m,0);else if(w(a))for(j=0;j<a.length;j++)l=a[j],e(l)?g(l,0,m,0):w(l)?B(l):Object(l)===l&&i(l,m);else Object(a)===a&&i(a,m)},B.addPrefix=function(a,b){z[a]=b},B.addFilter=function(a){x.push(a)},B.errorTimeout=1e4,b.readyState==null&&b.addEventListener&&(b.readyState="loading",b.addEventListener("DOMContentLoaded",A=function(){b.removeEventListener("DOMContentLoaded",A,0),b.readyState="complete"},0)),a.yepnope=k(),a.yepnope.executeStack=h,a.yepnope.injectJs=function(a,c,d,e,i,j){var k=b.createElement("script"),l,o,e=e||B.errorTimeout;k.src=a;for(o in d)k.setAttribute(o,d[o]);c=j?h:c||f,k.onreadystatechange=k.onload=function(){!l&&g(k.readyState)&&(l=1,c(),k.onload=k.onreadystatechange=null)},m(function(){l||(l=1,c(1))},e),i?k.onload():n.parentNode.insertBefore(k,n)},a.yepnope.injectCss=function(a,c,d,e,g,i){var e=b.createElement("link"),j,c=i?h:c||f;e.href=a,e.rel="stylesheet",e.type="text/css";for(j in d)e.setAttribute(j,d[j]);g||(n.parentNode.insertBefore(e,n),m(c,0))}}(this,document),Modernizr.load=function(){yepnope.apply(window,[].slice.call(arguments,0))};
/*
 RequireJS order 1.0.5 Copyright (c) 2010-2011, The Dojo Foundation All Rights Reserved.
 Available via the MIT or new BSD license.
 see: http://github.com/jrburke/requirejs for details
*/
(function(){function k(a){var b=a.currentTarget||a.srcElement,c;if(a.type==="load"||l.test(b.readyState)){a=b.getAttribute("data-requiremodule");j[a]=!0;for(a=0;c=g[a];a++)if(j[c.name])c.req([c.name],c.onLoad);else break;a>0&&g.splice(0,a);setTimeout(function(){b.parentNode.removeChild(b)},15)}}function m(a){var b,c;a.setAttribute("data-orderloaded","loaded");for(a=0;c=h[a];a++)if((b=i[c])&&b.getAttribute("data-orderloaded")==="loaded")delete i[c],require.addScriptToDom(b);else break;a>0&&h.splice(0,
a)}var f=typeof document!=="undefined"&&typeof window!=="undefined"&&document.createElement("script"),n=f&&(f.async||window.opera&&Object.prototype.toString.call(window.opera)==="[object Opera]"||"MozAppearance"in document.documentElement.style),o=f&&f.readyState==="uninitialized",l=/^(complete|loaded)$/,g=[],j={},i={},h=[],f=null;define({version:"1.0.5",load:function(a,b,c,e){var d;b.nameToUrl?(d=b.nameToUrl(a,null),require.s.skipAsync[d]=!0,n||e.isBuild?b([a],c):o?(e=require.s.contexts._,!e.urlFetched[d]&&
!e.loaded[a]&&(e.urlFetched[d]=!0,require.resourcesReady(!1),e.scriptCount+=1,d=require.attach(d,e,a,null,null,m),i[a]=d,h.push(a)),b([a],c)):b.specified(a)?b([a],c):(g.push({name:a,req:b,onLoad:c}),require.attach(d,null,a,k,"script/cache"))):b([a],c)}})})();

/*
 RequireJS 1.0.8 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 Available via the MIT or new BSD license.
 see: http://github.com/jrburke/requirejs for details
*/
var requirejs,require,define;
(function(r){function K(a){return O.call(a)==="[object Function]"}function G(a){return O.call(a)==="[object Array]"}function $(a,c,l){for(var j in c)if(!(j in L)&&(!(j in a)||l))a[j]=c[j];return d}function P(a,c,d){a=Error(c+"\nhttp://requirejs.org/docs/errors.html#"+a);if(d)a.originalError=d;return a}function aa(a,c,d){var j,k,t;for(j=0;t=c[j];j++){t=typeof t==="string"?{name:t}:t;k=t.location;if(d&&(!k||k.indexOf("/")!==0&&k.indexOf(":")===-1))k=d+"/"+(k||t.name);a[t.name]={name:t.name,location:k||
t.name,main:(t.main||"main").replace(fa,"").replace(ba,"")}}}function V(a,c){a.holdReady?a.holdReady(c):c?a.readyWait+=1:a.ready(!0)}function ga(a){function c(b,f){var g,m;if(b&&b.charAt(0)===".")if(f){q.pkgs[f]?f=[f]:(f=f.split("/"),f=f.slice(0,f.length-1));g=b=f.concat(b.split("/"));var a;for(m=0;a=g[m];m++)if(a===".")g.splice(m,1),m-=1;else if(a==="..")if(m===1&&(g[2]===".."||g[0]===".."))break;else m>0&&(g.splice(m-1,2),m-=2);m=q.pkgs[g=b[0]];b=b.join("/");m&&b===g+"/"+m.main&&(b=g)}else b.indexOf("./")===
0&&(b=b.substring(2));return b}function l(b,f){var g=b?b.indexOf("!"):-1,m=null,a=f?f.name:null,h=b,e,d;g!==-1&&(m=b.substring(0,g),b=b.substring(g+1,b.length));m&&(m=c(m,a));b&&(m?e=(g=n[m])&&g.normalize?g.normalize(b,function(b){return c(b,a)}):c(b,a):(e=c(b,a),d=G[e],d||(d=i.nameToUrl(b,null,f),G[e]=d)));return{prefix:m,name:e,parentMap:f,url:d,originalName:h,fullName:m?m+"!"+(e||""):e}}function j(){var b=!0,f=q.priorityWait,g,a;if(f){for(a=0;g=f[a];a++)if(!s[g]){b=!1;break}b&&delete q.priorityWait}return b}
function k(b,f,g){return function(){var a=ha.call(arguments,0),c;if(g&&K(c=a[a.length-1]))c.__requireJsBuild=!0;a.push(f);return b.apply(null,a)}}function t(b,f,g){f=k(g||i.require,b,f);$(f,{nameToUrl:k(i.nameToUrl,b),toUrl:k(i.toUrl,b),defined:k(i.requireDefined,b),specified:k(i.requireSpecified,b),isBrowser:d.isBrowser});return f}function p(b){var f,g,a,c=b.callback,h=b.map,e=h.fullName,ca=b.deps;a=b.listeners;var j=q.requireExecCb||d.execCb;if(c&&K(c)){if(q.catchError.define)try{g=j(e,b.callback,
ca,n[e])}catch(k){f=k}else g=j(e,b.callback,ca,n[e]);if(e)(c=b.cjsModule)&&c.exports!==r&&c.exports!==n[e]?g=n[e]=b.cjsModule.exports:g===r&&b.usingExports?g=n[e]:(n[e]=g,H[e]&&(T[e]=!0))}else e&&(g=n[e]=c,H[e]&&(T[e]=!0));if(x[b.id])delete x[b.id],b.isDone=!0,i.waitCount-=1,i.waitCount===0&&(J=[]);delete M[e];if(d.onResourceLoad&&!b.placeholder)d.onResourceLoad(i,h,b.depArray);if(f)return g=(e?l(e).url:"")||f.fileName||f.sourceURL,a=f.moduleTree,f=P("defineerror",'Error evaluating module "'+e+'" at location "'+
g+'":\n'+f+"\nfileName:"+g+"\nlineNumber: "+(f.lineNumber||f.line),f),f.moduleName=e,f.moduleTree=a,d.onError(f);for(f=0;c=a[f];f++)c(g);return r}function u(b,f){return function(g){b.depDone[f]||(b.depDone[f]=!0,b.deps[f]=g,b.depCount-=1,b.depCount||p(b))}}function o(b,f){var g=f.map,a=g.fullName,c=g.name,h=N[b]||(N[b]=n[b]),e;if(!f.loading)f.loading=!0,e=function(b){f.callback=function(){return b};p(f);s[f.id]=!0;A()},e.fromText=function(b,f){var g=Q;s[b]=!1;i.scriptCount+=1;i.fake[b]=!0;g&&(Q=!1);
d.exec(f);g&&(Q=!0);i.completeLoad(b)},a in n?e(n[a]):h.load(c,t(g.parentMap,!0,function(b,a){var c=[],e,m;for(e=0;m=b[e];e++)m=l(m,g.parentMap),b[e]=m.fullName,m.prefix||c.push(b[e]);f.moduleDeps=(f.moduleDeps||[]).concat(c);return i.require(b,a)}),e,q)}function y(b){x[b.id]||(x[b.id]=b,J.push(b),i.waitCount+=1)}function D(b){this.listeners.push(b)}function v(b,f){var g=b.fullName,a=b.prefix,c=a?N[a]||(N[a]=n[a]):null,h,e;g&&(h=M[g]);if(!h&&(e=!0,h={id:(a&&!c?O++ +"__p@:":"")+(g||"__r@"+O++),map:b,
depCount:0,depDone:[],depCallbacks:[],deps:[],listeners:[],add:D},B[h.id]=!0,g&&(!a||N[a])))M[g]=h;a&&!c?(g=l(a),a in n&&!n[a]&&(delete n[a],delete R[g.url]),a=v(g,!0),a.add(function(){var f=l(b.originalName,b.parentMap),f=v(f,!0);h.placeholder=!0;f.add(function(b){h.callback=function(){return b};p(h)})})):e&&f&&(s[h.id]=!1,i.paused.push(h),y(h));return h}function C(b,f,a,c){var b=l(b,c),d=b.name,h=b.fullName,e=v(b),j=e.id,k=e.deps,o;if(h){if(h in n||s[j]===!0||h==="jquery"&&q.jQuery&&q.jQuery!==
a().fn.jquery)return;B[j]=!0;s[j]=!0;h==="jquery"&&a&&W(a())}e.depArray=f;e.callback=a;for(a=0;a<f.length;a++)if(j=f[a])j=l(j,d?b:c),o=j.fullName,f[a]=o,o==="require"?k[a]=t(b):o==="exports"?(k[a]=n[h]={},e.usingExports=!0):o==="module"?e.cjsModule=k[a]={id:d,uri:d?i.nameToUrl(d,null,c):r,exports:n[h]}:o in n&&!(o in x)&&(!(h in H)||h in H&&T[o])?k[a]=n[o]:(h in H&&(H[o]=!0,delete n[o],R[j.url]=!1),e.depCount+=1,e.depCallbacks[a]=u(e,a),v(j,!0).add(e.depCallbacks[a]));e.depCount?y(e):p(e)}function w(b){C.apply(null,
b)}function F(b,f){var a=b.map.fullName,c=b.depArray,d=!0,h,e,i,l;if(b.isDone||!a||!s[a])return l;if(f[a])return b;f[a]=!0;if(c){for(h=0;h<c.length;h++){e=c[h];if(!s[e]&&!ia[e]){d=!1;break}if((i=x[e])&&!i.isDone&&s[e])if(l=F(i,f))break}d||(l=r,delete f[a])}return l}function z(b,a){var g=b.map.fullName,c=b.depArray,d,h,e,i;if(b.isDone||!g||!s[g])return r;if(g){if(a[g])return n[g];a[g]=!0}if(c)for(d=0;d<c.length;d++)if(h=c[d])if((e=l(h).prefix)&&(i=x[e])&&z(i,a),(e=x[h])&&!e.isDone&&s[h])h=z(e,a),b.depCallbacks[d](h);
return n[g]}function E(){var b=q.waitSeconds*1E3,b=b&&i.startTime+b<(new Date).getTime(),a="",c=!1,l=!1,k=[],h,e;if(i.pausedCount>0)return r;if(q.priorityWait)if(j())A();else return r;for(h in s)if(!(h in L)&&(c=!0,!s[h]))if(b)a+=h+" ";else if(l=!0,h.indexOf("!")===-1){k=[];break}else(e=M[h]&&M[h].moduleDeps)&&k.push.apply(k,e);if(!c&&!i.waitCount)return r;if(b&&a)return b=P("timeout","Load timeout for modules: "+a),b.requireType="timeout",b.requireModules=a,b.contextName=i.contextName,d.onError(b);
if(l&&k.length)for(a=0;h=x[k[a]];a++)if(h=F(h,{})){z(h,{});break}if(!b&&(l||i.scriptCount)){if((I||da)&&!X)X=setTimeout(function(){X=0;E()},50);return r}if(i.waitCount){for(a=0;h=J[a];a++)z(h,{});i.paused.length&&A();Y<5&&(Y+=1,E())}Y=0;d.checkReadyState();return r}var i,A,q={waitSeconds:7,baseUrl:"./",paths:{},pkgs:{},catchError:{}},S=[],B={require:!0,exports:!0,module:!0},G={},n={},s={},x={},J=[],R={},O=0,M={},N={},H={},T={},Z=0;W=function(b){if(!i.jQuery&&(b=b||(typeof jQuery!=="undefined"?jQuery:
null))&&!(q.jQuery&&b.fn.jquery!==q.jQuery)&&("holdReady"in b||"readyWait"in b))if(i.jQuery=b,w(["jquery",[],function(){return jQuery}]),i.scriptCount)V(b,!0),i.jQueryIncremented=!0};A=function(){var b,a,c,l,k,h;i.takeGlobalQueue();Z+=1;if(i.scriptCount<=0)i.scriptCount=0;for(;S.length;)if(b=S.shift(),b[0]===null)return d.onError(P("mismatch","Mismatched anonymous define() module: "+b[b.length-1]));else w(b);if(!q.priorityWait||j())for(;i.paused.length;){k=i.paused;i.pausedCount+=k.length;i.paused=
[];for(l=0;b=k[l];l++)a=b.map,c=a.url,h=a.fullName,a.prefix?o(a.prefix,b):!R[c]&&!s[h]&&((q.requireLoad||d.load)(i,h,c),c.indexOf("empty:")!==0&&(R[c]=!0));i.startTime=(new Date).getTime();i.pausedCount-=k.length}Z===1&&E();Z-=1;return r};i={contextName:a,config:q,defQueue:S,waiting:x,waitCount:0,specified:B,loaded:s,urlMap:G,urlFetched:R,scriptCount:0,defined:n,paused:[],pausedCount:0,plugins:N,needFullExec:H,fake:{},fullExec:T,managerCallbacks:M,makeModuleMap:l,normalize:c,configure:function(b){var a,
c,d;b.baseUrl&&b.baseUrl.charAt(b.baseUrl.length-1)!=="/"&&(b.baseUrl+="/");a=q.paths;d=q.pkgs;$(q,b,!0);if(b.paths){for(c in b.paths)c in L||(a[c]=b.paths[c]);q.paths=a}if((a=b.packagePaths)||b.packages){if(a)for(c in a)c in L||aa(d,a[c],c);b.packages&&aa(d,b.packages);q.pkgs=d}if(b.priority)c=i.requireWait,i.requireWait=!1,A(),i.require(b.priority),A(),i.requireWait=c,q.priorityWait=b.priority;if(b.deps||b.callback)i.require(b.deps||[],b.callback)},requireDefined:function(b,a){return l(b,a).fullName in
n},requireSpecified:function(b,a){return l(b,a).fullName in B},require:function(b,c,g){if(typeof b==="string"){if(K(c))return d.onError(P("requireargs","Invalid require call"));if(d.get)return d.get(i,b,c);c=l(b,c);b=c.fullName;return!(b in n)?d.onError(P("notloaded","Module name '"+c.fullName+"' has not been loaded yet for context: "+a)):n[b]}(b&&b.length||c)&&C(null,b,c,g);if(!i.requireWait)for(;!i.scriptCount&&i.paused.length;)A();return i.require},takeGlobalQueue:function(){U.length&&(ja.apply(i.defQueue,
[i.defQueue.length-1,0].concat(U)),U=[])},completeLoad:function(b){var a;for(i.takeGlobalQueue();S.length;)if(a=S.shift(),a[0]===null){a[0]=b;break}else if(a[0]===b)break;else w(a),a=null;a?w(a):w([b,[],b==="jquery"&&typeof jQuery!=="undefined"?function(){return jQuery}:null]);d.isAsync&&(i.scriptCount-=1);A();d.isAsync||(i.scriptCount-=1)},toUrl:function(b,a){var c=b.lastIndexOf("."),d=null;c!==-1&&(d=b.substring(c,b.length),b=b.substring(0,c));return i.nameToUrl(b,d,a)},nameToUrl:function(b,a,g){var l,
k,h,e,j=i.config,b=c(b,g&&g.fullName);if(d.jsExtRegExp.test(b))a=b+(a?a:"");else{l=j.paths;k=j.pkgs;g=b.split("/");for(e=g.length;e>0;e--)if(h=g.slice(0,e).join("/"),l[h]){g.splice(0,e,l[h]);break}else if(h=k[h]){b=b===h.name?h.location+"/"+h.main:h.location;g.splice(0,e,b);break}a=g.join("/")+(a||".js");a=(a.charAt(0)==="/"||a.match(/^[\w\+\.\-]+:/)?"":j.baseUrl)+a}return j.urlArgs?a+((a.indexOf("?")===-1?"?":"&")+j.urlArgs):a}};i.jQueryCheck=W;i.resume=A;return i}function ka(){var a,c,d;if(C&&C.readyState===
"interactive")return C;a=document.getElementsByTagName("script");for(c=a.length-1;c>-1&&(d=a[c]);c--)if(d.readyState==="interactive")return C=d;return null}var la=/(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,ma=/require\(\s*["']([^'"\s]+)["']\s*\)/g,fa=/^\.\//,ba=/\.js$/,O=Object.prototype.toString,u=Array.prototype,ha=u.slice,ja=u.splice,I=!!(typeof window!=="undefined"&&navigator&&document),da=!I&&typeof importScripts!=="undefined",na=I&&navigator.platform==="PLAYSTATION 3"?/^complete$/:/^(complete|loaded)$/,
ea=typeof opera!=="undefined"&&opera.toString()==="[object Opera]",L={},D={},U=[],C=null,Y=0,Q=!1,ia={require:!0,module:!0,exports:!0},d,u={},J,y,v,E,o,w,F,B,z,W,X;if(typeof define==="undefined"){if(typeof requirejs!=="undefined")if(K(requirejs))return;else u=requirejs,requirejs=r;typeof require!=="undefined"&&!K(require)&&(u=require,require=r);d=requirejs=function(a,c,d){var j="_",k;!G(a)&&typeof a!=="string"&&(k=a,G(c)?(a=c,c=d):a=[]);if(k&&k.context)j=k.context;d=D[j]||(D[j]=ga(j));k&&d.configure(k);
return d.require(a,c)};d.config=function(a){return d(a)};require||(require=d);d.toUrl=function(a){return D._.toUrl(a)};d.version="1.0.8";d.jsExtRegExp=/^\/|:|\?|\.js$/;y=d.s={contexts:D,skipAsync:{}};if(d.isAsync=d.isBrowser=I)if(v=y.head=document.getElementsByTagName("head")[0],E=document.getElementsByTagName("base")[0])v=y.head=E.parentNode;d.onError=function(a){throw a;};d.load=function(a,c,l){d.resourcesReady(!1);a.scriptCount+=1;d.attach(l,a,c);if(a.jQuery&&!a.jQueryIncremented)V(a.jQuery,!0),
a.jQueryIncremented=!0};define=function(a,c,d){var j,k;typeof a!=="string"&&(d=c,c=a,a=null);G(c)||(d=c,c=[]);!c.length&&K(d)&&d.length&&(d.toString().replace(la,"").replace(ma,function(a,d){c.push(d)}),c=(d.length===1?["require"]:["require","exports","module"]).concat(c));if(Q&&(j=J||ka()))a||(a=j.getAttribute("data-requiremodule")),k=D[j.getAttribute("data-requirecontext")];(k?k.defQueue:U).push([a,c,d]);return r};define.amd={multiversion:!0,plugins:!0,jQuery:!0};d.exec=function(a){return eval(a)};
d.execCb=function(a,c,d,j){return c.apply(j,d)};d.addScriptToDom=function(a){J=a;E?v.insertBefore(a,E):v.appendChild(a);J=null};d.onScriptLoad=function(a){var c=a.currentTarget||a.srcElement,l;if(a.type==="load"||c&&na.test(c.readyState))C=null,a=c.getAttribute("data-requirecontext"),l=c.getAttribute("data-requiremodule"),D[a].completeLoad(l),c.detachEvent&&!ea?c.detachEvent("onreadystatechange",d.onScriptLoad):c.removeEventListener("load",d.onScriptLoad,!1)};d.attach=function(a,c,l,j,k,o){var p;
if(I)return j=j||d.onScriptLoad,p=c&&c.config&&c.config.xhtml?document.createElementNS("http://www.w3.org/1999/xhtml","html:script"):document.createElement("script"),p.type=k||c&&c.config.scriptType||"text/javascript",p.charset="utf-8",p.async=!y.skipAsync[a],c&&p.setAttribute("data-requirecontext",c.contextName),p.setAttribute("data-requiremodule",l),p.attachEvent&&!(p.attachEvent.toString&&p.attachEvent.toString().indexOf("[native code]")<0)&&!ea?(Q=!0,o?p.onreadystatechange=function(){if(p.readyState===
"loaded")p.onreadystatechange=null,p.attachEvent("onreadystatechange",j),o(p)}:p.attachEvent("onreadystatechange",j)):p.addEventListener("load",j,!1),p.src=a,o||d.addScriptToDom(p),p;else da&&(importScripts(a),c.completeLoad(l));return null};if(I){o=document.getElementsByTagName("script");for(B=o.length-1;B>-1&&(w=o[B]);B--){if(!v)v=w.parentNode;if(F=w.getAttribute("data-main")){if(!u.baseUrl)o=F.split("/"),w=o.pop(),o=o.length?o.join("/")+"/":"./",u.baseUrl=o,F=w.replace(ba,"");u.deps=u.deps?u.deps.concat(F):
[F];break}}}d.checkReadyState=function(){var a=y.contexts,c;for(c in a)if(!(c in L)&&a[c].waitCount)return;d.resourcesReady(!0)};d.resourcesReady=function(a){var c,l;d.resourcesDone=a;if(d.resourcesDone)for(l in a=y.contexts,a)if(!(l in L)&&(c=a[l],c.jQueryIncremented))V(c.jQuery,!1),c.jQueryIncremented=!1};d.pageLoaded=function(){if(document.readyState!=="complete")document.readyState="complete"};if(I&&document.addEventListener&&!document.readyState)document.readyState="loading",window.addEventListener("load",
d.pageLoaded,!1);d(u);if(d.isAsync&&typeof setTimeout!=="undefined")z=y.contexts[u.context||"_"],z.requireWait=!0,setTimeout(function(){z.requireWait=!1;z.scriptCount||z.resume();d.checkReadyState()},0)}})();

(function(window) {

var ORIGIN_ = location.protocol + '//' + location.host;

function SlideController() {
  this.popup = null;
  this.isPopup = window.opener;

  if (this.setupDone()) {
    window.addEventListener('message', this.onMessage_.bind(this), false);

    // Close popups if we reload the main window.
    window.addEventListener('beforeunload', function(e) {
      if (this.popup) {
        this.popup.close();
      }
    }.bind(this), false);
  }
}

SlideController.PRESENTER_MODE_PARAM = 'presentme';

SlideController.prototype.setupDone = function() {
  var params = location.search.substring(1).split('&').map(function(el) {
    return el.split('=');
  });

  var presentMe = null;
  for (var i = 0, param; param = params[i]; ++i) {
    if (param[0].toLowerCase() == SlideController.PRESENTER_MODE_PARAM) {
      presentMe = param[1] == 'true';
      break;
    }
  }

  if (presentMe !== null) {
    localStorage.ENABLE_PRESENTOR_MODE = presentMe;
    // TODO: use window.history.pushState to update URL instead of the redirect.
    if (window.history.replaceState) {
      window.history.replaceState({}, '', location.pathname);
    } else {
      location.replace(location.pathname);
      return false;
    }
  }

  var enablePresenterMode = localStorage.getItem('ENABLE_PRESENTOR_MODE');
  if (enablePresenterMode && JSON.parse(enablePresenterMode)) {
    // Only open popup from main deck. Don't want recursive popup opening!
    if (!this.isPopup) {
      var opts = 'menubar=no,location=yes,resizable=yes,scrollbars=no,status=no';
      this.popup = window.open(location.href, 'mywindow', opts);

      // Loading in the popup? Trigger the hotkey for turning presenter mode on.
      this.popup.addEventListener('load', function(e) {
        var evt = this.popup.document.createEvent('Event');
        evt.initEvent('keydown', true, true);
        evt.keyCode = 'P'.charCodeAt(0);
        this.popup.document.dispatchEvent(evt);
        // this.popup.document.body.classList.add('with-notes');
        // document.body.classList.add('popup');
      }.bind(this), false);
    }
  }

  return true;
}

SlideController.prototype.onMessage_ = function(e) {
  var data = e.data;

  // Restrict messages to being from this origin. Allow local developmet
  // from file:// though.
  // TODO: It would be dope if FF implemented location.origin!
  if (e.origin != ORIGIN_ && ORIGIN_.indexOf('file://') != 0) {
    alert('Someone tried to postMessage from an unknown origin');
    return;
  }

  // if (e.source.location.hostname != 'localhost') {
  //   alert('Someone tried to postMessage from an unknown origin');
  //   return;
  // }

  if ('keyCode' in data) {
    var evt = document.createEvent('Event');
    evt.initEvent('keydown', true, true);
    evt.keyCode = data.keyCode;
    document.dispatchEvent(evt);
  }
};

SlideController.prototype.sendMsg = function(msg) {
  // // Send message to popup window.
  // if (this.popup) {
  //   this.popup.postMessage(msg, ORIGIN_);
  // }

  // Send message to main window.
  if (this.isPopup) {
    // TODO: It would be dope if FF implemented location.origin.
    window.opener.postMessage(msg, '*');
  }
};

window.SlideController = SlideController;

})(window);


/**
 * @authors Luke Mahe
 * @authors Eric Bidelman
 * @fileoverview TODO
 */
document.cancelFullScreen = document.webkitCancelFullScreen ||
                            document.mozCancelFullScreen;

/**
 * @constructor
 */
function SlideDeck(el) {
  this.curSlide_ = 0;
  this.prevSlide_ = 0;
  this.config_ = null;
  this.container = el || document.querySelector('slides');
  this.slides = [];
  this.controller = null;

  this.getCurrentSlideFromHash_();

  // Call this explicitly. Modernizr.load won't be done until after DOM load.
  this.onDomLoaded_.bind(this)();
}

/**
 * @const
 * @private
 */
SlideDeck.prototype.SLIDE_CLASSES_ = [
  'far-past', 'past', 'current', 'next', 'far-next'];

/**
 * @const
 * @private
 */
SlideDeck.prototype.CSS_DIR_ = 'theme/css/';

/**
 * @private
 */
SlideDeck.prototype.getCurrentSlideFromHash_ = function() {
  var slideNo = parseInt(document.location.hash.substr(1));

  if (slideNo) {
    this.curSlide_ = slideNo - 1;
  } else {
    this.curSlide_ = 0;
  }
};

/**
 * @param {number} slideNo
 */
SlideDeck.prototype.loadSlide = function(slideNo) {
  if (slideNo) {
    this.curSlide_ = slideNo - 1;
    this.updateSlides_();
  }
};

/**
 * @private
 */
SlideDeck.prototype.onDomLoaded_ = function(e) {
  document.body.classList.add('loaded'); // Add loaded class for templates to use.

  this.slides = this.container.querySelectorAll('slide:not([hidden]):not(.hidden):not(.backdrop)');

  // If we're on a smartphone, apply special sauce.
  if (Modernizr.mq('only screen and (max-device-width: 480px)')) {
    // var style = document.createElement('link');
    // style.rel = 'stylesheet';
    // style.type = 'text/css';
    // style.href = this.CSS_DIR_ + 'phone.css';
    // document.querySelector('head').appendChild(style);

    // No need for widescreen layout on a phone.
    this.container.classList.remove('layout-widescreen');
  }

  this.loadConfig_(SLIDE_CONFIG);
  this.addEventListeners_();
  this.updateSlides_();

  // Add slide numbers and total slide count metadata to each slide.
  var that = this;
  for (var i = 0, slide; slide = this.slides[i]; ++i) {
    slide.dataset.slideNum = i + 1;
    slide.dataset.totalSlides = this.slides.length;

    slide.addEventListener('click', function(e) {
      if (document.body.classList.contains('overview')) {
        that.loadSlide(this.dataset.slideNum);
        e.preventDefault();
        window.setTimeout(function() {
          that.toggleOverview();
        }, 500);
      }
    }, false);
  }

  // Note: this needs to come after addEventListeners_(), which adds a
  // 'keydown' listener that this controller relies on.

  // Modernizr.touch isn't a sufficient check for devices that support both
  // touch and mouse. Create the controller in all cases.
  // // Also, no need to set this up if we're on mobile.
  // if (!Modernizr.touch) {
    this.controller = new SlideController(this);
    if (this.controller.isPopup) {
      document.body.classList.add('popup');
    }
  //}
};

/**
 * @private
 */
SlideDeck.prototype.addEventListeners_ = function() {
  document.addEventListener('keydown', this.onBodyKeyDown_.bind(this), false);
  window.addEventListener('popstate', this.onPopState_.bind(this), false);

  // var transEndEventNames = {
  //   'WebkitTransition': 'webkitTransitionEnd',
  //   'MozTransition': 'transitionend',
  //   'OTransition': 'oTransitionEnd',
  //   'msTransition': 'MSTransitionEnd',
  //   'transition': 'transitionend'
  // };
  // 
  // // Find the correct transitionEnd vendor prefix.
  // window.transEndEventName = transEndEventNames[
  //     Modernizr.prefixed('transition')];
  // 
  // // When slides are done transitioning, kickoff loading iframes.
  // // Note: we're only looking at a single transition (on the slide). This
  // // doesn't include autobuilds the slides may have. Also, if the slide
  // // transitions on multiple properties (e.g. not just 'all'), this doesn't
  // // handle that case.
  // this.container.addEventListener(transEndEventName, function(e) {
  //     this.enableSlideFrames_(this.curSlide_);
  // }.bind(this), false);

  // document.addEventListener('slideenter', function(e) {
  //   var slide = e.target;
  //   window.setTimeout(function() {
  //     this.enableSlideFrames_(e.slideNumber);
  //     this.enableSlideFrames_(e.slideNumber + 1);
  //   }.bind(this), 300);
  // }.bind(this), false);
};

/**
 * @private
 * @param {Event} e The pop event.
 */
SlideDeck.prototype.onPopState_ = function(e) {
  if (e.state != null) {
    this.curSlide_ = e.state;
    this.updateSlides_(true);
  }
};

/**
 * @param {Event} e
 */
SlideDeck.prototype.onBodyKeyDown_ = function(e) {
  if (/^(input|textarea)$/i.test(e.target.nodeName) ||
      e.target.isContentEditable) {
    return;
  }

  // Forward keydowns to the main slides if we're the popup.
  if (this.controller && this.controller.isPopup) {
    this.controller.sendMsg({keyCode: e.keyCode});
  }

  switch (e.keyCode) {
    case 13: // Enter
      if (document.body.classList.contains('overview')) {
        this.toggleOverview();
      }
      break;

    case 39: // right arrow
    case 32: // space
    case 34: // PgDn
      this.nextSlide();
      e.preventDefault();
      break;

    case 37: // left arrow
    case 8: // Backspace
    case 33: // PgUp
      this.prevSlide();
      e.preventDefault();
      break;

    case 40: // down arrow
      this.nextSlide();
      e.preventDefault();
      break;

    case 38: // up arrow
      this.prevSlide();
      e.preventDefault();
      break;

    case 72: // H: Toggle code highlighting
      document.body.classList.toggle('highlight-code');
      break;

    case 79: // O: Toggle overview
      this.toggleOverview();
      break;

    case 80: // P
      if (this.controller && this.controller.isPopup) {
        document.body.classList.toggle('with-notes');
      } else if (this.controller && !this.controller.popup) {
        document.body.classList.toggle('with-notes');
      }
      break;

    case 82: // R
      // TODO: implement refresh on main slides when popup is refreshed.
      break;

    case 27: // ESC: Hide notes and highlighting
      document.body.classList.remove('with-notes');
      document.body.classList.remove('highlight-code');

      if (document.body.classList.contains('overview')) {
        this.toggleOverview();
      }
      break;

    case 70: // F: Toggle fullscreen
       // Only respect 'f' on body. Don't want to capture keys from an <input>.
       // Also, ignore browser's fullscreen shortcut (cmd+shift+f) so we don't
       // get trapped in fullscreen!
      if (e.target == document.body && !(e.shiftKey && e.metaKey)) {
        if (document.mozFullScreen !== undefined && !document.mozFullScreen) {
          document.body.mozRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        } else if (document.webkitIsFullScreen !== undefined && !document.webkitIsFullScreen) {
          document.body.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        } else {
          document.cancelFullScreen();
        }
      }
      break;

    case 87: // W: Toggle widescreen
      // Only respect 'w' on body. Don't want to capture keys from an <input>.
      if (e.target == document.body && !(e.shiftKey && e.metaKey)) {
        this.container.classList.toggle('layout-widescreen');
      }
      break;
  }
};

/**
 *
 */
SlideDeck.prototype.focusOverview_ = function() {
  var overview = document.body.classList.contains('overview');

  for (var i = 0, slide; slide = this.slides[i]; i++) {
    slide.style[Modernizr.prefixed('transform')] = overview ?
        'translateZ(-2500px) translate(' + (( i - this.curSlide_ ) * 105) +
                                       '%, 0%)' : '';
  }
};

/**
 */
SlideDeck.prototype.toggleOverview = function() {
  document.body.classList.toggle('overview');

  this.focusOverview_();
};

/**
 * @private
 */
SlideDeck.prototype.loadConfig_ = function(config) {
  if (!config) {
    return;
  }

  this.config_ = config;

  var settings = this.config_.settings;

  this.loadTheme_(settings.theme || []);

  if (settings.favIcon) {
    this.addFavIcon_(settings.favIcon);
  }

  // Prettyprint. Default to on.
  if (!!!('usePrettify' in settings) || settings.usePrettify) {
    prettyPrint();
  }

  if (settings.analytics) {
    this.loadAnalytics_();
  }

  if (settings.fonts) {
    this.addFonts_(settings.fonts);
  }

  // Builds. Default to on.
  if (!!!('useBuilds' in settings) || settings.useBuilds) {
    this.makeBuildLists_();
  }

  if (settings.title) {
    document.title = settings.title.replace(/<br\/?>/, ' ');
    if (settings.eventInfo && settings.eventInfo.title) {
      document.title +=  ' - ' + settings.eventInfo.title;
    }
    document.querySelector('[data-config-title]').innerHTML = settings.title;
  }

  if (settings.subtitle) {
    document.querySelector('[data-config-subtitle]').innerHTML = settings.subtitle;
  }

  if (this.config_.presenters) {
    var presenters = this.config_.presenters;
    var dataConfigContact = document.querySelector('[data-config-contact]');

    var html = [];
    if (presenters.length == 1) {
      var p = presenters[0];

      var presenterTitle = [p.name];
      if (p.company) {
        presenterTitle.push(p.company);
      }
      html = presenterTitle.join(' - ') + '<br>';

      var gplus = p.gplus ? '<span>g+</span><a href="' + p.gplus +
          '">' + p.gplus.replace(/https?:\/\//, '') + '</a>' : '';

      var twitter = p.twitter ? '<span>twitter</span>' +
          '<a href="http://twitter.com/' + p.twitter + '">' +
          p.twitter + '</a>' : '';

      var www = p.www ? '<span>www</span><a href="' + p.www +
                        '">' + p.www.replace(/https?:\/\//, '') + '</a>' : '';

      var github = p.github ? '<span>github</span><a href="' + p.github +
          '">' + p.github.replace(/https?:\/\//, '') + '</a>' : '';

      var html2 = [gplus, twitter, www, github].join('<br>');

      if (dataConfigContact) {
        dataConfigContact.innerHTML = html2;
      }
    } else {
      for (var i = 0, p; p = presenters[i]; ++i) {
        html.push(p.name + ' - ' + p.company);
      }
      html = html.join('<br>');
      if (dataConfigContact) {
        dataConfigContact.innerHTML = html;
      }
    }

    var dataConfigPresenter = document.querySelector('[data-config-presenter]');
    if (dataConfigPresenter) {
      dataConfigPresenter.innerHTML = html;
      if (settings.eventInfo) {
        var date = settings.eventInfo.date;
        var dateInfo = date ? ' - <time>' + date + '</time>' : '';
        dataConfigPresenter.innerHTML += settings.eventInfo.title + dateInfo;
      }
    }
  }

  /* Left/Right tap areas. Default to including. */
  if (!!!('enableSlideAreas' in settings) || settings.enableSlideAreas) {
    var el = document.createElement('div');
    el.classList.add('slide-area');
    el.id = 'prev-slide-area';
    el.addEventListener('click', this.prevSlide.bind(this), false);
    this.container.appendChild(el);

    var el = document.createElement('div');
    el.classList.add('slide-area');
    el.id = 'next-slide-area';
    el.addEventListener('click', this.nextSlide.bind(this), false);
    this.container.appendChild(el);
  }

  if (Modernizr.touch && (!!!('enableTouch' in settings) ||
      settings.enableTouch)) {
    var self = this;

    // Note: this prevents mobile zoom in/out but prevents iOS from doing
    // it's crazy scroll over effect and disaligning the slides.
    window.addEventListener('touchstart', function(e) {
      e.preventDefault();
    }, false);

    var hammer = new Hammer(this.container);
    hammer.ondragend = function(e) {
      if (e.direction == 'right' || e.direction == 'down') {
        self.prevSlide();
      } else if (e.direction == 'left' || e.direction == 'up') {
        self.nextSlide();
      }
    };
  }
};

/**
 * @private
 * @param {Array.<string>} fonts
 */
SlideDeck.prototype.addFonts_ = function(fonts) {
  var el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = ('https:' == document.location.protocol ? 'https' : 'http') +
      '://fonts.googleapis.com/css?family=' + fonts.join('|') + '&v2';
  document.querySelector('head').appendChild(el);
};

/**
 * @private
 */
SlideDeck.prototype.buildNextItem_ = function() {
  var slide = this.slides[this.curSlide_];
  var toBuild = slide.querySelector('.to-build');
  var built = slide.querySelector('.build-current');

  if (built) {
    built.classList.remove('build-current');
    if (built.classList.contains('fade')) {
      built.classList.add('build-fade');
    }
  }

  if (!toBuild) {
    var items = slide.querySelectorAll('.build-fade');
    for (var j = 0, item; item = items[j]; j++) {
      item.classList.remove('build-fade');
    }
    return false;
  }

  toBuild.classList.remove('to-build');
  toBuild.classList.add('build-current');

  return true;
};

/**
 * @param {boolean=} opt_dontPush
 */
SlideDeck.prototype.prevSlide = function(opt_dontPush) {
  if (this.curSlide_ > 0) {
    var bodyClassList = document.body.classList;
    bodyClassList.remove('highlight-code');

    // Toggle off speaker notes if they're showing when we move backwards on the
    // main slides. If we're the speaker notes popup, leave them up.
    if (this.controller && !this.controller.isPopup) {
      bodyClassList.remove('with-notes');
    } else if (!this.controller) {
      bodyClassList.remove('with-notes');
    }

    this.prevSlide_ = this.curSlide_--;

    this.updateSlides_(opt_dontPush);
  }
};

/**
 * @param {boolean=} opt_dontPush
 */
SlideDeck.prototype.nextSlide = function(opt_dontPush) {
  if (!document.body.classList.contains('overview') && this.buildNextItem_()) {
    return;
  }

  if (this.curSlide_ < this.slides.length - 1) {
    var bodyClassList = document.body.classList;
    bodyClassList.remove('highlight-code');

    // Toggle off speaker notes if they're showing when we advanced on the main
    // slides. If we're the speaker notes popup, leave them up.
    if (this.controller && !this.controller.isPopup) {
      bodyClassList.remove('with-notes');
    } else if (!this.controller) {
      bodyClassList.remove('with-notes');
    }

    this.prevSlide_ = this.curSlide_++;

    this.updateSlides_(opt_dontPush);
  }
};

/* Slide events */

/**
 * Triggered when a slide enter/leave event should be dispatched.
 *
 * @param {string} type The type of event to trigger
 *     (e.g. 'slideenter', 'slideleave').
 * @param {number} slideNo The index of the slide that is being left.
 */
SlideDeck.prototype.triggerSlideEvent = function(type, slideNo) {
  var el = this.getSlideEl_(slideNo);
  if (!el) {
    return;
  }

  // Call onslideenter/onslideleave if the attribute is defined on this slide.
  var func = el.getAttribute(type);
  if (func) {
    new Function(func).call(el); // TODO: Don't use new Function() :(
  }

  // Dispatch event to listeners setup using addEventListener.
  var evt = document.createEvent('Event');
  evt.initEvent(type, true, true);
  evt.slideNumber = slideNo + 1; // Make it readable
  evt.slide = el;

  el.dispatchEvent(evt);
};

/**
 * @private
 */
SlideDeck.prototype.updateSlides_ = function(opt_dontPush) {
  var dontPush = opt_dontPush || false;

  var curSlide = this.curSlide_;
  for (var i = 0; i < this.slides.length; ++i) {
    switch (i) {
      case curSlide - 2:
        this.updateSlideClass_(i, 'far-past');
        break;
      case curSlide - 1:
        this.updateSlideClass_(i, 'past');
        break;
      case curSlide:
        this.updateSlideClass_(i, 'current');
        break;
      case curSlide + 1:
        this.updateSlideClass_(i, 'next');
        break;
      case curSlide + 2:
        this.updateSlideClass_(i, 'far-next');
        break;
      default:
        this.updateSlideClass_(i);
        break;
    }
  };

  this.triggerSlideEvent('slideleave', this.prevSlide_);
  this.triggerSlideEvent('slideenter', curSlide);

// window.setTimeout(this.disableSlideFrames_.bind(this, curSlide - 2), 301);
// 
// this.enableSlideFrames_(curSlide - 1); // Previous slide.
// this.enableSlideFrames_(curSlide + 1); // Current slide.
// this.enableSlideFrames_(curSlide + 2); // Next slide.

   // Enable current slide's iframes (needed for page loat at current slide).
   this.enableSlideFrames_(curSlide + 1);

   // No way to tell when all slide transitions + auto builds are done.
   // Give ourselves a good buffer to preload the next slide's iframes.
   window.setTimeout(this.enableSlideFrames_.bind(this, curSlide + 2), 1000);

  this.updateHash_(dontPush);

  if (document.body.classList.contains('overview')) {
    this.focusOverview_();
    return;
  }

};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.enableSlideFrames_ = function(slideNo) {
  var el = this.slides[slideNo - 1];
  if (!el) {
    return;
  }

  var frames = el.querySelectorAll('iframe');
  for (var i = 0, frame; frame = frames[i]; i++) {
    this.enableFrame_(frame);
  }
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.enableFrame_ = function(frame) {
  var src = frame.dataset.src;
  if (src && frame.src != src) {
    frame.src = src;
  }
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.disableSlideFrames_ = function(slideNo) {
  var el = this.slides[slideNo - 1];
  if (!el) {
    return;
  }

  var frames = el.querySelectorAll('iframe');
  for (var i = 0, frame; frame = frames[i]; i++) {
    this.disableFrame_(frame);
  }
};

/**
 * @private
 * @param {Node} frame
 */
SlideDeck.prototype.disableFrame_ = function(frame) {
  frame.src = 'about:blank';
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.getSlideEl_ = function(no) {
  if ((no < 0) || (no >= this.slides.length)) {
    return null;
  } else {
    return this.slides[no];
  }
};

/**
 * @private
 * @param {number} slideNo
 * @param {string} className
 */
SlideDeck.prototype.updateSlideClass_ = function(slideNo, className) {
  var el = this.getSlideEl_(slideNo);

  if (!el) {
    return;
  }

  if (className) {
    el.classList.add(className);
  }

  for (var i = 0, slideClass; slideClass = this.SLIDE_CLASSES_[i]; ++i) {
    if (className != slideClass) {
      el.classList.remove(slideClass);
    }
  }
};

/**
 * @private
 */
SlideDeck.prototype.makeBuildLists_ = function () {
  for (var i = this.curSlide_, slide; slide = this.slides[i]; ++i) {
    var items = slide.querySelectorAll('.build > *');
    for (var j = 0, item; item = items[j]; ++j) {
      if (item.classList) {
        item.classList.add('to-build');
        if (item.parentNode.classList.contains('fade')) {
          item.classList.add('fade');
        }
      }
    }
  }
};

/**
 * @private
 * @param {boolean} dontPush
 */
SlideDeck.prototype.updateHash_ = function(dontPush) {
  if (!dontPush) {
    var slideNo = this.curSlide_ + 1;
    var hash = '#' + slideNo;
    if (window.history.pushState) {
      window.history.pushState(this.curSlide_, 'Slide ' + slideNo, hash);
    } else {
      window.location.replace(hash);
    }

    // Record GA hit on this slide.
    window['_gaq'] && window['_gaq'].push(['_trackPageview',
                                          document.location.href]);
  }
};


/**
 * @private
 * @param {string} favIcon
 */
SlideDeck.prototype.addFavIcon_ = function(favIcon) {
  var el = document.createElement('link');
  el.rel = 'icon';
  el.type = 'image/png';
  el.href = favIcon;
  document.querySelector('head').appendChild(el);
};

/**
 * @private
 * @param {string} theme
 */
SlideDeck.prototype.loadTheme_ = function(theme) {
  var styles = [];
  if (theme.constructor.name === 'String') {
    styles.push(theme);
  } else {
    styles = theme;
  }

  for (var i = 0, style; themeUrl = styles[i]; i++) {
    var style = document.createElement('link');
    style.rel = 'stylesheet';
    style.type = 'text/css';
    if (themeUrl.indexOf('http') == -1) {
      style.href = this.CSS_DIR_ + themeUrl + '.css';
    } else {
      style.href = themeUrl;
    }
    document.querySelector('head').appendChild(style);
  }
};

/**
 * @private
 */
SlideDeck.prototype.loadAnalytics_ = function() {
  var _gaq = window['_gaq'] || [];
  _gaq.push(['_setAccount', this.config_.settings.analytics]);
  _gaq.push(['_trackPageview']);

  (function() {
    var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
    ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
  })();
};


// Polyfill missing APIs (if we need to), then create the slide deck.
// iOS < 5 needs classList, dataset, and window.matchMedia. Modernizr contains
// the last one.
(function() {
  Modernizr.load({
    test: !!document.body.classList && !!document.body.dataset,
    nope: ['js/polyfills/classList.min.js', 'js/polyfills/dataset.min.js'],
    complete: function() {
      window.slidedeck = new SlideDeck();
    }
  });
})();

require(['order!../slide_config', 'order!modernizr.custom.45394',
         'order!prettify/prettify', 'order!hammer', 'order!slide-controller',
         'order!slide-deck'], function(someModule) {

});

/* @source http://purl.eligrey.com/github/classList.js/blob/master/classList.js*/
"use strict";if(typeof document!=="undefined"&&!("classList" in document.createElement("a"))){(function(a){var f="classList",d="prototype",e=(a.HTMLElement||a.Element)[d],g=Object;strTrim=String[d].trim||function(){return this.replace(/^\s+|\s+$/g,"")},arrIndexOf=Array[d].indexOf||function(k){for(var j=0,h=this.length;j<h;j++){if(j in this&&this[j]===k){return j}}return -1},DOMEx=function(h,i){this.name=h;this.code=DOMException[h];this.message=i},checkTokenAndGetIndex=function(i,h){if(h===""){throw new DOMEx("SYNTAX_ERR","An invalid or illegal string was specified")}if(/\s/.test(h)){throw new DOMEx("INVALID_CHARACTER_ERR","String contains an invalid character")}return arrIndexOf.call(i,h)},ClassList=function(m){var l=strTrim.call(m.className),k=l?l.split(/\s+/):[];for(var j=0,h=k.length;j<h;j++){this.push(k[j])}this._updateClassName=function(){m.className=this.toString()}},classListProto=ClassList[d]=[],classListGetter=function(){return new ClassList(this)};DOMEx[d]=Error[d];classListProto.item=function(h){return this[h]||null};classListProto.contains=function(h){h+="";return checkTokenAndGetIndex(this,h)!==-1};classListProto.add=function(h){h+="";if(checkTokenAndGetIndex(this,h)===-1){this.push(h);this._updateClassName()}};classListProto.remove=function(i){i+="";var h=checkTokenAndGetIndex(this,i);if(h!==-1){this.splice(h,1);this._updateClassName()}};classListProto.toggle=function(h){h+="";if(checkTokenAndGetIndex(this,h)===-1){this.add(h)}else{this.remove(h)}};classListProto.toString=function(){return this.join(" ")};if(g.defineProperty){var c={get:classListGetter,enumerable:true,configurable:true};try{g.defineProperty(e,f,c)}catch(b){if(b.number===-2146823252){c.enumerable=false;g.defineProperty(e,f,c)}}}else{if(g[d].__defineGetter__){e.__defineGetter__(f,classListGetter)}}}(self))};
(function(){function c(){d=!0;this.removeEventListener("DOMAttrModified",c,!1)}function g(b){return b.replace(h,function(b,a){return a.toUpperCase()})}function e(){var b={};i.call(this.attributes,function(a){if(f=a.name.match(j))b[g(f[1])]=a.value});return b}var i=[].forEach,j=/^data-(.+)/,h=/\-([a-z])/ig,a=document.createElement("div"),d=!1,f;a.dataset==void 0&&(a.addEventListener("DOMAttrModified",c,!1),a.setAttribute("foo","bar"),Element.prototype.__defineGetter__("dataset",d?function(){if(!this._datasetCache)this._datasetCache=
e.call(this);return this._datasetCache}:e),document.addEventListener("DOMAttrModified",function(a){delete a.target._datasetCache},!1))})();
(function(a,b){"use strict";var c=a.console||b,d=a.document,e=a.navigator,f=a.sessionStorage||!1,g=a.setTimeout,h=a.clearTimeout,i=a.setInterval,j=a.clearInterval,k=a.JSON,l=a.alert,m=a.History=a.History||{},n=a.history;k.stringify=k.stringify||k.encode,k.parse=k.parse||k.decode;if(typeof m.init!="undefined")throw new Error("History.js Core has already been loaded...");m.init=function(){return typeof m.Adapter=="undefined"?!1:(typeof m.initCore!="undefined"&&m.initCore(),typeof m.initHtml4!="undefined"&&m.initHtml4(),!0)},m.initCore=function(){if(typeof m.initCore.initialized!="undefined")return!1;m.initCore.initialized=!0,m.options=m.options||{},m.options.hashChangeInterval=m.options.hashChangeInterval||100,m.options.safariPollInterval=m.options.safariPollInterval||500,m.options.doubleCheckInterval=m.options.doubleCheckInterval||500,m.options.storeInterval=m.options.storeInterval||1e3,m.options.busyDelay=m.options.busyDelay||250,m.options.debug=m.options.debug||!1,m.options.initialTitle=m.options.initialTitle||d.title,m.intervalList=[],m.clearAllIntervals=function(){var a,b=m.intervalList;if(typeof b!="undefined"&&b!==null){for(a=0;a<b.length;a++)j(b[a]);m.intervalList=null}},m.debug=function(){(m.options.debug||!1)&&m.log.apply(m,arguments)},m.log=function(){var a=typeof c!="undefined"&&typeof c.log!="undefined"&&typeof c.log.apply!="undefined",b=d.getElementById("log"),e,f,g,h,i;a?(h=Array.prototype.slice.call(arguments),e=h.shift(),typeof c.debug!="undefined"?c.debug.apply(c,[e,h]):c.log.apply(c,[e,h])):e="\n"+arguments[0]+"\n";for(f=1,g=arguments.length;f<g;++f){i=arguments[f];if(typeof i=="object"&&typeof k!="undefined")try{i=k.stringify(i)}catch(j){}e+="\n"+i+"\n"}return b?(b.value+=e+"\n-----\n",b.scrollTop=b.scrollHeight-b.clientHeight):a||l(e),!0},m.getInternetExplorerMajorVersion=function(){var a=m.getInternetExplorerMajorVersion.cached=typeof m.getInternetExplorerMajorVersion.cached!="undefined"?m.getInternetExplorerMajorVersion.cached:function(){var a=3,b=d.createElement("div"),c=b.getElementsByTagName("i");while((b.innerHTML="<!--[if gt IE "+ ++a+"]><i></i><![endif]-->")&&c[0]);return a>4?a:!1}();return a},m.isInternetExplorer=function(){var a=m.isInternetExplorer.cached=typeof m.isInternetExplorer.cached!="undefined"?m.isInternetExplorer.cached:Boolean(m.getInternetExplorerMajorVersion());return a},m.emulated={pushState:!Boolean(a.history&&a.history.pushState&&a.history.replaceState&&!/ Mobile\/([1-7][a-z]|(8([abcde]|f(1[0-8]))))/i.test(e.userAgent)&&!/AppleWebKit\/5([0-2]|3[0-2])/i.test(e.userAgent)),hashChange:Boolean(!("onhashchange"in a||"onhashchange"in d)||m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<8)},m.enabled=!m.emulated.pushState,m.bugs={setHash:Boolean(!m.emulated.pushState&&e.vendor==="Apple Computer, Inc."&&/AppleWebKit\/5([0-2]|3[0-3])/.test(e.userAgent)),safariPoll:Boolean(!m.emulated.pushState&&e.vendor==="Apple Computer, Inc."&&/AppleWebKit\/5([0-2]|3[0-3])/.test(e.userAgent)),ieDoubleCheck:Boolean(m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<8),hashEscape:Boolean(m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<7)},m.isEmptyObject=function(a){for(var b in a)return!1;return!0},m.cloneObject=function(a){var b,c;return a?(b=k.stringify(a),c=k.parse(b)):c={},c},m.getRootUrl=function(){var a=d.location.protocol+"//"+(d.location.hostname||d.location.host);if(d.location.port||!1)a+=":"+d.location.port;return a+="/",a},m.getBaseHref=function(){var a=d.getElementsByTagName("base"),b=null,c="";return a.length===1&&(b=a[0],c=b.href.replace(/[^\/]+$/,"")),c=c.replace(/\/+$/,""),c&&(c+="/"),c},m.getBaseUrl=function(){var a=m.getBaseHref()||m.getBasePageUrl()||m.getRootUrl();return a},m.getPageUrl=function(){var a=m.getState(!1,!1),b=(a||{}).url||d.location.href,c;return c=b.replace(/\/+$/,"").replace(/[^\/]+$/,function(a,b,c){return/\./.test(a)?a:a+"/"}),c},m.getBasePageUrl=function(){var a=d.location.href.replace(/[#\?].*/,"").replace(/[^\/]+$/,function(a,b,c){return/[^\/]$/.test(a)?"":a}).replace(/\/+$/,"")+"/";return a},m.getFullUrl=function(a,b){var c=a,d=a.substring(0,1);return b=typeof b=="undefined"?!0:b,/[a-z]+\:\/\//.test(a)||(d==="/"?c=m.getRootUrl()+a.replace(/^\/+/,""):d==="#"?c=m.getPageUrl().replace(/#.*/,"")+a:d==="?"?c=m.getPageUrl().replace(/[\?#].*/,"")+a:b?c=m.getBaseUrl()+a.replace(/^(\.\/)+/,""):c=m.getBasePageUrl()+a.replace(/^(\.\/)+/,"")),c.replace(/\#$/,"")},m.getShortUrl=function(a){var b=a,c=m.getBaseUrl(),d=m.getRootUrl();return m.emulated.pushState&&(b=b.replace(c,"")),b=b.replace(d,"/"),m.isTraditionalAnchor(b)&&(b="./"+b),b=b.replace(/^(\.\/)+/g,"./").replace(/\#$/,""),b},m.store={},m.idToState=m.idToState||{},m.stateToId=m.stateToId||{},m.urlToId=m.urlToId||{},m.storedStates=m.storedStates||[],m.savedStates=m.savedStates||[],m.normalizeStore=function(){m.store.idToState=m.store.idToState||{},m.store.urlToId=m.store.urlToId||{},m.store.stateToId=m.store.stateToId||{}},m.getState=function(a,b){typeof a=="undefined"&&(a=!0),typeof b=="undefined"&&(b=!0);var c=m.getLastSavedState();return!c&&b&&(c=m.createStateObject()),a&&(c=m.cloneObject(c),c.url=c.cleanUrl||c.url),c},m.getIdByState=function(a){var b=m.extractId(a.url),c;if(!b){c=m.getStateString(a);if(typeof m.stateToId[c]!="undefined")b=m.stateToId[c];else if(typeof m.store.stateToId[c]!="undefined")b=m.store.stateToId[c];else{for(;;){b=(new Date).getTime()+String(Math.random()).replace(/\D/g,"");if(typeof m.idToState[b]=="undefined"&&typeof m.store.idToState[b]=="undefined")break}m.stateToId[c]=b,m.idToState[b]=a}}return b},m.normalizeState=function(a){var b,c;if(!a||typeof a!="object")a={};if(typeof a.normalized!="undefined")return a;if(!a.data||typeof a.data!="object")a.data={};b={},b.normalized=!0,b.title=a.title||"",b.url=m.getFullUrl(m.unescapeString(a.url||d.location.href)),b.hash=m.getShortUrl(b.url),b.data=m.cloneObject(a.data),b.id=m.getIdByState(b),b.cleanUrl=b.url.replace(/\??\&_suid.*/,""),b.url=b.cleanUrl,c=!m.isEmptyObject(b.data);if(b.title||c)b.hash=m.getShortUrl(b.url).replace(/\??\&_suid.*/,""),/\?/.test(b.hash)||(b.hash+="?"),b.hash+="&_suid="+b.id;return b.hashedUrl=m.getFullUrl(b.hash),(m.emulated.pushState||m.bugs.safariPoll)&&m.hasUrlDuplicate(b)&&(b.url=b.hashedUrl),b},m.createStateObject=function(a,b,c){var d={data:a,title:b,url:c};return d=m.normalizeState(d),d},m.getStateById=function(a){a=String(a);var c=m.idToState[a]||m.store.idToState[a]||b;return c},m.getStateString=function(a){var b,c,d;return b=m.normalizeState(a),c={data:b.data,title:a.title,url:a.url},d=k.stringify(c),d},m.getStateId=function(a){var b,c;return b=m.normalizeState(a),c=b.id,c},m.getHashByState=function(a){var b,c;return b=m.normalizeState(a),c=b.hash,c},m.extractId=function(a){var b,c,d;return c=/(.*)\&_suid=([0-9]+)$/.exec(a),d=c?c[1]||a:a,b=c?String(c[2]||""):"",b||!1},m.isTraditionalAnchor=function(a){var b=!/[\/\?\.]/.test(a);return b},m.extractState=function(a,b){var c=null,d,e;return b=b||!1,d=m.extractId(a),d&&(c=m.getStateById(d)),c||(e=m.getFullUrl(a),d=m.getIdByUrl(e)||!1,d&&(c=m.getStateById(d)),!c&&b&&!m.isTraditionalAnchor(a)&&(c=m.createStateObject(null,null,e))),c},m.getIdByUrl=function(a){var c=m.urlToId[a]||m.store.urlToId[a]||b;return c},m.getLastSavedState=function(){return m.savedStates[m.savedStates.length-1]||b},m.getLastStoredState=function(){return m.storedStates[m.storedStates.length-1]||b},m.hasUrlDuplicate=function(a){var b=!1,c;return c=m.extractState(a.url),b=c&&c.id!==a.id,b},m.storeState=function(a){return m.urlToId[a.url]=a.id,m.storedStates.push(m.cloneObject(a)),a},m.isLastSavedState=function(a){var b=!1,c,d,e;return m.savedStates.length&&(c=a.id,d=m.getLastSavedState(),e=d.id,b=c===e),b},m.saveState=function(a){return m.isLastSavedState(a)?!1:(m.savedStates.push(m.cloneObject(a)),!0)},m.getStateByIndex=function(a){var b=null;return typeof a=="undefined"?b=m.savedStates[m.savedStates.length-1]:a<0?b=m.savedStates[m.savedStates.length+a]:b=m.savedStates[a],b},m.getHash=function(){var a=m.unescapeHash(d.location.hash);return a},m.unescapeString=function(b){var c=b,d;for(;;){d=a.unescape(c);if(d===c)break;c=d}return c},m.unescapeHash=function(a){var b=m.normalizeHash(a);return b=m.unescapeString(b),b},m.normalizeHash=function(a){var b=a.replace(/[^#]*#/,"").replace(/#.*/,"");return b},m.setHash=function(a,b){var c,e,f;return b!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.setHash,args:arguments,queue:b}),!1):(c=m.escapeHash(a),m.busy(!0),e=m.extractState(a,!0),e&&!m.emulated.pushState?m.pushState(e.data,e.title,e.url,!1):d.location.hash!==c&&(m.bugs.setHash?(f=m.getPageUrl(),m.pushState(null,null,f+"#"+c,!1)):d.location.hash=c),m)},m.escapeHash=function(b){var c=m.normalizeHash(b);return c=a.escape(c),m.bugs.hashEscape||(c=c.replace(/\%21/g,"!").replace(/\%26/g,"&").replace(/\%3D/g,"=").replace(/\%3F/g,"?")),c},m.getHashByUrl=function(a){var b=String(a).replace(/([^#]*)#?([^#]*)#?(.*)/,"$2");return b=m.unescapeHash(b),b},m.setTitle=function(a){var b=a.title,c;b||(c=m.getStateByIndex(0),c&&c.url===a.url&&(b=c.title||m.options.initialTitle));try{d.getElementsByTagName("title")[0].innerHTML=b.replace("<","&lt;").replace(">","&gt;").replace(" & "," &amp; ")}catch(e){}return d.title=b,m},m.queues=[],m.busy=function(a){typeof a!="undefined"?m.busy.flag=a:typeof m.busy.flag=="undefined"&&(m.busy.flag=!1);if(!m.busy.flag){h(m.busy.timeout);var b=function(){var a,c,d;if(m.busy.flag)return;for(a=m.queues.length-1;a>=0;--a){c=m.queues[a];if(c.length===0)continue;d=c.shift(),m.fireQueueItem(d),m.busy.timeout=g(b,m.options.busyDelay)}};m.busy.timeout=g(b,m.options.busyDelay)}return m.busy.flag},m.busy.flag=!1,m.fireQueueItem=function(a){return a.callback.apply(a.scope||m,a.args||[])},m.pushQueue=function(a){return m.queues[a.queue||0]=m.queues[a.queue||0]||[],m.queues[a.queue||0].push(a),m},m.queue=function(a,b){return typeof a=="function"&&(a={callback:a}),typeof b!="undefined"&&(a.queue=b),m.busy()?m.pushQueue(a):m.fireQueueItem(a),m},m.clearQueue=function(){return m.busy.flag=!1,m.queues=[],m},m.stateChanged=!1,m.doubleChecker=!1,m.doubleCheckComplete=function(){return m.stateChanged=!0,m.doubleCheckClear(),m},m.doubleCheckClear=function(){return m.doubleChecker&&(h(m.doubleChecker),m.doubleChecker=!1),m},m.doubleCheck=function(a){return m.stateChanged=!1,m.doubleCheckClear(),m.bugs.ieDoubleCheck&&(m.doubleChecker=g(function(){return m.doubleCheckClear(),m.stateChanged||a(),!0},m.options.doubleCheckInterval)),m},m.safariStatePoll=function(){var b=m.extractState(d.location.href),c;if(!m.isLastSavedState(b))c=b;else return;return c||(c=m.createStateObject()),m.Adapter.trigger(a,"popstate"),m},m.back=function(a){return a!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.back,args:arguments,queue:a}),!1):(m.busy(!0),m.doubleCheck(function(){m.back(!1)}),n.go(-1),!0)},m.forward=function(a){return a!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.forward,args:arguments,queue:a}),!1):(m.busy(!0),m.doubleCheck(function(){m.forward(!1)}),n.go(1),!0)},m.go=function(a,b){var c;if(a>0)for(c=1;c<=a;++c)m.forward(b);else{if(!(a<0))throw new Error("History.go: History.go requires a positive or negative integer passed.");for(c=-1;c>=a;--c)m.back(b)}return m};if(m.emulated.pushState){var o=function(){};m.pushState=m.pushState||o,m.replaceState=m.replaceState||o}else m.onPopState=function(b,c){var e=!1,f=!1,g,h;return m.doubleCheckComplete(),g=m.getHash(),g?(h=m.extractState(g||d.location.href,!0),h?m.replaceState(h.data,h.title,h.url,!1):(m.Adapter.trigger(a,"anchorchange"),m.busy(!1)),m.expectedStateId=!1,!1):(e=m.Adapter.extractEventData("state",b,c)||!1,e?f=m.getStateById(e):m.expectedStateId?f=m.getStateById(m.expectedStateId):f=m.extractState(d.location.href),f||(f=m.createStateObject(null,null,d.location.href)),m.expectedStateId=!1,m.isLastSavedState(f)?(m.busy(!1),!1):(m.storeState(f),m.saveState(f),m.setTitle(f),m.Adapter.trigger(a,"statechange"),m.busy(!1),!0))},m.Adapter.bind(a,"popstate",m.onPopState),m.pushState=function(b,c,d,e){if(m.getHashByUrl(d)&&m.emulated.pushState)throw new Error("History.js does not support states with fragement-identifiers (hashes/anchors).");if(e!==!1&&m.busy())return m.pushQueue({scope:m,callback:m.pushState,args:arguments,queue:e}),!1;m.busy(!0);var f=m.createStateObject(b,c,d);return m.isLastSavedState(f)?m.busy(!1):(m.storeState(f),m.expectedStateId=f.id,n.pushState(f.id,f.title,f.url),m.Adapter.trigger(a,"popstate")),!0},m.replaceState=function(b,c,d,e){if(m.getHashByUrl(d)&&m.emulated.pushState)throw new Error("History.js does not support states with fragement-identifiers (hashes/anchors).");if(e!==!1&&m.busy())return m.pushQueue({scope:m,callback:m.replaceState,args:arguments,queue:e}),!1;m.busy(!0);var f=m.createStateObject(b,c,d);return m.isLastSavedState(f)?m.busy(!1):(m.storeState(f),m.expectedStateId=f.id,n.replaceState(f.id,f.title,f.url),m.Adapter.trigger(a,"popstate")),!0};if(f){try{m.store=k.parse(f.getItem("History.store"))||{}}catch(p){m.store={}}m.normalizeStore()}else m.store={},m.normalizeStore();m.Adapter.bind(a,"beforeunload",m.clearAllIntervals),m.Adapter.bind(a,"unload",m.clearAllIntervals),m.saveState(m.storeState(m.extractState(d.location.href,!0))),f&&(m.onUnload=function(){var a,b;try{a=k.parse(f.getItem("History.store"))||{}}catch(c){a={}}a.idToState=a.idToState||{},a.urlToId=a.urlToId||{},a.stateToId=a.stateToId||{};for(b in m.idToState){if(!m.idToState.hasOwnProperty(b))continue;a.idToState[b]=m.idToState[b]}for(b in m.urlToId){if(!m.urlToId.hasOwnProperty(b))continue;a.urlToId[b]=m.urlToId[b]}for(b in m.stateToId){if(!m.stateToId.hasOwnProperty(b))continue;a.stateToId[b]=m.stateToId[b]}m.store=a,m.normalizeStore(),f.setItem("History.store",k.stringify(a))},m.intervalList.push(i(m.onUnload,m.options.storeInterval)),m.Adapter.bind(a,"beforeunload",m.onUnload),m.Adapter.bind(a,"unload",m.onUnload));if(!m.emulated.pushState){m.bugs.safariPoll&&m.intervalList.push(i(m.safariStatePoll,m.options.safariPollInterval));if(e.vendor==="Apple Computer, Inc."||(e.appCodeName||"")==="Mozilla")m.Adapter.bind(a,"hashchange",function(){m.Adapter.trigger(a,"popstate")}),m.getHash()&&m.Adapter.onDomLoad(function(){m.Adapter.trigger(a,"hashchange")})}},m.init()})(window)
PR.registerLangHandler(PR.createSimpleLexer([["com",/^#[^\n\r]*/,null,"#"],["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,null,'"']],[["kwd",/^(?:ADS|AD|AUG|BZF|BZMF|CAE|CAF|CA|CCS|COM|CS|DAS|DCA|DCOM|DCS|DDOUBL|DIM|DOUBLE|DTCB|DTCF|DV|DXCH|EDRUPT|EXTEND|INCR|INDEX|NDX|INHINT|LXCH|MASK|MSK|MP|MSU|NOOP|OVSK|QXCH|RAND|READ|RELINT|RESUME|RETURN|ROR|RXOR|SQUARE|SU|TCR|TCAA|OVSK|TCF|TC|TS|WAND|WOR|WRITE|XCH|XLQ|XXALQ|ZL|ZQ|ADD|ADZ|SUB|SUZ|MPY|MPR|MPZ|DVP|COM|ABS|CLA|CLZ|LDQ|STO|STQ|ALS|LLS|LRS|TRA|TSQ|TMI|TOV|AXT|TIX|DLY|INP|OUT)\s/,
null],["typ",/^(?:-?GENADR|=MINUS|2BCADR|VN|BOF|MM|-?2CADR|-?[1-6]DNADR|ADRES|BBCON|[ES]?BANK=?|BLOCK|BNKSUM|E?CADR|COUNT\*?|2?DEC\*?|-?DNCHAN|-?DNPTR|EQUALS|ERASE|MEMORY|2?OCT|REMADR|SETLOC|SUBRO|ORG|BSS|BES|SYN|EQU|DEFINE|END)\s/,null],["lit",/^'(?:-*(?:\w|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?)?/],["pln",/^-*(?:[!-z]|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?/],["pun",/^[^\w\t\n\r "'-);\\\xa0]+/]]),["apollo","agc","aea"]);

/*
 Copyright (C) 2011 Google Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/
var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["opn",/^[([{]+/,a,"([{"],["clo",/^[)\]}]+/,a,")]}"],["com",/^;[^\n\r]*/,a,";"],["pln",/^[\t\n\r \xa0]+/,a,"\t\n\r \xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,a,'"']],[["kwd",/^(?:def|if|do|let|quote|var|fn|loop|recur|throw|try|monitor-enter|monitor-exit|defmacro|defn|defn-|macroexpand|macroexpand-1|for|doseq|dosync|dotimes|and|or|when|not|assert|doto|proxy|defstruct|first|rest|cons|defprotocol|deftype|defrecord|reify|defmulti|defmethod|meta|with-meta|ns|in-ns|create-ns|import|intern|refer|alias|namespace|resolve|ref|deref|refset|new|set!|memfn|to-array|into-array|aset|gen-class|reduce|map|filter|find|nil?|empty?|hash-map|hash-set|vec|vector|seq|flatten|reverse|assoc|dissoc|list|list?|disj|get|union|difference|intersection|extend|extend-type|extend-protocol|prn)\b/,a],
["typ",/^:[\dA-Za-z-]+/]]),["clj"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\f\r ]+/,null," \t\r\n"]],[["str",/^"(?:[^\n\f\r"\\]|\\(?:\r\n?|\n|\f)|\\[\S\s])*"/,null],["str",/^'(?:[^\n\f\r'\\]|\\(?:\r\n?|\n|\f)|\\[\S\s])*'/,null],["lang-css-str",/^url\(([^"')]*)\)/i],["kwd",/^(?:url|rgb|!important|@import|@page|@media|@charset|inherit)(?=[^\w-]|$)/i,null],["lang-css-kw",/^(-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*)\s*:/i],["com",/^\/\*[^*]*\*+(?:[^*/][^*]*\*+)*\//],["com",
/^(?:<\!--|--\>)/],["lit",/^(?:\d+|\d*\.\d+)(?:%|[a-z]+)?/i],["lit",/^#[\da-f]{3,6}/i],["pln",/^-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*/i],["pun",/^[^\s\w"']+/]]),["css"]);PR.registerLangHandler(PR.createSimpleLexer([],[["kwd",/^-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*/i]]),["css-kw"]);PR.registerLangHandler(PR.createSimpleLexer([],[["str",/^[^"')]+/]]),["css-str"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["pln",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])+(?:'|$)|`[^`]*(?:`|$))/,null,"\"'"]],[["com",/^(?:\/\/[^\n\r]*|\/\*[\S\s]*?\*\/)/],["pln",/^(?:[^"'/`]|\/(?![*/]))+/]]),["go"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t-\r ]+/,null,"\t\n\r "],["str",/^"(?:[^\n\f\r"\\]|\\[\S\s])*(?:"|$)/,null,'"'],["str",/^'(?:[^\n\f\r'\\]|\\[^&])'?/,null,"'"],["lit",/^(?:0o[0-7]+|0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i,null,"0123456789"]],[["com",/^(?:--+[^\n\f\r]*|{-(?:[^-]|-+[^}-])*-})/],["kwd",/^(?:case|class|data|default|deriving|do|else|if|import|in|infix|infixl|infixr|instance|let|module|newtype|of|then|type|where|_)(?=[^\d'A-Za-z]|$)/,
null],["pln",/^(?:[A-Z][\w']*\.)*[A-Za-z][\w']*/],["pun",/^[^\d\t-\r "'A-Za-z]+/]]),["hs"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["opn",/^\(+/,a,"("],["clo",/^\)+/,a,")"],["com",/^;[^\n\r]*/,a,";"],["pln",/^[\t\n\r \xa0]+/,a,"\t\n\r \xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,a,'"']],[["kwd",/^(?:block|c[ad]+r|catch|con[ds]|def(?:ine|un)|do|eq|eql|equal|equalp|eval-when|flet|format|go|if|labels|lambda|let|load-time-value|locally|macrolet|multiple-value-call|nil|progn|progv|quote|require|return-from|setq|symbol-macrolet|t|tagbody|the|throw|unwind)\b/,a],
["lit",/^[+-]?(?:[#0]x[\da-f]+|\d+\/\d+|(?:\.\d+|\d+(?:\.\d*)?)(?:[de][+-]?\d+)?)/i],["lit",/^'(?:-*(?:\w|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?)?/],["pln",/^-*(?:[_a-z]|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?/i],["pun",/^[^\w\t\n\r "'-);\\\xa0]+/]]),["cl","el","lisp","scm"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])*(?:'|$))/,null,"\"'"]],[["com",/^--(?:\[(=*)\[[\S\s]*?(?:]\1]|$)|[^\n\r]*)/],["str",/^\[(=*)\[[\S\s]*?(?:]\1]|$)/],["kwd",/^(?:and|break|do|else|elseif|end|false|for|function|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b/,null],["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],
["pln",/^[_a-z]\w*/i],["pun",/^[^\w\t\n\r \xa0][^\w\t\n\r "'+=\xa0-]*/]]),["lua"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["com",/^#(?:if[\t\n\r \xa0]+(?:[$_a-z][\w']*|``[^\t\n\r`]*(?:``|$))|else|endif|light)/i,null,"#"],["str",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])(?:'|$))/,null,"\"'"]],[["com",/^(?:\/\/[^\n\r]*|\(\*[\S\s]*?\*\))/],["kwd",/^(?:abstract|and|as|assert|begin|class|default|delegate|do|done|downcast|downto|elif|else|end|exception|extern|false|finally|for|fun|function|if|in|inherit|inline|interface|internal|lazy|let|match|member|module|mutable|namespace|new|null|of|open|or|override|private|public|rec|return|static|struct|then|to|true|try|type|upcast|use|val|void|when|while|with|yield|asr|land|lor|lsl|lsr|lxor|mod|sig|atomic|break|checked|component|const|constraint|constructor|continue|eager|event|external|fixed|functor|global|include|method|mixin|object|parallel|process|protected|pure|sealed|trait|virtual|volatile)\b/],
["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],["pln",/^(?:[_a-z][\w']*[!#?]?|``[^\t\n\r`]*(?:``|$))/i],["pun",/^[^\w\t\n\r "'\xa0]+/]]),["fs","ml"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["str",/^(?:'(?:[^\n\r'\\]|\\.)*'|"(?:[^\n\r"\\]|\\.)*(?:"|$))/,a,'"'],["com",/^#(?:(?:define|elif|else|endif|error|ifdef|include|ifndef|line|pragma|undef|warning)\b|[^\n\r]*)/,a,"#"],["pln",/^\s+/,a," \r\n\t\xa0"]],[["str",/^@"(?:[^"]|"")*(?:"|$)/,a],["str",/^<#[^#>]*(?:#>|$)/,a],["str",/^<(?:(?:(?:\.\.\/)*|\/?)(?:[\w-]+(?:\/[\w-]+)+)?[\w-]+\.h|[a-z]\w*)>/,a],["com",/^\/\/[^\n\r]*/,a],["com",/^\/\*[\S\s]*?(?:\*\/|$)/,
a],["kwd",/^(?:abstract|and|as|base|catch|class|def|delegate|enum|event|extern|false|finally|fun|implements|interface|internal|is|macro|match|matches|module|mutable|namespace|new|null|out|override|params|partial|private|protected|public|ref|sealed|static|struct|syntax|this|throw|true|try|type|typeof|using|variant|virtual|volatile|when|where|with|assert|assert2|async|break|checked|continue|do|else|ensures|for|foreach|if|late|lock|new|nolate|otherwise|regexp|repeat|requires|return|surroundwith|unchecked|unless|using|while|yield)\b/,
a],["typ",/^(?:array|bool|byte|char|decimal|double|float|int|list|long|object|sbyte|short|string|ulong|uint|ufloat|ulong|ushort|void)\b/,a],["lit",/^@[$_a-z][\w$@]*/i,a],["typ",/^@[A-Z]+[a-z][\w$@]*/,a],["pln",/^'?[$_a-z][\w$@]*/i,a],["lit",/^(?:0x[\da-f]+|(?:\d(?:_\d+)*\d*(?:\.\d*)?|\.\d\+)(?:e[+-]?\d+)?)[a-z]*/i,a,"0123456789"],["pun",/^.[^\s\w"-$'./@`]*/,a]]),["n","nemerle"]);

PR.registerLangHandler(PR.sourceDecorator({keywords:"bytes,default,double,enum,extend,extensions,false,group,import,max,message,option,optional,package,repeated,required,returns,rpc,service,syntax,to,true",types:/^(bool|(double|s?fixed|[su]?int)(32|64)|float|string)\b/,cStyleComments:!0}),["proto"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^"(?:""(?:""?(?!")|[^"\\]|\\.)*"{0,3}|(?:[^\n\r"\\]|\\.)*"?)/,null,'"'],["lit",/^`(?:[^\n\r\\`]|\\.)*`?/,null,"`"],["pun",/^[!#%&(--:-@[-^{-~]+/,null,"!#%&()*+,-:;<=>?@[\\]^{|}~"]],[["str",/^'(?:[^\n\r'\\]|\\(?:'|[^\n\r']+))'/],["lit",/^'[$A-Z_a-z][\w$]*(?![\w$'])/],["kwd",/^(?:abstract|case|catch|class|def|do|else|extends|final|finally|for|forSome|if|implicit|import|lazy|match|new|object|override|package|private|protected|requires|return|sealed|super|throw|trait|try|type|val|var|while|with|yield)\b/],
["lit",/^(?:true|false|null|this)\b/],["lit",/^(?:0(?:[0-7]+|x[\da-f]+)l?|(?:0|[1-9]\d*)(?:(?:\.\d+)?(?:e[+-]?\d+)?f?|l?)|\\.\d+(?:e[+-]?\d+)?f?)/i],["typ",/^[$_]*[A-Z][\d$A-Z_]*[a-z][\w$]*/],["pln",/^[$A-Z_a-z][\w$]*/],["com",/^\/(?:\/.*|\*(?:\/|\**[^*/])*(?:\*+\/?)?)/],["pun",/^(?:\.+|\/)/]]),["scala"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,null,"\"'"]],[["com",/^(?:--[^\n\r]*|\/\*[\S\s]*?(?:\*\/|$))/],["kwd",/^(?:add|all|alter|and|any|as|asc|authorization|backup|begin|between|break|browse|bulk|by|cascade|case|check|checkpoint|close|clustered|coalesce|collate|column|commit|compute|constraint|contains|containstable|continue|convert|create|cross|current|current_date|current_time|current_timestamp|current_user|cursor|database|dbcc|deallocate|declare|default|delete|deny|desc|disk|distinct|distributed|double|drop|dummy|dump|else|end|errlvl|escape|except|exec|execute|exists|exit|fetch|file|fillfactor|for|foreign|freetext|freetexttable|from|full|function|goto|grant|group|having|holdlock|identity|identitycol|identity_insert|if|in|index|inner|insert|intersect|into|is|join|key|kill|left|like|lineno|load|match|merge|national|nocheck|nonclustered|not|null|nullif|of|off|offsets|on|open|opendatasource|openquery|openrowset|openxml|option|or|order|outer|over|percent|plan|precision|primary|print|proc|procedure|public|raiserror|read|readtext|reconfigure|references|replication|restore|restrict|return|revoke|right|rollback|rowcount|rowguidcol|rule|save|schema|select|session_user|set|setuser|shutdown|some|statistics|system_user|table|textsize|then|to|top|tran|transaction|trigger|truncate|tsequal|union|unique|update|updatetext|use|user|using|values|varying|view|waitfor|when|where|while|with|writetext)(?=[^\w-]|$)/i,
null],["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],["pln",/^[_a-z][\w-]*/i],["pun",/^[^\w\t\n\r "'\xa0][^\w\t\n\r "'+\xa0-]*/]]),["sql"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["com",/^%[^\n\r]*/,null,"%"]],[["kwd",/^\\[@-Za-z]+/],["kwd",/^\\./],["typ",/^[$&]/],["lit",/[+-]?(?:\.\d+|\d+(?:\.\d*)?)(cm|em|ex|in|pc|pt|bp|mm)/i],["pun",/^[()=[\]{}]+/]]),["latex","tex"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0\u2028\u2029]+/,null,"\t\n\r ¬\xa0‚Ä®‚Ä©"],["str",/^(?:["\u201c\u201d](?:[^"\u201c\u201d]|["\u201c\u201d]{2})(?:["\u201c\u201d]c|$)|["\u201c\u201d](?:[^"\u201c\u201d]|["\u201c\u201d]{2})*(?:["\u201c\u201d]|$))/i,null,'"‚Äú‚Äù'],["com",/^['\u2018\u2019].*/,null,"'‚Äò‚Äô"]],[["kwd",/^(?:addhandler|addressof|alias|and|andalso|ansi|as|assembly|auto|boolean|byref|byte|byval|call|case|catch|cbool|cbyte|cchar|cdate|cdbl|cdec|char|cint|class|clng|cobj|const|cshort|csng|cstr|ctype|date|decimal|declare|default|delegate|dim|directcast|do|double|each|else|elseif|end|endif|enum|erase|error|event|exit|finally|for|friend|function|get|gettype|gosub|goto|handles|if|implements|imports|in|inherits|integer|interface|is|let|lib|like|long|loop|me|mod|module|mustinherit|mustoverride|mybase|myclass|namespace|new|next|not|notinheritable|notoverridable|object|on|option|optional|or|orelse|overloads|overridable|overrides|paramarray|preserve|private|property|protected|public|raiseevent|readonly|redim|removehandler|resume|return|select|set|shadows|shared|short|single|static|step|stop|string|structure|sub|synclock|then|throw|to|try|typeof|unicode|until|variant|wend|when|while|with|withevents|writeonly|xor|endif|gosub|let|variant|wend)\b/i,
null],["com",/^rem.*/i],["lit",/^(?:true\b|false\b|nothing\b|\d+(?:e[+-]?\d+[dfr]?|[dfilrs])?|(?:&h[\da-f]+|&o[0-7]+)[ils]?|\d*\.\d+(?:e[+-]?\d+)?[dfr]?|#\s+(?:\d+[/-]\d+[/-]\d+(?:\s+\d+:\d+(?::\d+)?(\s*(?:am|pm))?)?|\d+:\d+(?::\d+)?(\s*(?:am|pm))?)\s+#)/i],["pln",/^(?:(?:[a-z]|_\w)\w*|\[(?:[a-z]|_\w)\w*])/i],["pun",/^[^\w\t\n\r "'[\]\xa0\u2018\u2019\u201c\u201d\u2028\u2029]+/],["pun",/^(?:\[|])/]]),["vb","vbs"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"]],[["str",/^(?:[box]?"(?:[^"]|"")*"|'.')/i],["com",/^--[^\n\r]*/],["kwd",/^(?:abs|access|after|alias|all|and|architecture|array|assert|attribute|begin|block|body|buffer|bus|case|component|configuration|constant|disconnect|downto|else|elsif|end|entity|exit|file|for|function|generate|generic|group|guarded|if|impure|in|inertial|inout|is|label|library|linkage|literal|loop|map|mod|nand|new|next|nor|not|null|of|on|open|or|others|out|package|port|postponed|procedure|process|pure|range|record|register|reject|rem|report|return|rol|ror|select|severity|shared|signal|sla|sll|sra|srl|subtype|then|to|transport|type|unaffected|units|until|use|variable|wait|when|while|with|xnor|xor)(?=[^\w-]|$)/i,
null],["typ",/^(?:bit|bit_vector|character|boolean|integer|real|time|string|severity_level|positive|natural|signed|unsigned|line|text|std_u?logic(?:_vector)?)(?=[^\w-]|$)/i,null],["typ",/^'(?:active|ascending|base|delayed|driving|driving_value|event|high|image|instance_name|last_active|last_event|last_value|left|leftof|length|low|path_name|pos|pred|quiet|range|reverse_range|right|rightof|simple_name|stable|succ|transaction|val|value)(?=[^\w-]|$)/i,null],["lit",/^\d+(?:_\d+)*(?:#[\w.\\]+#(?:[+-]?\d+(?:_\d+)*)?|(?:\.\d+(?:_\d+)*)?(?:e[+-]?\d+(?:_\d+)*)?)/i],
["pln",/^(?:[a-z]\w*|\\[^\\]*\\)/i],["pun",/^[^\w\t\n\r "'\xa0][^\w\t\n\r "'\xa0-]*/]]),["vhdl","vhd"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\d\t a-gi-z\xa0]+/,null,"\t ¬\xa0abcdefgijklmnopqrstuvwxyz0123456789"],["pun",/^[*=[\]^~]+/,null,"=*~^[]"]],[["lang-wiki.meta",/(?:^^|\r\n?|\n)(#[a-z]+)\b/],["lit",/^[A-Z][a-z][\da-z]+[A-Z][a-z][^\W_]+\b/],["lang-",/^{{{([\S\s]+?)}}}/],["lang-",/^`([^\n\r`]+)`/],["str",/^https?:\/\/[^\s#/?]*(?:\/[^\s#?]*)?(?:\?[^\s#]*)?(?:#\S*)?/i],["pln",/^(?:\r\n|[\S\s])[^\n\r#*=A-[^`h{~]*/]]),["wiki"]);
PR.registerLangHandler(PR.createSimpleLexer([["kwd",/^#[a-z]+/i,null,"#"]],[]),["wiki.meta"]);

PR.registerLangHandler(PR.createSimpleLexer([["var pln",/^\$[\w-]+/,null,"$"]],[["pln",/^[\s=][<>][\s=]/],["lit",/^@[\w-]+/],["tag",/^<\/?[a-z](?:[\w-.:]*\w)?|\/?>$/i],["com",/^\(:[\S\s]*?:\)/],["pln",/^[(),/;[\]{}]$/],["str",/^(?:"(?:[^"\\{]|\\[\S\s])*(?:"|$)|'(?:[^'\\{]|\\[\S\s])*(?:'|$))/,null,"\"'"],["kwd",/^(?:xquery|where|version|variable|union|typeswitch|treat|to|then|text|stable|sortby|some|self|schema|satisfies|returns|return|ref|processing-instruction|preceding-sibling|preceding|precedes|parent|only|of|node|namespace|module|let|item|intersect|instance|in|import|if|function|for|follows|following-sibling|following|external|except|every|else|element|descending|descendant-or-self|descendant|define|default|declare|comment|child|cast|case|before|attribute|assert|ascending|as|ancestor-or-self|ancestor|after|eq|order|by|or|and|schema-element|document-node|node|at)\b/],
["typ",/^(?:xs:yearMonthDuration|xs:unsignedLong|xs:time|xs:string|xs:short|xs:QName|xs:Name|xs:long|xs:integer|xs:int|xs:gYearMonth|xs:gYear|xs:gMonthDay|xs:gDay|xs:float|xs:duration|xs:double|xs:decimal|xs:dayTimeDuration|xs:dateTime|xs:date|xs:byte|xs:boolean|xs:anyURI|xf:yearMonthDuration)\b/,null],["fun pln",/^(?:xp:dereference|xinc:node-expand|xinc:link-references|xinc:link-expand|xhtml:restructure|xhtml:clean|xhtml:add-lists|xdmp:zip-manifest|xdmp:zip-get|xdmp:zip-create|xdmp:xquery-version|xdmp:word-convert|xdmp:with-namespaces|xdmp:version|xdmp:value|xdmp:user-roles|xdmp:user-last-login|xdmp:user|xdmp:url-encode|xdmp:url-decode|xdmp:uri-is-file|xdmp:uri-format|xdmp:uri-content-type|xdmp:unquote|xdmp:unpath|xdmp:triggers-database|xdmp:trace|xdmp:to-json|xdmp:tidy|xdmp:subbinary|xdmp:strftime|xdmp:spawn-in|xdmp:spawn|xdmp:sleep|xdmp:shutdown|xdmp:set-session-field|xdmp:set-response-encoding|xdmp:set-response-content-type|xdmp:set-response-code|xdmp:set-request-time-limit|xdmp:set|xdmp:servers|xdmp:server-status|xdmp:server-name|xdmp:server|xdmp:security-database|xdmp:security-assert|xdmp:schema-database|xdmp:save|xdmp:role-roles|xdmp:role|xdmp:rethrow|xdmp:restart|xdmp:request-timestamp|xdmp:request-status|xdmp:request-cancel|xdmp:request|xdmp:redirect-response|xdmp:random|xdmp:quote|xdmp:query-trace|xdmp:query-meters|xdmp:product-edition|xdmp:privilege-roles|xdmp:privilege|xdmp:pretty-print|xdmp:powerpoint-convert|xdmp:platform|xdmp:permission|xdmp:pdf-convert|xdmp:path|xdmp:octal-to-integer|xdmp:node-uri|xdmp:node-replace|xdmp:node-kind|xdmp:node-insert-child|xdmp:node-insert-before|xdmp:node-insert-after|xdmp:node-delete|xdmp:node-database|xdmp:mul64|xdmp:modules-root|xdmp:modules-database|xdmp:merging|xdmp:merge-cancel|xdmp:merge|xdmp:md5|xdmp:logout|xdmp:login|xdmp:log-level|xdmp:log|xdmp:lock-release|xdmp:lock-acquire|xdmp:load|xdmp:invoke-in|xdmp:invoke|xdmp:integer-to-octal|xdmp:integer-to-hex|xdmp:http-put|xdmp:http-post|xdmp:http-options|xdmp:http-head|xdmp:http-get|xdmp:http-delete|xdmp:hosts|xdmp:host-status|xdmp:host-name|xdmp:host|xdmp:hex-to-integer|xdmp:hash64|xdmp:hash32|xdmp:has-privilege|xdmp:groups|xdmp:group-serves|xdmp:group-servers|xdmp:group-name|xdmp:group-hosts|xdmp:group|xdmp:get-session-field-names|xdmp:get-session-field|xdmp:get-response-encoding|xdmp:get-response-code|xdmp:get-request-username|xdmp:get-request-user|xdmp:get-request-url|xdmp:get-request-protocol|xdmp:get-request-path|xdmp:get-request-method|xdmp:get-request-header-names|xdmp:get-request-header|xdmp:get-request-field-names|xdmp:get-request-field-filename|xdmp:get-request-field-content-type|xdmp:get-request-field|xdmp:get-request-client-certificate|xdmp:get-request-client-address|xdmp:get-request-body|xdmp:get-current-user|xdmp:get-current-roles|xdmp:get|xdmp:function-name|xdmp:function-module|xdmp:function|xdmp:from-json|xdmp:forests|xdmp:forest-status|xdmp:forest-restore|xdmp:forest-restart|xdmp:forest-name|xdmp:forest-delete|xdmp:forest-databases|xdmp:forest-counts|xdmp:forest-clear|xdmp:forest-backup|xdmp:forest|xdmp:filesystem-file|xdmp:filesystem-directory|xdmp:exists|xdmp:excel-convert|xdmp:eval-in|xdmp:eval|xdmp:estimate|xdmp:email|xdmp:element-content-type|xdmp:elapsed-time|xdmp:document-set-quality|xdmp:document-set-property|xdmp:document-set-properties|xdmp:document-set-permissions|xdmp:document-set-collections|xdmp:document-remove-properties|xdmp:document-remove-permissions|xdmp:document-remove-collections|xdmp:document-properties|xdmp:document-locks|xdmp:document-load|xdmp:document-insert|xdmp:document-get-quality|xdmp:document-get-properties|xdmp:document-get-permissions|xdmp:document-get-collections|xdmp:document-get|xdmp:document-forest|xdmp:document-delete|xdmp:document-add-properties|xdmp:document-add-permissions|xdmp:document-add-collections|xdmp:directory-properties|xdmp:directory-locks|xdmp:directory-delete|xdmp:directory-create|xdmp:directory|xdmp:diacritic-less|xdmp:describe|xdmp:default-permissions|xdmp:default-collections|xdmp:databases|xdmp:database-restore-validate|xdmp:database-restore-status|xdmp:database-restore-cancel|xdmp:database-restore|xdmp:database-name|xdmp:database-forests|xdmp:database-backup-validate|xdmp:database-backup-status|xdmp:database-backup-purge|xdmp:database-backup-cancel|xdmp:database-backup|xdmp:database|xdmp:collection-properties|xdmp:collection-locks|xdmp:collection-delete|xdmp:collation-canonical-uri|xdmp:castable-as|xdmp:can-grant-roles|xdmp:base64-encode|xdmp:base64-decode|xdmp:architecture|xdmp:apply|xdmp:amp-roles|xdmp:amp|xdmp:add64|xdmp:add-response-header|xdmp:access|trgr:trigger-set-recursive|trgr:trigger-set-permissions|trgr:trigger-set-name|trgr:trigger-set-module|trgr:trigger-set-event|trgr:trigger-set-description|trgr:trigger-remove-permissions|trgr:trigger-module|trgr:trigger-get-permissions|trgr:trigger-enable|trgr:trigger-disable|trgr:trigger-database-online-event|trgr:trigger-data-event|trgr:trigger-add-permissions|trgr:remove-trigger|trgr:property-content|trgr:pre-commit|trgr:post-commit|trgr:get-trigger-by-id|trgr:get-trigger|trgr:document-scope|trgr:document-content|trgr:directory-scope|trgr:create-trigger|trgr:collection-scope|trgr:any-property-content|thsr:set-entry|thsr:remove-term|thsr:remove-synonym|thsr:remove-entry|thsr:query-lookup|thsr:lookup|thsr:load|thsr:insert|thsr:expand|thsr:add-synonym|spell:suggest-detailed|spell:suggest|spell:remove-word|spell:make-dictionary|spell:load|spell:levenshtein-distance|spell:is-correct|spell:insert|spell:double-metaphone|spell:add-word|sec:users-collection|sec:user-set-roles|sec:user-set-password|sec:user-set-name|sec:user-set-description|sec:user-set-default-permissions|sec:user-set-default-collections|sec:user-remove-roles|sec:user-privileges|sec:user-get-roles|sec:user-get-description|sec:user-get-default-permissions|sec:user-get-default-collections|sec:user-doc-permissions|sec:user-doc-collections|sec:user-add-roles|sec:unprotect-collection|sec:uid-for-name|sec:set-realm|sec:security-version|sec:security-namespace|sec:security-installed|sec:security-collection|sec:roles-collection|sec:role-set-roles|sec:role-set-name|sec:role-set-description|sec:role-set-default-permissions|sec:role-set-default-collections|sec:role-remove-roles|sec:role-privileges|sec:role-get-roles|sec:role-get-description|sec:role-get-default-permissions|sec:role-get-default-collections|sec:role-doc-permissions|sec:role-doc-collections|sec:role-add-roles|sec:remove-user|sec:remove-role-from-users|sec:remove-role-from-role|sec:remove-role-from-privileges|sec:remove-role-from-amps|sec:remove-role|sec:remove-privilege|sec:remove-amp|sec:protect-collection|sec:privileges-collection|sec:privilege-set-roles|sec:privilege-set-name|sec:privilege-remove-roles|sec:privilege-get-roles|sec:privilege-add-roles|sec:priv-doc-permissions|sec:priv-doc-collections|sec:get-user-names|sec:get-unique-elem-id|sec:get-role-names|sec:get-role-ids|sec:get-privilege|sec:get-distinct-permissions|sec:get-collection|sec:get-amp|sec:create-user-with-role|sec:create-user|sec:create-role|sec:create-privilege|sec:create-amp|sec:collections-collection|sec:collection-set-permissions|sec:collection-remove-permissions|sec:collection-get-permissions|sec:collection-add-permissions|sec:check-admin|sec:amps-collection|sec:amp-set-roles|sec:amp-remove-roles|sec:amp-get-roles|sec:amp-doc-permissions|sec:amp-doc-collections|sec:amp-add-roles|search:unparse|search:suggest|search:snippet|search:search|search:resolve-nodes|search:resolve|search:remove-constraint|search:parse|search:get-default-options|search:estimate|search:check-options|prof:value|prof:reset|prof:report|prof:invoke|prof:eval|prof:enable|prof:disable|prof:allowed|ppt:clean|pki:template-set-request|pki:template-set-name|pki:template-set-key-type|pki:template-set-key-options|pki:template-set-description|pki:template-in-use|pki:template-get-version|pki:template-get-request|pki:template-get-name|pki:template-get-key-type|pki:template-get-key-options|pki:template-get-id|pki:template-get-description|pki:need-certificate|pki:is-temporary|pki:insert-trusted-certificates|pki:insert-template|pki:insert-signed-certificates|pki:insert-certificate-revocation-list|pki:get-trusted-certificate-ids|pki:get-template-ids|pki:get-template-certificate-authority|pki:get-template-by-name|pki:get-template|pki:get-pending-certificate-requests-xml|pki:get-pending-certificate-requests-pem|pki:get-pending-certificate-request|pki:get-certificates-for-template-xml|pki:get-certificates-for-template|pki:get-certificates|pki:get-certificate-xml|pki:get-certificate-pem|pki:get-certificate|pki:generate-temporary-certificate-if-necessary|pki:generate-temporary-certificate|pki:generate-template-certificate-authority|pki:generate-certificate-request|pki:delete-template|pki:delete-certificate|pki:create-template|pdf:make-toc|pdf:insert-toc-headers|pdf:get-toc|pdf:clean|p:status-transition|p:state-transition|p:remove|p:pipelines|p:insert|p:get-by-id|p:get|p:execute|p:create|p:condition|p:collection|p:action|ooxml:runs-merge|ooxml:package-uris|ooxml:package-parts-insert|ooxml:package-parts|msword:clean|mcgm:polygon|mcgm:point|mcgm:geospatial-query-from-elements|mcgm:geospatial-query|mcgm:circle|math:tanh|math:tan|math:sqrt|math:sinh|math:sin|math:pow|math:modf|math:log10|math:log|math:ldexp|math:frexp|math:fmod|math:floor|math:fabs|math:exp|math:cosh|math:cos|math:ceil|math:atan2|math:atan|math:asin|math:acos|map:put|map:map|map:keys|map:get|map:delete|map:count|map:clear|lnk:to|lnk:remove|lnk:insert|lnk:get|lnk:from|lnk:create|kml:polygon|kml:point|kml:interior-polygon|kml:geospatial-query-from-elements|kml:geospatial-query|kml:circle|kml:box|gml:polygon|gml:point|gml:interior-polygon|gml:geospatial-query-from-elements|gml:geospatial-query|gml:circle|gml:box|georss:point|georss:geospatial-query|georss:circle|geo:polygon|geo:point|geo:interior-polygon|geo:geospatial-query-from-elements|geo:geospatial-query|geo:circle|geo:box|fn:zero-or-one|fn:years-from-duration|fn:year-from-dateTime|fn:year-from-date|fn:upper-case|fn:unordered|fn:true|fn:translate|fn:trace|fn:tokenize|fn:timezone-from-time|fn:timezone-from-dateTime|fn:timezone-from-date|fn:sum|fn:subtract-dateTimes-yielding-yearMonthDuration|fn:subtract-dateTimes-yielding-dayTimeDuration|fn:substring-before|fn:substring-after|fn:substring|fn:subsequence|fn:string-to-codepoints|fn:string-pad|fn:string-length|fn:string-join|fn:string|fn:static-base-uri|fn:starts-with|fn:seconds-from-time|fn:seconds-from-duration|fn:seconds-from-dateTime|fn:round-half-to-even|fn:round|fn:root|fn:reverse|fn:resolve-uri|fn:resolve-QName|fn:replace|fn:remove|fn:QName|fn:prefix-from-QName|fn:position|fn:one-or-more|fn:number|fn:not|fn:normalize-unicode|fn:normalize-space|fn:node-name|fn:node-kind|fn:nilled|fn:namespace-uri-from-QName|fn:namespace-uri-for-prefix|fn:namespace-uri|fn:name|fn:months-from-duration|fn:month-from-dateTime|fn:month-from-date|fn:minutes-from-time|fn:minutes-from-duration|fn:minutes-from-dateTime|fn:min|fn:max|fn:matches|fn:lower-case|fn:local-name-from-QName|fn:local-name|fn:last|fn:lang|fn:iri-to-uri|fn:insert-before|fn:index-of|fn:in-scope-prefixes|fn:implicit-timezone|fn:idref|fn:id|fn:hours-from-time|fn:hours-from-duration|fn:hours-from-dateTime|fn:floor|fn:false|fn:expanded-QName|fn:exists|fn:exactly-one|fn:escape-uri|fn:escape-html-uri|fn:error|fn:ends-with|fn:encode-for-uri|fn:empty|fn:document-uri|fn:doc-available|fn:doc|fn:distinct-values|fn:distinct-nodes|fn:default-collation|fn:deep-equal|fn:days-from-duration|fn:day-from-dateTime|fn:day-from-date|fn:data|fn:current-time|fn:current-dateTime|fn:current-date|fn:count|fn:contains|fn:concat|fn:compare|fn:collection|fn:codepoints-to-string|fn:codepoint-equal|fn:ceiling|fn:boolean|fn:base-uri|fn:avg|fn:adjust-time-to-timezone|fn:adjust-dateTime-to-timezone|fn:adjust-date-to-timezone|fn:abs|feed:unsubscribe|feed:subscription|feed:subscribe|feed:request|feed:item|feed:description|excel:clean|entity:enrich|dom:set-pipelines|dom:set-permissions|dom:set-name|dom:set-evaluation-context|dom:set-domain-scope|dom:set-description|dom:remove-pipeline|dom:remove-permissions|dom:remove|dom:get|dom:evaluation-context|dom:domains|dom:domain-scope|dom:create|dom:configuration-set-restart-user|dom:configuration-set-permissions|dom:configuration-set-evaluation-context|dom:configuration-set-default-domain|dom:configuration-get|dom:configuration-create|dom:collection|dom:add-pipeline|dom:add-permissions|dls:retention-rules|dls:retention-rule-remove|dls:retention-rule-insert|dls:retention-rule|dls:purge|dls:node-expand|dls:link-references|dls:link-expand|dls:documents-query|dls:document-versions-query|dls:document-version-uri|dls:document-version-query|dls:document-version-delete|dls:document-version-as-of|dls:document-version|dls:document-update|dls:document-unmanage|dls:document-set-quality|dls:document-set-property|dls:document-set-properties|dls:document-set-permissions|dls:document-set-collections|dls:document-retention-rules|dls:document-remove-properties|dls:document-remove-permissions|dls:document-remove-collections|dls:document-purge|dls:document-manage|dls:document-is-managed|dls:document-insert-and-manage|dls:document-include-query|dls:document-history|dls:document-get-permissions|dls:document-extract-part|dls:document-delete|dls:document-checkout-status|dls:document-checkout|dls:document-checkin|dls:document-add-properties|dls:document-add-permissions|dls:document-add-collections|dls:break-checkout|dls:author-query|dls:as-of-query|dbk:convert|dbg:wait|dbg:value|dbg:stopped|dbg:stop|dbg:step|dbg:status|dbg:stack|dbg:out|dbg:next|dbg:line|dbg:invoke|dbg:function|dbg:finish|dbg:expr|dbg:eval|dbg:disconnect|dbg:detach|dbg:continue|dbg:connect|dbg:clear|dbg:breakpoints|dbg:break|dbg:attached|dbg:attach|cvt:save-converted-documents|cvt:part-uri|cvt:destination-uri|cvt:basepath|cvt:basename|cts:words|cts:word-query-weight|cts:word-query-text|cts:word-query-options|cts:word-query|cts:word-match|cts:walk|cts:uris|cts:uri-match|cts:train|cts:tokenize|cts:thresholds|cts:stem|cts:similar-query-weight|cts:similar-query-nodes|cts:similar-query|cts:shortest-distance|cts:search|cts:score|cts:reverse-query-weight|cts:reverse-query-nodes|cts:reverse-query|cts:remainder|cts:registered-query-weight|cts:registered-query-options|cts:registered-query-ids|cts:registered-query|cts:register|cts:query|cts:quality|cts:properties-query-query|cts:properties-query|cts:polygon-vertices|cts:polygon|cts:point-longitude|cts:point-latitude|cts:point|cts:or-query-queries|cts:or-query|cts:not-query-weight|cts:not-query-query|cts:not-query|cts:near-query-weight|cts:near-query-queries|cts:near-query-options|cts:near-query-distance|cts:near-query|cts:highlight|cts:geospatial-co-occurrences|cts:frequency|cts:fitness|cts:field-words|cts:field-word-query-weight|cts:field-word-query-text|cts:field-word-query-options|cts:field-word-query-field-name|cts:field-word-query|cts:field-word-match|cts:entity-highlight|cts:element-words|cts:element-word-query-weight|cts:element-word-query-text|cts:element-word-query-options|cts:element-word-query-element-name|cts:element-word-query|cts:element-word-match|cts:element-values|cts:element-value-ranges|cts:element-value-query-weight|cts:element-value-query-text|cts:element-value-query-options|cts:element-value-query-element-name|cts:element-value-query|cts:element-value-match|cts:element-value-geospatial-co-occurrences|cts:element-value-co-occurrences|cts:element-range-query-weight|cts:element-range-query-value|cts:element-range-query-options|cts:element-range-query-operator|cts:element-range-query-element-name|cts:element-range-query|cts:element-query-query|cts:element-query-element-name|cts:element-query|cts:element-pair-geospatial-values|cts:element-pair-geospatial-value-match|cts:element-pair-geospatial-query-weight|cts:element-pair-geospatial-query-region|cts:element-pair-geospatial-query-options|cts:element-pair-geospatial-query-longitude-name|cts:element-pair-geospatial-query-latitude-name|cts:element-pair-geospatial-query-element-name|cts:element-pair-geospatial-query|cts:element-pair-geospatial-boxes|cts:element-geospatial-values|cts:element-geospatial-value-match|cts:element-geospatial-query-weight|cts:element-geospatial-query-region|cts:element-geospatial-query-options|cts:element-geospatial-query-element-name|cts:element-geospatial-query|cts:element-geospatial-boxes|cts:element-child-geospatial-values|cts:element-child-geospatial-value-match|cts:element-child-geospatial-query-weight|cts:element-child-geospatial-query-region|cts:element-child-geospatial-query-options|cts:element-child-geospatial-query-element-name|cts:element-child-geospatial-query-child-name|cts:element-child-geospatial-query|cts:element-child-geospatial-boxes|cts:element-attribute-words|cts:element-attribute-word-query-weight|cts:element-attribute-word-query-text|cts:element-attribute-word-query-options|cts:element-attribute-word-query-element-name|cts:element-attribute-word-query-attribute-name|cts:element-attribute-word-query|cts:element-attribute-word-match|cts:element-attribute-values|cts:element-attribute-value-ranges|cts:element-attribute-value-query-weight|cts:element-attribute-value-query-text|cts:element-attribute-value-query-options|cts:element-attribute-value-query-element-name|cts:element-attribute-value-query-attribute-name|cts:element-attribute-value-query|cts:element-attribute-value-match|cts:element-attribute-value-geospatial-co-occurrences|cts:element-attribute-value-co-occurrences|cts:element-attribute-range-query-weight|cts:element-attribute-range-query-value|cts:element-attribute-range-query-options|cts:element-attribute-range-query-operator|cts:element-attribute-range-query-element-name|cts:element-attribute-range-query-attribute-name|cts:element-attribute-range-query|cts:element-attribute-pair-geospatial-values|cts:element-attribute-pair-geospatial-value-match|cts:element-attribute-pair-geospatial-query-weight|cts:element-attribute-pair-geospatial-query-region|cts:element-attribute-pair-geospatial-query-options|cts:element-attribute-pair-geospatial-query-longitude-name|cts:element-attribute-pair-geospatial-query-latitude-name|cts:element-attribute-pair-geospatial-query-element-name|cts:element-attribute-pair-geospatial-query|cts:element-attribute-pair-geospatial-boxes|cts:document-query-uris|cts:document-query|cts:distance|cts:directory-query-uris|cts:directory-query-depth|cts:directory-query|cts:destination|cts:deregister|cts:contains|cts:confidence|cts:collections|cts:collection-query-uris|cts:collection-query|cts:collection-match|cts:classify|cts:circle-radius|cts:circle-center|cts:circle|cts:box-west|cts:box-south|cts:box-north|cts:box-east|cts:box|cts:bearing|cts:arc-intersection|cts:and-query-queries|cts:and-query-options|cts:and-query|cts:and-not-query-positive-query|cts:and-not-query-negative-query|cts:and-not-query|css:get|css:convert|cpf:success|cpf:failure|cpf:document-set-state|cpf:document-set-processing-status|cpf:document-set-last-updated|cpf:document-set-error|cpf:document-get-state|cpf:document-get-processing-status|cpf:document-get-last-updated|cpf:document-get-error|cpf:check-transition|alert:spawn-matching-actions|alert:rule-user-id-query|alert:rule-set-user-id|alert:rule-set-query|alert:rule-set-options|alert:rule-set-name|alert:rule-set-description|alert:rule-set-action|alert:rule-remove|alert:rule-name-query|alert:rule-insert|alert:rule-id-query|alert:rule-get-user-id|alert:rule-get-query|alert:rule-get-options|alert:rule-get-name|alert:rule-get-id|alert:rule-get-description|alert:rule-get-action|alert:rule-action-query|alert:remove-triggers|alert:make-rule|alert:make-log-action|alert:make-config|alert:make-action|alert:invoke-matching-actions|alert:get-my-rules|alert:get-all-rules|alert:get-actions|alert:find-matching-rules|alert:create-triggers|alert:config-set-uri|alert:config-set-trigger-ids|alert:config-set-options|alert:config-set-name|alert:config-set-description|alert:config-set-cpf-domain-names|alert:config-set-cpf-domain-ids|alert:config-insert|alert:config-get-uri|alert:config-get-trigger-ids|alert:config-get-options|alert:config-get-name|alert:config-get-id|alert:config-get-description|alert:config-get-cpf-domain-names|alert:config-get-cpf-domain-ids|alert:config-get|alert:config-delete|alert:action-set-options|alert:action-set-name|alert:action-set-module-root|alert:action-set-module-db|alert:action-set-module|alert:action-set-description|alert:action-remove|alert:action-insert|alert:action-get-options|alert:action-get-name|alert:action-get-module-root|alert:action-get-module-db|alert:action-get-module|alert:action-get-description|zero-or-one|years-from-duration|year-from-dateTime|year-from-date|upper-case|unordered|true|translate|trace|tokenize|timezone-from-time|timezone-from-dateTime|timezone-from-date|sum|subtract-dateTimes-yielding-yearMonthDuration|subtract-dateTimes-yielding-dayTimeDuration|substring-before|substring-after|substring|subsequence|string-to-codepoints|string-pad|string-length|string-join|string|static-base-uri|starts-with|seconds-from-time|seconds-from-duration|seconds-from-dateTime|round-half-to-even|round|root|reverse|resolve-uri|resolve-QName|replace|remove|QName|prefix-from-QName|position|one-or-more|number|not|normalize-unicode|normalize-space|node-name|node-kind|nilled|namespace-uri-from-QName|namespace-uri-for-prefix|namespace-uri|name|months-from-duration|month-from-dateTime|month-from-date|minutes-from-time|minutes-from-duration|minutes-from-dateTime|min|max|matches|lower-case|local-name-from-QName|local-name|last|lang|iri-to-uri|insert-before|index-of|in-scope-prefixes|implicit-timezone|idref|id|hours-from-time|hours-from-duration|hours-from-dateTime|floor|false|expanded-QName|exists|exactly-one|escape-uri|escape-html-uri|error|ends-with|encode-for-uri|empty|document-uri|doc-available|doc|distinct-values|distinct-nodes|default-collation|deep-equal|days-from-duration|day-from-dateTime|day-from-date|data|current-time|current-dateTime|current-date|count|contains|concat|compare|collection|codepoints-to-string|codepoint-equal|ceiling|boolean|base-uri|avg|adjust-time-to-timezone|adjust-dateTime-to-timezone|adjust-date-to-timezone|abs)\b/],
["pln",/^[\w:-]+/],["pln",/^[\t\n\r \xa0]+/]]),["xq","xquery"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["pun",/^[:>?|]+/,a,":|>?"],["dec",/^%(?:YAML|TAG)[^\n\r#]+/,a,"%"],["typ",/^&\S+/,a,"&"],["typ",/^!\S*/,a,"!"],["str",/^"(?:[^"\\]|\\.)*(?:"|$)/,a,'"'],["str",/^'(?:[^']|'')*(?:'|$)/,a,"'"],["com",/^#[^\n\r]*/,a,"#"],["pln",/^\s+/,a," \t\r\n"]],[["dec",/^(?:---|\.\.\.)(?:[\n\r]|$)/],["pun",/^-/],["kwd",/^\w+:[\n\r ]/],["pln",/^\w+/]]),["yaml","yml"]);

var q=null;window.PR_SHOULD_USE_CONTINUATION=!0;
(function(){function L(a){function m(a){var f=a.charCodeAt(0);if(f!==92)return f;var b=a.charAt(1);return(f=r[b])?f:"0"<=b&&b<="7"?parseInt(a.substring(1),8):b==="u"||b==="x"?parseInt(a.substring(2),16):a.charCodeAt(1)}function e(a){if(a<32)return(a<16?"\\x0":"\\x")+a.toString(16);a=String.fromCharCode(a);if(a==="\\"||a==="-"||a==="["||a==="]")a="\\"+a;return a}function h(a){for(var f=a.substring(1,a.length-1).match(/\\u[\dA-Fa-f]{4}|\\x[\dA-Fa-f]{2}|\\[0-3][0-7]{0,2}|\\[0-7]{1,2}|\\[\S\s]|[^\\]/g),a=
[],b=[],o=f[0]==="^",c=o?1:0,i=f.length;c<i;++c){var j=f[c];if(/\\[bdsw]/i.test(j))a.push(j);else{var j=m(j),d;c+2<i&&"-"===f[c+1]?(d=m(f[c+2]),c+=2):d=j;b.push([j,d]);d<65||j>122||(d<65||j>90||b.push([Math.max(65,j)|32,Math.min(d,90)|32]),d<97||j>122||b.push([Math.max(97,j)&-33,Math.min(d,122)&-33]))}}b.sort(function(a,f){return a[0]-f[0]||f[1]-a[1]});f=[];j=[NaN,NaN];for(c=0;c<b.length;++c)i=b[c],i[0]<=j[1]+1?j[1]=Math.max(j[1],i[1]):f.push(j=i);b=["["];o&&b.push("^");b.push.apply(b,a);for(c=0;c<
f.length;++c)i=f[c],b.push(e(i[0])),i[1]>i[0]&&(i[1]+1>i[0]&&b.push("-"),b.push(e(i[1])));b.push("]");return b.join("")}function y(a){for(var f=a.source.match(/\[(?:[^\\\]]|\\[\S\s])*]|\\u[\dA-Fa-f]{4}|\\x[\dA-Fa-f]{2}|\\\d+|\\[^\dux]|\(\?[!:=]|[()^]|[^()[\\^]+/g),b=f.length,d=[],c=0,i=0;c<b;++c){var j=f[c];j==="("?++i:"\\"===j.charAt(0)&&(j=+j.substring(1))&&j<=i&&(d[j]=-1)}for(c=1;c<d.length;++c)-1===d[c]&&(d[c]=++t);for(i=c=0;c<b;++c)j=f[c],j==="("?(++i,d[i]===void 0&&(f[c]="(?:")):"\\"===j.charAt(0)&&
(j=+j.substring(1))&&j<=i&&(f[c]="\\"+d[i]);for(i=c=0;c<b;++c)"^"===f[c]&&"^"!==f[c+1]&&(f[c]="");if(a.ignoreCase&&s)for(c=0;c<b;++c)j=f[c],a=j.charAt(0),j.length>=2&&a==="["?f[c]=h(j):a!=="\\"&&(f[c]=j.replace(/[A-Za-z]/g,function(a){a=a.charCodeAt(0);return"["+String.fromCharCode(a&-33,a|32)+"]"}));return f.join("")}for(var t=0,s=!1,l=!1,p=0,d=a.length;p<d;++p){var g=a[p];if(g.ignoreCase)l=!0;else if(/[a-z]/i.test(g.source.replace(/\\u[\da-f]{4}|\\x[\da-f]{2}|\\[^UXux]/gi,""))){s=!0;l=!1;break}}for(var r=
{b:8,t:9,n:10,v:11,f:12,r:13},n=[],p=0,d=a.length;p<d;++p){g=a[p];if(g.global||g.multiline)throw Error(""+g);n.push("(?:"+y(g)+")")}return RegExp(n.join("|"),l?"gi":"g")}function M(a){function m(a){switch(a.nodeType){case 1:if(e.test(a.className))break;for(var g=a.firstChild;g;g=g.nextSibling)m(g);g=a.nodeName;if("BR"===g||"LI"===g)h[s]="\n",t[s<<1]=y++,t[s++<<1|1]=a;break;case 3:case 4:g=a.nodeValue,g.length&&(g=p?g.replace(/\r\n?/g,"\n"):g.replace(/[\t\n\r ]+/g," "),h[s]=g,t[s<<1]=y,y+=g.length,
t[s++<<1|1]=a)}}var e=/(?:^|\s)nocode(?:\s|$)/,h=[],y=0,t=[],s=0,l;a.currentStyle?l=a.currentStyle.whiteSpace:window.getComputedStyle&&(l=document.defaultView.getComputedStyle(a,q).getPropertyValue("white-space"));var p=l&&"pre"===l.substring(0,3);m(a);return{a:h.join("").replace(/\n$/,""),c:t}}function B(a,m,e,h){m&&(a={a:m,d:a},e(a),h.push.apply(h,a.e))}function x(a,m){function e(a){for(var l=a.d,p=[l,"pln"],d=0,g=a.a.match(y)||[],r={},n=0,z=g.length;n<z;++n){var f=g[n],b=r[f],o=void 0,c;if(typeof b===
"string")c=!1;else{var i=h[f.charAt(0)];if(i)o=f.match(i[1]),b=i[0];else{for(c=0;c<t;++c)if(i=m[c],o=f.match(i[1])){b=i[0];break}o||(b="pln")}if((c=b.length>=5&&"lang-"===b.substring(0,5))&&!(o&&typeof o[1]==="string"))c=!1,b="src";c||(r[f]=b)}i=d;d+=f.length;if(c){c=o[1];var j=f.indexOf(c),k=j+c.length;o[2]&&(k=f.length-o[2].length,j=k-c.length);b=b.substring(5);B(l+i,f.substring(0,j),e,p);B(l+i+j,c,C(b,c),p);B(l+i+k,f.substring(k),e,p)}else p.push(l+i,b)}a.e=p}var h={},y;(function(){for(var e=a.concat(m),
l=[],p={},d=0,g=e.length;d<g;++d){var r=e[d],n=r[3];if(n)for(var k=n.length;--k>=0;)h[n.charAt(k)]=r;r=r[1];n=""+r;p.hasOwnProperty(n)||(l.push(r),p[n]=q)}l.push(/[\S\s]/);y=L(l)})();var t=m.length;return e}function u(a){var m=[],e=[];a.tripleQuotedStrings?m.push(["str",/^(?:'''(?:[^'\\]|\\[\S\s]|''?(?=[^']))*(?:'''|$)|"""(?:[^"\\]|\\[\S\s]|""?(?=[^"]))*(?:"""|$)|'(?:[^'\\]|\\[\S\s])*(?:'|$)|"(?:[^"\\]|\\[\S\s])*(?:"|$))/,q,"'\""]):a.multiLineStrings?m.push(["str",/^(?:'(?:[^'\\]|\\[\S\s])*(?:'|$)|"(?:[^"\\]|\\[\S\s])*(?:"|$)|`(?:[^\\`]|\\[\S\s])*(?:`|$))/,
q,"'\"`"]):m.push(["str",/^(?:'(?:[^\n\r'\\]|\\.)*(?:'|$)|"(?:[^\n\r"\\]|\\.)*(?:"|$))/,q,"\"'"]);a.verbatimStrings&&e.push(["str",/^@"(?:[^"]|"")*(?:"|$)/,q]);var h=a.hashComments;h&&(a.cStyleComments?(h>1?m.push(["com",/^#(?:##(?:[^#]|#(?!##))*(?:###|$)|.*)/,q,"#"]):m.push(["com",/^#(?:(?:define|elif|else|endif|error|ifdef|include|ifndef|line|pragma|undef|warning)\b|[^\n\r]*)/,q,"#"]),e.push(["str",/^<(?:(?:(?:\.\.\/)*|\/?)(?:[\w-]+(?:\/[\w-]+)+)?[\w-]+\.h|[a-z]\w*)>/,q])):m.push(["com",/^#[^\n\r]*/,
q,"#"]));a.cStyleComments&&(e.push(["com",/^\/\/[^\n\r]*/,q]),e.push(["com",/^\/\*[\S\s]*?(?:\*\/|$)/,q]));a.regexLiterals&&e.push(["lang-regex",/^(?:^^\.?|[!+-]|!=|!==|#|%|%=|&|&&|&&=|&=|\(|\*|\*=|\+=|,|-=|->|\/|\/=|:|::|;|<|<<|<<=|<=|=|==|===|>|>=|>>|>>=|>>>|>>>=|[?@[^]|\^=|\^\^|\^\^=|{|\||\|=|\|\||\|\|=|~|break|case|continue|delete|do|else|finally|instanceof|return|throw|try|typeof)\s*(\/(?=[^*/])(?:[^/[\\]|\\[\S\s]|\[(?:[^\\\]]|\\[\S\s])*(?:]|$))+\/)/]);(h=a.types)&&e.push(["typ",h]);a=(""+a.keywords).replace(/^ | $/g,
"");a.length&&e.push(["kwd",RegExp("^(?:"+a.replace(/[\s,]+/g,"|")+")\\b"),q]);m.push(["pln",/^\s+/,q," \r\n\t\xa0"]);e.push(["lit",/^@[$_a-z][\w$@]*/i,q],["typ",/^(?:[@_]?[A-Z]+[a-z][\w$@]*|\w+_t\b)/,q],["pln",/^[$_a-z][\w$@]*/i,q],["lit",/^(?:0x[\da-f]+|(?:\d(?:_\d+)*\d*(?:\.\d*)?|\.\d\+)(?:e[+-]?\d+)?)[a-z]*/i,q,"0123456789"],["pln",/^\\[\S\s]?/,q],["pun",/^.[^\s\w"-$'./@\\`]*/,q]);return x(m,e)}function D(a,m){function e(a){switch(a.nodeType){case 1:if(k.test(a.className))break;if("BR"===a.nodeName)h(a),
a.parentNode&&a.parentNode.removeChild(a);else for(a=a.firstChild;a;a=a.nextSibling)e(a);break;case 3:case 4:if(p){var b=a.nodeValue,d=b.match(t);if(d){var c=b.substring(0,d.index);a.nodeValue=c;(b=b.substring(d.index+d[0].length))&&a.parentNode.insertBefore(s.createTextNode(b),a.nextSibling);h(a);c||a.parentNode.removeChild(a)}}}}function h(a){function b(a,d){var e=d?a.cloneNode(!1):a,f=a.parentNode;if(f){var f=b(f,1),g=a.nextSibling;f.appendChild(e);for(var h=g;h;h=g)g=h.nextSibling,f.appendChild(h)}return e}
for(;!a.nextSibling;)if(a=a.parentNode,!a)return;for(var a=b(a.nextSibling,0),e;(e=a.parentNode)&&e.nodeType===1;)a=e;d.push(a)}var k=/(?:^|\s)nocode(?:\s|$)/,t=/\r\n?|\n/,s=a.ownerDocument,l;a.currentStyle?l=a.currentStyle.whiteSpace:window.getComputedStyle&&(l=s.defaultView.getComputedStyle(a,q).getPropertyValue("white-space"));var p=l&&"pre"===l.substring(0,3);for(l=s.createElement("LI");a.firstChild;)l.appendChild(a.firstChild);for(var d=[l],g=0;g<d.length;++g)e(d[g]);m===(m|0)&&d[0].setAttribute("value",
m);var r=s.createElement("OL");r.className="linenums";for(var n=Math.max(0,m-1|0)||0,g=0,z=d.length;g<z;++g)l=d[g],l.className="L"+(g+n)%10,l.firstChild||l.appendChild(s.createTextNode("\xa0")),r.appendChild(l);a.appendChild(r)}function k(a,m){for(var e=m.length;--e>=0;){var h=m[e];A.hasOwnProperty(h)?window.console&&console.warn("cannot override language handler %s",h):A[h]=a}}function C(a,m){if(!a||!A.hasOwnProperty(a))a=/^\s*</.test(m)?"default-markup":"default-code";return A[a]}function E(a){var m=
a.g;try{var e=M(a.h),h=e.a;a.a=h;a.c=e.c;a.d=0;C(m,h)(a);var k=/\bMSIE\b/.test(navigator.userAgent),m=/\n/g,t=a.a,s=t.length,e=0,l=a.c,p=l.length,h=0,d=a.e,g=d.length,a=0;d[g]=s;var r,n;for(n=r=0;n<g;)d[n]!==d[n+2]?(d[r++]=d[n++],d[r++]=d[n++]):n+=2;g=r;for(n=r=0;n<g;){for(var z=d[n],f=d[n+1],b=n+2;b+2<=g&&d[b+1]===f;)b+=2;d[r++]=z;d[r++]=f;n=b}for(d.length=r;h<p;){var o=l[h+2]||s,c=d[a+2]||s,b=Math.min(o,c),i=l[h+1],j;if(i.nodeType!==1&&(j=t.substring(e,b))){k&&(j=j.replace(m,"\r"));i.nodeValue=
j;var u=i.ownerDocument,v=u.createElement("SPAN");v.className=d[a+1];var x=i.parentNode;x.replaceChild(v,i);v.appendChild(i);e<o&&(l[h+1]=i=u.createTextNode(t.substring(b,o)),x.insertBefore(i,v.nextSibling))}e=b;e>=o&&(h+=2);e>=c&&(a+=2)}}catch(w){"console"in window&&console.log(w&&w.stack?w.stack:w)}}var v=["break,continue,do,else,for,if,return,while"],w=[[v,"auto,case,char,const,default,double,enum,extern,float,goto,int,long,register,short,signed,sizeof,static,struct,switch,typedef,union,unsigned,void,volatile"],
"catch,class,delete,false,import,new,operator,private,protected,public,this,throw,true,try,typeof"],F=[w,"alignof,align_union,asm,axiom,bool,concept,concept_map,const_cast,constexpr,decltype,dynamic_cast,explicit,export,friend,inline,late_check,mutable,namespace,nullptr,reinterpret_cast,static_assert,static_cast,template,typeid,typename,using,virtual,where"],G=[w,"abstract,boolean,byte,extends,final,finally,implements,import,instanceof,null,native,package,strictfp,super,synchronized,throws,transient"],
H=[G,"as,base,by,checked,decimal,delegate,descending,dynamic,event,fixed,foreach,from,group,implicit,in,interface,internal,into,is,lock,object,out,override,orderby,params,partial,readonly,ref,sbyte,sealed,stackalloc,string,select,uint,ulong,unchecked,unsafe,ushort,var"],w=[w,"debugger,eval,export,function,get,null,set,undefined,var,with,Infinity,NaN"],I=[v,"and,as,assert,class,def,del,elif,except,exec,finally,from,global,import,in,is,lambda,nonlocal,not,or,pass,print,raise,try,with,yield,False,True,None"],
J=[v,"alias,and,begin,case,class,def,defined,elsif,end,ensure,false,in,module,next,nil,not,or,redo,rescue,retry,self,super,then,true,undef,unless,until,when,yield,BEGIN,END"],v=[v,"case,done,elif,esac,eval,fi,function,in,local,set,then,until"],K=/^(DIR|FILE|vector|(de|priority_)?queue|list|stack|(const_)?iterator|(multi)?(set|map)|bitset|u?(int|float)\d*)/,N=/\S/,O=u({keywords:[F,H,w,"caller,delete,die,do,dump,elsif,eval,exit,foreach,for,goto,if,import,last,local,my,next,no,our,print,package,redo,require,sub,undef,unless,until,use,wantarray,while,BEGIN,END"+
I,J,v],hashComments:!0,cStyleComments:!0,multiLineStrings:!0,regexLiterals:!0}),A={};k(O,["default-code"]);k(x([],[["pln",/^[^<?]+/],["dec",/^<!\w[^>]*(?:>|$)/],["com",/^<\!--[\S\s]*?(?:--\>|$)/],["lang-",/^<\?([\S\s]+?)(?:\?>|$)/],["lang-",/^<%([\S\s]+?)(?:%>|$)/],["pun",/^(?:<[%?]|[%?]>)/],["lang-",/^<xmp\b[^>]*>([\S\s]+?)<\/xmp\b[^>]*>/i],["lang-js",/^<script\b[^>]*>([\S\s]*?)(<\/script\b[^>]*>)/i],["lang-css",/^<style\b[^>]*>([\S\s]*?)(<\/style\b[^>]*>)/i],["lang-in.tag",/^(<\/?[a-z][^<>]*>)/i]]),
["default-markup","htm","html","mxml","xhtml","xml","xsl"]);k(x([["pln",/^\s+/,q," \t\r\n"],["atv",/^(?:"[^"]*"?|'[^']*'?)/,q,"\"'"]],[["tag",/^^<\/?[a-z](?:[\w-.:]*\w)?|\/?>$/i],["atn",/^(?!style[\s=]|on)[a-z](?:[\w:-]*\w)?/i],["lang-uq.val",/^=\s*([^\s"'>]*(?:[^\s"'/>]|\/(?=\s)))/],["pun",/^[/<->]+/],["lang-js",/^on\w+\s*=\s*"([^"]+)"/i],["lang-js",/^on\w+\s*=\s*'([^']+)'/i],["lang-js",/^on\w+\s*=\s*([^\s"'>]+)/i],["lang-css",/^style\s*=\s*"([^"]+)"/i],["lang-css",/^style\s*=\s*'([^']+)'/i],["lang-css",
/^style\s*=\s*([^\s"'>]+)/i]]),["in.tag"]);k(x([],[["atv",/^[\S\s]+/]]),["uq.val"]);k(u({keywords:F,hashComments:!0,cStyleComments:!0,types:K}),["c","cc","cpp","cxx","cyc","m"]);k(u({keywords:"null,true,false"}),["json"]);k(u({keywords:H,hashComments:!0,cStyleComments:!0,verbatimStrings:!0,types:K}),["cs"]);k(u({keywords:G,cStyleComments:!0}),["java"]);k(u({keywords:v,hashComments:!0,multiLineStrings:!0}),["bsh","csh","sh"]);k(u({keywords:I,hashComments:!0,multiLineStrings:!0,tripleQuotedStrings:!0}),
["cv","py"]);k(u({keywords:"caller,delete,die,do,dump,elsif,eval,exit,foreach,for,goto,if,import,last,local,my,next,no,our,print,package,redo,require,sub,undef,unless,until,use,wantarray,while,BEGIN,END",hashComments:!0,multiLineStrings:!0,regexLiterals:!0}),["perl","pl","pm"]);k(u({keywords:J,hashComments:!0,multiLineStrings:!0,regexLiterals:!0}),["rb"]);k(u({keywords:w,cStyleComments:!0,regexLiterals:!0}),["js"]);k(u({keywords:"all,and,by,catch,class,else,extends,false,finally,for,if,in,is,isnt,loop,new,no,not,null,of,off,on,or,return,super,then,true,try,unless,until,when,while,yes",
hashComments:3,cStyleComments:!0,multilineStrings:!0,tripleQuotedStrings:!0,regexLiterals:!0}),["coffee"]);k(x([],[["str",/^[\S\s]+/]]),["regex"]);window.prettyPrintOne=function(a,m,e){var h=document.createElement("PRE");h.innerHTML=a;e&&D(h,e);E({g:m,i:e,h:h});return h.innerHTML};window.prettyPrint=function(a){function m(){for(var e=window.PR_SHOULD_USE_CONTINUATION?l.now()+250:Infinity;p<h.length&&l.now()<e;p++){var n=h[p],k=n.className;if(k.indexOf("prettyprint")>=0){var k=k.match(g),f,b;if(b=
!k){b=n;for(var o=void 0,c=b.firstChild;c;c=c.nextSibling)var i=c.nodeType,o=i===1?o?b:c:i===3?N.test(c.nodeValue)?b:o:o;b=(f=o===b?void 0:o)&&"CODE"===f.tagName}b&&(k=f.className.match(g));k&&(k=k[1]);b=!1;for(o=n.parentNode;o;o=o.parentNode)if((o.tagName==="pre"||o.tagName==="code"||o.tagName==="xmp")&&o.className&&o.className.indexOf("prettyprint")>=0){b=!0;break}b||((b=(b=n.className.match(/\blinenums\b(?::(\d+))?/))?b[1]&&b[1].length?+b[1]:!0:!1)&&D(n,b),d={g:k,h:n,i:b},E(d))}}p<h.length?setTimeout(m,
250):a&&a()}for(var e=[document.getElementsByTagName("pre"),document.getElementsByTagName("code"),document.getElementsByTagName("xmp")],h=[],k=0;k<e.length;++k)for(var t=0,s=e[k].length;t<s;++t)h.push(e[k][t]);var e=q,l=Date;l.now||(l={now:function(){return+new Date}});var p=0,d,g=/\blang(?:uage)?-([\w.]+)(?!\S)/;m()};window.PR={createSimpleLexer:x,registerLangHandler:k,sourceDecorator:u,PR_ATTRIB_NAME:"atn",PR_ATTRIB_VALUE:"atv",PR_COMMENT:"com",PR_DECLARATION:"dec",PR_KEYWORD:"kwd",PR_LITERAL:"lit",
PR_NOCODE:"nocode",PR_PLAIN:"pln",PR_PUNCTUATION:"pun",PR_SOURCE:"src",PR_STRING:"str",PR_TAG:"tag",PR_TYPE:"typ"}})();

/* Modernizr 2.5.3 (Custom Build) | MIT & BSD
 * Build: http://www.modernizr.com/download/#-fontface-backgroundsize-borderimage-borderradius-boxshadow-flexbox-flexbox_legacy-hsla-multiplebgs-opacity-rgba-textshadow-cssanimations-csscolumns-generatedcontent-cssgradients-cssreflections-csstransforms-csstransforms3d-csstransitions-applicationcache-canvas-canvastext-draganddrop-hashchange-history-audio-video-indexeddb-input-inputtypes-localstorage-postmessage-sessionstorage-websockets-websqldatabase-webworkers-geolocation-inlinesvg-smil-svg-svgclippaths-touch-webgl-mq-prefixed-teststyles-testprop-testallprops-hasevent-prefixes-domprefixes-load
 */
;window.Modernizr=function(a,b,c){function C(a){i.cssText=a}function D(a,b){return C(m.join(a+";")+(b||""))}function E(a,b){return typeof a===b}function F(a,b){return!!~(""+a).indexOf(b)}function G(a,b){for(var d in a)if(i[a[d]]!==c)return b=="pfx"?a[d]:!0;return!1}function H(a,b,d){for(var e in a){var f=b[a[e]];if(f!==c)return d===!1?a[e]:E(f,"function")?f.bind(d||b):f}return!1}function I(a,b,c){var d=a.charAt(0).toUpperCase()+a.substr(1),e=(a+" "+o.join(d+" ")+d).split(" ");return E(b,"string")||E(b,"undefined")?G(e,b):(e=(a+" "+p.join(d+" ")+d).split(" "),H(e,b,c))}function K(){e.input=function(c){for(var d=0,e=c.length;d<e;d++)t[c[d]]=c[d]in j;return t.list&&(t.list=!!b.createElement("datalist")&&!!a.HTMLDataListElement),t}("autocomplete autofocus list placeholder max min multiple pattern required step".split(" ")),e.inputtypes=function(a){for(var d=0,e,g,h,i=a.length;d<i;d++)j.setAttribute("type",g=a[d]),e=j.type!=="text",e&&(j.value=k,j.style.cssText="position:absolute;visibility:hidden;",/^range$/.test(g)&&j.style.WebkitAppearance!==c?(f.appendChild(j),h=b.defaultView,e=h.getComputedStyle&&h.getComputedStyle(j,null).WebkitAppearance!=="textfield"&&j.offsetHeight!==0,f.removeChild(j)):/^(search|tel)$/.test(g)||(/^(url|email)$/.test(g)?e=j.checkValidity&&j.checkValidity()===!1:/^color$/.test(g)?(f.appendChild(j),f.offsetWidth,e=j.value!=k,f.removeChild(j)):e=j.value!=k)),s[a[d]]=!!e;return s}("search tel url email datetime date month week time datetime-local number range color".split(" "))}var d="2.5.3",e={},f=b.documentElement,g="modernizr",h=b.createElement(g),i=h.style,j=b.createElement("input"),k=":)",l={}.toString,m=" -webkit- -moz- -o- -ms- ".split(" "),n="Webkit Moz O ms",o=n.split(" "),p=n.toLowerCase().split(" "),q={svg:"http://www.w3.org/2000/svg"},r={},s={},t={},u=[],v=u.slice,w,x=function(a,c,d,e){var h,i,j,k=b.createElement("div"),l=b.body,m=l?l:b.createElement("body");if(parseInt(d,10))while(d--)j=b.createElement("div"),j.id=e?e[d]:g+(d+1),k.appendChild(j);return h=["&#173;","<style>",a,"</style>"].join(""),k.id=g,(l?k:m).innerHTML+=h,m.appendChild(k),l||(m.style.background="",f.appendChild(m)),i=c(k,a),l?k.parentNode.removeChild(k):m.parentNode.removeChild(m),!!i},y=function(b){var c=a.matchMedia||a.msMatchMedia;if(c)return c(b).matches;var d;return x("@media "+b+" { #"+g+" { position: absolute; } }",function(b){d=(a.getComputedStyle?getComputedStyle(b,null):b.currentStyle)["position"]=="absolute"}),d},z=function(){function d(d,e){e=e||b.createElement(a[d]||"div"),d="on"+d;var f=d in e;return f||(e.setAttribute||(e=b.createElement("div")),e.setAttribute&&e.removeAttribute&&(e.setAttribute(d,""),f=E(e[d],"function"),E(e[d],"undefined")||(e[d]=c),e.removeAttribute(d))),e=null,f}var a={select:"input",change:"input",submit:"form",reset:"form",error:"img",load:"img",abort:"img"};return d}(),A={}.hasOwnProperty,B;!E(A,"undefined")&&!E(A.call,"undefined")?B=function(a,b){return A.call(a,b)}:B=function(a,b){return b in a&&E(a.constructor.prototype[b],"undefined")},Function.prototype.bind||(Function.prototype.bind=function(b){var c=this;if(typeof c!="function")throw new TypeError;var d=v.call(arguments,1),e=function(){if(this instanceof e){var a=function(){};a.prototype=c.prototype;var f=new a,g=c.apply(f,d.concat(v.call(arguments)));return Object(g)===g?g:f}return c.apply(b,d.concat(v.call(arguments)))};return e});var J=function(c,d){var f=c.join(""),g=d.length;x(f,function(c,d){var f=b.styleSheets[b.styleSheets.length-1],h=f?f.cssRules&&f.cssRules[0]?f.cssRules[0].cssText:f.cssText||"":"",i=c.childNodes,j={};while(g--)j[i[g].id]=i[g];e.touch="ontouchstart"in a||a.DocumentTouch&&b instanceof DocumentTouch||(j.touch&&j.touch.offsetTop)===9,e.csstransforms3d=(j.csstransforms3d&&j.csstransforms3d.offsetLeft)===9&&j.csstransforms3d.offsetHeight===3,e.generatedcontent=(j.generatedcontent&&j.generatedcontent.offsetHeight)>=1,e.fontface=/src/i.test(h)&&h.indexOf(d.split(" ")[0])===0},g,d)}(['@font-face {font-family:"font";src:url("https://")}',["@media (",m.join("touch-enabled),("),g,")","{#touch{top:9px;position:absolute}}"].join(""),["@media (",m.join("transform-3d),("),g,")","{#csstransforms3d{left:9px;position:absolute;height:3px;}}"].join(""),['#generatedcontent:after{content:"',k,'";visibility:hidden}'].join("")],["fontface","touch","csstransforms3d","generatedcontent"]);r.flexbox=function(){return I("flexOrder")},r["flexbox-legacy"]=function(){return I("boxDirection")},r.canvas=function(){var a=b.createElement("canvas");return!!a.getContext&&!!a.getContext("2d")},r.canvastext=function(){return!!e.canvas&&!!E(b.createElement("canvas").getContext("2d").fillText,"function")},r.webgl=function(){try{var d=b.createElement("canvas"),e;e=!(!a.WebGLRenderingContext||!d.getContext("experimental-webgl")&&!d.getContext("webgl")),d=c}catch(f){e=!1}return e},r.touch=function(){return e.touch},r.geolocation=function(){return!!navigator.geolocation},r.postmessage=function(){return!!a.postMessage},r.websqldatabase=function(){return!!a.openDatabase},r.indexedDB=function(){return!!I("indexedDB",a)},r.hashchange=function(){return z("hashchange",a)&&(b.documentMode===c||b.documentMode>7)},r.history=function(){return!!a.history&&!!history.pushState},r.draganddrop=function(){var a=b.createElement("div");return"draggable"in a||"ondragstart"in a&&"ondrop"in a},r.websockets=function(){for(var b=-1,c=o.length;++b<c;)if(a[o[b]+"WebSocket"])return!0;return"WebSocket"in a},r.rgba=function(){return C("background-color:rgba(150,255,150,.5)"),F(i.backgroundColor,"rgba")},r.hsla=function(){return C("background-color:hsla(120,40%,100%,.5)"),F(i.backgroundColor,"rgba")||F(i.backgroundColor,"hsla")},r.multiplebgs=function(){return C("background:url(https://),url(https://),red url(https://)"),/(url\s*\(.*?){3}/.test(i.background)},r.backgroundsize=function(){return I("backgroundSize")},r.borderimage=function(){return I("borderImage")},r.borderradius=function(){return I("borderRadius")},r.boxshadow=function(){return I("boxShadow")},r.textshadow=function(){return b.createElement("div").style.textShadow===""},r.opacity=function(){return D("opacity:.55"),/^0.55$/.test(i.opacity)},r.cssanimations=function(){return I("animationName")},r.csscolumns=function(){return I("columnCount")},r.cssgradients=function(){var a="background-image:",b="gradient(linear,left top,right bottom,from(#9f9),to(white));",c="linear-gradient(left top,#9f9, white);";return C((a+"-webkit- ".split(" ").join(b+a)+m.join(c+a)).slice(0,-a.length)),F(i.backgroundImage,"gradient")},r.cssreflections=function(){return I("boxReflect")},r.csstransforms=function(){return!!I("transform")},r.csstransforms3d=function(){var a=!!I("perspective");return a&&"webkitPerspective"in f.style&&(a=e.csstransforms3d),a},r.csstransitions=function(){return I("transition")},r.fontface=function(){return e.fontface},r.generatedcontent=function(){return e.generatedcontent},r.video=function(){var a=b.createElement("video"),c=!1;try{if(c=!!a.canPlayType)c=new Boolean(c),c.ogg=a.canPlayType('video/ogg; codecs="theora"').replace(/^no$/,""),c.h264=a.canPlayType('video/mp4; codecs="avc1.42E01E"').replace(/^no$/,""),c.webm=a.canPlayType('video/webm; codecs="vp8, vorbis"').replace(/^no$/,"")}catch(d){}return c},r.audio=function(){var a=b.createElement("audio"),c=!1;try{if(c=!!a.canPlayType)c=new Boolean(c),c.ogg=a.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/,""),c.mp3=a.canPlayType("audio/mpeg;").replace(/^no$/,""),c.wav=a.canPlayType('audio/wav; codecs="1"').replace(/^no$/,""),c.m4a=(a.canPlayType("audio/x-m4a;")||a.canPlayType("audio/aac;")).replace(/^no$/,"")}catch(d){}return c},r.localstorage=function(){try{return localStorage.setItem(g,g),localStorage.removeItem(g),!0}catch(a){return!1}},r.sessionstorage=function(){try{return sessionStorage.setItem(g,g),sessionStorage.removeItem(g),!0}catch(a){return!1}},r.webworkers=function(){return!!a.Worker},r.applicationcache=function(){return!!a.applicationCache},r.svg=function(){return!!b.createElementNS&&!!b.createElementNS(q.svg,"svg").createSVGRect},r.inlinesvg=function(){var a=b.createElement("div");return a.innerHTML="<svg/>",(a.firstChild&&a.firstChild.namespaceURI)==q.svg},r.smil=function(){return!!b.createElementNS&&/SVGAnimate/.test(l.call(b.createElementNS(q.svg,"animate")))},r.svgclippaths=function(){return!!b.createElementNS&&/SVGClipPath/.test(l.call(b.createElementNS(q.svg,"clipPath")))};for(var L in r)B(r,L)&&(w=L.toLowerCase(),e[w]=r[L](),u.push((e[w]?"":"no-")+w));return e.input||K(),C(""),h=j=null,e._version=d,e._prefixes=m,e._domPrefixes=p,e._cssomPrefixes=o,e.mq=y,e.hasEvent=z,e.testProp=function(a){return G([a])},e.testAllProps=I,e.testStyles=x,e.prefixed=function(a,b,c){return b?I(a,b,c):I(a,"pfx")},e}(this,this.document),function(a,b,c){function d(a){return o.call(a)=="[object Function]"}function e(a){return typeof a=="string"}function f(){}function g(a){return!a||a=="loaded"||a=="complete"||a=="uninitialized"}function h(){var a=p.shift();q=1,a?a.t?m(function(){(a.t=="c"?B.injectCss:B.injectJs)(a.s,0,a.a,a.x,a.e,1)},0):(a(),h()):q=0}function i(a,c,d,e,f,i,j){function k(b){if(!o&&g(l.readyState)&&(u.r=o=1,!q&&h(),l.onload=l.onreadystatechange=null,b)){a!="img"&&m(function(){t.removeChild(l)},50);for(var d in y[c])y[c].hasOwnProperty(d)&&y[c][d].onload()}}var j=j||B.errorTimeout,l={},o=0,r=0,u={t:d,s:c,e:f,a:i,x:j};y[c]===1&&(r=1,y[c]=[],l=b.createElement(a)),a=="object"?l.data=c:(l.src=c,l.type=a),l.width=l.height="0",l.onerror=l.onload=l.onreadystatechange=function(){k.call(this,r)},p.splice(e,0,u),a!="img"&&(r||y[c]===2?(t.insertBefore(l,s?null:n),m(k,j)):y[c].push(l))}function j(a,b,c,d,f){return q=0,b=b||"j",e(a)?i(b=="c"?v:u,a,b,this.i++,c,d,f):(p.splice(this.i++,0,a),p.length==1&&h()),this}function k(){var a=B;return a.loader={load:j,i:0},a}var l=b.documentElement,m=a.setTimeout,n=b.getElementsByTagName("script")[0],o={}.toString,p=[],q=0,r="MozAppearance"in l.style,s=r&&!!b.createRange().compareNode,t=s?l:n.parentNode,l=a.opera&&o.call(a.opera)=="[object Opera]",l=!!b.attachEvent&&!l,u=r?"object":l?"script":"img",v=l?"script":u,w=Array.isArray||function(a){return o.call(a)=="[object Array]"},x=[],y={},z={timeout:function(a,b){return b.length&&(a.timeout=b[0]),a}},A,B;B=function(a){function b(a){var a=a.split("!"),b=x.length,c=a.pop(),d=a.length,c={url:c,origUrl:c,prefixes:a},e,f,g;for(f=0;f<d;f++)g=a[f].split("="),(e=z[g.shift()])&&(c=e(c,g));for(f=0;f<b;f++)c=x[f](c);return c}function g(a,e,f,g,i){var j=b(a),l=j.autoCallback;j.url.split(".").pop().split("?").shift(),j.bypass||(e&&(e=d(e)?e:e[a]||e[g]||e[a.split("/").pop().split("?")[0]]||h),j.instead?j.instead(a,e,f,g,i):(y[j.url]?j.noexec=!0:y[j.url]=1,f.load(j.url,j.forceCSS||!j.forceJS&&"css"==j.url.split(".").pop().split("?").shift()?"c":c,j.noexec,j.attrs,j.timeout),(d(e)||d(l))&&f.load(function(){k(),e&&e(j.origUrl,i,g),l&&l(j.origUrl,i,g),y[j.url]=2})))}function i(a,b){function c(a,c){if(a){if(e(a))c||(j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}),g(a,j,b,0,h);else if(Object(a)===a)for(n in m=function(){var b=0,c;for(c in a)a.hasOwnProperty(c)&&b++;return b}(),a)a.hasOwnProperty(n)&&(!c&&!--m&&(d(j)?j=function(){var a=[].slice.call(arguments);k.apply(this,a),l()}:j[n]=function(a){return function(){var b=[].slice.call(arguments);a&&a.apply(this,b),l()}}(k[n])),g(a[n],j,b,n,h))}else!c&&l()}var h=!!a.test,i=a.load||a.both,j=a.callback||f,k=j,l=a.complete||f,m,n;c(h?a.yep:a.nope,!!i),i&&c(i)}var j,l,m=this.yepnope.loader;if(e(a))g(a,0,m,0);else if(w(a))for(j=0;j<a.length;j++)l=a[j],e(l)?g(l,0,m,0):w(l)?B(l):Object(l)===l&&i(l,m);else Object(a)===a&&i(a,m)},B.addPrefix=function(a,b){z[a]=b},B.addFilter=function(a){x.push(a)},B.errorTimeout=1e4,b.readyState==null&&b.addEventListener&&(b.readyState="loading",b.addEventListener("DOMContentLoaded",A=function(){b.removeEventListener("DOMContentLoaded",A,0),b.readyState="complete"},0)),a.yepnope=k(),a.yepnope.executeStack=h,a.yepnope.injectJs=function(a,c,d,e,i,j){var k=b.createElement("script"),l,o,e=e||B.errorTimeout;k.src=a;for(o in d)k.setAttribute(o,d[o]);c=j?h:c||f,k.onreadystatechange=k.onload=function(){!l&&g(k.readyState)&&(l=1,c(),k.onload=k.onreadystatechange=null)},m(function(){l||(l=1,c(1))},e),i?k.onload():n.parentNode.insertBefore(k,n)},a.yepnope.injectCss=function(a,c,d,e,g,i){var e=b.createElement("link"),j,c=i?h:c||f;e.href=a,e.rel="stylesheet",e.type="text/css";for(j in d)e.setAttribute(j,d[j]);g||(n.parentNode.insertBefore(e,n),m(c,0))}}(this,document),Modernizr.load=function(){yepnope.apply(window,[].slice.call(arguments,0))};
/*
 RequireJS order 1.0.5 Copyright (c) 2010-2011, The Dojo Foundation All Rights Reserved.
 Available via the MIT or new BSD license.
 see: http://github.com/jrburke/requirejs for details
*/
(function(){function k(a){var b=a.currentTarget||a.srcElement,c;if(a.type==="load"||l.test(b.readyState)){a=b.getAttribute("data-requiremodule");j[a]=!0;for(a=0;c=g[a];a++)if(j[c.name])c.req([c.name],c.onLoad);else break;a>0&&g.splice(0,a);setTimeout(function(){b.parentNode.removeChild(b)},15)}}function m(a){var b,c;a.setAttribute("data-orderloaded","loaded");for(a=0;c=h[a];a++)if((b=i[c])&&b.getAttribute("data-orderloaded")==="loaded")delete i[c],require.addScriptToDom(b);else break;a>0&&h.splice(0,
a)}var f=typeof document!=="undefined"&&typeof window!=="undefined"&&document.createElement("script"),n=f&&(f.async||window.opera&&Object.prototype.toString.call(window.opera)==="[object Opera]"||"MozAppearance"in document.documentElement.style),o=f&&f.readyState==="uninitialized",l=/^(complete|loaded)$/,g=[],j={},i={},h=[],f=null;define({version:"1.0.5",load:function(a,b,c,e){var d;b.nameToUrl?(d=b.nameToUrl(a,null),require.s.skipAsync[d]=!0,n||e.isBuild?b([a],c):o?(e=require.s.contexts._,!e.urlFetched[d]&&
!e.loaded[a]&&(e.urlFetched[d]=!0,require.resourcesReady(!1),e.scriptCount+=1,d=require.attach(d,e,a,null,null,m),i[a]=d,h.push(a)),b([a],c)):b.specified(a)?b([a],c):(g.push({name:a,req:b,onLoad:c}),require.attach(d,null,a,k,"script/cache"))):b([a],c)}})})();

/*
 RequireJS 1.0.8 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 Available via the MIT or new BSD license.
 see: http://github.com/jrburke/requirejs for details
*/
var requirejs,require,define;
(function(r){function K(a){return O.call(a)==="[object Function]"}function G(a){return O.call(a)==="[object Array]"}function $(a,c,l){for(var j in c)if(!(j in L)&&(!(j in a)||l))a[j]=c[j];return d}function P(a,c,d){a=Error(c+"\nhttp://requirejs.org/docs/errors.html#"+a);if(d)a.originalError=d;return a}function aa(a,c,d){var j,k,t;for(j=0;t=c[j];j++){t=typeof t==="string"?{name:t}:t;k=t.location;if(d&&(!k||k.indexOf("/")!==0&&k.indexOf(":")===-1))k=d+"/"+(k||t.name);a[t.name]={name:t.name,location:k||
t.name,main:(t.main||"main").replace(fa,"").replace(ba,"")}}}function V(a,c){a.holdReady?a.holdReady(c):c?a.readyWait+=1:a.ready(!0)}function ga(a){function c(b,f){var g,m;if(b&&b.charAt(0)===".")if(f){q.pkgs[f]?f=[f]:(f=f.split("/"),f=f.slice(0,f.length-1));g=b=f.concat(b.split("/"));var a;for(m=0;a=g[m];m++)if(a===".")g.splice(m,1),m-=1;else if(a==="..")if(m===1&&(g[2]===".."||g[0]===".."))break;else m>0&&(g.splice(m-1,2),m-=2);m=q.pkgs[g=b[0]];b=b.join("/");m&&b===g+"/"+m.main&&(b=g)}else b.indexOf("./")===
0&&(b=b.substring(2));return b}function l(b,f){var g=b?b.indexOf("!"):-1,m=null,a=f?f.name:null,h=b,e,d;g!==-1&&(m=b.substring(0,g),b=b.substring(g+1,b.length));m&&(m=c(m,a));b&&(m?e=(g=n[m])&&g.normalize?g.normalize(b,function(b){return c(b,a)}):c(b,a):(e=c(b,a),d=G[e],d||(d=i.nameToUrl(b,null,f),G[e]=d)));return{prefix:m,name:e,parentMap:f,url:d,originalName:h,fullName:m?m+"!"+(e||""):e}}function j(){var b=!0,f=q.priorityWait,g,a;if(f){for(a=0;g=f[a];a++)if(!s[g]){b=!1;break}b&&delete q.priorityWait}return b}
function k(b,f,g){return function(){var a=ha.call(arguments,0),c;if(g&&K(c=a[a.length-1]))c.__requireJsBuild=!0;a.push(f);return b.apply(null,a)}}function t(b,f,g){f=k(g||i.require,b,f);$(f,{nameToUrl:k(i.nameToUrl,b),toUrl:k(i.toUrl,b),defined:k(i.requireDefined,b),specified:k(i.requireSpecified,b),isBrowser:d.isBrowser});return f}function p(b){var f,g,a,c=b.callback,h=b.map,e=h.fullName,ca=b.deps;a=b.listeners;var j=q.requireExecCb||d.execCb;if(c&&K(c)){if(q.catchError.define)try{g=j(e,b.callback,
ca,n[e])}catch(k){f=k}else g=j(e,b.callback,ca,n[e]);if(e)(c=b.cjsModule)&&c.exports!==r&&c.exports!==n[e]?g=n[e]=b.cjsModule.exports:g===r&&b.usingExports?g=n[e]:(n[e]=g,H[e]&&(T[e]=!0))}else e&&(g=n[e]=c,H[e]&&(T[e]=!0));if(x[b.id])delete x[b.id],b.isDone=!0,i.waitCount-=1,i.waitCount===0&&(J=[]);delete M[e];if(d.onResourceLoad&&!b.placeholder)d.onResourceLoad(i,h,b.depArray);if(f)return g=(e?l(e).url:"")||f.fileName||f.sourceURL,a=f.moduleTree,f=P("defineerror",'Error evaluating module "'+e+'" at location "'+
g+'":\n'+f+"\nfileName:"+g+"\nlineNumber: "+(f.lineNumber||f.line),f),f.moduleName=e,f.moduleTree=a,d.onError(f);for(f=0;c=a[f];f++)c(g);return r}function u(b,f){return function(g){b.depDone[f]||(b.depDone[f]=!0,b.deps[f]=g,b.depCount-=1,b.depCount||p(b))}}function o(b,f){var g=f.map,a=g.fullName,c=g.name,h=N[b]||(N[b]=n[b]),e;if(!f.loading)f.loading=!0,e=function(b){f.callback=function(){return b};p(f);s[f.id]=!0;A()},e.fromText=function(b,f){var g=Q;s[b]=!1;i.scriptCount+=1;i.fake[b]=!0;g&&(Q=!1);
d.exec(f);g&&(Q=!0);i.completeLoad(b)},a in n?e(n[a]):h.load(c,t(g.parentMap,!0,function(b,a){var c=[],e,m;for(e=0;m=b[e];e++)m=l(m,g.parentMap),b[e]=m.fullName,m.prefix||c.push(b[e]);f.moduleDeps=(f.moduleDeps||[]).concat(c);return i.require(b,a)}),e,q)}function y(b){x[b.id]||(x[b.id]=b,J.push(b),i.waitCount+=1)}function D(b){this.listeners.push(b)}function v(b,f){var g=b.fullName,a=b.prefix,c=a?N[a]||(N[a]=n[a]):null,h,e;g&&(h=M[g]);if(!h&&(e=!0,h={id:(a&&!c?O++ +"__p@:":"")+(g||"__r@"+O++),map:b,
depCount:0,depDone:[],depCallbacks:[],deps:[],listeners:[],add:D},B[h.id]=!0,g&&(!a||N[a])))M[g]=h;a&&!c?(g=l(a),a in n&&!n[a]&&(delete n[a],delete R[g.url]),a=v(g,!0),a.add(function(){var f=l(b.originalName,b.parentMap),f=v(f,!0);h.placeholder=!0;f.add(function(b){h.callback=function(){return b};p(h)})})):e&&f&&(s[h.id]=!1,i.paused.push(h),y(h));return h}function C(b,f,a,c){var b=l(b,c),d=b.name,h=b.fullName,e=v(b),j=e.id,k=e.deps,o;if(h){if(h in n||s[j]===!0||h==="jquery"&&q.jQuery&&q.jQuery!==
a().fn.jquery)return;B[j]=!0;s[j]=!0;h==="jquery"&&a&&W(a())}e.depArray=f;e.callback=a;for(a=0;a<f.length;a++)if(j=f[a])j=l(j,d?b:c),o=j.fullName,f[a]=o,o==="require"?k[a]=t(b):o==="exports"?(k[a]=n[h]={},e.usingExports=!0):o==="module"?e.cjsModule=k[a]={id:d,uri:d?i.nameToUrl(d,null,c):r,exports:n[h]}:o in n&&!(o in x)&&(!(h in H)||h in H&&T[o])?k[a]=n[o]:(h in H&&(H[o]=!0,delete n[o],R[j.url]=!1),e.depCount+=1,e.depCallbacks[a]=u(e,a),v(j,!0).add(e.depCallbacks[a]));e.depCount?y(e):p(e)}function w(b){C.apply(null,
b)}function F(b,f){var a=b.map.fullName,c=b.depArray,d=!0,h,e,i,l;if(b.isDone||!a||!s[a])return l;if(f[a])return b;f[a]=!0;if(c){for(h=0;h<c.length;h++){e=c[h];if(!s[e]&&!ia[e]){d=!1;break}if((i=x[e])&&!i.isDone&&s[e])if(l=F(i,f))break}d||(l=r,delete f[a])}return l}function z(b,a){var g=b.map.fullName,c=b.depArray,d,h,e,i;if(b.isDone||!g||!s[g])return r;if(g){if(a[g])return n[g];a[g]=!0}if(c)for(d=0;d<c.length;d++)if(h=c[d])if((e=l(h).prefix)&&(i=x[e])&&z(i,a),(e=x[h])&&!e.isDone&&s[h])h=z(e,a),b.depCallbacks[d](h);
return n[g]}function E(){var b=q.waitSeconds*1E3,b=b&&i.startTime+b<(new Date).getTime(),a="",c=!1,l=!1,k=[],h,e;if(i.pausedCount>0)return r;if(q.priorityWait)if(j())A();else return r;for(h in s)if(!(h in L)&&(c=!0,!s[h]))if(b)a+=h+" ";else if(l=!0,h.indexOf("!")===-1){k=[];break}else(e=M[h]&&M[h].moduleDeps)&&k.push.apply(k,e);if(!c&&!i.waitCount)return r;if(b&&a)return b=P("timeout","Load timeout for modules: "+a),b.requireType="timeout",b.requireModules=a,b.contextName=i.contextName,d.onError(b);
if(l&&k.length)for(a=0;h=x[k[a]];a++)if(h=F(h,{})){z(h,{});break}if(!b&&(l||i.scriptCount)){if((I||da)&&!X)X=setTimeout(function(){X=0;E()},50);return r}if(i.waitCount){for(a=0;h=J[a];a++)z(h,{});i.paused.length&&A();Y<5&&(Y+=1,E())}Y=0;d.checkReadyState();return r}var i,A,q={waitSeconds:7,baseUrl:"./",paths:{},pkgs:{},catchError:{}},S=[],B={require:!0,exports:!0,module:!0},G={},n={},s={},x={},J=[],R={},O=0,M={},N={},H={},T={},Z=0;W=function(b){if(!i.jQuery&&(b=b||(typeof jQuery!=="undefined"?jQuery:
null))&&!(q.jQuery&&b.fn.jquery!==q.jQuery)&&("holdReady"in b||"readyWait"in b))if(i.jQuery=b,w(["jquery",[],function(){return jQuery}]),i.scriptCount)V(b,!0),i.jQueryIncremented=!0};A=function(){var b,a,c,l,k,h;i.takeGlobalQueue();Z+=1;if(i.scriptCount<=0)i.scriptCount=0;for(;S.length;)if(b=S.shift(),b[0]===null)return d.onError(P("mismatch","Mismatched anonymous define() module: "+b[b.length-1]));else w(b);if(!q.priorityWait||j())for(;i.paused.length;){k=i.paused;i.pausedCount+=k.length;i.paused=
[];for(l=0;b=k[l];l++)a=b.map,c=a.url,h=a.fullName,a.prefix?o(a.prefix,b):!R[c]&&!s[h]&&((q.requireLoad||d.load)(i,h,c),c.indexOf("empty:")!==0&&(R[c]=!0));i.startTime=(new Date).getTime();i.pausedCount-=k.length}Z===1&&E();Z-=1;return r};i={contextName:a,config:q,defQueue:S,waiting:x,waitCount:0,specified:B,loaded:s,urlMap:G,urlFetched:R,scriptCount:0,defined:n,paused:[],pausedCount:0,plugins:N,needFullExec:H,fake:{},fullExec:T,managerCallbacks:M,makeModuleMap:l,normalize:c,configure:function(b){var a,
c,d;b.baseUrl&&b.baseUrl.charAt(b.baseUrl.length-1)!=="/"&&(b.baseUrl+="/");a=q.paths;d=q.pkgs;$(q,b,!0);if(b.paths){for(c in b.paths)c in L||(a[c]=b.paths[c]);q.paths=a}if((a=b.packagePaths)||b.packages){if(a)for(c in a)c in L||aa(d,a[c],c);b.packages&&aa(d,b.packages);q.pkgs=d}if(b.priority)c=i.requireWait,i.requireWait=!1,A(),i.require(b.priority),A(),i.requireWait=c,q.priorityWait=b.priority;if(b.deps||b.callback)i.require(b.deps||[],b.callback)},requireDefined:function(b,a){return l(b,a).fullName in
n},requireSpecified:function(b,a){return l(b,a).fullName in B},require:function(b,c,g){if(typeof b==="string"){if(K(c))return d.onError(P("requireargs","Invalid require call"));if(d.get)return d.get(i,b,c);c=l(b,c);b=c.fullName;return!(b in n)?d.onError(P("notloaded","Module name '"+c.fullName+"' has not been loaded yet for context: "+a)):n[b]}(b&&b.length||c)&&C(null,b,c,g);if(!i.requireWait)for(;!i.scriptCount&&i.paused.length;)A();return i.require},takeGlobalQueue:function(){U.length&&(ja.apply(i.defQueue,
[i.defQueue.length-1,0].concat(U)),U=[])},completeLoad:function(b){var a;for(i.takeGlobalQueue();S.length;)if(a=S.shift(),a[0]===null){a[0]=b;break}else if(a[0]===b)break;else w(a),a=null;a?w(a):w([b,[],b==="jquery"&&typeof jQuery!=="undefined"?function(){return jQuery}:null]);d.isAsync&&(i.scriptCount-=1);A();d.isAsync||(i.scriptCount-=1)},toUrl:function(b,a){var c=b.lastIndexOf("."),d=null;c!==-1&&(d=b.substring(c,b.length),b=b.substring(0,c));return i.nameToUrl(b,d,a)},nameToUrl:function(b,a,g){var l,
k,h,e,j=i.config,b=c(b,g&&g.fullName);if(d.jsExtRegExp.test(b))a=b+(a?a:"");else{l=j.paths;k=j.pkgs;g=b.split("/");for(e=g.length;e>0;e--)if(h=g.slice(0,e).join("/"),l[h]){g.splice(0,e,l[h]);break}else if(h=k[h]){b=b===h.name?h.location+"/"+h.main:h.location;g.splice(0,e,b);break}a=g.join("/")+(a||".js");a=(a.charAt(0)==="/"||a.match(/^[\w\+\.\-]+:/)?"":j.baseUrl)+a}return j.urlArgs?a+((a.indexOf("?")===-1?"?":"&")+j.urlArgs):a}};i.jQueryCheck=W;i.resume=A;return i}function ka(){var a,c,d;if(C&&C.readyState===
"interactive")return C;a=document.getElementsByTagName("script");for(c=a.length-1;c>-1&&(d=a[c]);c--)if(d.readyState==="interactive")return C=d;return null}var la=/(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,ma=/require\(\s*["']([^'"\s]+)["']\s*\)/g,fa=/^\.\//,ba=/\.js$/,O=Object.prototype.toString,u=Array.prototype,ha=u.slice,ja=u.splice,I=!!(typeof window!=="undefined"&&navigator&&document),da=!I&&typeof importScripts!=="undefined",na=I&&navigator.platform==="PLAYSTATION 3"?/^complete$/:/^(complete|loaded)$/,
ea=typeof opera!=="undefined"&&opera.toString()==="[object Opera]",L={},D={},U=[],C=null,Y=0,Q=!1,ia={require:!0,module:!0,exports:!0},d,u={},J,y,v,E,o,w,F,B,z,W,X;if(typeof define==="undefined"){if(typeof requirejs!=="undefined")if(K(requirejs))return;else u=requirejs,requirejs=r;typeof require!=="undefined"&&!K(require)&&(u=require,require=r);d=requirejs=function(a,c,d){var j="_",k;!G(a)&&typeof a!=="string"&&(k=a,G(c)?(a=c,c=d):a=[]);if(k&&k.context)j=k.context;d=D[j]||(D[j]=ga(j));k&&d.configure(k);
return d.require(a,c)};d.config=function(a){return d(a)};require||(require=d);d.toUrl=function(a){return D._.toUrl(a)};d.version="1.0.8";d.jsExtRegExp=/^\/|:|\?|\.js$/;y=d.s={contexts:D,skipAsync:{}};if(d.isAsync=d.isBrowser=I)if(v=y.head=document.getElementsByTagName("head")[0],E=document.getElementsByTagName("base")[0])v=y.head=E.parentNode;d.onError=function(a){throw a;};d.load=function(a,c,l){d.resourcesReady(!1);a.scriptCount+=1;d.attach(l,a,c);if(a.jQuery&&!a.jQueryIncremented)V(a.jQuery,!0),
a.jQueryIncremented=!0};define=function(a,c,d){var j,k;typeof a!=="string"&&(d=c,c=a,a=null);G(c)||(d=c,c=[]);!c.length&&K(d)&&d.length&&(d.toString().replace(la,"").replace(ma,function(a,d){c.push(d)}),c=(d.length===1?["require"]:["require","exports","module"]).concat(c));if(Q&&(j=J||ka()))a||(a=j.getAttribute("data-requiremodule")),k=D[j.getAttribute("data-requirecontext")];(k?k.defQueue:U).push([a,c,d]);return r};define.amd={multiversion:!0,plugins:!0,jQuery:!0};d.exec=function(a){return eval(a)};
d.execCb=function(a,c,d,j){return c.apply(j,d)};d.addScriptToDom=function(a){J=a;E?v.insertBefore(a,E):v.appendChild(a);J=null};d.onScriptLoad=function(a){var c=a.currentTarget||a.srcElement,l;if(a.type==="load"||c&&na.test(c.readyState))C=null,a=c.getAttribute("data-requirecontext"),l=c.getAttribute("data-requiremodule"),D[a].completeLoad(l),c.detachEvent&&!ea?c.detachEvent("onreadystatechange",d.onScriptLoad):c.removeEventListener("load",d.onScriptLoad,!1)};d.attach=function(a,c,l,j,k,o){var p;
if(I)return j=j||d.onScriptLoad,p=c&&c.config&&c.config.xhtml?document.createElementNS("http://www.w3.org/1999/xhtml","html:script"):document.createElement("script"),p.type=k||c&&c.config.scriptType||"text/javascript",p.charset="utf-8",p.async=!y.skipAsync[a],c&&p.setAttribute("data-requirecontext",c.contextName),p.setAttribute("data-requiremodule",l),p.attachEvent&&!(p.attachEvent.toString&&p.attachEvent.toString().indexOf("[native code]")<0)&&!ea?(Q=!0,o?p.onreadystatechange=function(){if(p.readyState===
"loaded")p.onreadystatechange=null,p.attachEvent("onreadystatechange",j),o(p)}:p.attachEvent("onreadystatechange",j)):p.addEventListener("load",j,!1),p.src=a,o||d.addScriptToDom(p),p;else da&&(importScripts(a),c.completeLoad(l));return null};if(I){o=document.getElementsByTagName("script");for(B=o.length-1;B>-1&&(w=o[B]);B--){if(!v)v=w.parentNode;if(F=w.getAttribute("data-main")){if(!u.baseUrl)o=F.split("/"),w=o.pop(),o=o.length?o.join("/")+"/":"./",u.baseUrl=o,F=w.replace(ba,"");u.deps=u.deps?u.deps.concat(F):
[F];break}}}d.checkReadyState=function(){var a=y.contexts,c;for(c in a)if(!(c in L)&&a[c].waitCount)return;d.resourcesReady(!0)};d.resourcesReady=function(a){var c,l;d.resourcesDone=a;if(d.resourcesDone)for(l in a=y.contexts,a)if(!(l in L)&&(c=a[l],c.jQueryIncremented))V(c.jQuery,!1),c.jQueryIncremented=!1};d.pageLoaded=function(){if(document.readyState!=="complete")document.readyState="complete"};if(I&&document.addEventListener&&!document.readyState)document.readyState="loading",window.addEventListener("load",
d.pageLoaded,!1);d(u);if(d.isAsync&&typeof setTimeout!=="undefined")z=y.contexts[u.context||"_"],z.requireWait=!0,setTimeout(function(){z.requireWait=!1;z.scriptCount||z.resume();d.checkReadyState()},0)}})();

(function(window) {

var ORIGIN_ = location.protocol + '//' + location.host;

function SlideController() {
  this.popup = null;
  this.isPopup = window.opener;

  if (this.setupDone()) {
    window.addEventListener('message', this.onMessage_.bind(this), false);

    // Close popups if we reload the main window.
    window.addEventListener('beforeunload', function(e) {
      if (this.popup) {
        this.popup.close();
      }
    }.bind(this), false);
  }
}

SlideController.PRESENTER_MODE_PARAM = 'presentme';

SlideController.prototype.setupDone = function() {
  var params = location.search.substring(1).split('&').map(function(el) {
    return el.split('=');
  });

  var presentMe = null;
  for (var i = 0, param; param = params[i]; ++i) {
    if (param[0].toLowerCase() == SlideController.PRESENTER_MODE_PARAM) {
      presentMe = param[1] == 'true';
      break;
    }
  }

  if (presentMe !== null) {
    localStorage.ENABLE_PRESENTOR_MODE = presentMe;
    // TODO: use window.history.pushState to update URL instead of the redirect.
    if (window.history.replaceState) {
      window.history.replaceState({}, '', location.pathname);
    } else {
      location.replace(location.pathname);
      return false;
    }
  }

  var enablePresenterMode = localStorage.getItem('ENABLE_PRESENTOR_MODE');
  if (enablePresenterMode && JSON.parse(enablePresenterMode)) {
    // Only open popup from main deck. Don't want recursive popup opening!
    if (!this.isPopup) {
      var opts = 'menubar=no,location=yes,resizable=yes,scrollbars=no,status=no';
      this.popup = window.open(location.href, 'mywindow', opts);

      // Loading in the popup? Trigger the hotkey for turning presenter mode on.
      this.popup.addEventListener('load', function(e) {
        var evt = this.popup.document.createEvent('Event');
        evt.initEvent('keydown', true, true);
        evt.keyCode = 'P'.charCodeAt(0);
        this.popup.document.dispatchEvent(evt);
        // this.popup.document.body.classList.add('with-notes');
        // document.body.classList.add('popup');
      }.bind(this), false);
    }
  }

  return true;
}

SlideController.prototype.onMessage_ = function(e) {
  var data = e.data;

  // Restrict messages to being from this origin. Allow local developmet
  // from file:// though.
  // TODO: It would be dope if FF implemented location.origin!
  if (e.origin != ORIGIN_ && ORIGIN_.indexOf('file://') != 0) {
    alert('Someone tried to postMessage from an unknown origin');
    return;
  }

  // if (e.source.location.hostname != 'localhost') {
  //   alert('Someone tried to postMessage from an unknown origin');
  //   return;
  // }

  if ('keyCode' in data) {
    var evt = document.createEvent('Event');
    evt.initEvent('keydown', true, true);
    evt.keyCode = data.keyCode;
    document.dispatchEvent(evt);
  }
};

SlideController.prototype.sendMsg = function(msg) {
  // // Send message to popup window.
  // if (this.popup) {
  //   this.popup.postMessage(msg, ORIGIN_);
  // }

  // Send message to main window.
  if (this.isPopup) {
    // TODO: It would be dope if FF implemented location.origin.
    window.opener.postMessage(msg, '*');
  }
};

window.SlideController = SlideController;

})(window);


/**
 * @authors Luke Mahe
 * @authors Eric Bidelman
 * @fileoverview TODO
 */
document.cancelFullScreen = document.webkitCancelFullScreen ||
                            document.mozCancelFullScreen;

/**
 * @constructor
 */
function SlideDeck(el) {
  this.curSlide_ = 0;
  this.prevSlide_ = 0;
  this.config_ = null;
  this.container = el || document.querySelector('slides');
  this.slides = [];
  this.controller = null;

  this.getCurrentSlideFromHash_();

  // Call this explicitly. Modernizr.load won't be done until after DOM load.
  this.onDomLoaded_.bind(this)();
}

/**
 * @const
 * @private
 */
SlideDeck.prototype.SLIDE_CLASSES_ = [
  'far-past', 'past', 'current', 'next', 'far-next'];

/**
 * @const
 * @private
 */
SlideDeck.prototype.CSS_DIR_ = 'theme/css/';

/**
 * @private
 */
SlideDeck.prototype.getCurrentSlideFromHash_ = function() {
  var slideNo = parseInt(document.location.hash.substr(1));

  if (slideNo) {
    this.curSlide_ = slideNo - 1;
  } else {
    this.curSlide_ = 0;
  }
};

/**
 * @param {number} slideNo
 */
SlideDeck.prototype.loadSlide = function(slideNo) {
  if (slideNo) {
    this.curSlide_ = slideNo - 1;
    this.updateSlides_();
  }
};

/**
 * @private
 */
SlideDeck.prototype.onDomLoaded_ = function(e) {
  document.body.classList.add('loaded'); // Add loaded class for templates to use.

  this.slides = this.container.querySelectorAll('slide:not([hidden]):not(.hidden):not(.backdrop)');

  // If we're on a smartphone, apply special sauce.
  if (Modernizr.mq('only screen and (max-device-width: 480px)')) {
    // var style = document.createElement('link');
    // style.rel = 'stylesheet';
    // style.type = 'text/css';
    // style.href = this.CSS_DIR_ + 'phone.css';
    // document.querySelector('head').appendChild(style);

    // No need for widescreen layout on a phone.
    this.container.classList.remove('layout-widescreen');
  }

  this.loadConfig_(SLIDE_CONFIG);
  this.addEventListeners_();
  this.updateSlides_();

  // Add slide numbers and total slide count metadata to each slide.
  var that = this;
  for (var i = 0, slide; slide = this.slides[i]; ++i) {
    slide.dataset.slideNum = i + 1;
    slide.dataset.totalSlides = this.slides.length;

    slide.addEventListener('click', function(e) {
      if (document.body.classList.contains('overview')) {
        that.loadSlide(this.dataset.slideNum);
        e.preventDefault();
        window.setTimeout(function() {
          that.toggleOverview();
        }, 500);
      }
    }, false);
  }

  // Note: this needs to come after addEventListeners_(), which adds a
  // 'keydown' listener that this controller relies on.

  // Modernizr.touch isn't a sufficient check for devices that support both
  // touch and mouse. Create the controller in all cases.
  // // Also, no need to set this up if we're on mobile.
  // if (!Modernizr.touch) {
    this.controller = new SlideController(this);
    if (this.controller.isPopup) {
      document.body.classList.add('popup');
    }
  //}
};

/**
 * @private
 */
SlideDeck.prototype.addEventListeners_ = function() {
  document.addEventListener('keydown', this.onBodyKeyDown_.bind(this), false);
  window.addEventListener('popstate', this.onPopState_.bind(this), false);

  // var transEndEventNames = {
  //   'WebkitTransition': 'webkitTransitionEnd',
  //   'MozTransition': 'transitionend',
  //   'OTransition': 'oTransitionEnd',
  //   'msTransition': 'MSTransitionEnd',
  //   'transition': 'transitionend'
  // };
  // 
  // // Find the correct transitionEnd vendor prefix.
  // window.transEndEventName = transEndEventNames[
  //     Modernizr.prefixed('transition')];
  // 
  // // When slides are done transitioning, kickoff loading iframes.
  // // Note: we're only looking at a single transition (on the slide). This
  // // doesn't include autobuilds the slides may have. Also, if the slide
  // // transitions on multiple properties (e.g. not just 'all'), this doesn't
  // // handle that case.
  // this.container.addEventListener(transEndEventName, function(e) {
  //     this.enableSlideFrames_(this.curSlide_);
  // }.bind(this), false);

  // document.addEventListener('slideenter', function(e) {
  //   var slide = e.target;
  //   window.setTimeout(function() {
  //     this.enableSlideFrames_(e.slideNumber);
  //     this.enableSlideFrames_(e.slideNumber + 1);
  //   }.bind(this), 300);
  // }.bind(this), false);
};

/**
 * @private
 * @param {Event} e The pop event.
 */
SlideDeck.prototype.onPopState_ = function(e) {
  if (e.state != null) {
    this.curSlide_ = e.state;
    this.updateSlides_(true);
  }
};

/**
 * @param {Event} e
 */
SlideDeck.prototype.onBodyKeyDown_ = function(e) {
  if (/^(input|textarea)$/i.test(e.target.nodeName) ||
      e.target.isContentEditable) {
    return;
  }

  // Forward keydowns to the main slides if we're the popup.
  if (this.controller && this.controller.isPopup) {
    this.controller.sendMsg({keyCode: e.keyCode});
  }

  switch (e.keyCode) {
    case 13: // Enter
      if (document.body.classList.contains('overview')) {
        this.toggleOverview();
      }
      break;

    case 39: // right arrow
    case 32: // space
    case 34: // PgDn
      this.nextSlide();
      e.preventDefault();
      break;

    case 37: // left arrow
    case 8: // Backspace
    case 33: // PgUp
      this.prevSlide();
      e.preventDefault();
      break;

    case 40: // down arrow
      this.nextSlide();
      e.preventDefault();
      break;

    case 38: // up arrow
      this.prevSlide();
      e.preventDefault();
      break;

    case 72: // H: Toggle code highlighting
      document.body.classList.toggle('highlight-code');
      break;

    case 79: // O: Toggle overview
      this.toggleOverview();
      break;

    case 80: // P
      if (this.controller && this.controller.isPopup) {
        document.body.classList.toggle('with-notes');
      } else if (this.controller && !this.controller.popup) {
        document.body.classList.toggle('with-notes');
      }
      break;

    case 82: // R
      // TODO: implement refresh on main slides when popup is refreshed.
      break;

    case 27: // ESC: Hide notes and highlighting
      document.body.classList.remove('with-notes');
      document.body.classList.remove('highlight-code');

      if (document.body.classList.contains('overview')) {
        this.toggleOverview();
      }
      break;

    case 70: // F: Toggle fullscreen
       // Only respect 'f' on body. Don't want to capture keys from an <input>.
       // Also, ignore browser's fullscreen shortcut (cmd+shift+f) so we don't
       // get trapped in fullscreen!
      if (e.target == document.body && !(e.shiftKey && e.metaKey)) {
        if (document.mozFullScreen !== undefined && !document.mozFullScreen) {
          document.body.mozRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        } else if (document.webkitIsFullScreen !== undefined && !document.webkitIsFullScreen) {
          document.body.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        } else {
          document.cancelFullScreen();
        }
      }
      break;

    case 87: // W: Toggle widescreen
      // Only respect 'w' on body. Don't want to capture keys from an <input>.
      if (e.target == document.body && !(e.shiftKey && e.metaKey)) {
        this.container.classList.toggle('layout-widescreen');
      }
      break;
  }
};

/**
 *
 */
SlideDeck.prototype.focusOverview_ = function() {
  var overview = document.body.classList.contains('overview');

  for (var i = 0, slide; slide = this.slides[i]; i++) {
    slide.style[Modernizr.prefixed('transform')] = overview ?
        'translateZ(-2500px) translate(' + (( i - this.curSlide_ ) * 105) +
                                       '%, 0%)' : '';
  }
};

/**
 */
SlideDeck.prototype.toggleOverview = function() {
  document.body.classList.toggle('overview');

  this.focusOverview_();
};

/**
 * @private
 */
SlideDeck.prototype.loadConfig_ = function(config) {
  if (!config) {
    return;
  }

  this.config_ = config;

  var settings = this.config_.settings;

  this.loadTheme_(settings.theme || []);

  if (settings.favIcon) {
    this.addFavIcon_(settings.favIcon);
  }

  // Prettyprint. Default to on.
  if (!!!('usePrettify' in settings) || settings.usePrettify) {
    prettyPrint();
  }

  if (settings.analytics) {
    this.loadAnalytics_();
  }

  if (settings.fonts) {
    this.addFonts_(settings.fonts);
  }

  // Builds. Default to on.
  if (!!!('useBuilds' in settings) || settings.useBuilds) {
    this.makeBuildLists_();
  }

  if (settings.title) {
    document.title = settings.title.replace(/<br\/?>/, ' ');
    if (settings.eventInfo && settings.eventInfo.title) {
      document.title +=  ' - ' + settings.eventInfo.title;
    }
    document.querySelector('[data-config-title]').innerHTML = settings.title;
  }

  if (settings.subtitle) {
    document.querySelector('[data-config-subtitle]').innerHTML = settings.subtitle;
  }

  if (this.config_.presenters) {
    var presenters = this.config_.presenters;
    var dataConfigContact = document.querySelector('[data-config-contact]');

    var html = [];
    if (presenters.length == 1) {
      var p = presenters[0];

      var presenterTitle = [p.name];
      if (p.company) {
        presenterTitle.push(p.company);
      }
      html = presenterTitle.join(' - ') + '<br>';

      var gplus = p.gplus ? '<span>g+</span><a href="' + p.gplus +
          '">' + p.gplus.replace(/https?:\/\//, '') + '</a>' : '';

      var twitter = p.twitter ? '<span>twitter</span>' +
          '<a href="http://twitter.com/' + p.twitter + '">' +
          p.twitter + '</a>' : '';

      var www = p.www ? '<span>www</span><a href="' + p.www +
                        '">' + p.www.replace(/https?:\/\//, '') + '</a>' : '';

      var github = p.github ? '<span>github</span><a href="' + p.github +
          '">' + p.github.replace(/https?:\/\//, '') + '</a>' : '';

      var html2 = [gplus, twitter, www, github].join('<br>');

      if (dataConfigContact) {
        dataConfigContact.innerHTML = html2;
      }
    } else {
      for (var i = 0, p; p = presenters[i]; ++i) {
        html.push(p.name + ' - ' + p.company);
      }
      html = html.join('<br>');
      if (dataConfigContact) {
        dataConfigContact.innerHTML = html;
      }
    }

    var dataConfigPresenter = document.querySelector('[data-config-presenter]');
    if (dataConfigPresenter) {
      dataConfigPresenter.innerHTML = html;
      if (settings.eventInfo) {
        var date = settings.eventInfo.date;
        var dateInfo = date ? ' - <time>' + date + '</time>' : '';
        dataConfigPresenter.innerHTML += settings.eventInfo.title + dateInfo;
      }
    }
  }

  /* Left/Right tap areas. Default to including. */
  if (!!!('enableSlideAreas' in settings) || settings.enableSlideAreas) {
    var el = document.createElement('div');
    el.classList.add('slide-area');
    el.id = 'prev-slide-area';
    el.addEventListener('click', this.prevSlide.bind(this), false);
    this.container.appendChild(el);

    var el = document.createElement('div');
    el.classList.add('slide-area');
    el.id = 'next-slide-area';
    el.addEventListener('click', this.nextSlide.bind(this), false);
    this.container.appendChild(el);
  }

  if (Modernizr.touch && (!!!('enableTouch' in settings) ||
      settings.enableTouch)) {
    var self = this;

    // Note: this prevents mobile zoom in/out but prevents iOS from doing
    // it's crazy scroll over effect and disaligning the slides.
    window.addEventListener('touchstart', function(e) {
      e.preventDefault();
    }, false);

    var hammer = new Hammer(this.container);
    hammer.ondragend = function(e) {
      if (e.direction == 'right' || e.direction == 'down') {
        self.prevSlide();
      } else if (e.direction == 'left' || e.direction == 'up') {
        self.nextSlide();
      }
    };
  }
};

/**
 * @private
 * @param {Array.<string>} fonts
 */
SlideDeck.prototype.addFonts_ = function(fonts) {
  var el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = ('https:' == document.location.protocol ? 'https' : 'http') +
      '://fonts.googleapis.com/css?family=' + fonts.join('|') + '&v2';
  document.querySelector('head').appendChild(el);
};

/**
 * @private
 */
SlideDeck.prototype.buildNextItem_ = function() {
  var slide = this.slides[this.curSlide_];
  var toBuild = slide.querySelector('.to-build');
  var built = slide.querySelector('.build-current');

  if (built) {
    built.classList.remove('build-current');
    if (built.classList.contains('fade')) {
      built.classList.add('build-fade');
    }
  }

  if (!toBuild) {
    var items = slide.querySelectorAll('.build-fade');
    for (var j = 0, item; item = items[j]; j++) {
      item.classList.remove('build-fade');
    }
    return false;
  }

  toBuild.classList.remove('to-build');
  toBuild.classList.add('build-current');

  return true;
};

/**
 * @param {boolean=} opt_dontPush
 */
SlideDeck.prototype.prevSlide = function(opt_dontPush) {
  if (this.curSlide_ > 0) {
    var bodyClassList = document.body.classList;
    bodyClassList.remove('highlight-code');

    // Toggle off speaker notes if they're showing when we move backwards on the
    // main slides. If we're the speaker notes popup, leave them up.
    if (this.controller && !this.controller.isPopup) {
      bodyClassList.remove('with-notes');
    } else if (!this.controller) {
      bodyClassList.remove('with-notes');
    }

    this.prevSlide_ = this.curSlide_--;

    this.updateSlides_(opt_dontPush);
  }
};

/**
 * @param {boolean=} opt_dontPush
 */
SlideDeck.prototype.nextSlide = function(opt_dontPush) {
  if (!document.body.classList.contains('overview') && this.buildNextItem_()) {
    return;
  }

  if (this.curSlide_ < this.slides.length - 1) {
    var bodyClassList = document.body.classList;
    bodyClassList.remove('highlight-code');

    // Toggle off speaker notes if they're showing when we advanced on the main
    // slides. If we're the speaker notes popup, leave them up.
    if (this.controller && !this.controller.isPopup) {
      bodyClassList.remove('with-notes');
    } else if (!this.controller) {
      bodyClassList.remove('with-notes');
    }

    this.prevSlide_ = this.curSlide_++;

    this.updateSlides_(opt_dontPush);
  }
};

/* Slide events */

/**
 * Triggered when a slide enter/leave event should be dispatched.
 *
 * @param {string} type The type of event to trigger
 *     (e.g. 'slideenter', 'slideleave').
 * @param {number} slideNo The index of the slide that is being left.
 */
SlideDeck.prototype.triggerSlideEvent = function(type, slideNo) {
  var el = this.getSlideEl_(slideNo);
  if (!el) {
    return;
  }

  // Call onslideenter/onslideleave if the attribute is defined on this slide.
  var func = el.getAttribute(type);
  if (func) {
    new Function(func).call(el); // TODO: Don't use new Function() :(
  }

  // Dispatch event to listeners setup using addEventListener.
  var evt = document.createEvent('Event');
  evt.initEvent(type, true, true);
  evt.slideNumber = slideNo + 1; // Make it readable
  evt.slide = el;

  el.dispatchEvent(evt);
};

/**
 * @private
 */
SlideDeck.prototype.updateSlides_ = function(opt_dontPush) {
  var dontPush = opt_dontPush || false;

  var curSlide = this.curSlide_;
  for (var i = 0; i < this.slides.length; ++i) {
    switch (i) {
      case curSlide - 2:
        this.updateSlideClass_(i, 'far-past');
        break;
      case curSlide - 1:
        this.updateSlideClass_(i, 'past');
        break;
      case curSlide:
        this.updateSlideClass_(i, 'current');
        break;
      case curSlide + 1:
        this.updateSlideClass_(i, 'next');
        break;
      case curSlide + 2:
        this.updateSlideClass_(i, 'far-next');
        break;
      default:
        this.updateSlideClass_(i);
        break;
    }
  };

  this.triggerSlideEvent('slideleave', this.prevSlide_);
  this.triggerSlideEvent('slideenter', curSlide);

// window.setTimeout(this.disableSlideFrames_.bind(this, curSlide - 2), 301);
// 
// this.enableSlideFrames_(curSlide - 1); // Previous slide.
// this.enableSlideFrames_(curSlide + 1); // Current slide.
// this.enableSlideFrames_(curSlide + 2); // Next slide.

   // Enable current slide's iframes (needed for page loat at current slide).
   this.enableSlideFrames_(curSlide + 1);

   // No way to tell when all slide transitions + auto builds are done.
   // Give ourselves a good buffer to preload the next slide's iframes.
   window.setTimeout(this.enableSlideFrames_.bind(this, curSlide + 2), 1000);

  this.updateHash_(dontPush);

  if (document.body.classList.contains('overview')) {
    this.focusOverview_();
    return;
  }

};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.enableSlideFrames_ = function(slideNo) {
  var el = this.slides[slideNo - 1];
  if (!el) {
    return;
  }

  var frames = el.querySelectorAll('iframe');
  for (var i = 0, frame; frame = frames[i]; i++) {
    this.enableFrame_(frame);
  }
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.enableFrame_ = function(frame) {
  var src = frame.dataset.src;
  if (src && frame.src != src) {
    frame.src = src;
  }
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.disableSlideFrames_ = function(slideNo) {
  var el = this.slides[slideNo - 1];
  if (!el) {
    return;
  }

  var frames = el.querySelectorAll('iframe');
  for (var i = 0, frame; frame = frames[i]; i++) {
    this.disableFrame_(frame);
  }
};

/**
 * @private
 * @param {Node} frame
 */
SlideDeck.prototype.disableFrame_ = function(frame) {
  frame.src = 'about:blank';
};

/**
 * @private
 * @param {number} slideNo
 */
SlideDeck.prototype.getSlideEl_ = function(no) {
  if ((no < 0) || (no >= this.slides.length)) {
    return null;
  } else {
    return this.slides[no];
  }
};

/**
 * @private
 * @param {number} slideNo
 * @param {string} className
 */
SlideDeck.prototype.updateSlideClass_ = function(slideNo, className) {
  var el = this.getSlideEl_(slideNo);

  if (!el) {
    return;
  }

  if (className) {
    el.classList.add(className);
  }

  for (var i = 0, slideClass; slideClass = this.SLIDE_CLASSES_[i]; ++i) {
    if (className != slideClass) {
      el.classList.remove(slideClass);
    }
  }
};

/**
 * @private
 */
SlideDeck.prototype.makeBuildLists_ = function () {
  for (var i = this.curSlide_, slide; slide = this.slides[i]; ++i) {
    var items = slide.querySelectorAll('.build > *');
    for (var j = 0, item; item = items[j]; ++j) {
      if (item.classList) {
        item.classList.add('to-build');
        if (item.parentNode.classList.contains('fade')) {
          item.classList.add('fade');
        }
      }
    }
  }
};

/**
 * @private
 * @param {boolean} dontPush
 */
SlideDeck.prototype.updateHash_ = function(dontPush) {
  if (!dontPush) {
    var slideNo = this.curSlide_ + 1;
    var hash = '#' + slideNo;
    if (window.history.pushState) {
      window.history.pushState(this.curSlide_, 'Slide ' + slideNo, hash);
    } else {
      window.location.replace(hash);
    }

    // Record GA hit on this slide.
    window['_gaq'] && window['_gaq'].push(['_trackPageview',
                                          document.location.href]);
  }
};


/**
 * @private
 * @param {string} favIcon
 */
SlideDeck.prototype.addFavIcon_ = function(favIcon) {
  var el = document.createElement('link');
  el.rel = 'icon';
  el.type = 'image/png';
  el.href = favIcon;
  document.querySelector('head').appendChild(el);
};

/**
 * @private
 * @param {string} theme
 */
SlideDeck.prototype.loadTheme_ = function(theme) {
  var styles = [];
  if (theme.constructor.name === 'String') {
    styles.push(theme);
  } else {
    styles = theme;
  }

  for (var i = 0, style; themeUrl = styles[i]; i++) {
    var style = document.createElement('link');
    style.rel = 'stylesheet';
    style.type = 'text/css';
    if (themeUrl.indexOf('http') == -1) {
      style.href = this.CSS_DIR_ + themeUrl + '.css';
    } else {
      style.href = themeUrl;
    }
    document.querySelector('head').appendChild(style);
  }
};

/**
 * @private
 */
SlideDeck.prototype.loadAnalytics_ = function() {
  var _gaq = window['_gaq'] || [];
  _gaq.push(['_setAccount', this.config_.settings.analytics]);
  _gaq.push(['_trackPageview']);

  (function() {
    var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
    ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
  })();
};


// Polyfill missing APIs (if we need to), then create the slide deck.
// iOS < 5 needs classList, dataset, and window.matchMedia. Modernizr contains
// the last one.
(function() {
  Modernizr.load({
    test: !!document.body.classList && !!document.body.dataset,
    nope: ['js/polyfills/classList.min.js', 'js/polyfills/dataset.min.js'],
    complete: function() {
      window.slidedeck = new SlideDeck();
    }
  });
})();

require(['order!../slide_config', 'order!modernizr.custom.45394',
         'order!prettify/prettify', 'order!hammer', 'order!slide-controller',
         'order!slide-deck'], function(someModule) {

});

/* @source http://purl.eligrey.com/github/classList.js/blob/master/classList.js*/
"use strict";if(typeof document!=="undefined"&&!("classList" in document.createElement("a"))){(function(a){var f="classList",d="prototype",e=(a.HTMLElement||a.Element)[d],g=Object;strTrim=String[d].trim||function(){return this.replace(/^\s+|\s+$/g,"")},arrIndexOf=Array[d].indexOf||function(k){for(var j=0,h=this.length;j<h;j++){if(j in this&&this[j]===k){return j}}return -1},DOMEx=function(h,i){this.name=h;this.code=DOMException[h];this.message=i},checkTokenAndGetIndex=function(i,h){if(h===""){throw new DOMEx("SYNTAX_ERR","An invalid or illegal string was specified")}if(/\s/.test(h)){throw new DOMEx("INVALID_CHARACTER_ERR","String contains an invalid character")}return arrIndexOf.call(i,h)},ClassList=function(m){var l=strTrim.call(m.className),k=l?l.split(/\s+/):[];for(var j=0,h=k.length;j<h;j++){this.push(k[j])}this._updateClassName=function(){m.className=this.toString()}},classListProto=ClassList[d]=[],classListGetter=function(){return new ClassList(this)};DOMEx[d]=Error[d];classListProto.item=function(h){return this[h]||null};classListProto.contains=function(h){h+="";return checkTokenAndGetIndex(this,h)!==-1};classListProto.add=function(h){h+="";if(checkTokenAndGetIndex(this,h)===-1){this.push(h);this._updateClassName()}};classListProto.remove=function(i){i+="";var h=checkTokenAndGetIndex(this,i);if(h!==-1){this.splice(h,1);this._updateClassName()}};classListProto.toggle=function(h){h+="";if(checkTokenAndGetIndex(this,h)===-1){this.add(h)}else{this.remove(h)}};classListProto.toString=function(){return this.join(" ")};if(g.defineProperty){var c={get:classListGetter,enumerable:true,configurable:true};try{g.defineProperty(e,f,c)}catch(b){if(b.number===-2146823252){c.enumerable=false;g.defineProperty(e,f,c)}}}else{if(g[d].__defineGetter__){e.__defineGetter__(f,classListGetter)}}}(self))};
(function(){function c(){d=!0;this.removeEventListener("DOMAttrModified",c,!1)}function g(b){return b.replace(h,function(b,a){return a.toUpperCase()})}function e(){var b={};i.call(this.attributes,function(a){if(f=a.name.match(j))b[g(f[1])]=a.value});return b}var i=[].forEach,j=/^data-(.+)/,h=/\-([a-z])/ig,a=document.createElement("div"),d=!1,f;a.dataset==void 0&&(a.addEventListener("DOMAttrModified",c,!1),a.setAttribute("foo","bar"),Element.prototype.__defineGetter__("dataset",d?function(){if(!this._datasetCache)this._datasetCache=
e.call(this);return this._datasetCache}:e),document.addEventListener("DOMAttrModified",function(a){delete a.target._datasetCache},!1))})();
(function(a,b){"use strict";var c=a.console||b,d=a.document,e=a.navigator,f=a.sessionStorage||!1,g=a.setTimeout,h=a.clearTimeout,i=a.setInterval,j=a.clearInterval,k=a.JSON,l=a.alert,m=a.History=a.History||{},n=a.history;k.stringify=k.stringify||k.encode,k.parse=k.parse||k.decode;if(typeof m.init!="undefined")throw new Error("History.js Core has already been loaded...");m.init=function(){return typeof m.Adapter=="undefined"?!1:(typeof m.initCore!="undefined"&&m.initCore(),typeof m.initHtml4!="undefined"&&m.initHtml4(),!0)},m.initCore=function(){if(typeof m.initCore.initialized!="undefined")return!1;m.initCore.initialized=!0,m.options=m.options||{},m.options.hashChangeInterval=m.options.hashChangeInterval||100,m.options.safariPollInterval=m.options.safariPollInterval||500,m.options.doubleCheckInterval=m.options.doubleCheckInterval||500,m.options.storeInterval=m.options.storeInterval||1e3,m.options.busyDelay=m.options.busyDelay||250,m.options.debug=m.options.debug||!1,m.options.initialTitle=m.options.initialTitle||d.title,m.intervalList=[],m.clearAllIntervals=function(){var a,b=m.intervalList;if(typeof b!="undefined"&&b!==null){for(a=0;a<b.length;a++)j(b[a]);m.intervalList=null}},m.debug=function(){(m.options.debug||!1)&&m.log.apply(m,arguments)},m.log=function(){var a=typeof c!="undefined"&&typeof c.log!="undefined"&&typeof c.log.apply!="undefined",b=d.getElementById("log"),e,f,g,h,i;a?(h=Array.prototype.slice.call(arguments),e=h.shift(),typeof c.debug!="undefined"?c.debug.apply(c,[e,h]):c.log.apply(c,[e,h])):e="\n"+arguments[0]+"\n";for(f=1,g=arguments.length;f<g;++f){i=arguments[f];if(typeof i=="object"&&typeof k!="undefined")try{i=k.stringify(i)}catch(j){}e+="\n"+i+"\n"}return b?(b.value+=e+"\n-----\n",b.scrollTop=b.scrollHeight-b.clientHeight):a||l(e),!0},m.getInternetExplorerMajorVersion=function(){var a=m.getInternetExplorerMajorVersion.cached=typeof m.getInternetExplorerMajorVersion.cached!="undefined"?m.getInternetExplorerMajorVersion.cached:function(){var a=3,b=d.createElement("div"),c=b.getElementsByTagName("i");while((b.innerHTML="<!--[if gt IE "+ ++a+"]><i></i><![endif]-->")&&c[0]);return a>4?a:!1}();return a},m.isInternetExplorer=function(){var a=m.isInternetExplorer.cached=typeof m.isInternetExplorer.cached!="undefined"?m.isInternetExplorer.cached:Boolean(m.getInternetExplorerMajorVersion());return a},m.emulated={pushState:!Boolean(a.history&&a.history.pushState&&a.history.replaceState&&!/ Mobile\/([1-7][a-z]|(8([abcde]|f(1[0-8]))))/i.test(e.userAgent)&&!/AppleWebKit\/5([0-2]|3[0-2])/i.test(e.userAgent)),hashChange:Boolean(!("onhashchange"in a||"onhashchange"in d)||m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<8)},m.enabled=!m.emulated.pushState,m.bugs={setHash:Boolean(!m.emulated.pushState&&e.vendor==="Apple Computer, Inc."&&/AppleWebKit\/5([0-2]|3[0-3])/.test(e.userAgent)),safariPoll:Boolean(!m.emulated.pushState&&e.vendor==="Apple Computer, Inc."&&/AppleWebKit\/5([0-2]|3[0-3])/.test(e.userAgent)),ieDoubleCheck:Boolean(m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<8),hashEscape:Boolean(m.isInternetExplorer()&&m.getInternetExplorerMajorVersion()<7)},m.isEmptyObject=function(a){for(var b in a)return!1;return!0},m.cloneObject=function(a){var b,c;return a?(b=k.stringify(a),c=k.parse(b)):c={},c},m.getRootUrl=function(){var a=d.location.protocol+"//"+(d.location.hostname||d.location.host);if(d.location.port||!1)a+=":"+d.location.port;return a+="/",a},m.getBaseHref=function(){var a=d.getElementsByTagName("base"),b=null,c="";return a.length===1&&(b=a[0],c=b.href.replace(/[^\/]+$/,"")),c=c.replace(/\/+$/,""),c&&(c+="/"),c},m.getBaseUrl=function(){var a=m.getBaseHref()||m.getBasePageUrl()||m.getRootUrl();return a},m.getPageUrl=function(){var a=m.getState(!1,!1),b=(a||{}).url||d.location.href,c;return c=b.replace(/\/+$/,"").replace(/[^\/]+$/,function(a,b,c){return/\./.test(a)?a:a+"/"}),c},m.getBasePageUrl=function(){var a=d.location.href.replace(/[#\?].*/,"").replace(/[^\/]+$/,function(a,b,c){return/[^\/]$/.test(a)?"":a}).replace(/\/+$/,"")+"/";return a},m.getFullUrl=function(a,b){var c=a,d=a.substring(0,1);return b=typeof b=="undefined"?!0:b,/[a-z]+\:\/\//.test(a)||(d==="/"?c=m.getRootUrl()+a.replace(/^\/+/,""):d==="#"?c=m.getPageUrl().replace(/#.*/,"")+a:d==="?"?c=m.getPageUrl().replace(/[\?#].*/,"")+a:b?c=m.getBaseUrl()+a.replace(/^(\.\/)+/,""):c=m.getBasePageUrl()+a.replace(/^(\.\/)+/,"")),c.replace(/\#$/,"")},m.getShortUrl=function(a){var b=a,c=m.getBaseUrl(),d=m.getRootUrl();return m.emulated.pushState&&(b=b.replace(c,"")),b=b.replace(d,"/"),m.isTraditionalAnchor(b)&&(b="./"+b),b=b.replace(/^(\.\/)+/g,"./").replace(/\#$/,""),b},m.store={},m.idToState=m.idToState||{},m.stateToId=m.stateToId||{},m.urlToId=m.urlToId||{},m.storedStates=m.storedStates||[],m.savedStates=m.savedStates||[],m.normalizeStore=function(){m.store.idToState=m.store.idToState||{},m.store.urlToId=m.store.urlToId||{},m.store.stateToId=m.store.stateToId||{}},m.getState=function(a,b){typeof a=="undefined"&&(a=!0),typeof b=="undefined"&&(b=!0);var c=m.getLastSavedState();return!c&&b&&(c=m.createStateObject()),a&&(c=m.cloneObject(c),c.url=c.cleanUrl||c.url),c},m.getIdByState=function(a){var b=m.extractId(a.url),c;if(!b){c=m.getStateString(a);if(typeof m.stateToId[c]!="undefined")b=m.stateToId[c];else if(typeof m.store.stateToId[c]!="undefined")b=m.store.stateToId[c];else{for(;;){b=(new Date).getTime()+String(Math.random()).replace(/\D/g,"");if(typeof m.idToState[b]=="undefined"&&typeof m.store.idToState[b]=="undefined")break}m.stateToId[c]=b,m.idToState[b]=a}}return b},m.normalizeState=function(a){var b,c;if(!a||typeof a!="object")a={};if(typeof a.normalized!="undefined")return a;if(!a.data||typeof a.data!="object")a.data={};b={},b.normalized=!0,b.title=a.title||"",b.url=m.getFullUrl(m.unescapeString(a.url||d.location.href)),b.hash=m.getShortUrl(b.url),b.data=m.cloneObject(a.data),b.id=m.getIdByState(b),b.cleanUrl=b.url.replace(/\??\&_suid.*/,""),b.url=b.cleanUrl,c=!m.isEmptyObject(b.data);if(b.title||c)b.hash=m.getShortUrl(b.url).replace(/\??\&_suid.*/,""),/\?/.test(b.hash)||(b.hash+="?"),b.hash+="&_suid="+b.id;return b.hashedUrl=m.getFullUrl(b.hash),(m.emulated.pushState||m.bugs.safariPoll)&&m.hasUrlDuplicate(b)&&(b.url=b.hashedUrl),b},m.createStateObject=function(a,b,c){var d={data:a,title:b,url:c};return d=m.normalizeState(d),d},m.getStateById=function(a){a=String(a);var c=m.idToState[a]||m.store.idToState[a]||b;return c},m.getStateString=function(a){var b,c,d;return b=m.normalizeState(a),c={data:b.data,title:a.title,url:a.url},d=k.stringify(c),d},m.getStateId=function(a){var b,c;return b=m.normalizeState(a),c=b.id,c},m.getHashByState=function(a){var b,c;return b=m.normalizeState(a),c=b.hash,c},m.extractId=function(a){var b,c,d;return c=/(.*)\&_suid=([0-9]+)$/.exec(a),d=c?c[1]||a:a,b=c?String(c[2]||""):"",b||!1},m.isTraditionalAnchor=function(a){var b=!/[\/\?\.]/.test(a);return b},m.extractState=function(a,b){var c=null,d,e;return b=b||!1,d=m.extractId(a),d&&(c=m.getStateById(d)),c||(e=m.getFullUrl(a),d=m.getIdByUrl(e)||!1,d&&(c=m.getStateById(d)),!c&&b&&!m.isTraditionalAnchor(a)&&(c=m.createStateObject(null,null,e))),c},m.getIdByUrl=function(a){var c=m.urlToId[a]||m.store.urlToId[a]||b;return c},m.getLastSavedState=function(){return m.savedStates[m.savedStates.length-1]||b},m.getLastStoredState=function(){return m.storedStates[m.storedStates.length-1]||b},m.hasUrlDuplicate=function(a){var b=!1,c;return c=m.extractState(a.url),b=c&&c.id!==a.id,b},m.storeState=function(a){return m.urlToId[a.url]=a.id,m.storedStates.push(m.cloneObject(a)),a},m.isLastSavedState=function(a){var b=!1,c,d,e;return m.savedStates.length&&(c=a.id,d=m.getLastSavedState(),e=d.id,b=c===e),b},m.saveState=function(a){return m.isLastSavedState(a)?!1:(m.savedStates.push(m.cloneObject(a)),!0)},m.getStateByIndex=function(a){var b=null;return typeof a=="undefined"?b=m.savedStates[m.savedStates.length-1]:a<0?b=m.savedStates[m.savedStates.length+a]:b=m.savedStates[a],b},m.getHash=function(){var a=m.unescapeHash(d.location.hash);return a},m.unescapeString=function(b){var c=b,d;for(;;){d=a.unescape(c);if(d===c)break;c=d}return c},m.unescapeHash=function(a){var b=m.normalizeHash(a);return b=m.unescapeString(b),b},m.normalizeHash=function(a){var b=a.replace(/[^#]*#/,"").replace(/#.*/,"");return b},m.setHash=function(a,b){var c,e,f;return b!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.setHash,args:arguments,queue:b}),!1):(c=m.escapeHash(a),m.busy(!0),e=m.extractState(a,!0),e&&!m.emulated.pushState?m.pushState(e.data,e.title,e.url,!1):d.location.hash!==c&&(m.bugs.setHash?(f=m.getPageUrl(),m.pushState(null,null,f+"#"+c,!1)):d.location.hash=c),m)},m.escapeHash=function(b){var c=m.normalizeHash(b);return c=a.escape(c),m.bugs.hashEscape||(c=c.replace(/\%21/g,"!").replace(/\%26/g,"&").replace(/\%3D/g,"=").replace(/\%3F/g,"?")),c},m.getHashByUrl=function(a){var b=String(a).replace(/([^#]*)#?([^#]*)#?(.*)/,"$2");return b=m.unescapeHash(b),b},m.setTitle=function(a){var b=a.title,c;b||(c=m.getStateByIndex(0),c&&c.url===a.url&&(b=c.title||m.options.initialTitle));try{d.getElementsByTagName("title")[0].innerHTML=b.replace("<","&lt;").replace(">","&gt;").replace(" & "," &amp; ")}catch(e){}return d.title=b,m},m.queues=[],m.busy=function(a){typeof a!="undefined"?m.busy.flag=a:typeof m.busy.flag=="undefined"&&(m.busy.flag=!1);if(!m.busy.flag){h(m.busy.timeout);var b=function(){var a,c,d;if(m.busy.flag)return;for(a=m.queues.length-1;a>=0;--a){c=m.queues[a];if(c.length===0)continue;d=c.shift(),m.fireQueueItem(d),m.busy.timeout=g(b,m.options.busyDelay)}};m.busy.timeout=g(b,m.options.busyDelay)}return m.busy.flag},m.busy.flag=!1,m.fireQueueItem=function(a){return a.callback.apply(a.scope||m,a.args||[])},m.pushQueue=function(a){return m.queues[a.queue||0]=m.queues[a.queue||0]||[],m.queues[a.queue||0].push(a),m},m.queue=function(a,b){return typeof a=="function"&&(a={callback:a}),typeof b!="undefined"&&(a.queue=b),m.busy()?m.pushQueue(a):m.fireQueueItem(a),m},m.clearQueue=function(){return m.busy.flag=!1,m.queues=[],m},m.stateChanged=!1,m.doubleChecker=!1,m.doubleCheckComplete=function(){return m.stateChanged=!0,m.doubleCheckClear(),m},m.doubleCheckClear=function(){return m.doubleChecker&&(h(m.doubleChecker),m.doubleChecker=!1),m},m.doubleCheck=function(a){return m.stateChanged=!1,m.doubleCheckClear(),m.bugs.ieDoubleCheck&&(m.doubleChecker=g(function(){return m.doubleCheckClear(),m.stateChanged||a(),!0},m.options.doubleCheckInterval)),m},m.safariStatePoll=function(){var b=m.extractState(d.location.href),c;if(!m.isLastSavedState(b))c=b;else return;return c||(c=m.createStateObject()),m.Adapter.trigger(a,"popstate"),m},m.back=function(a){return a!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.back,args:arguments,queue:a}),!1):(m.busy(!0),m.doubleCheck(function(){m.back(!1)}),n.go(-1),!0)},m.forward=function(a){return a!==!1&&m.busy()?(m.pushQueue({scope:m,callback:m.forward,args:arguments,queue:a}),!1):(m.busy(!0),m.doubleCheck(function(){m.forward(!1)}),n.go(1),!0)},m.go=function(a,b){var c;if(a>0)for(c=1;c<=a;++c)m.forward(b);else{if(!(a<0))throw new Error("History.go: History.go requires a positive or negative integer passed.");for(c=-1;c>=a;--c)m.back(b)}return m};if(m.emulated.pushState){var o=function(){};m.pushState=m.pushState||o,m.replaceState=m.replaceState||o}else m.onPopState=function(b,c){var e=!1,f=!1,g,h;return m.doubleCheckComplete(),g=m.getHash(),g?(h=m.extractState(g||d.location.href,!0),h?m.replaceState(h.data,h.title,h.url,!1):(m.Adapter.trigger(a,"anchorchange"),m.busy(!1)),m.expectedStateId=!1,!1):(e=m.Adapter.extractEventData("state",b,c)||!1,e?f=m.getStateById(e):m.expectedStateId?f=m.getStateById(m.expectedStateId):f=m.extractState(d.location.href),f||(f=m.createStateObject(null,null,d.location.href)),m.expectedStateId=!1,m.isLastSavedState(f)?(m.busy(!1),!1):(m.storeState(f),m.saveState(f),m.setTitle(f),m.Adapter.trigger(a,"statechange"),m.busy(!1),!0))},m.Adapter.bind(a,"popstate",m.onPopState),m.pushState=function(b,c,d,e){if(m.getHashByUrl(d)&&m.emulated.pushState)throw new Error("History.js does not support states with fragement-identifiers (hashes/anchors).");if(e!==!1&&m.busy())return m.pushQueue({scope:m,callback:m.pushState,args:arguments,queue:e}),!1;m.busy(!0);var f=m.createStateObject(b,c,d);return m.isLastSavedState(f)?m.busy(!1):(m.storeState(f),m.expectedStateId=f.id,n.pushState(f.id,f.title,f.url),m.Adapter.trigger(a,"popstate")),!0},m.replaceState=function(b,c,d,e){if(m.getHashByUrl(d)&&m.emulated.pushState)throw new Error("History.js does not support states with fragement-identifiers (hashes/anchors).");if(e!==!1&&m.busy())return m.pushQueue({scope:m,callback:m.replaceState,args:arguments,queue:e}),!1;m.busy(!0);var f=m.createStateObject(b,c,d);return m.isLastSavedState(f)?m.busy(!1):(m.storeState(f),m.expectedStateId=f.id,n.replaceState(f.id,f.title,f.url),m.Adapter.trigger(a,"popstate")),!0};if(f){try{m.store=k.parse(f.getItem("History.store"))||{}}catch(p){m.store={}}m.normalizeStore()}else m.store={},m.normalizeStore();m.Adapter.bind(a,"beforeunload",m.clearAllIntervals),m.Adapter.bind(a,"unload",m.clearAllIntervals),m.saveState(m.storeState(m.extractState(d.location.href,!0))),f&&(m.onUnload=function(){var a,b;try{a=k.parse(f.getItem("History.store"))||{}}catch(c){a={}}a.idToState=a.idToState||{},a.urlToId=a.urlToId||{},a.stateToId=a.stateToId||{};for(b in m.idToState){if(!m.idToState.hasOwnProperty(b))continue;a.idToState[b]=m.idToState[b]}for(b in m.urlToId){if(!m.urlToId.hasOwnProperty(b))continue;a.urlToId[b]=m.urlToId[b]}for(b in m.stateToId){if(!m.stateToId.hasOwnProperty(b))continue;a.stateToId[b]=m.stateToId[b]}m.store=a,m.normalizeStore(),f.setItem("History.store",k.stringify(a))},m.intervalList.push(i(m.onUnload,m.options.storeInterval)),m.Adapter.bind(a,"beforeunload",m.onUnload),m.Adapter.bind(a,"unload",m.onUnload));if(!m.emulated.pushState){m.bugs.safariPoll&&m.intervalList.push(i(m.safariStatePoll,m.options.safariPollInterval));if(e.vendor==="Apple Computer, Inc."||(e.appCodeName||"")==="Mozilla")m.Adapter.bind(a,"hashchange",function(){m.Adapter.trigger(a,"popstate")}),m.getHash()&&m.Adapter.onDomLoad(function(){m.Adapter.trigger(a,"hashchange")})}},m.init()})(window)
PR.registerLangHandler(PR.createSimpleLexer([["com",/^#[^\n\r]*/,null,"#"],["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,null,'"']],[["kwd",/^(?:ADS|AD|AUG|BZF|BZMF|CAE|CAF|CA|CCS|COM|CS|DAS|DCA|DCOM|DCS|DDOUBL|DIM|DOUBLE|DTCB|DTCF|DV|DXCH|EDRUPT|EXTEND|INCR|INDEX|NDX|INHINT|LXCH|MASK|MSK|MP|MSU|NOOP|OVSK|QXCH|RAND|READ|RELINT|RESUME|RETURN|ROR|RXOR|SQUARE|SU|TCR|TCAA|OVSK|TCF|TC|TS|WAND|WOR|WRITE|XCH|XLQ|XXALQ|ZL|ZQ|ADD|ADZ|SUB|SUZ|MPY|MPR|MPZ|DVP|COM|ABS|CLA|CLZ|LDQ|STO|STQ|ALS|LLS|LRS|TRA|TSQ|TMI|TOV|AXT|TIX|DLY|INP|OUT)\s/,
null],["typ",/^(?:-?GENADR|=MINUS|2BCADR|VN|BOF|MM|-?2CADR|-?[1-6]DNADR|ADRES|BBCON|[ES]?BANK=?|BLOCK|BNKSUM|E?CADR|COUNT\*?|2?DEC\*?|-?DNCHAN|-?DNPTR|EQUALS|ERASE|MEMORY|2?OCT|REMADR|SETLOC|SUBRO|ORG|BSS|BES|SYN|EQU|DEFINE|END)\s/,null],["lit",/^'(?:-*(?:\w|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?)?/],["pln",/^-*(?:[!-z]|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?/],["pun",/^[^\w\t\n\r "'-);\\\xa0]+/]]),["apollo","agc","aea"]);

/*
 Copyright (C) 2011 Google Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/
var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["opn",/^[([{]+/,a,"([{"],["clo",/^[)\]}]+/,a,")]}"],["com",/^;[^\n\r]*/,a,";"],["pln",/^[\t\n\r \xa0]+/,a,"\t\n\r \xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,a,'"']],[["kwd",/^(?:def|if|do|let|quote|var|fn|loop|recur|throw|try|monitor-enter|monitor-exit|defmacro|defn|defn-|macroexpand|macroexpand-1|for|doseq|dosync|dotimes|and|or|when|not|assert|doto|proxy|defstruct|first|rest|cons|defprotocol|deftype|defrecord|reify|defmulti|defmethod|meta|with-meta|ns|in-ns|create-ns|import|intern|refer|alias|namespace|resolve|ref|deref|refset|new|set!|memfn|to-array|into-array|aset|gen-class|reduce|map|filter|find|nil?|empty?|hash-map|hash-set|vec|vector|seq|flatten|reverse|assoc|dissoc|list|list?|disj|get|union|difference|intersection|extend|extend-type|extend-protocol|prn)\b/,a],
["typ",/^:[\dA-Za-z-]+/]]),["clj"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\f\r ]+/,null," \t\r\n"]],[["str",/^"(?:[^\n\f\r"\\]|\\(?:\r\n?|\n|\f)|\\[\S\s])*"/,null],["str",/^'(?:[^\n\f\r'\\]|\\(?:\r\n?|\n|\f)|\\[\S\s])*'/,null],["lang-css-str",/^url\(([^"')]*)\)/i],["kwd",/^(?:url|rgb|!important|@import|@page|@media|@charset|inherit)(?=[^\w-]|$)/i,null],["lang-css-kw",/^(-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*)\s*:/i],["com",/^\/\*[^*]*\*+(?:[^*/][^*]*\*+)*\//],["com",
/^(?:<\!--|--\>)/],["lit",/^(?:\d+|\d*\.\d+)(?:%|[a-z]+)?/i],["lit",/^#[\da-f]{3,6}/i],["pln",/^-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*/i],["pun",/^[^\s\w"']+/]]),["css"]);PR.registerLangHandler(PR.createSimpleLexer([],[["kwd",/^-?(?:[_a-z]|\\[\da-f]+ ?)(?:[\w-]|\\\\[\da-f]+ ?)*/i]]),["css-kw"]);PR.registerLangHandler(PR.createSimpleLexer([],[["str",/^[^"')]+/]]),["css-str"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["pln",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])+(?:'|$)|`[^`]*(?:`|$))/,null,"\"'"]],[["com",/^(?:\/\/[^\n\r]*|\/\*[\S\s]*?\*\/)/],["pln",/^(?:[^"'/`]|\/(?![*/]))+/]]),["go"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t-\r ]+/,null,"\t\n\r "],["str",/^"(?:[^\n\f\r"\\]|\\[\S\s])*(?:"|$)/,null,'"'],["str",/^'(?:[^\n\f\r'\\]|\\[^&])'?/,null,"'"],["lit",/^(?:0o[0-7]+|0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i,null,"0123456789"]],[["com",/^(?:--+[^\n\f\r]*|{-(?:[^-]|-+[^}-])*-})/],["kwd",/^(?:case|class|data|default|deriving|do|else|if|import|in|infix|infixl|infixr|instance|let|module|newtype|of|then|type|where|_)(?=[^\d'A-Za-z]|$)/,
null],["pln",/^(?:[A-Z][\w']*\.)*[A-Za-z][\w']*/],["pun",/^[^\d\t-\r "'A-Za-z]+/]]),["hs"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["opn",/^\(+/,a,"("],["clo",/^\)+/,a,")"],["com",/^;[^\n\r]*/,a,";"],["pln",/^[\t\n\r \xa0]+/,a,"\t\n\r \xa0"],["str",/^"(?:[^"\\]|\\[\S\s])*(?:"|$)/,a,'"']],[["kwd",/^(?:block|c[ad]+r|catch|con[ds]|def(?:ine|un)|do|eq|eql|equal|equalp|eval-when|flet|format|go|if|labels|lambda|let|load-time-value|locally|macrolet|multiple-value-call|nil|progn|progv|quote|require|return-from|setq|symbol-macrolet|t|tagbody|the|throw|unwind)\b/,a],
["lit",/^[+-]?(?:[#0]x[\da-f]+|\d+\/\d+|(?:\.\d+|\d+(?:\.\d*)?)(?:[de][+-]?\d+)?)/i],["lit",/^'(?:-*(?:\w|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?)?/],["pln",/^-*(?:[_a-z]|\\[!-~])(?:[\w-]*|\\[!-~])[!=?]?/i],["pun",/^[^\w\t\n\r "'-);\\\xa0]+/]]),["cl","el","lisp","scm"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])*(?:'|$))/,null,"\"'"]],[["com",/^--(?:\[(=*)\[[\S\s]*?(?:]\1]|$)|[^\n\r]*)/],["str",/^\[(=*)\[[\S\s]*?(?:]\1]|$)/],["kwd",/^(?:and|break|do|else|elseif|end|false|for|function|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b/,null],["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],
["pln",/^[_a-z]\w*/i],["pun",/^[^\w\t\n\r \xa0][^\w\t\n\r "'+=\xa0-]*/]]),["lua"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["com",/^#(?:if[\t\n\r \xa0]+(?:[$_a-z][\w']*|``[^\t\n\r`]*(?:``|$))|else|endif|light)/i,null,"#"],["str",/^(?:"(?:[^"\\]|\\[\S\s])*(?:"|$)|'(?:[^'\\]|\\[\S\s])(?:'|$))/,null,"\"'"]],[["com",/^(?:\/\/[^\n\r]*|\(\*[\S\s]*?\*\))/],["kwd",/^(?:abstract|and|as|assert|begin|class|default|delegate|do|done|downcast|downto|elif|else|end|exception|extern|false|finally|for|fun|function|if|in|inherit|inline|interface|internal|lazy|let|match|member|module|mutable|namespace|new|null|of|open|or|override|private|public|rec|return|static|struct|then|to|true|try|type|upcast|use|val|void|when|while|with|yield|asr|land|lor|lsl|lsr|lxor|mod|sig|atomic|break|checked|component|const|constraint|constructor|continue|eager|event|external|fixed|functor|global|include|method|mixin|object|parallel|process|protected|pure|sealed|trait|virtual|volatile)\b/],
["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],["pln",/^(?:[_a-z][\w']*[!#?]?|``[^\t\n\r`]*(?:``|$))/i],["pun",/^[^\w\t\n\r "'\xa0]+/]]),["fs","ml"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["str",/^(?:'(?:[^\n\r'\\]|\\.)*'|"(?:[^\n\r"\\]|\\.)*(?:"|$))/,a,'"'],["com",/^#(?:(?:define|elif|else|endif|error|ifdef|include|ifndef|line|pragma|undef|warning)\b|[^\n\r]*)/,a,"#"],["pln",/^\s+/,a," \r\n\t\xa0"]],[["str",/^@"(?:[^"]|"")*(?:"|$)/,a],["str",/^<#[^#>]*(?:#>|$)/,a],["str",/^<(?:(?:(?:\.\.\/)*|\/?)(?:[\w-]+(?:\/[\w-]+)+)?[\w-]+\.h|[a-z]\w*)>/,a],["com",/^\/\/[^\n\r]*/,a],["com",/^\/\*[\S\s]*?(?:\*\/|$)/,
a],["kwd",/^(?:abstract|and|as|base|catch|class|def|delegate|enum|event|extern|false|finally|fun|implements|interface|internal|is|macro|match|matches|module|mutable|namespace|new|null|out|override|params|partial|private|protected|public|ref|sealed|static|struct|syntax|this|throw|true|try|type|typeof|using|variant|virtual|volatile|when|where|with|assert|assert2|async|break|checked|continue|do|else|ensures|for|foreach|if|late|lock|new|nolate|otherwise|regexp|repeat|requires|return|surroundwith|unchecked|unless|using|while|yield)\b/,
a],["typ",/^(?:array|bool|byte|char|decimal|double|float|int|list|long|object|sbyte|short|string|ulong|uint|ufloat|ulong|ushort|void)\b/,a],["lit",/^@[$_a-z][\w$@]*/i,a],["typ",/^@[A-Z]+[a-z][\w$@]*/,a],["pln",/^'?[$_a-z][\w$@]*/i,a],["lit",/^(?:0x[\da-f]+|(?:\d(?:_\d+)*\d*(?:\.\d*)?|\.\d\+)(?:e[+-]?\d+)?)[a-z]*/i,a,"0123456789"],["pun",/^.[^\s\w"-$'./@`]*/,a]]),["n","nemerle"]);

PR.registerLangHandler(PR.sourceDecorator({keywords:"bytes,default,double,enum,extend,extensions,false,group,import,max,message,option,optional,package,repeated,required,returns,rpc,service,syntax,to,true",types:/^(bool|(double|s?fixed|[su]?int)(32|64)|float|string)\b/,cStyleComments:!0}),["proto"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^"(?:""(?:""?(?!")|[^"\\]|\\.)*"{0,3}|(?:[^\n\r"\\]|\\.)*"?)/,null,'"'],["lit",/^`(?:[^\n\r\\`]|\\.)*`?/,null,"`"],["pun",/^[!#%&(--:-@[-^{-~]+/,null,"!#%&()*+,-:;<=>?@[\\]^{|}~"]],[["str",/^'(?:[^\n\r'\\]|\\(?:'|[^\n\r']+))'/],["lit",/^'[$A-Z_a-z][\w$]*(?![\w$'])/],["kwd",/^(?:abstract|case|catch|class|def|do|else|extends|final|finally|for|forSome|if|implicit|import|lazy|match|new|object|override|package|private|protected|requires|return|sealed|super|throw|trait|try|type|val|var|while|with|yield)\b/],
["lit",/^(?:true|false|null|this)\b/],["lit",/^(?:0(?:[0-7]+|x[\da-f]+)l?|(?:0|[1-9]\d*)(?:(?:\.\d+)?(?:e[+-]?\d+)?f?|l?)|\\.\d+(?:e[+-]?\d+)?f?)/i],["typ",/^[$_]*[A-Z][\d$A-Z_]*[a-z][\w$]*/],["pln",/^[$A-Z_a-z][\w$]*/],["com",/^\/(?:\/.*|\*(?:\/|\**[^*/])*(?:\*+\/?)?)/],["pun",/^(?:\.+|\/)/]]),["scala"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["str",/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,null,"\"'"]],[["com",/^(?:--[^\n\r]*|\/\*[\S\s]*?(?:\*\/|$))/],["kwd",/^(?:add|all|alter|and|any|as|asc|authorization|backup|begin|between|break|browse|bulk|by|cascade|case|check|checkpoint|close|clustered|coalesce|collate|column|commit|compute|constraint|contains|containstable|continue|convert|create|cross|current|current_date|current_time|current_timestamp|current_user|cursor|database|dbcc|deallocate|declare|default|delete|deny|desc|disk|distinct|distributed|double|drop|dummy|dump|else|end|errlvl|escape|except|exec|execute|exists|exit|fetch|file|fillfactor|for|foreign|freetext|freetexttable|from|full|function|goto|grant|group|having|holdlock|identity|identitycol|identity_insert|if|in|index|inner|insert|intersect|into|is|join|key|kill|left|like|lineno|load|match|merge|national|nocheck|nonclustered|not|null|nullif|of|off|offsets|on|open|opendatasource|openquery|openrowset|openxml|option|or|order|outer|over|percent|plan|precision|primary|print|proc|procedure|public|raiserror|read|readtext|reconfigure|references|replication|restore|restrict|return|revoke|right|rollback|rowcount|rowguidcol|rule|save|schema|select|session_user|set|setuser|shutdown|some|statistics|system_user|table|textsize|then|to|top|tran|transaction|trigger|truncate|tsequal|union|unique|update|updatetext|use|user|using|values|varying|view|waitfor|when|where|while|with|writetext)(?=[^\w-]|$)/i,
null],["lit",/^[+-]?(?:0x[\da-f]+|(?:\.\d+|\d+(?:\.\d*)?)(?:e[+-]?\d+)?)/i],["pln",/^[_a-z][\w-]*/i],["pun",/^[^\w\t\n\r "'\xa0][^\w\t\n\r "'+\xa0-]*/]]),["sql"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"],["com",/^%[^\n\r]*/,null,"%"]],[["kwd",/^\\[@-Za-z]+/],["kwd",/^\\./],["typ",/^[$&]/],["lit",/[+-]?(?:\.\d+|\d+(?:\.\d*)?)(cm|em|ex|in|pc|pt|bp|mm)/i],["pun",/^[()=[\]{}]+/]]),["latex","tex"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0\u2028\u2029]+/,null,"\t\n\r ¬\xa0‚Ä®‚Ä©"],["str",/^(?:["\u201c\u201d](?:[^"\u201c\u201d]|["\u201c\u201d]{2})(?:["\u201c\u201d]c|$)|["\u201c\u201d](?:[^"\u201c\u201d]|["\u201c\u201d]{2})*(?:["\u201c\u201d]|$))/i,null,'"‚Äú‚Äù'],["com",/^['\u2018\u2019].*/,null,"'‚Äò‚Äô"]],[["kwd",/^(?:addhandler|addressof|alias|and|andalso|ansi|as|assembly|auto|boolean|byref|byte|byval|call|case|catch|cbool|cbyte|cchar|cdate|cdbl|cdec|char|cint|class|clng|cobj|const|cshort|csng|cstr|ctype|date|decimal|declare|default|delegate|dim|directcast|do|double|each|else|elseif|end|endif|enum|erase|error|event|exit|finally|for|friend|function|get|gettype|gosub|goto|handles|if|implements|imports|in|inherits|integer|interface|is|let|lib|like|long|loop|me|mod|module|mustinherit|mustoverride|mybase|myclass|namespace|new|next|not|notinheritable|notoverridable|object|on|option|optional|or|orelse|overloads|overridable|overrides|paramarray|preserve|private|property|protected|public|raiseevent|readonly|redim|removehandler|resume|return|select|set|shadows|shared|short|single|static|step|stop|string|structure|sub|synclock|then|throw|to|try|typeof|unicode|until|variant|wend|when|while|with|withevents|writeonly|xor|endif|gosub|let|variant|wend)\b/i,
null],["com",/^rem.*/i],["lit",/^(?:true\b|false\b|nothing\b|\d+(?:e[+-]?\d+[dfr]?|[dfilrs])?|(?:&h[\da-f]+|&o[0-7]+)[ils]?|\d*\.\d+(?:e[+-]?\d+)?[dfr]?|#\s+(?:\d+[/-]\d+[/-]\d+(?:\s+\d+:\d+(?::\d+)?(\s*(?:am|pm))?)?|\d+:\d+(?::\d+)?(\s*(?:am|pm))?)\s+#)/i],["pln",/^(?:(?:[a-z]|_\w)\w*|\[(?:[a-z]|_\w)\w*])/i],["pun",/^[^\w\t\n\r "'[\]\xa0\u2018\u2019\u201c\u201d\u2028\u2029]+/],["pun",/^(?:\[|])/]]),["vb","vbs"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\t\n\r \xa0]+/,null,"\t\n\r ¬\xa0"]],[["str",/^(?:[box]?"(?:[^"]|"")*"|'.')/i],["com",/^--[^\n\r]*/],["kwd",/^(?:abs|access|after|alias|all|and|architecture|array|assert|attribute|begin|block|body|buffer|bus|case|component|configuration|constant|disconnect|downto|else|elsif|end|entity|exit|file|for|function|generate|generic|group|guarded|if|impure|in|inertial|inout|is|label|library|linkage|literal|loop|map|mod|nand|new|next|nor|not|null|of|on|open|or|others|out|package|port|postponed|procedure|process|pure|range|record|register|reject|rem|report|return|rol|ror|select|severity|shared|signal|sla|sll|sra|srl|subtype|then|to|transport|type|unaffected|units|until|use|variable|wait|when|while|with|xnor|xor)(?=[^\w-]|$)/i,
null],["typ",/^(?:bit|bit_vector|character|boolean|integer|real|time|string|severity_level|positive|natural|signed|unsigned|line|text|std_u?logic(?:_vector)?)(?=[^\w-]|$)/i,null],["typ",/^'(?:active|ascending|base|delayed|driving|driving_value|event|high|image|instance_name|last_active|last_event|last_value|left|leftof|length|low|path_name|pos|pred|quiet|range|reverse_range|right|rightof|simple_name|stable|succ|transaction|val|value)(?=[^\w-]|$)/i,null],["lit",/^\d+(?:_\d+)*(?:#[\w.\\]+#(?:[+-]?\d+(?:_\d+)*)?|(?:\.\d+(?:_\d+)*)?(?:e[+-]?\d+(?:_\d+)*)?)/i],
["pln",/^(?:[a-z]\w*|\\[^\\]*\\)/i],["pun",/^[^\w\t\n\r "'\xa0][^\w\t\n\r "'\xa0-]*/]]),["vhdl","vhd"]);

PR.registerLangHandler(PR.createSimpleLexer([["pln",/^[\d\t a-gi-z\xa0]+/,null,"\t ¬\xa0abcdefgijklmnopqrstuvwxyz0123456789"],["pun",/^[*=[\]^~]+/,null,"=*~^[]"]],[["lang-wiki.meta",/(?:^^|\r\n?|\n)(#[a-z]+)\b/],["lit",/^[A-Z][a-z][\da-z]+[A-Z][a-z][^\W_]+\b/],["lang-",/^{{{([\S\s]+?)}}}/],["lang-",/^`([^\n\r`]+)`/],["str",/^https?:\/\/[^\s#/?]*(?:\/[^\s#?]*)?(?:\?[^\s#]*)?(?:#\S*)?/i],["pln",/^(?:\r\n|[\S\s])[^\n\r#*=A-[^`h{~]*/]]),["wiki"]);
PR.registerLangHandler(PR.createSimpleLexer([["kwd",/^#[a-z]+/i,null,"#"]],[]),["wiki.meta"]);

PR.registerLangHandler(PR.createSimpleLexer([["var pln",/^\$[\w-]+/,null,"$"]],[["pln",/^[\s=][<>][\s=]/],["lit",/^@[\w-]+/],["tag",/^<\/?[a-z](?:[\w-.:]*\w)?|\/?>$/i],["com",/^\(:[\S\s]*?:\)/],["pln",/^[(),/;[\]{}]$/],["str",/^(?:"(?:[^"\\{]|\\[\S\s])*(?:"|$)|'(?:[^'\\{]|\\[\S\s])*(?:'|$))/,null,"\"'"],["kwd",/^(?:xquery|where|version|variable|union|typeswitch|treat|to|then|text|stable|sortby|some|self|schema|satisfies|returns|return|ref|processing-instruction|preceding-sibling|preceding|precedes|parent|only|of|node|namespace|module|let|item|intersect|instance|in|import|if|function|for|follows|following-sibling|following|external|except|every|else|element|descending|descendant-or-self|descendant|define|default|declare|comment|child|cast|case|before|attribute|assert|ascending|as|ancestor-or-self|ancestor|after|eq|order|by|or|and|schema-element|document-node|node|at)\b/],
["typ",/^(?:xs:yearMonthDuration|xs:unsignedLong|xs:time|xs:string|xs:short|xs:QName|xs:Name|xs:long|xs:integer|xs:int|xs:gYearMonth|xs:gYear|xs:gMonthDay|xs:gDay|xs:float|xs:duration|xs:double|xs:decimal|xs:dayTimeDuration|xs:dateTime|xs:date|xs:byte|xs:boolean|xs:anyURI|xf:yearMonthDuration)\b/,null],["fun pln",/^(?:xp:dereference|xinc:node-expand|xinc:link-references|xinc:link-expand|xhtml:restructure|xhtml:clean|xhtml:add-lists|xdmp:zip-manifest|xdmp:zip-get|xdmp:zip-create|xdmp:xquery-version|xdmp:word-convert|xdmp:with-namespaces|xdmp:version|xdmp:value|xdmp:user-roles|xdmp:user-last-login|xdmp:user|xdmp:url-encode|xdmp:url-decode|xdmp:uri-is-file|xdmp:uri-format|xdmp:uri-content-type|xdmp:unquote|xdmp:unpath|xdmp:triggers-database|xdmp:trace|xdmp:to-json|xdmp:tidy|xdmp:subbinary|xdmp:strftime|xdmp:spawn-in|xdmp:spawn|xdmp:sleep|xdmp:shutdown|xdmp:set-session-field|xdmp:set-response-encoding|xdmp:set-response-content-type|xdmp:set-response-code|xdmp:set-request-time-limit|xdmp:set|xdmp:servers|xdmp:server-status|xdmp:server-name|xdmp:server|xdmp:security-database|xdmp:security-assert|xdmp:schema-database|xdmp:save|xdmp:role-roles|xdmp:role|xdmp:rethrow|xdmp:restart|xdmp:request-timestamp|xdmp:request-status|xdmp:request-cancel|xdmp:request|xdmp:redirect-response|xdmp:random|xdmp:quote|xdmp:query-trace|xdmp:query-meters|xdmp:product-edition|xdmp:privilege-roles|xdmp:privilege|xdmp:pretty-print|xdmp:powerpoint-convert|xdmp:platform|xdmp:permission|xdmp:pdf-convert|xdmp:path|xdmp:octal-to-integer|xdmp:node-uri|xdmp:node-replace|xdmp:node-kind|xdmp:node-insert-child|xdmp:node-insert-before|xdmp:node-insert-after|xdmp:node-delete|xdmp:node-database|xdmp:mul64|xdmp:modules-root|xdmp:modules-database|xdmp:merging|xdmp:merge-cancel|xdmp:merge|xdmp:md5|xdmp:logout|xdmp:login|xdmp:log-level|xdmp:log|xdmp:lock-release|xdmp:lock-acquire|xdmp:load|xdmp:invoke-in|xdmp:invoke|xdmp:integer-to-octal|xdmp:integer-to-hex|xdmp:http-put|xdmp:http-post|xdmp:http-options|xdmp:http-head|xdmp:http-get|xdmp:http-delete|xdmp:hosts|xdmp:host-status|xdmp:host-name|xdmp:host|xdmp:hex-to-integer|xdmp:hash64|xdmp:hash32|xdmp:has-privilege|xdmp:groups|xdmp:group-serves|xdmp:group-servers|xdmp:group-name|xdmp:group-hosts|xdmp:group|xdmp:get-session-field-names|xdmp:get-session-field|xdmp:get-response-encoding|xdmp:get-response-code|xdmp:get-request-username|xdmp:get-request-user|xdmp:get-request-url|xdmp:get-request-protocol|xdmp:get-request-path|xdmp:get-request-method|xdmp:get-request-header-names|xdmp:get-request-header|xdmp:get-request-field-names|xdmp:get-request-field-filename|xdmp:get-request-field-content-type|xdmp:get-request-field|xdmp:get-request-client-certificate|xdmp:get-request-client-address|xdmp:get-request-body|xdmp:get-current-user|xdmp:get-current-roles|xdmp:get|xdmp:function-name|xdmp:function-module|xdmp:function|xdmp:from-json|xdmp:forests|xdmp:forest-status|xdmp:forest-restore|xdmp:forest-restart|xdmp:forest-name|xdmp:forest-delete|xdmp:forest-databases|xdmp:forest-counts|xdmp:forest-clear|xdmp:forest-backup|xdmp:forest|xdmp:filesystem-file|xdmp:filesystem-directory|xdmp:exists|xdmp:excel-convert|xdmp:eval-in|xdmp:eval|xdmp:estimate|xdmp:email|xdmp:element-content-type|xdmp:elapsed-time|xdmp:document-set-quality|xdmp:document-set-property|xdmp:document-set-properties|xdmp:document-set-permissions|xdmp:document-set-collections|xdmp:document-remove-properties|xdmp:document-remove-permissions|xdmp:document-remove-collections|xdmp:document-properties|xdmp:document-locks|xdmp:document-load|xdmp:document-insert|xdmp:document-get-quality|xdmp:document-get-properties|xdmp:document-get-permissions|xdmp:document-get-collections|xdmp:document-get|xdmp:document-forest|xdmp:document-delete|xdmp:document-add-properties|xdmp:document-add-permissions|xdmp:document-add-collections|xdmp:directory-properties|xdmp:directory-locks|xdmp:directory-delete|xdmp:directory-create|xdmp:directory|xdmp:diacritic-less|xdmp:describe|xdmp:default-permissions|xdmp:default-collections|xdmp:databases|xdmp:database-restore-validate|xdmp:database-restore-status|xdmp:database-restore-cancel|xdmp:database-restore|xdmp:database-name|xdmp:database-forests|xdmp:database-backup-validate|xdmp:database-backup-status|xdmp:database-backup-purge|xdmp:database-backup-cancel|xdmp:database-backup|xdmp:database|xdmp:collection-properties|xdmp:collection-locks|xdmp:collection-delete|xdmp:collation-canonical-uri|xdmp:castable-as|xdmp:can-grant-roles|xdmp:base64-encode|xdmp:base64-decode|xdmp:architecture|xdmp:apply|xdmp:amp-roles|xdmp:amp|xdmp:add64|xdmp:add-response-header|xdmp:access|trgr:trigger-set-recursive|trgr:trigger-set-permissions|trgr:trigger-set-name|trgr:trigger-set-module|trgr:trigger-set-event|trgr:trigger-set-description|trgr:trigger-remove-permissions|trgr:trigger-module|trgr:trigger-get-permissions|trgr:trigger-enable|trgr:trigger-disable|trgr:trigger-database-online-event|trgr:trigger-data-event|trgr:trigger-add-permissions|trgr:remove-trigger|trgr:property-content|trgr:pre-commit|trgr:post-commit|trgr:get-trigger-by-id|trgr:get-trigger|trgr:document-scope|trgr:document-content|trgr:directory-scope|trgr:create-trigger|trgr:collection-scope|trgr:any-property-content|thsr:set-entry|thsr:remove-term|thsr:remove-synonym|thsr:remove-entry|thsr:query-lookup|thsr:lookup|thsr:load|thsr:insert|thsr:expand|thsr:add-synonym|spell:suggest-detailed|spell:suggest|spell:remove-word|spell:make-dictionary|spell:load|spell:levenshtein-distance|spell:is-correct|spell:insert|spell:double-metaphone|spell:add-word|sec:users-collection|sec:user-set-roles|sec:user-set-password|sec:user-set-name|sec:user-set-description|sec:user-set-default-permissions|sec:user-set-default-collections|sec:user-remove-roles|sec:user-privileges|sec:user-get-roles|sec:user-get-description|sec:user-get-default-permissions|sec:user-get-default-collections|sec:user-doc-permissions|sec:user-doc-collections|sec:user-add-roles|sec:unprotect-collection|sec:uid-for-name|sec:set-realm|sec:security-version|sec:security-namespace|sec:security-installed|sec:security-collection|sec:roles-collection|sec:role-set-roles|sec:role-set-name|sec:role-set-description|sec:role-set-default-permissions|sec:role-set-default-collections|sec:role-remove-roles|sec:role-privileges|sec:role-get-roles|sec:role-get-description|sec:role-get-default-permissions|sec:role-get-default-collections|sec:role-doc-permissions|sec:role-doc-collections|sec:role-add-roles|sec:remove-user|sec:remove-role-from-users|sec:remove-role-from-role|sec:remove-role-from-privileges|sec:remove-role-from-amps|sec:remove-role|sec:remove-privilege|sec:remove-amp|sec:protect-collection|sec:privileges-collection|sec:privilege-set-roles|sec:privilege-set-name|sec:privilege-remove-roles|sec:privilege-get-roles|sec:privilege-add-roles|sec:priv-doc-permissions|sec:priv-doc-collections|sec:get-user-names|sec:get-unique-elem-id|sec:get-role-names|sec:get-role-ids|sec:get-privilege|sec:get-distinct-permissions|sec:get-collection|sec:get-amp|sec:create-user-with-role|sec:create-user|sec:create-role|sec:create-privilege|sec:create-amp|sec:collections-collection|sec:collection-set-permissions|sec:collection-remove-permissions|sec:collection-get-permissions|sec:collection-add-permissions|sec:check-admin|sec:amps-collection|sec:amp-set-roles|sec:amp-remove-roles|sec:amp-get-roles|sec:amp-doc-permissions|sec:amp-doc-collections|sec:amp-add-roles|search:unparse|search:suggest|search:snippet|search:search|search:resolve-nodes|search:resolve|search:remove-constraint|search:parse|search:get-default-options|search:estimate|search:check-options|prof:value|prof:reset|prof:report|prof:invoke|prof:eval|prof:enable|prof:disable|prof:allowed|ppt:clean|pki:template-set-request|pki:template-set-name|pki:template-set-key-type|pki:template-set-key-options|pki:template-set-description|pki:template-in-use|pki:template-get-version|pki:template-get-request|pki:template-get-name|pki:template-get-key-type|pki:template-get-key-options|pki:template-get-id|pki:template-get-description|pki:need-certificate|pki:is-temporary|pki:insert-trusted-certificates|pki:insert-template|pki:insert-signed-certificates|pki:insert-certificate-revocation-list|pki:get-trusted-certificate-ids|pki:get-template-ids|pki:get-template-certificate-authority|pki:get-template-by-name|pki:get-template|pki:get-pending-certificate-requests-xml|pki:get-pending-certificate-requests-pem|pki:get-pending-certificate-request|pki:get-certificates-for-template-xml|pki:get-certificates-for-template|pki:get-certificates|pki:get-certificate-xml|pki:get-certificate-pem|pki:get-certificate|pki:generate-temporary-certificate-if-necessary|pki:generate-temporary-certificate|pki:generate-template-certificate-authority|pki:generate-certificate-request|pki:delete-template|pki:delete-certificate|pki:create-template|pdf:make-toc|pdf:insert-toc-headers|pdf:get-toc|pdf:clean|p:status-transition|p:state-transition|p:remove|p:pipelines|p:insert|p:get-by-id|p:get|p:execute|p:create|p:condition|p:collection|p:action|ooxml:runs-merge|ooxml:package-uris|ooxml:package-parts-insert|ooxml:package-parts|msword:clean|mcgm:polygon|mcgm:point|mcgm:geospatial-query-from-elements|mcgm:geospatial-query|mcgm:circle|math:tanh|math:tan|math:sqrt|math:sinh|math:sin|math:pow|math:modf|math:log10|math:log|math:ldexp|math:frexp|math:fmod|math:floor|math:fabs|math:exp|math:cosh|math:cos|math:ceil|math:atan2|math:atan|math:asin|math:acos|map:put|map:map|map:keys|map:get|map:delete|map:count|map:clear|lnk:to|lnk:remove|lnk:insert|lnk:get|lnk:from|lnk:create|kml:polygon|kml:point|kml:interior-polygon|kml:geospatial-query-from-elements|kml:geospatial-query|kml:circle|kml:box|gml:polygon|gml:point|gml:interior-polygon|gml:geospatial-query-from-elements|gml:geospatial-query|gml:circle|gml:box|georss:point|georss:geospatial-query|georss:circle|geo:polygon|geo:point|geo:interior-polygon|geo:geospatial-query-from-elements|geo:geospatial-query|geo:circle|geo:box|fn:zero-or-one|fn:years-from-duration|fn:year-from-dateTime|fn:year-from-date|fn:upper-case|fn:unordered|fn:true|fn:translate|fn:trace|fn:tokenize|fn:timezone-from-time|fn:timezone-from-dateTime|fn:timezone-from-date|fn:sum|fn:subtract-dateTimes-yielding-yearMonthDuration|fn:subtract-dateTimes-yielding-dayTimeDuration|fn:substring-before|fn:substring-after|fn:substring|fn:subsequence|fn:string-to-codepoints|fn:string-pad|fn:string-length|fn:string-join|fn:string|fn:static-base-uri|fn:starts-with|fn:seconds-from-time|fn:seconds-from-duration|fn:seconds-from-dateTime|fn:round-half-to-even|fn:round|fn:root|fn:reverse|fn:resolve-uri|fn:resolve-QName|fn:replace|fn:remove|fn:QName|fn:prefix-from-QName|fn:position|fn:one-or-more|fn:number|fn:not|fn:normalize-unicode|fn:normalize-space|fn:node-name|fn:node-kind|fn:nilled|fn:namespace-uri-from-QName|fn:namespace-uri-for-prefix|fn:namespace-uri|fn:name|fn:months-from-duration|fn:month-from-dateTime|fn:month-from-date|fn:minutes-from-time|fn:minutes-from-duration|fn:minutes-from-dateTime|fn:min|fn:max|fn:matches|fn:lower-case|fn:local-name-from-QName|fn:local-name|fn:last|fn:lang|fn:iri-to-uri|fn:insert-before|fn:index-of|fn:in-scope-prefixes|fn:implicit-timezone|fn:idref|fn:id|fn:hours-from-time|fn:hours-from-duration|fn:hours-from-dateTime|fn:floor|fn:false|fn:expanded-QName|fn:exists|fn:exactly-one|fn:escape-uri|fn:escape-html-uri|fn:error|fn:ends-with|fn:encode-for-uri|fn:empty|fn:document-uri|fn:doc-available|fn:doc|fn:distinct-values|fn:distinct-nodes|fn:default-collation|fn:deep-equal|fn:days-from-duration|fn:day-from-dateTime|fn:day-from-date|fn:data|fn:current-time|fn:current-dateTime|fn:current-date|fn:count|fn:contains|fn:concat|fn:compare|fn:collection|fn:codepoints-to-string|fn:codepoint-equal|fn:ceiling|fn:boolean|fn:base-uri|fn:avg|fn:adjust-time-to-timezone|fn:adjust-dateTime-to-timezone|fn:adjust-date-to-timezone|fn:abs|feed:unsubscribe|feed:subscription|feed:subscribe|feed:request|feed:item|feed:description|excel:clean|entity:enrich|dom:set-pipelines|dom:set-permissions|dom:set-name|dom:set-evaluation-context|dom:set-domain-scope|dom:set-description|dom:remove-pipeline|dom:remove-permissions|dom:remove|dom:get|dom:evaluation-context|dom:domains|dom:domain-scope|dom:create|dom:configuration-set-restart-user|dom:configuration-set-permissions|dom:configuration-set-evaluation-context|dom:configuration-set-default-domain|dom:configuration-get|dom:configuration-create|dom:collection|dom:add-pipeline|dom:add-permissions|dls:retention-rules|dls:retention-rule-remove|dls:retention-rule-insert|dls:retention-rule|dls:purge|dls:node-expand|dls:link-references|dls:link-expand|dls:documents-query|dls:document-versions-query|dls:document-version-uri|dls:document-version-query|dls:document-version-delete|dls:document-version-as-of|dls:document-version|dls:document-update|dls:document-unmanage|dls:document-set-quality|dls:document-set-property|dls:document-set-properties|dls:document-set-permissions|dls:document-set-collections|dls:document-retention-rules|dls:document-remove-properties|dls:document-remove-permissions|dls:document-remove-collections|dls:document-purge|dls:document-manage|dls:document-is-managed|dls:document-insert-and-manage|dls:document-include-query|dls:document-history|dls:document-get-permissions|dls:document-extract-part|dls:document-delete|dls:document-checkout-status|dls:document-checkout|dls:document-checkin|dls:document-add-properties|dls:document-add-permissions|dls:document-add-collections|dls:break-checkout|dls:author-query|dls:as-of-query|dbk:convert|dbg:wait|dbg:value|dbg:stopped|dbg:stop|dbg:step|dbg:status|dbg:stack|dbg:out|dbg:next|dbg:line|dbg:invoke|dbg:function|dbg:finish|dbg:expr|dbg:eval|dbg:disconnect|dbg:detach|dbg:continue|dbg:connect|dbg:clear|dbg:breakpoints|dbg:break|dbg:attached|dbg:attach|cvt:save-converted-documents|cvt:part-uri|cvt:destination-uri|cvt:basepath|cvt:basename|cts:words|cts:word-query-weight|cts:word-query-text|cts:word-query-options|cts:word-query|cts:word-match|cts:walk|cts:uris|cts:uri-match|cts:train|cts:tokenize|cts:thresholds|cts:stem|cts:similar-query-weight|cts:similar-query-nodes|cts:similar-query|cts:shortest-distance|cts:search|cts:score|cts:reverse-query-weight|cts:reverse-query-nodes|cts:reverse-query|cts:remainder|cts:registered-query-weight|cts:registered-query-options|cts:registered-query-ids|cts:registered-query|cts:register|cts:query|cts:quality|cts:properties-query-query|cts:properties-query|cts:polygon-vertices|cts:polygon|cts:point-longitude|cts:point-latitude|cts:point|cts:or-query-queries|cts:or-query|cts:not-query-weight|cts:not-query-query|cts:not-query|cts:near-query-weight|cts:near-query-queries|cts:near-query-options|cts:near-query-distance|cts:near-query|cts:highlight|cts:geospatial-co-occurrences|cts:frequency|cts:fitness|cts:field-words|cts:field-word-query-weight|cts:field-word-query-text|cts:field-word-query-options|cts:field-word-query-field-name|cts:field-word-query|cts:field-word-match|cts:entity-highlight|cts:element-words|cts:element-word-query-weight|cts:element-word-query-text|cts:element-word-query-options|cts:element-word-query-element-name|cts:element-word-query|cts:element-word-match|cts:element-values|cts:element-value-ranges|cts:element-value-query-weight|cts:element-value-query-text|cts:element-value-query-options|cts:element-value-query-element-name|cts:element-value-query|cts:element-value-match|cts:element-value-geospatial-co-occurrences|cts:element-value-co-occurrences|cts:element-range-query-weight|cts:element-range-query-value|cts:element-range-query-options|cts:element-range-query-operator|cts:element-range-query-element-name|cts:element-range-query|cts:element-query-query|cts:element-query-element-name|cts:element-query|cts:element-pair-geospatial-values|cts:element-pair-geospatial-value-match|cts:element-pair-geospatial-query-weight|cts:element-pair-geospatial-query-region|cts:element-pair-geospatial-query-options|cts:element-pair-geospatial-query-longitude-name|cts:element-pair-geospatial-query-latitude-name|cts:element-pair-geospatial-query-element-name|cts:element-pair-geospatial-query|cts:element-pair-geospatial-boxes|cts:element-geospatial-values|cts:element-geospatial-value-match|cts:element-geospatial-query-weight|cts:element-geospatial-query-region|cts:element-geospatial-query-options|cts:element-geospatial-query-element-name|cts:element-geospatial-query|cts:element-geospatial-boxes|cts:element-child-geospatial-values|cts:element-child-geospatial-value-match|cts:element-child-geospatial-query-weight|cts:element-child-geospatial-query-region|cts:element-child-geospatial-query-options|cts:element-child-geospatial-query-element-name|cts:element-child-geospatial-query-child-name|cts:element-child-geospatial-query|cts:element-child-geospatial-boxes|cts:element-attribute-words|cts:element-attribute-word-query-weight|cts:element-attribute-word-query-text|cts:element-attribute-word-query-options|cts:element-attribute-word-query-element-name|cts:element-attribute-word-query-attribute-name|cts:element-attribute-word-query|cts:element-attribute-word-match|cts:element-attribute-values|cts:element-attribute-value-ranges|cts:element-attribute-value-query-weight|cts:element-attribute-value-query-text|cts:element-attribute-value-query-options|cts:element-attribute-value-query-element-name|cts:element-attribute-value-query-attribute-name|cts:element-attribute-value-query|cts:element-attribute-value-match|cts:element-attribute-value-geospatial-co-occurrences|cts:element-attribute-value-co-occurrences|cts:element-attribute-range-query-weight|cts:element-attribute-range-query-value|cts:element-attribute-range-query-options|cts:element-attribute-range-query-operator|cts:element-attribute-range-query-element-name|cts:element-attribute-range-query-attribute-name|cts:element-attribute-range-query|cts:element-attribute-pair-geospatial-values|cts:element-attribute-pair-geospatial-value-match|cts:element-attribute-pair-geospatial-query-weight|cts:element-attribute-pair-geospatial-query-region|cts:element-attribute-pair-geospatial-query-options|cts:element-attribute-pair-geospatial-query-longitude-name|cts:element-attribute-pair-geospatial-query-latitude-name|cts:element-attribute-pair-geospatial-query-element-name|cts:element-attribute-pair-geospatial-query|cts:element-attribute-pair-geospatial-boxes|cts:document-query-uris|cts:document-query|cts:distance|cts:directory-query-uris|cts:directory-query-depth|cts:directory-query|cts:destination|cts:deregister|cts:contains|cts:confidence|cts:collections|cts:collection-query-uris|cts:collection-query|cts:collection-match|cts:classify|cts:circle-radius|cts:circle-center|cts:circle|cts:box-west|cts:box-south|cts:box-north|cts:box-east|cts:box|cts:bearing|cts:arc-intersection|cts:and-query-queries|cts:and-query-options|cts:and-query|cts:and-not-query-positive-query|cts:and-not-query-negative-query|cts:and-not-query|css:get|css:convert|cpf:success|cpf:failure|cpf:document-set-state|cpf:document-set-processing-status|cpf:document-set-last-updated|cpf:document-set-error|cpf:document-get-state|cpf:document-get-processing-status|cpf:document-get-last-updated|cpf:document-get-error|cpf:check-transition|alert:spawn-matching-actions|alert:rule-user-id-query|alert:rule-set-user-id|alert:rule-set-query|alert:rule-set-options|alert:rule-set-name|alert:rule-set-description|alert:rule-set-action|alert:rule-remove|alert:rule-name-query|alert:rule-insert|alert:rule-id-query|alert:rule-get-user-id|alert:rule-get-query|alert:rule-get-options|alert:rule-get-name|alert:rule-get-id|alert:rule-get-description|alert:rule-get-action|alert:rule-action-query|alert:remove-triggers|alert:make-rule|alert:make-log-action|alert:make-config|alert:make-action|alert:invoke-matching-actions|alert:get-my-rules|alert:get-all-rules|alert:get-actions|alert:find-matching-rules|alert:create-triggers|alert:config-set-uri|alert:config-set-trigger-ids|alert:config-set-options|alert:config-set-name|alert:config-set-description|alert:config-set-cpf-domain-names|alert:config-set-cpf-domain-ids|alert:config-insert|alert:config-get-uri|alert:config-get-trigger-ids|alert:config-get-options|alert:config-get-name|alert:config-get-id|alert:config-get-description|alert:config-get-cpf-domain-names|alert:config-get-cpf-domain-ids|alert:config-get|alert:config-delete|alert:action-set-options|alert:action-set-name|alert:action-set-module-root|alert:action-set-module-db|alert:action-set-module|alert:action-set-description|alert:action-remove|alert:action-insert|alert:action-get-options|alert:action-get-name|alert:action-get-module-root|alert:action-get-module-db|alert:action-get-module|alert:action-get-description|zero-or-one|years-from-duration|year-from-dateTime|year-from-date|upper-case|unordered|true|translate|trace|tokenize|timezone-from-time|timezone-from-dateTime|timezone-from-date|sum|subtract-dateTimes-yielding-yearMonthDuration|subtract-dateTimes-yielding-dayTimeDuration|substring-before|substring-after|substring|subsequence|string-to-codepoints|string-pad|string-length|string-join|string|static-base-uri|starts-with|seconds-from-time|seconds-from-duration|seconds-from-dateTime|round-half-to-even|round|root|reverse|resolve-uri|resolve-QName|replace|remove|QName|prefix-from-QName|position|one-or-more|number|not|normalize-unicode|normalize-space|node-name|node-kind|nilled|namespace-uri-from-QName|namespace-uri-for-prefix|namespace-uri|name|months-from-duration|month-from-dateTime|month-from-date|minutes-from-time|minutes-from-duration|minutes-from-dateTime|min|max|matches|lower-case|local-name-from-QName|local-name|last|lang|iri-to-uri|insert-before|index-of|in-scope-prefixes|implicit-timezone|idref|id|hours-from-time|hours-from-duration|hours-from-dateTime|floor|false|expanded-QName|exists|exactly-one|escape-uri|escape-html-uri|error|ends-with|encode-for-uri|empty|document-uri|doc-available|doc|distinct-values|distinct-nodes|default-collation|deep-equal|days-from-duration|day-from-dateTime|day-from-date|data|current-time|current-dateTime|current-date|count|contains|concat|compare|collection|codepoints-to-string|codepoint-equal|ceiling|boolean|base-uri|avg|adjust-time-to-timezone|adjust-dateTime-to-timezone|adjust-date-to-timezone|abs)\b/],
["pln",/^[\w:-]+/],["pln",/^[\t\n\r \xa0]+/]]),["xq","xquery"]);

var a=null;
PR.registerLangHandler(PR.createSimpleLexer([["pun",/^[:>?|]+/,a,":|>?"],["dec",/^%(?:YAML|TAG)[^\n\r#]+/,a,"%"],["typ",/^&\S+/,a,"&"],["typ",/^!\S*/,a,"!"],["str",/^"(?:[^"\\]|\\.)*(?:"|$)/,a,'"'],["str",/^'(?:[^']|'')*(?:'|$)/,a,"'"],["com",/^#[^\n\r]*/,a,"#"],["pln",/^\s+/,a," \t\r\n"]],[["dec",/^(?:---|\.\.\.)(?:[\n\r]|$)/],["pun",/^-/],["kwd",/^\w+:[\n\r ]/],["pln",/^\w+/]]),["yaml","yml"]);

var q=null;window.PR_SHOULD_USE_CONTINUATION=!0;
(function(){function L(a){function m(a){var f=a.charCodeAt(0);if(f!==92)return f;var b=a.charAt(1);return(f=r[b])?f:"0"<=b&&b<="7"?parseInt(a.substring(1),8):b==="u"||b==="x"?parseInt(a.substring(2),16):a.charCodeAt(1)}function e(a){if(a<32)return(a<16?"\\x0":"\\x")+a.toString(16);a=String.fromCharCode(a);if(a==="\\"||a==="-"||a==="["||a==="]")a="\\"+a;return a}function h(a){for(var f=a.substring(1,a.length-1).match(/\\u[\dA-Fa-f]{4}|\\x[\dA-Fa-f]{2}|\\[0-3][0-7]{0,2}|\\[0-7]{1,2}|\\[\S\s]|[^\\]/g),a=
[],b=[],o=f[0]==="^",c=o?1:0,i=f.length;c<i;++c){var j=f[c];if(/\\[bdsw]/i.test(j))a.push(j);else{var j=m(j),d;c+2<i&&"-"===f[c+1]?(d=m(f[c+2]),c+=2):d=j;b.push([j,d]);d<65||j>122||(d<65||j>90||b.push([Math.max(65,j)|32,Math.min(d,90)|32]),d<97||j>122||b.push([Math.max(97,j)&-33,Math.min(d,122)&-33]))}}b.sort(function(a,f){return a[0]-f[0]||f[1]-a[1]});f=[];j=[NaN,NaN];for(c=0;c<b.length;++c)i=b[c],i[0]<=j[1]+1?j[1]=Math.max(j[1],i[1]):f.push(j=i);b=["["];o&&b.push("^");b.push.apply(b,a);for(c=0;c<
f.length;++c)i=f[c],b.push(e(i[0])),i[1]>i[0]&&(i[1]+1>i[0]&&b.push("-"),b.push(e(i[1])));b.push("]");return b.join("")}function y(a){for(var f=a.source.match(/\[(?:[^\\\]]|\\[\S\s])*]|\\u[\dA-Fa-f]{4}|\\x[\dA-Fa-f]{2}|\\\d+|\\[^\dux]|\(\?[!:=]|[()^]|[^()[\\^]+/g),b=f.length,d=[],c=0,i=0;c<b;++c){var j=f[c];j==="("?++i:"\\"===j.charAt(0)&&(j=+j.substring(1))&&j<=i&&(d[j]=-1)}for(c=1;c<d.length;++c)-1===d[c]&&(d[c]=++t);for(i=c=0;c<b;++c)j=f[c],j==="("?(++i,d[i]===void 0&&(f[c]="(?:")):"\\"===j.charAt(0)&&
(j=+j.substring(1))&&j<=i&&(f[c]="\\"+d[i]);for(i=c=0;c<b;++c)"^"===f[c]&&"^"!==f[c+1]&&(f[c]="");if(a.ignoreCase&&s)for(c=0;c<b;++c)j=f[c],a=j.charAt(0),j.length>=2&&a==="["?f[c]=h(j):a!=="\\"&&(f[c]=j.replace(/[A-Za-z]/g,function(a){a=a.charCodeAt(0);return"["+String.fromCharCode(a&-33,a|32)+"]"}));return f.join("")}for(var t=0,s=!1,l=!1,p=0,d=a.length;p<d;++p){var g=a[p];if(g.ignoreCase)l=!0;else if(/[a-z]/i.test(g.source.replace(/\\u[\da-f]{4}|\\x[\da-f]{2}|\\[^UXux]/gi,""))){s=!0;l=!1;break}}for(var r=
{b:8,t:9,n:10,v:11,f:12,r:13},n=[],p=0,d=a.length;p<d;++p){g=a[p];if(g.global||g.multiline)throw Error(""+g);n.push("(?:"+y(g)+")")}return RegExp(n.join("|"),l?"gi":"g")}function M(a){function m(a){switch(a.nodeType){case 1:if(e.test(a.className))break;for(var g=a.firstChild;g;g=g.nextSibling)m(g);g=a.nodeName;if("BR"===g||"LI"===g)h[s]="\n",t[s<<1]=y++,t[s++<<1|1]=a;break;case 3:case 4:g=a.nodeValue,g.length&&(g=p?g.replace(/\r\n?/g,"\n"):g.replace(/[\t\n\r ]+/g," "),h[s]=g,t[s<<1]=y,y+=g.length,
t[s++<<1|1]=a)}}var e=/(?:^|\s)nocode(?:\s|$)/,h=[],y=0,t=[],s=0,l;a.currentStyle?l=a.currentStyle.whiteSpace:window.getComputedStyle&&(l=document.defaultView.getComputedStyle(a,q).getPropertyValue("white-space"));var p=l&&"pre"===l.substring(0,3);m(a);return{a:h.join("").replace(/\n$/,""),c:t}}function B(a,m,e,h){m&&(a={a:m,d:a},e(a),h.push.apply(h,a.e))}function x(a,m){function e(a){for(var l=a.d,p=[l,"pln"],d=0,g=a.a.match(y)||[],r={},n=0,z=g.length;n<z;++n){var f=g[n],b=r[f],o=void 0,c;if(typeof b===
"string")c=!1;else{var i=h[f.charAt(0)];if(i)o=f.match(i[1]),b=i[0];else{for(c=0;c<t;++c)if(i=m[c],o=f.match(i[1])){b=i[0];break}o||(b="pln")}if((c=b.length>=5&&"lang-"===b.substring(0,5))&&!(o&&typeof o[1]==="string"))c=!1,b="src";c||(r[f]=b)}i=d;d+=f.length;if(c){c=o[1];var j=f.indexOf(c),k=j+c.length;o[2]&&(k=f.length-o[2].length,j=k-c.length);b=b.substring(5);B(l+i,f.substring(0,j),e,p);B(l+i+j,c,C(b,c),p);B(l+i+k,f.substring(k),e,p)}else p.push(l+i,b)}a.e=p}var h={},y;(function(){for(var e=a.concat(m),
l=[],p={},d=0,g=e.length;d<g;++d){var r=e[d],n=r[3];if(n)for(var k=n.length;--k>=0;)h[n.charAt(k)]=r;r=r[1];n=""+r;p.hasOwnProperty(n)||(l.push(r),p[n]=q)}l.push(/[\S\s]/);y=L(l)})();var t=m.length;return e}function u(a){var m=[],e=[];a.tripleQuotedStrings?m.push(["str",/^(?:'''(?:[^'\\]|\\[\S\s]|''?(?=[^']))*(?:'''|$)|"""(?:[^"\\]|\\[\S\s]|""?(?=[^"]))*(?:"""|$)|'(?:[^'\\]|\\[\S\s])*(?:'|$)|"(?:[^"\\]|\\[\S\s])*(?:"|$))/,q,"'\""]):a.multiLineStrings?m.push(["str",/^(?:'(?:[^'\\]|\\[\S\s])*(?:'|$)|"(?:[^"\\]|\\[\S\s])*(?:"|$)|`(?:[^\\`]|\\[\S\s])*(?:`|$))/,
q,"'\"`"]):m.push(["str",/^(?:'(?:[^\n\r'\\]|\\.)*(?:'|$)|"(?:[^\n\r"\\]|\\.)*(?:"|$))/,q,"\"'"]);a.verbatimStrings&&e.push(["str",/^@"(?:[^"]|"")*(?:"|$)/,q]);var h=a.hashComments;h&&(a.cStyleComments?(h>1?m.push(["com",/^#(?:##(?:[^#]|#(?!##))*(?:###|$)|.*)/,q,"#"]):m.push(["com",/^#(?:(?:define|elif|else|endif|error|ifdef|include|ifndef|line|pragma|undef|warning)\b|[^\n\r]*)/,q,"#"]),e.push(["str",/^<(?:(?:(?:\.\.\/)*|\/?)(?:[\w-]+(?:\/[\w-]+)+)?[\w-]+\.h|[a-z]\w*)>/,q])):m.push(["com",/^#[^\n\r]*/,
q,"#"]));a.cStyleComments&&(e.push(["com",/^\/\/[^\n\r]*/,q]),e.push(["com",/^\/\*[\S\s]*?(?:\*\/|$)/,q]));a.regexLiterals&&e.push(["lang-regex",/^(?:^^\.?|[!+-]|!=|!==|#|%|%=|&|&&|&&=|&=|\(|\*|\*=|\+=|,|-=|->|\/|\/=|:|::|;|<|<<|<<=|<=|=|==|===|>|>=|>>|>>=|>>>|>>>=|[?@[^]|\^=|\^\^|\^\^=|{|\||\|=|\|\||\|\|=|~|break|case|continue|delete|do|else|finally|instanceof|return|throw|try|typeof)\s*(\/(?=[^*/])(?:[^/[\\]|\\[\S\s]|\[(?:[^\\\]]|\\[\S\s])*(?:]|$))+\/)/]);(h=a.types)&&e.push(["typ",h]);a=(""+a.keywords).replace(/^ | $/g,
"");a.length&&e.push(["kwd",RegExp("^(?:"+a.replace(/[\s,]+/g,"|")+")\\b"),q]);m.push(["pln",/^\s+/,q," \r\n\t\xa0"]);e.push(["lit",/^@[$_a-z][\w$@]*/i,q],["typ",/^(?:[@_]?[A-Z]+[a-z][\w$@]*|\w+_t\b)/,q],["pln",/^[$_a-z][\w$@]*/i,q],["lit",/^(?:0x[\da-f]+|(?:\d(?:_\d+)*\d*(?:\.\d*)?|\.\d\+)(?:e[+-]?\d+)?)[a-z]*/i,q,"0123456789"],["pln",/^\\[\S\s]?/,q],["pun",/^.[^\s\w"-$'./@\\`]*/,q]);return x(m,e)}function D(a,m){function e(a){switch(a.nodeType){case 1:if(k.test(a.className))break;if("BR"===a.nodeName)h(a),
a.parentNode&&a.parentNode.removeChild(a);else for(a=a.firstChild;a;a=a.nextSibling)e(a);break;case 3:case 4:if(p){var b=a.nodeValue,d=b.match(t);if(d){var c=b.substring(0,d.index);a.nodeValue=c;(b=b.substring(d.index+d[0].length))&&a.parentNode.insertBefore(s.createTextNode(b),a.nextSibling);h(a);c||a.parentNode.removeChild(a)}}}}function h(a){function b(a,d){var e=d?a.cloneNode(!1):a,f=a.parentNode;if(f){var f=b(f,1),g=a.nextSibling;f.appendChild(e);for(var h=g;h;h=g)g=h.nextSibling,f.appendChild(h)}return e}
for(;!a.nextSibling;)if(a=a.parentNode,!a)return;for(var a=b(a.nextSibling,0),e;(e=a.parentNode)&&e.nodeType===1;)a=e;d.push(a)}var k=/(?:^|\s)nocode(?:\s|$)/,t=/\r\n?|\n/,s=a.ownerDocument,l;a.currentStyle?l=a.currentStyle.whiteSpace:window.getComputedStyle&&(l=s.defaultView.getComputedStyle(a,q).getPropertyValue("white-space"));var p=l&&"pre"===l.substring(0,3);for(l=s.createElement("LI");a.firstChild;)l.appendChild(a.firstChild);for(var d=[l],g=0;g<d.length;++g)e(d[g]);m===(m|0)&&d[0].setAttribute("value",
m);var r=s.createElement("OL");r.className="linenums";for(var n=Math.max(0,m-1|0)||0,g=0,z=d.length;g<z;++g)l=d[g],l.className="L"+(g+n)%10,l.firstChild||l.appendChild(s.createTextNode("\xa0")),r.appendChild(l);a.appendChild(r)}function k(a,m){for(var e=m.length;--e>=0;){var h=m[e];A.hasOwnProperty(h)?window.console&&console.warn("cannot override language handler %s",h):A[h]=a}}function C(a,m){if(!a||!A.hasOwnProperty(a))a=/^\s*</.test(m)?"default-markup":"default-code";return A[a]}function E(a){var m=
a.g;try{var e=M(a.h),h=e.a;a.a=h;a.c=e.c;a.d=0;C(m,h)(a);var k=/\bMSIE\b/.test(navigator.userAgent),m=/\n/g,t=a.a,s=t.length,e=0,l=a.c,p=l.length,h=0,d=a.e,g=d.length,a=0;d[g]=s;var r,n;for(n=r=0;n<g;)d[n]!==d[n+2]?(d[r++]=d[n++],d[r++]=d[n++]):n+=2;g=r;for(n=r=0;n<g;){for(var z=d[n],f=d[n+1],b=n+2;b+2<=g&&d[b+1]===f;)b+=2;d[r++]=z;d[r++]=f;n=b}for(d.length=r;h<p;){var o=l[h+2]||s,c=d[a+2]||s,b=Math.min(o,c),i=l[h+1],j;if(i.nodeType!==1&&(j=t.substring(e,b))){k&&(j=j.replace(m,"\r"));i.nodeValue=
j;var u=i.ownerDocument,v=u.createElement("SPAN");v.className=d[a+1];var x=i.parentNode;x.replaceChild(v,i);v.appendChild(i);e<o&&(l[h+1]=i=u.createTextNode(t.substring(b,o)),x.insertBefore(i,v.nextSibling))}e=b;e>=o&&(h+=2);e>=c&&(a+=2)}}catch(w){"console"in window&&console.log(w&&w.stack?w.stack:w)}}var v=["break,continue,do,else,for,if,return,while"],w=[[v,"auto,case,char,const,default,double,enum,extern,float,goto,int,long,register,short,signed,sizeof,static,struct,switch,typedef,union,unsigned,void,volatile"],
"catch,class,delete,false,import,new,operator,private,protected,public,this,throw,true,try,typeof"],F=[w,"alignof,align_union,asm,axiom,bool,concept,concept_map,const_cast,constexpr,decltype,dynamic_cast,explicit,export,friend,inline,late_check,mutable,namespace,nullptr,reinterpret_cast,static_assert,static_cast,template,typeid,typename,using,virtual,where"],G=[w,"abstract,boolean,byte,extends,final,finally,implements,import,instanceof,null,native,package,strictfp,super,synchronized,throws,transient"],
H=[G,"as,base,by,checked,decimal,delegate,descending,dynamic,event,fixed,foreach,from,group,implicit,in,interface,internal,into,is,lock,object,out,override,orderby,params,partial,readonly,ref,sbyte,sealed,stackalloc,string,select,uint,ulong,unchecked,unsafe,ushort,var"],w=[w,"debugger,eval,export,function,get,null,set,undefined,var,with,Infinity,NaN"],I=[v,"and,as,assert,class,def,del,elif,except,exec,finally,from,global,import,in,is,lambda,nonlocal,not,or,pass,print,raise,try,with,yield,False,True,None"],
J=[v,"alias,and,begin,case,class,def,defined,elsif,end,ensure,false,in,module,next,nil,not,or,redo,rescue,retry,self,super,then,true,undef,unless,until,when,yield,BEGIN,END"],v=[v,"case,done,elif,esac,eval,fi,function,in,local,set,then,until"],K=/^(DIR|FILE|vector|(de|priority_)?queue|list|stack|(const_)?iterator|(multi)?(set|map)|bitset|u?(int|float)\d*)/,N=/\S/,O=u({keywords:[F,H,w,"caller,delete,die,do,dump,elsif,eval,exit,foreach,for,goto,if,import,last,local,my,next,no,our,print,package,redo,require,sub,undef,unless,until,use,wantarray,while,BEGIN,END"+
I,J,v],hashComments:!0,cStyleComments:!0,multiLineStrings:!0,regexLiterals:!0}),A={};k(O,["default-code"]);k(x([],[["pln",/^[^<?]+/],["dec",/^<!\w[^>]*(?:>|$)/],["com",/^<\!--[\S\s]*?(?:--\>|$)/],["lang-",/^<\?([\S\s]+?)(?:\?>|$)/],["lang-",/^<%([\S\s]+?)(?:%>|$)/],["pun",/^(?:<[%?]|[%?]>)/],["lang-",/^<xmp\b[^>]*>([\S\s]+?)<\/xmp\b[^>]*>/i],["lang-js",/^<script\b[^>]*>([\S\s]*?)(<\/script\b[^>]*>)/i],["lang-css",/^<style\b[^>]*>([\S\s]*?)(<\/style\b[^>]*>)/i],["lang-in.tag",/^(<\/?[a-z][^<>]*>)/i]]),
["default-markup","htm","html","mxml","xhtml","xml","xsl"]);k(x([["pln",/^\s+/,q," \t\r\n"],["atv",/^(?:"[^"]*"?|'[^']*'?)/,q,"\"'"]],[["tag",/^^<\/?[a-z](?:[\w-.:]*\w)?|\/?>$/i],["atn",/^(?!style[\s=]|on)[a-z](?:[\w:-]*\w)?/i],["lang-uq.val",/^=\s*([^\s"'>]*(?:[^\s"'/>]|\/(?=\s)))/],["pun",/^[/<->]+/],["lang-js",/^on\w+\s*=\s*"([^"]+)"/i],["lang-js",/^on\w+\s*=\s*'([^']+)'/i],["lang-js",/^on\w+\s*=\s*([^\s"'>]+)/i],["lang-css",/^style\s*=\s*"([^"]+)"/i],["lang-css",/^style\s*=\s*'([^']+)'/i],["lang-css",
/^style\s*=\s*([^\s"'>]+)/i]]),["in.tag"]);k(x([],[["atv",/^[\S\s]+/]]),["uq.val"]);k(u({keywords:F,hashComments:!0,cStyleComments:!0,types:K}),["c","cc","cpp","cxx","cyc","m"]);k(u({keywords:"null,true,false"}),["json"]);k(u({keywords:H,hashComments:!0,cStyleComments:!0,verbatimStrings:!0,types:K}),["cs"]);k(u({keywords:G,cStyleComments:!0}),["java"]);k(u({keywords:v,hashComments:!0,multiLineStrings:!0}),["bsh","csh","sh"]);k(u({keywords:I,hashComments:!0,multiLineStrings:!0,tripleQuotedStrings:!0}),
["cv","py"]);k(u({keywords:"caller,delete,die,do,dump,elsif,eval,exit,foreach,for,goto,if,import,last,local,my,next,no,our,print,package,redo,require,sub,undef,unless,until,use,wantarray,while,BEGIN,END",hashComments:!0,multiLineStrings:!0,regexLiterals:!0}),["perl","pl","pm"]);k(u({keywords:J,hashComments:!0,multiLineStrings:!0,regexLiterals:!0}),["rb"]);k(u({keywords:w,cStyleComments:!0,regexLiterals:!0}),["js"]);k(u({keywords:"all,and,by,catch,class,else,extends,false,finally,for,if,in,is,isnt,loop,new,no,not,null,of,off,on,or,return,super,then,true,try,unless,until,when,while,yes",
hashComments:3,cStyleComments:!0,multilineStrings:!0,tripleQuotedStrings:!0,regexLiterals:!0}),["coffee"]);k(x([],[["str",/^[\S\s]+/]]),["regex"]);window.prettyPrintOne=function(a,m,e){var h=document.createElement("PRE");h.innerHTML=a;e&&D(h,e);E({g:m,i:e,h:h});return h.innerHTML};window.prettyPrint=function(a){function m(){for(var e=window.PR_SHOULD_USE_CONTINUATION?l.now()+250:Infinity;p<h.length&&l.now()<e;p++){var n=h[p],k=n.className;if(k.indexOf("prettyprint")>=0){var k=k.match(g),f,b;if(b=
!k){b=n;for(var o=void 0,c=b.firstChild;c;c=c.nextSibling)var i=c.nodeType,o=i===1?o?b:c:i===3?N.test(c.nodeValue)?b:o:o;b=(f=o===b?void 0:o)&&"CODE"===f.tagName}b&&(k=f.className.match(g));k&&(k=k[1]);b=!1;for(o=n.parentNode;o;o=o.parentNode)if((o.tagName==="pre"||o.tagName==="code"||o.tagName==="xmp")&&o.className&&o.className.indexOf("prettyprint")>=0){b=!0;break}b||((b=(b=n.className.match(/\blinenums\b(?::(\d+))?/))?b[1]&&b[1].length?+b[1]:!0:!1)&&D(n,b),d={g:k,h:n,i:b},E(d))}}p<h.length?setTimeout(m,
250):a&&a()}for(var e=[document.getElementsByTagName("pre"),document.getElementsByTagName("code"),document.getElementsByTagName("xmp")],h=[],k=0;k<e.length;++k)for(var t=0,s=e[k].length;t<s;++t)h.push(e[k][t]);var e=q,l=Date;l.now||(l={now:function(){return+new Date}});var p=0,d,g=/\blang(?:uage)?-([\w.]+)(?!\S)/;m()};window.PR={createSimpleLexer:x,registerLangHandler:k,sourceDecorator:u,PR_ATTRIB_NAME:"atn",PR_ATTRIB_VALUE:"atv",PR_COMMENT:"com",PR_DECLARATION:"dec",PR_KEYWORD:"kwd",PR_LITERAL:"lit",
PR_NOCODE:"nocode",PR_PLAIN:"pln",PR_PUNCTUATION:"pun",PR_SOURCE:"src",PR_STRING:"str",PR_TAG:"tag",PR_TYPE:"typ"}})();
