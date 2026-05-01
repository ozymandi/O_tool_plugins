#target illustrator
#targetengine "OSpiralCEP"

var OSPIRAL_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/ospiral_cep_log.txt");

var ospiralSession = {
    active: false,
    keys: [],            // sorted [{x, y, w, h}, ...]
    strokeColor: null,
    previewPath: null
};

function ospiralLog(message) {
    if (!OSPIRAL_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function ospiralEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function ospiralToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + ospiralEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(ospiralToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(ospiralToJson(String(key)) + ":" + ospiralToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function ospiralResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return ospiralToJson(payload);
}

function ospiralParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function ospiralNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function ospiralNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function ospiralValidateConfig(config) {
    var validModes = { "total": 1, "per-segment": 1 };
    var validDir = { "cw": 1, "ccw": 1 };
    var normalized = {
        mode: validModes.hasOwnProperty(config.mode) ? config.mode : "total",
        loops: ospiralNormalizeInteger(config.loops, 15),
        randomness: ospiralNormalizeNumber(config.randomness, 0),
        density: ospiralNormalizeInteger(config.density, 12),
        direction: validDir.hasOwnProperty(config.direction) ? config.direction : "cw"
    };
    if (normalized.loops < 1) normalized.loops = 1;
    if (normalized.randomness < 0) normalized.randomness = 0;
    if (normalized.randomness > 100) normalized.randomness = 100;
    if (normalized.density < 4) normalized.density = 4;
    return normalized;
}

function ospiralEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

// ---------- SORTING (verbatim) ----------

function ospiralCollectAndSort(sel) {
    var objects = [];
    for (var i = 0; i < sel.length; i++) objects.push(sel[i]);
    objects.sort(function (a, b) {
        var b1 = a.geometricBounds;
        var b2 = b.geometricBounds;
        var yDiff = b2[1] - b1[1];
        if (Math.abs(yDiff) > 10) return yDiff;
        return b1[0] - b2[0];
    });
    return objects;
}

function ospiralGetData(item) {
    var b = item.geometricBounds;
    return {
        x: (b[0] + b[2]) / 2,
        y: (b[1] + b[3]) / 2,
        w: Math.abs(b[2] - b[0]) / 2,
        h: Math.abs(b[1] - b[3]) / 2
    };
}

// ---------- SPLINE / NOISE (verbatim) ----------

function ospiralSpline(p0, p1, p2, p3, t) {
    var v0 = (p2 - p0) * 0.5;
    var v1 = (p3 - p1) * 0.5;
    var t2 = t * t;
    var t3 = t * t2;
    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

function ospiralComputePoints(keys, mode, loops, randomness, density, direction) {
    var dir = direction === "ccw" ? -1 : 1;
    var noiseFactor = randomness / 10;
    var numSegments = keys.length - 1;
    var totalLoops;
    if (mode === "per-segment") {
        totalLoops = loops * numSegments;
    } else {
        totalLoops = loops;
    }
    if (totalLoops < 1) totalLoops = 1;

    var fullKeys = [keys[0]].concat(keys).concat([keys[keys.length - 1]]);

    var loopCount = Math.ceil(totalLoops) + 2;
    var loopNoises = [];
    for (var n = 0; n <= loopCount; n++) {
        loopNoises.push(1 + (Math.random() - 0.5) * noiseFactor);
    }

    var pointsPerLoop = density;
    if (pointsPerLoop < 4) pointsPerLoop = 4;
    var totalSteps = Math.round(totalLoops * pointsPerLoop);
    if (totalSteps < 2) totalSteps = 2;

    // Pass 1: compute anchor positions
    var anchors = [];
    for (var i = 0; i <= totalSteps; i++) {
        var globalT = i / totalSteps;
        var floatIndex = globalT * numSegments;
        var segIdx = Math.floor(floatIndex);
        if (segIdx >= numSegments) segIdx = numSegments - 1;
        var localT = floatIndex - segIdx;

        var p0 = fullKeys[segIdx];
        var p1 = fullKeys[segIdx + 1];
        var p2 = fullKeys[segIdx + 2];
        var p3 = fullKeys[segIdx + 3];

        var cx = ospiralSpline(p0.x, p1.x, p2.x, p3.x, localT);
        var cy = ospiralSpline(p0.y, p1.y, p2.y, p3.y, localT);

        var cw_base = p1.w + (p2.w - p1.w) * localT;
        var ch_base = p1.h + (p2.h - p1.h) * localT;

        var loopFloat = globalT * totalLoops;
        var loopIdx = Math.floor(loopFloat);
        var loopLocalT = loopFloat - loopIdx;

        var nStart = loopNoises[loopIdx] || 1;
        var nEnd = loopNoises[loopIdx + 1] || nStart;
        var rawNoise = nStart + (nEnd - nStart) * loopLocalT;

        var keyframeConstraint = Math.sin(localT * Math.PI);
        var finalNoise = 1 + (rawNoise - 1) * keyframeConstraint;

        var cw = cw_base * finalNoise;
        var ch = ch_base * finalNoise;

        var angle = globalT * Math.PI * 2 * totalLoops * dir;
        var x = cx + Math.cos(angle) * cw;
        var y = cy + Math.sin(angle) * ch;
        anchors.push([x, y]);
    }

    // Pass 2: derive Catmull-Rom-to-Bezier handles
    // Tangent at i = (anchor[i+1] - anchor[i-1]) / 2; handle = anchor +- tangent / 3
    var n = anchors.length;
    var pts = [];
    for (var k = 0; k < n; k++) {
        var a = anchors[k];
        var prev = (k > 0) ? anchors[k - 1] : null;
        var next = (k < n - 1) ? anchors[k + 1] : null;
        var lx, ly, rx, ry;
        if (prev && next) {
            var tx = (next[0] - prev[0]) / 2;
            var ty = (next[1] - prev[1]) / 2;
            lx = a[0] - tx / 3; ly = a[1] - ty / 3;
            rx = a[0] + tx / 3; ry = a[1] + ty / 3;
        } else if (next) {
            // First anchor: extrapolate forward tangent
            var ftx = next[0] - a[0];
            var fty = next[1] - a[1];
            lx = a[0]; ly = a[1];
            rx = a[0] + ftx / 3; ry = a[1] + fty / 3;
        } else if (prev) {
            // Last anchor: extrapolate backward tangent
            var btx = a[0] - prev[0];
            var bty = a[1] - prev[1];
            lx = a[0] - btx / 3; ly = a[1] - bty / 3;
            rx = a[0]; ry = a[1];
        } else {
            // Single anchor (degenerate)
            lx = a[0]; ly = a[1];
            rx = a[0]; ry = a[1];
        }
        pts.push({ a: a, l: [lx, ly], r: [rx, ry] });
    }
    return pts;
}

// ---------- PATH MANAGEMENT ----------

function ospiralWritePathPoints(path, points) {
    var pts = path.pathPoints;
    while (pts.length < points.length) pts.add();
    while (pts.length > points.length) {
        try { pts[pts.length - 1].remove(); }
        catch (e) { break; }
    }
    var lastIdx = points.length - 1;
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        pts[i].anchor = p.a;
        pts[i].leftDirection = p.l;
        pts[i].rightDirection = p.r;
        try { pts[i].pointType = (i === 0 || i === lastIdx) ? PointType.CORNER : PointType.SMOOTH; } catch (e) {}
    }
}

function ospiralCreatePath(doc, strokeColor, points) {
    var path = doc.pathItems.add();
    path.name = "OSpiral_Result";
    path.filled = false;
    path.stroked = true;
    path.strokeWidth = 1.5;
    path.strokeColor = strokeColor;

    // setEntirePath accepts an array of anchor [x, y] pairs and creates pathPoints accordingly
    var anchors = [];
    for (var i = 0; i < points.length; i++) anchors.push(points[i].a);
    path.setEntirePath(anchors);

    var pp = path.pathPoints;
    var lastIdx = points.length - 1;
    for (var j = 0; j < points.length; j++) {
        pp[j].leftDirection = points[j].l;
        pp[j].rightDirection = points[j].r;
        try { pp[j].pointType = (j === 0 || j === lastIdx) ? PointType.CORNER : PointType.SMOOTH; } catch (e) {}
    }
    return path;
}

function ospiralResolveStrokeColor(item) {
    try {
        if (item && item.stroked && item.strokeColor && item.strokeColor.typename !== "NoColor") {
            return item.strokeColor;
        }
    } catch (e) {}
    var black = new RGBColor();
    black.red = 0; black.green = 0; black.blue = 0;
    return black;
}

// ---------- ENDPOINTS ----------

function ospiralStart(encodedConfig) {
    try {
        if (ospiralSession.active) {
            try { if (ospiralSession.previewPath) ospiralSession.previewPath.remove(); } catch (e) {}
            ospiralSession.active = false;
            ospiralSession.previewPath = null;
        }

        var config = ospiralValidateConfig(ospiralParseConfig(encodedConfig));
        var doc = ospiralEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length < 2) {
            throw new Error("Select at least 2 circles first.");
        }

        var sortedItems = ospiralCollectAndSort(sel);
        var keys = [];
        for (var i = 0; i < sortedItems.length; i++) keys.push(ospiralGetData(sortedItems[i]));

        var strokeColor = ospiralResolveStrokeColor(sortedItems[0]);
        var pts = ospiralComputePoints(keys, config.mode, config.loops, config.randomness, config.density, config.direction);

        var path = ospiralCreatePath(doc, strokeColor, pts);

        ospiralSession.active = true;
        ospiralSession.keys = keys;
        ospiralSession.strokeColor = strokeColor;
        ospiralSession.previewPath = path;

        app.redraw();
        return ospiralResponse(true, "Built spiral with " + keys.length + " key circles.", {
            keys: keys.length,
            anchors: pts.length
        });
    } catch (error) {
        ospiralLog(error.message || String(error));
        try { if (ospiralSession.previewPath) ospiralSession.previewPath.remove(); } catch (e) {}
        ospiralSession.active = false;
        ospiralSession.keys = [];
        ospiralSession.strokeColor = null;
        ospiralSession.previewPath = null;
        return ospiralResponse(false, error.message || String(error));
    }
}

function ospiralUpdate(encodedConfig) {
    try {
        if (!ospiralSession.active || !ospiralSession.previewPath) {
            return ospiralResponse(false, "No active session.");
        }
        var config = ospiralValidateConfig(ospiralParseConfig(encodedConfig));
        var pts = ospiralComputePoints(ospiralSession.keys, config.mode, config.loops, config.randomness, config.density, config.direction);
        ospiralWritePathPoints(ospiralSession.previewPath, pts);
        app.redraw();
        return ospiralResponse(true, "Spiral updated.", { anchors: pts.length });
    } catch (error) {
        ospiralLog(error.message || String(error));
        return ospiralResponse(false, error.message || String(error));
    }
}

function ospiralApply() {
    try {
        if (!ospiralSession.active || !ospiralSession.previewPath) {
            return ospiralResponse(false, "No active session.");
        }
        // Detach preview path from session — keep it as final result
        ospiralSession.active = false;
        ospiralSession.keys = [];
        ospiralSession.strokeColor = null;
        ospiralSession.previewPath = null;
        app.redraw();
        return ospiralResponse(true, "Spiral applied.");
    } catch (error) {
        ospiralLog(error.message || String(error));
        return ospiralResponse(false, error.message || String(error));
    }
}

function ospiralCancel() {
    try {
        if (!ospiralSession.active) {
            return ospiralResponse(true, "No active session.", { wasActive: false });
        }
        if (ospiralSession.previewPath) {
            try { ospiralSession.previewPath.remove(); } catch (e) {}
        }
        ospiralSession.active = false;
        ospiralSession.keys = [];
        ospiralSession.strokeColor = null;
        ospiralSession.previewPath = null;
        app.redraw();
        return ospiralResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        ospiralLog(error.message || String(error));
        return ospiralResponse(false, error.message || String(error));
    }
}

function ospiralHandshake() {
    try {
        return ospiralResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!ospiralSession.active
        });
    } catch (error) {
        return ospiralResponse(false, error.message || String(error));
    }
}
