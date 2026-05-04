#target illustrator
#targetengine "OLumeGradientCEP"

var olumegradientSession = {
    active: false,
    items: [],          // captured PathItem / CompoundPathItem
    snapshots: [],      // [{ item, hadFill, fillColor, hadStroke, strokeColor, gradientStrokePolicy }]
    sessionID: null
};

function olumegradientEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function olumegradientToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + olumegradientEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(olumegradientToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(olumegradientToJson(String(key)) + ":" + olumegradientToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function olumegradientResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return olumegradientToJson(payload);
}

function olumegradientParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function olumegradientEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function olumegradientValidateConfig(config) {
    var n = {
        doFill: !!config.doFill,
        doStroke: !!config.doStroke,
        gradType: (config.gradType === "radial") ? "radial" : "linear",
        angle: parseFloat(config.angle),
        stops: parseInt(config.stops, 10),
        intensity: parseFloat(config.intensity)
    };
    if (isNaN(n.angle)) n.angle = -90;
    if (isNaN(n.stops) || n.stops < 2) n.stops = 2;
    if (n.stops > 20) n.stops = 20;
    if (isNaN(n.intensity)) n.intensity = 0.5;
    if (n.intensity < 0) n.intensity = 0;
    if (n.intensity > 1) n.intensity = 1;
    return n;
}

// ---------- HELPERS ----------

function olumegradientFlatten(items, out) {
    for (var i = 0; i < items.length; i++) {
        try {
            var it = items[i];
            if (it.typename === "GroupItem") olumegradientFlatten(it.pageItems, out);
            else if (it.typename === "PathItem" || it.typename === "CompoundPathItem") out.push(it);
        } catch (e) {}
    }
}

function olumegradientGetRGB(c) {
    if (!c) return null;
    try {
        if (c.typename === "SpotColor") return olumegradientGetRGB(c.spot.color);
        if (c.typename === "RGBColor") return { r: c.red, g: c.green, b: c.blue };
        if (c.typename === "GrayColor") {
            var v = 255 - (c.gray * 2.55);
            return { r: v, g: v, b: v };
        }
        if (c.typename === "CMYKColor") {
            var k = c.black / 100;
            return {
                r: Math.round(255 * (1 - c.cyan / 100) * (1 - k)),
                g: Math.round(255 * (1 - c.magenta / 100) * (1 - k)),
                b: Math.round(255 * (1 - c.yellow / 100) * (1 - k))
            };
        }
    } catch (e) {}
    return null;
}

function olumegradientMakeRGB(r, g, b) {
    var c = new RGBColor();
    c.red = Math.max(0, Math.min(255, r));
    c.green = Math.max(0, Math.min(255, g));
    c.blue = Math.max(0, Math.min(255, b));
    return c;
}

function olumegradientGetOrMakeGradient(doc, name) {
    try {
        for (var i = 0; i < doc.gradients.length; i++) {
            try {
                if (doc.gradients[i].name === name) return doc.gradients[i];
            } catch (e) {}
        }
    } catch (e) {}
    var g = doc.gradients.add();
    try { g.name = name; } catch (eN) {}
    return g;
}

function olumegradientCreateGradient(doc, rgb, params, key) {
    var name = "Lume_" + olumegradientSession.sessionID + "_" + key;
    var grad = olumegradientGetOrMakeGradient(doc, name);
    grad.type = (params.gradType === "linear") ? GradientType.LINEAR : GradientType.RADIAL;

    var needed = params.stops;
    while (grad.gradientStops.length < needed) grad.gradientStops.add();
    while (grad.gradientStops.length > needed) {
        try { grad.gradientStops[grad.gradientStops.length - 1].remove(); } catch (eR) { break; }
    }

    var lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b);
    var targetVal = (lum > 128) ? 0 : 255;

    for (var i = 0; i < needed; i++) {
        var t = (needed > 1) ? i / (needed - 1) : 0;
        var mix = t * params.intensity;
        var r = rgb.r + (targetVal - rgb.r) * mix;
        var g = rgb.g + (targetVal - rgb.g) * mix;
        var b = rgb.b + (targetVal - rgb.b) * mix;
        var stop = grad.gradientStops[i];
        try { stop.rampPoint = t * 100; } catch (eRamp) {}
        try { stop.midPoint = 50; } catch (eMid) {}
        try { stop.color = olumegradientMakeRGB(r, g, b); } catch (eC) {}
    }
    return grad;
}

function olumegradientApplyGradientToItem(item, mode, baseColor, params, cache) {
    if (!baseColor) return false;
    var rgb = olumegradientGetRGB(baseColor);
    if (!rgb) return false;
    var key = rgb.r + "-" + rgb.g + "-" + rgb.b + "_" + params.stops + "_" + params.intensity + "_" + params.gradType;
    var grad = cache[key];
    if (!grad) {
        grad = olumegradientCreateGradient(app.activeDocument, rgb, params, key);
        cache[key] = grad;
    }
    var gc = new GradientColor();
    gc.gradient = grad;
    if (params.gradType === "linear") {
        try { gc.angle = params.angle; } catch (eA) {}
    }
    try {
        if (mode === "fill") item.fillColor = gc;
        else {
            item.strokeColor = gc;
            try { item.strokeColor.gradientStrokePolicy = GradientStrokePolicy.GRADIENTALONGSTROKE; } catch (eP) {}
        }
        return true;
    } catch (eApply) {
        return false;
    }
}

