#target illustrator
#targetengine "OConeCEP"

var OCONE_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/ocone_cep_log.txt");

var oconeSession = {
    active: false,
    items: []
};

function oconeLog(message) {
    if (!OCONE_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function oconeEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oconeToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oconeEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oconeToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oconeToJson(String(key)) + ":" + oconeToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oconeResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oconeToJson(payload);
}

function oconeParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function oconeNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function oconeValidateConfig(config) {
    var normalized = {
        style: oconeNormalizeInteger(config.style, 0),
        quality: oconeNormalizeInteger(config.quality, 180)
    };
    if (normalized.style < 0 || normalized.style > 4) normalized.style = 0;
    if (normalized.quality < 3) normalized.quality = 3;
    return normalized;
}

function oconeEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

// ---------- COLOR ENGINE (verbatim from original) ----------

function oconeGetColorForStyle(styleIdx, t) {
    var stops = [];
    switch (styleIdx) {
        case 0: stops = [[0, [255, 255, 255]], [0.25, [180, 180, 180]], [0.5, [255, 255, 255]], [0.75, [150, 150, 150]], [1, [255, 255, 255]]]; break;
        case 1: stops = [[0, [255, 240, 150]], [0.25, [194, 135, 50]], [0.5, [255, 252, 200]], [0.75, [194, 135, 50]], [1, [255, 240, 150]]]; break;
        case 2: stops = [[0, [255, 0, 0]], [0.16, [255, 255, 0]], [0.33, [0, 255, 0]], [0.5, [0, 255, 255]], [0.66, [0, 0, 255]], [0.83, [255, 0, 255]], [1, [255, 0, 0]]]; break;
        case 3: stops = [[0, [0, 255, 0]], [0.95, [0, 50, 0]], [1, [0, 255, 0]]]; break;
        case 4: stops = [[0, [0, 0, 0]], [0.5, [128, 128, 128]], [1, [255, 255, 255]]]; break;
    }
    for (var i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) {
            var t1 = stops[i][0], t2 = stops[i + 1][0];
            var c1 = stops[i][1], c2 = stops[i + 1][1];
            var localT = (t - t1) / (t2 - t1);
            return [c1[0] + (c2[0] - c1[0]) * localT, c1[1] + (c2[1] - c1[1]) * localT, c1[2] + (c2[2] - c1[2]) * localT];
        }
    }
    return stops[stops.length - 1][1];
}

function oconeMakeRGB(rgb) {
    var c = new RGBColor();
    c.red = rgb[0]; c.green = rgb[1]; c.blue = rgb[2];
    return c;
}

// ---------- FAN BUILD ----------

function oconeBuildFan(fanGroup, cx, cy, radius, segCount, styleIdx) {
    var step = 360 / segCount;
    var startAngle = -90;
    for (var a = 0; a < segCount; a++) {
        var deg = a * step;
        var rad1 = (startAngle + deg) * Math.PI / 180;
        var rad2 = (startAngle + deg + step + 0.6) * Math.PI / 180;
        var p1 = [cx, cy];
        var p2 = [cx + Math.cos(rad1) * radius, cy + Math.sin(rad1) * radius];
        var p3 = [cx + Math.cos(rad2) * radius, cy + Math.sin(rad2) * radius];
        var tri = fanGroup.pathItems.add();
        tri.setEntirePath([p1, p2, p3]);
        tri.closed = true;
        tri.stroked = false;
        tri.filled = true;
        var pct = deg / 360;
        tri.fillColor = oconeMakeRGB(oconeGetColorForStyle(styleIdx, pct));
    }
}

function oconeUpdateColors(fanGroup, segCount, styleIdx) {
    var step = 360 / segCount;
    var pis = fanGroup.pathItems;
    var n = Math.min(segCount, pis.length);
    for (var i = 0; i < n; i++) {
        var deg = i * step;
        pis[i].fillColor = oconeMakeRGB(oconeGetColorForStyle(styleIdx, deg / 360));
    }
}

function oconeRebuildFan(item, segCount, styleIdx) {
    while (item.fanGroup.pathItems.length > 0) {
        try { item.fanGroup.pathItems[0].remove(); } catch (e) { break; }
    }
    oconeBuildFan(item.fanGroup, item.cx, item.cy, item.radius, segCount, styleIdx);
}

// ---------- SESSION ----------

function oconeBuildItem(srcItem, segCount, styleIdx) {
    var doc = app.activeDocument;
    var b = srcItem.visibleBounds;
    var w = b[2] - b[0];
    var h = b[1] - b[3];
    var cx = b[0] + w / 2;
    var cy = b[1] - h / 2;
    var radius = Math.sqrt(w * w + h * h) / 1.5;

    var mainGroup = doc.groupItems.add();
    mainGroup.name = "OCone_Result";
    mainGroup.move(srcItem, ElementPlacement.PLACEBEFORE);

    var maskPath = srcItem.duplicate(mainGroup, ElementPlacement.PLACEATBEGINNING);

    if (maskPath.typename === "PathItem") {
        maskPath.filled = false;
        maskPath.stroked = false;
        maskPath.clipping = true;
    } else if (maskPath.typename === "CompoundPathItem") {
        if (maskPath.pathItems.length > 0) maskPath.pathItems[0].clipping = true;
    }

    var fanGroup = doc.groupItems.add();
    fanGroup.name = "Fan_Source";
    fanGroup.move(maskPath, ElementPlacement.PLACEAFTER);

    oconeBuildFan(fanGroup, cx, cy, radius, segCount, styleIdx);

    mainGroup.clipped = true;

    try { srcItem.hidden = true; } catch (e) {}

    return {
        original: srcItem,
        mainGroup: mainGroup,
        maskPath: maskPath,
        fanGroup: fanGroup,
        cx: cx,
        cy: cy,
        radius: radius,
        lastQuality: segCount,
        lastStyle: styleIdx
    };
}

