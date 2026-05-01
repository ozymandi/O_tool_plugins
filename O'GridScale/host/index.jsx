#target illustrator
#targetengine "OGridScaleCEP"

var OGRIDSCALE_DEBUG = false;
var ogridscaleDebugLog = new File(Folder.desktop + "/ogridscale_cep_log.txt");

function ogridscaleLog(message) {
    if (!OGRIDSCALE_DEBUG) return;
    try {
        ogridscaleDebugLog.open("a");
        ogridscaleDebugLog.writeln("[" + new Date().toUTCString() + "] " + message);
        ogridscaleDebugLog.close();
    } catch (e) {}
}

function ogridscaleEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function ogridscaleToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + ogridscaleEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(ogridscaleToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(ogridscaleToJson(String(key)) + ":" + ogridscaleToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function ogridscaleResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return ogridscaleToJson(payload);
}

function ogridscaleParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function ogridscaleNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function ogridscaleValidateConfig(config) {
    var validModes = { radial: 1, horizontal: 1, vertical: 1 };
    var validEasing = { cosine: 1, linear: 1 };
    var normalized = {
        mode: validModes.hasOwnProperty(config.mode) ? config.mode : "radial",
        easing: validEasing.hasOwnProperty(config.easing) ? config.easing : "cosine",
        startScale: ogridscaleNormalizeNumber(config.startScale, 85),
        endScale: ogridscaleNormalizeNumber(config.endScale, 15),
        scaleStrokes: !!config.scaleStrokes,
        invert: !!config.invert
    };
    if (normalized.startScale < 0) normalized.startScale = 0;
    if (normalized.endScale < 0) normalized.endScale = 0;
    return normalized;
}

function ogridscaleEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function ogridscaleGetTargets(doc) {
    var sel = doc.selection;
    var items = [];
    var i;
    if (!sel || sel.length === 0) return items;
    if (sel.length === 1 && sel[0].typename === "GroupItem") {
        var groupItems = sel[0].pageItems;
        for (i = 0; i < groupItems.length; i++) items.push(groupItems[i]);
    } else {
        for (i = 0; i < sel.length; i++) items.push(sel[i]);
    }
    return items;
}

function ogridscaleGetItemCenter(item) {
    var b = item.geometricBounds;
    var w = b[2] - b[0];
    var h = b[1] - b[3];
    return [b[0] + w / 2, b[1] - h / 2];
}

function ogridscaleGetFullBounds(items) {
    var b = items[0].geometricBounds;
    var L = b[0], T = b[1], R = b[2], B = b[3];
    for (var i = 1; i < items.length; i++) {
        var cb = items[i].geometricBounds;
        if (cb[0] < L) L = cb[0];
        if (cb[1] > T) T = cb[1];
        if (cb[2] > R) R = cb[2];
        if (cb[3] < B) B = cb[3];
    }
    return [L, T, R, B];
}

function ogridscaleResizeAndLock(item, scalePct, originalCenter, scaleStrokes) {
    try {
        item.resize(scalePct, scalePct, true, true, true, true, scaleStrokes ? scalePct : 100);
        var newCenter = ogridscaleGetItemCenter(item);
        var dx = originalCenter[0] - newCenter[0];
        var dy = originalCenter[1] - newCenter[1];
        if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
            item.translate(dx, dy);
        }
    } catch (e) {
        ogridscaleLog("Resize failed: " + e.message);
    }
}

function ogridscaleBuildProcessData(items, mode) {
    var data = [];
    var i;
    var count = items.length;

    if (mode === "radial") {
        var bounds = ogridscaleGetFullBounds(items);
        var cx = bounds[0] + (bounds[2] - bounds[0]) / 2;
        var cy = bounds[1] - (bounds[1] - bounds[3]) / 2;
        var maxDist = 0;
        for (i = 0; i < count; i++) {
            var center = ogridscaleGetItemCenter(items[i]);
            var dist = Math.sqrt(Math.pow(center[0] - cx, 2) + Math.pow(center[1] - cy, 2));
            if (dist > maxDist) maxDist = dist;
            data.push({ item: items[i], val: dist, origin: center });
        }
        for (i = 0; i < data.length; i++) {
            data[i].t = (maxDist === 0) ? 0 : data[i].val / maxDist;
        }
        return data;
    }

    var sorted = items.slice();
    if (mode === "horizontal") {
        sorted.sort(function (a, b) { return a.left - b.left; });
    } else {
        sorted.sort(function (a, b) { return b.top - a.top; });
    }
    for (i = 0; i < sorted.length; i++) {
        data.push({
            item: sorted[i],
            val: i,
            origin: ogridscaleGetItemCenter(sorted[i]),
            t: (sorted.length <= 1) ? 0 : i / (sorted.length - 1)
        });
    }
    return data;
}

function ogridscaleRun(encodedConfig) {
    try {
        var config = ogridscaleValidateConfig(ogridscaleParseConfig(encodedConfig));
        var doc = ogridscaleEnsureDocument();
        var items = ogridscaleGetTargets(doc);
        if (items.length < 2) {
            throw new Error("Select 2+ objects (or a group with 2+ children).");
        }

        var processed = ogridscaleBuildProcessData(items, config.mode);
        var startScale = config.startScale;
        var endScale = config.endScale;
        var useCosine = (config.easing === "cosine");
        var invert = !!config.invert;

        for (var i = 0; i < processed.length; i++) {
            var d = processed[i];
            var t = d.t;
            var factor = useCosine ? (0.5 * (1 + Math.cos(t * Math.PI))) : (1 - t);
            var finalScale;
            if (invert) {
                finalScale = endScale + ((startScale - endScale) * (1 - factor));
            } else {
                finalScale = endScale + ((startScale - endScale) * factor);
            }
            ogridscaleResizeAndLock(d.item, finalScale, d.origin, config.scaleStrokes);
        }

        app.redraw();
        return ogridscaleResponse(true, "Scaled " + processed.length + " items.", { count: processed.length });
    } catch (error) {
        ogridscaleLog(error.message || String(error));
        return ogridscaleResponse(false, error.message || String(error));
    }
}

function ogridscaleHandshake() {
    try {
        return ogridscaleResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return ogridscaleResponse(false, error.message || String(error));
    }
}