// ---------- SNAPSHOTS / RESTORE ----------

function olumegradientSnapshotItem(item) {
    var snap = {
        item: item,
        hadFill: false,
        fillColor: null,
        hadStroke: false,
        strokeColor: null
    };
    try { snap.hadFill = !!item.filled; } catch (e) {}
    if (snap.hadFill) {
        try { snap.fillColor = item.fillColor; } catch (e) {}
    }
    try { snap.hadStroke = !!item.stroked; } catch (e) {}
    if (snap.hadStroke) {
        try { snap.strokeColor = item.strokeColor; } catch (e) {}
    }
    return snap;
}

function olumegradientRestoreSnapshots() {
    for (var i = 0; i < olumegradientSession.snapshots.length; i++) {
        var s = olumegradientSession.snapshots[i];
        try {
            if (s.hadFill && s.fillColor) {
                s.item.filled = true;
                s.item.fillColor = s.fillColor;
            }
        } catch (e1) {}
        try {
            if (s.hadStroke && s.strokeColor) {
                s.item.stroked = true;
                s.item.strokeColor = s.strokeColor;
            }
        } catch (e2) {}
    }
}

// ---------- DRAW ----------

function olumegradientRedraw(config) {
    if (!olumegradientSession.snapshots.length) return 0;
    // Always start from snapshots so changing gradType / angle etc.
    // doesn't compound the previous gradient.
    olumegradientRestoreSnapshots();

    var cache = {};
    var counter = 0;
    for (var i = 0; i < olumegradientSession.snapshots.length; i++) {
        var s = olumegradientSession.snapshots[i];
        var item = s.item;
        if (config.doFill && s.hadFill && s.fillColor) {
            // Skip if original was already gradient/pattern (we treat it as untouchable)
            if (s.fillColor.typename !== "GradientColor" && s.fillColor.typename !== "PatternColor") {
                if (olumegradientApplyGradientToItem(item, "fill", s.fillColor, config, cache)) counter++;
            }
        }
        if (config.doStroke && s.hadStroke && s.strokeColor) {
            if (s.strokeColor.typename !== "GradientColor" && s.strokeColor.typename !== "PatternColor") {
                if (olumegradientApplyGradientToItem(item, "stroke", s.strokeColor, config, cache)) counter++;
            }
        }
    }
    return counter;
}

function olumegradientResetSession(restore) {
    if (restore) olumegradientRestoreSnapshots();
    olumegradientSession.active = false;
    olumegradientSession.items = [];
    olumegradientSession.snapshots = [];
}

// ---------- ENDPOINTS ----------

function olumegradientStart(encodedConfig) {
    try {
        if (olumegradientSession.active) {
            olumegradientResetSession(true);
        }
        var config = olumegradientValidateConfig(olumegradientParseConfig(encodedConfig));
        var doc = olumegradientEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) throw new Error("Select objects first.");
        var items = [];
        olumegradientFlatten(sel, items);
        if (items.length === 0) throw new Error("No paths or compound paths in selection.");
        olumegradientSession.items = items;
        olumegradientSession.snapshots = [];
        for (var i = 0; i < items.length; i++) {
            olumegradientSession.snapshots.push(olumegradientSnapshotItem(items[i]));
        }
        olumegradientSession.sessionID = Math.floor(Math.random() * 99999).toString(16);
        olumegradientSession.active = true;
        var n = olumegradientRedraw(config);
        app.redraw();
        return olumegradientResponse(true, "Applied gradient to " + n + " of " + items.length + " object(s).", {
            applied: n,
            total: items.length
        });
    } catch (error) {
        olumegradientResetSession(true);
        return olumegradientResponse(false, error.message || String(error));
    }
}

function olumegradientUpdate(encodedConfig) {
    try {
        if (!olumegradientSession.active) return olumegradientResponse(false, "No active session.");
        var config = olumegradientValidateConfig(olumegradientParseConfig(encodedConfig));
        var n = olumegradientRedraw(config);
        app.redraw();
        return olumegradientResponse(true, "Applied " + n + " gradient(s).", { applied: n });
    } catch (error) {
        return olumegradientResponse(false, error.message || String(error));
    }
}

function olumegradientApply() {
    try {
        if (!olumegradientSession.active) return olumegradientResponse(false, "No active session.");
        // Detach: keep gradients on canvas as-is, drop snapshots
        var n = olumegradientSession.snapshots.length;
        olumegradientSession.active = false;
        olumegradientSession.items = [];
        olumegradientSession.snapshots = [];
        app.redraw();
        return olumegradientResponse(true, "Committed gradients on " + n + " object(s).", { items: n });
    } catch (error) {
        return olumegradientResponse(false, error.message || String(error));
    }
}

function olumegradientCancel() {
    try {
        if (!olumegradientSession.active) return olumegradientResponse(true, "No active session.", { wasActive: false });
        olumegradientResetSession(true);
        app.redraw();
        return olumegradientResponse(true, "Cancelled — colors restored.", { wasActive: true });
    } catch (error) {
        return olumegradientResponse(false, error.message || String(error));
    }
}

function olumegradientHandshake() {
    try {
        return olumegradientResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!olumegradientSession.active
        });
    } catch (error) {
        return olumegradientResponse(false, error.message || String(error));
    }
}