function oconeRevertItem(item) {
    if (item.mainGroup) {
        try { item.mainGroup.remove(); } catch (e) {}
    }
    if (item.original) {
        try { item.original.hidden = false; } catch (e) {}
    }
}

function oconeCommitItem(item) {
    if (item.original) {
        try { item.original.remove(); } catch (e) {}
    }
}

function oconeClearSession() {
    oconeSession.active = false;
    oconeSession.items = [];
}

// ---------- ENDPOINTS ----------

function oconeStart(encodedConfig) {
    try {
        // Cancel any stale session first
        if (oconeSession.active) {
            for (var s = 0; s < oconeSession.items.length; s++) oconeRevertItem(oconeSession.items[s]);
            oconeClearSession();
        }

        var config = oconeValidateConfig(oconeParseConfig(encodedConfig));
        var doc = oconeEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select one or more shapes first.");
        }

        // Snapshot selection (refs may shift as we mutate the layer)
        var srcItems = [];
        for (var i = 0; i < sel.length; i++) srcItems.push(sel[i]);

        var built = [];
        // Iterate in reverse so each new mainGroup placed BEFORE original keeps subsequent indices valid
        for (var j = srcItems.length - 1; j >= 0; j--) {
            try {
                built.push(oconeBuildItem(srcItems[j], config.quality, config.style));
            } catch (err) {
                oconeLog("Build error on item " + j + ": " + err.message);
            }
        }

        if (built.length === 0) {
            throw new Error("Could not build any cones.");
        }

        oconeSession.active = true;
        oconeSession.items = built;

        app.redraw();
        return oconeResponse(true, "Built " + built.length + " cone(s).", { count: built.length });
    } catch (error) {
        oconeLog(error.message || String(error));
        // Rollback partial
        if (oconeSession.items.length > 0) {
            for (var k = 0; k < oconeSession.items.length; k++) oconeRevertItem(oconeSession.items[k]);
            oconeClearSession();
        }
        return oconeResponse(false, error.message || String(error));
    }
}

function oconeUpdate(encodedConfig) {
    try {
        if (!oconeSession.active) {
            return oconeResponse(false, "No active session.");
        }
        var config = oconeValidateConfig(oconeParseConfig(encodedConfig));
        var rebuilt = 0;
        var recolored = 0;
        for (var i = 0; i < oconeSession.items.length; i++) {
            var item = oconeSession.items[i];
            if (item.lastQuality === config.quality && item.lastStyle === config.style) continue;
            if (item.lastQuality === config.quality) {
                // Style only — fast path
                oconeUpdateColors(item.fanGroup, config.quality, config.style);
                item.lastStyle = config.style;
                recolored++;
            } else {
                oconeRebuildFan(item, config.quality, config.style);
                item.lastQuality = config.quality;
                item.lastStyle = config.style;
                rebuilt++;
            }
        }
        app.redraw();
        var msg = "";
        if (rebuilt > 0) msg += "Rebuilt " + rebuilt + " fan(s). ";
        if (recolored > 0) msg += "Recoloured " + recolored + ".";
        if (!msg) msg = "No changes.";
        return oconeResponse(true, msg);
    } catch (error) {
        oconeLog(error.message || String(error));
        return oconeResponse(false, error.message || String(error));
    }
}

function oconeApply() {
    try {
        if (!oconeSession.active) {
            return oconeResponse(false, "No active session.");
        }
        var n = oconeSession.items.length;
        for (var i = 0; i < n; i++) oconeCommitItem(oconeSession.items[i]);
        oconeClearSession();
        app.redraw();
        return oconeResponse(true, "Applied " + n + " cone(s).", { count: n });
    } catch (error) {
        oconeLog(error.message || String(error));
        return oconeResponse(false, error.message || String(error));
    }
}

function oconeCancel() {
    try {
        if (!oconeSession.active) {
            return oconeResponse(true, "No active session.", { wasActive: false });
        }
        for (var i = 0; i < oconeSession.items.length; i++) oconeRevertItem(oconeSession.items[i]);
        oconeClearSession();
        app.redraw();
        return oconeResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        oconeLog(error.message || String(error));
        return oconeResponse(false, error.message || String(error));
    }
}

function oconeHandshake() {
    try {
        return oconeResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!oconeSession.active
        });
    } catch (error) {
        return oconeResponse(false, error.message || String(error));
    }
}
