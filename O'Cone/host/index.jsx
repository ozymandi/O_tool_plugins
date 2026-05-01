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

function oconeEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

// ---------- COLOR ENGINE: stops-based ----------

function oconeGetColorAtT(t, stops) {
    if (!stops || stops.length === 0) return [128, 128, 128];
    if (stops.length === 1) return stops[0][1];
    if (t <= stops[0][0]) return stops[0][1];
    if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (var i = 0; i < stops.length - 1; i++) {
        var a = stops[i][0], b = stops[i + 1][0];
        if (t >= a && t <= b) {
            var c1 = stops[i][1], c2 = stops[i + 1][1];
            var localT = (b === a) ? 0 : (t - a) / (b - a);
            return [
                c1[0] + (c2[0] - c1[0]) * localT,
                c1[1] + (c2[1] - c1[1]) * localT,
                c1[2] + (c2[2] - c1[2]) * localT
            ];
        }
    }
    return stops[stops.length - 1][1];
}

function oconeMakeRGB(rgb) {
    var c = new RGBColor();
    c.red = Math.max(0, Math.min(255, rgb[0]));
    c.green = Math.max(0, Math.min(255, rgb[1]));
    c.blue = Math.max(0, Math.min(255, rgb[2]));
    return c;
}

// ---------- FAN BUILD ----------

function oconeBuildFan(fanGroup, cx, cy, radius, segCount, stops) {
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
        tri.fillColor = oconeMakeRGB(oconeGetColorAtT(deg / 360, stops));
    }
}

function oconeUpdateColors(fanGroup, segCount, stops) {
    var step = 360 / segCount;
    var pis = fanGroup.pathItems;
    var n = Math.min(segCount, pis.length);
    for (var i = 0; i < n; i++) {
        var deg = i * step;
        pis[i].fillColor = oconeMakeRGB(oconeGetColorAtT(deg / 360, stops));
    }
}

function oconeRebuildFan(item, segCount, stops) {
    while (item.fanGroup.pathItems.length > 0) {
        try { item.fanGroup.pathItems[0].remove(); } catch (e) { break; }
    }
    oconeBuildFan(item.fanGroup, item.cx, item.cy, item.radius, segCount, stops);
}

// ---------- SESSION ----------

function oconeBuildItem(srcItem, segCount, stops) {
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

    oconeBuildFan(fanGroup, cx, cy, radius, segCount, stops);

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
        lastQuality: segCount
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

function oconeValidateRunConfig(config) {
    var quality = oconeNormalizeInteger(config.quality, 180);
    if (quality < 3) quality = 3;
    var stops = [];
    if (config.stops && config.stops instanceof Array) {
        for (var i = 0; i < config.stops.length; i++) {
            var s = config.stops[i];
            if (!s || !(s instanceof Array) || s.length < 2) continue;
            var pos = parseFloat(s[0]);
            var rgb = s[1];
            if (!isFinite(pos)) continue;
            if (!rgb || !(rgb instanceof Array) || rgb.length < 3) continue;
            stops.push([pos, [parseFloat(rgb[0]) || 0, parseFloat(rgb[1]) || 0, parseFloat(rgb[2]) || 0]]);
        }
    }
    if (stops.length === 0) {
        // Fallback: medium gray
        stops = [[0, [128, 128, 128]], [1, [128, 128, 128]]];
    }
    return { quality: quality, stops: stops };
}

// ---------- ENDPOINTS ----------

function oconeStart(encodedConfig) {
    try {
        if (oconeSession.active) {
            for (var s = 0; s < oconeSession.items.length; s++) oconeRevertItem(oconeSession.items[s]);
            oconeClearSession();
        }

        var config = oconeValidateRunConfig(oconeParseConfig(encodedConfig));
        var doc = oconeEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select one or more shapes first.");
        }

        var srcItems = [];
        for (var i = 0; i < sel.length; i++) srcItems.push(sel[i]);

        var built = [];
        for (var j = srcItems.length - 1; j >= 0; j--) {
            try {
                built.push(oconeBuildItem(srcItems[j], config.quality, config.stops));
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
        var config = oconeValidateRunConfig(oconeParseConfig(encodedConfig));
        var rebuilt = 0;
        var recolored = 0;
        for (var i = 0; i < oconeSession.items.length; i++) {
            var item = oconeSession.items[i];
            if (item.lastQuality !== config.quality) {
                oconeRebuildFan(item, config.quality, config.stops);
                item.lastQuality = config.quality;
                rebuilt++;
            } else {
                oconeUpdateColors(item.fanGroup, config.quality, config.stops);
                recolored++;
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
        if (!oconeSession.active) return oconeResponse(false, "No active session.");
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
        if (!oconeSession.active) return oconeResponse(true, "No active session.", { wasActive: false });
        for (var i = 0; i < oconeSession.items.length; i++) oconeRevertItem(oconeSession.items[i]);
        oconeClearSession();
        app.redraw();
        return oconeResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        oconeLog(error.message || String(error));
        return oconeResponse(false, error.message || String(error));
    }
}

// ---------- COLOR CONVERSIONS ----------

function oconeLabToRgb(L, A, B) {
    var fy = (L + 16) / 116;
    var fx = A / 500 + fy;
    var fz = fy - B / 200;
    var eps = 6 / 29;
    function finv(t) { return t > eps ? t * t * t : 3 * eps * eps * (t - 4 / 29); }
    var X = 0.95047 * finv(fx);
    var Y = 1.00000 * finv(fy);
    var Z = 1.08883 * finv(fz);
    var rl = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
    var gl = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
    var bl = X * 0.0557 + Y * -0.2040 + Z * 1.0570;
    function gam(c) {
        if (c <= 0.0031308) return 12.92 * c;
        return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }
    var r = Math.max(0, Math.min(1, gam(rl)));
    var g = Math.max(0, Math.min(1, gam(gl)));
    var b = Math.max(0, Math.min(1, gam(bl)));
    return [r * 255, g * 255, b * 255];
}

function oconeColorToRgb(color) {
    if (!color) return [128, 128, 128];
    var t = color.typename;
    if (t === "RGBColor") return [color.red, color.green, color.blue];
    if (t === "CMYKColor") {
        var c = color.cyan / 100;
        var m = color.magenta / 100;
        var y = color.yellow / 100;
        var k = color.black / 100;
        return [
            255 * (1 - c) * (1 - k),
            255 * (1 - m) * (1 - k),
            255 * (1 - y) * (1 - k)
        ];
    }
    if (t === "GrayColor") {
        var v = 255 * (1 - color.gray / 100);
        return [v, v, v];
    }
    if (t === "LabColor") {
        return oconeLabToRgb(color.l, color.a, color.b);
    }
    if (t === "SpotColor") {
        try { return oconeColorToRgb(color.spot.color); } catch (e) { return [128, 128, 128]; }
    }
    return [128, 128, 128];
}

// ---------- SWATCH GROUPS ----------

function oconeListSwatchGroups() {
    try {
        var doc = oconeEnsureDocument();
        var groups = doc.swatchGroups;
        var out = [];
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var name = "";
            try { name = g.name || ""; } catch (e) {}
            var count = 0;
            try {
                var swatches = g.getAllSwatches();
                count = swatches ? swatches.length : 0;
            } catch (e) {}
            if (count > 0 && name !== "") {
                out.push({ name: name, count: count });
            }
        }
        return oconeResponse(true, "Found " + out.length + " group(s).", { groups: out });
    } catch (error) {
        return oconeResponse(false, error.message || String(error), { groups: [] });
    }
}

function oconeReadSwatchGroup(encodedConfig) {
    try {
        var raw = oconeParseConfig(encodedConfig);
        var name = String(raw.name || "");
        if (!name) throw new Error("Group name is required.");
        var doc = oconeEnsureDocument();
        var groups = doc.swatchGroups;
        var found = null;
        for (var i = 0; i < groups.length; i++) {
            try {
                if (groups[i].name === name) { found = groups[i]; break; }
            } catch (e) {}
        }
        if (!found) throw new Error("Group not found: " + name);
        var swatches = found.getAllSwatches();
        var colors = [];
        for (var j = 0; j < swatches.length; j++) {
            try {
                colors.push(oconeColorToRgb(swatches[j].color));
            } catch (e) {}
        }
        if (colors.length === 0) throw new Error("Group is empty.");
        return oconeResponse(true, "Read " + colors.length + " colour(s).", { colors: colors });
    } catch (error) {
        return oconeResponse(false, error.message || String(error));
    }
}

// ---------- ASE PARSING ----------

function oconeReadUInt16BE(s, offset) {
    return ((s.charCodeAt(offset) & 0xFF) << 8) | (s.charCodeAt(offset + 1) & 0xFF);
}

function oconeReadInt32BE(s, offset) {
    var b0 = s.charCodeAt(offset) & 0xFF;
    var b1 = s.charCodeAt(offset + 1) & 0xFF;
    var b2 = s.charCodeAt(offset + 2) & 0xFF;
    var b3 = s.charCodeAt(offset + 3) & 0xFF;
    var v = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
    return v;
}

function oconeReadFloat32BE(s, offset) {
    var b0 = s.charCodeAt(offset) & 0xFF;
    var b1 = s.charCodeAt(offset + 1) & 0xFF;
    var b2 = s.charCodeAt(offset + 2) & 0xFF;
    var b3 = s.charCodeAt(offset + 3) & 0xFF;
    var sign = b0 >> 7;
    var exp = ((b0 & 0x7F) << 1) | (b1 >> 7);
    var mant = ((b1 & 0x7F) << 16) | (b2 << 8) | b3;
    if (exp === 0) {
        if (mant === 0) return sign ? -0 : 0;
        return (sign ? -1 : 1) * mant * Math.pow(2, -126 - 23);
    }
    if (exp === 0xFF) {
        if (mant === 0) return sign ? -Infinity : Infinity;
        return NaN;
    }
    return (sign ? -1 : 1) * (1 + mant / 0x800000) * Math.pow(2, exp - 127);
}

function oconeReadAscii(s, offset, len) {
    var out = "";
    for (var i = 0; i < len; i++) out += s.charAt(offset + i);
    return out;
}

function oconeReadUtf16Be(s, offset, units) {
    var out = "";
    for (var i = 0; i < units; i++) {
        var hi = s.charCodeAt(offset + i * 2) & 0xFF;
        var lo = s.charCodeAt(offset + i * 2 + 1) & 0xFF;
        var code = (hi << 8) | lo;
        if (code === 0) break;
        out += String.fromCharCode(code);
    }
    return out;
}

function oconeParseAse(buffer) {
    if (buffer.length < 12) throw new Error("File is too short to be ASE.");
    var sig = oconeReadAscii(buffer, 0, 4);
    if (sig !== "ASEF") throw new Error("Not an ASE file (signature mismatch).");
    var blockCount = oconeReadInt32BE(buffer, 8);
    var pos = 12;
    var colors = [];
    var safety = 0;
    while (pos < buffer.length && safety < 1000000) {
        if (pos + 6 > buffer.length) break;
        var blockType = oconeReadUInt16BE(buffer, pos);
        var blockLen = oconeReadInt32BE(buffer, pos + 2);
        var dataStart = pos + 6;
        var dataEnd = dataStart + blockLen;
        if (blockType === 0x0001) {
            // Color entry
            var p = dataStart;
            var nameLen = oconeReadUInt16BE(buffer, p); p += 2;
            // name occupies nameLen UTF-16 BE units (incl null terminator)
            p += nameLen * 2;
            if (p + 4 > dataEnd) { pos = dataEnd; safety++; continue; }
            var model = oconeReadAscii(buffer, p, 4); p += 4;
            var rgb = null;
            if (model === "RGB ") {
                if (p + 12 > dataEnd) { pos = dataEnd; safety++; continue; }
                var r = oconeReadFloat32BE(buffer, p); p += 4;
                var g = oconeReadFloat32BE(buffer, p); p += 4;
                var b = oconeReadFloat32BE(buffer, p); p += 4;
                rgb = [r * 255, g * 255, b * 255];
            } else if (model === "CMYK") {
                if (p + 16 > dataEnd) { pos = dataEnd; safety++; continue; }
                var c = oconeReadFloat32BE(buffer, p); p += 4;
                var m = oconeReadFloat32BE(buffer, p); p += 4;
                var y = oconeReadFloat32BE(buffer, p); p += 4;
                var k = oconeReadFloat32BE(buffer, p); p += 4;
                rgb = [
                    255 * (1 - c) * (1 - k),
                    255 * (1 - m) * (1 - k),
                    255 * (1 - y) * (1 - k)
                ];
            } else if (model === "LAB ") {
                if (p + 12 > dataEnd) { pos = dataEnd; safety++; continue; }
                var L = oconeReadFloat32BE(buffer, p) * 100; p += 4;
                var A = oconeReadFloat32BE(buffer, p); p += 4;
                var B = oconeReadFloat32BE(buffer, p); p += 4;
                rgb = oconeLabToRgb(L, A, B);
            } else if (model === "Gray") {
                if (p + 4 > dataEnd) { pos = dataEnd; safety++; continue; }
                var gv = oconeReadFloat32BE(buffer, p); p += 4;
                var v = gv * 255;
                rgb = [v, v, v];
            }
            if (rgb) colors.push([
                Math.max(0, Math.min(255, rgb[0])),
                Math.max(0, Math.min(255, rgb[1])),
                Math.max(0, Math.min(255, rgb[2]))
            ]);
        }
        pos = dataEnd;
        safety++;
    }
    return colors;
}

function oconeReadAseFile(encodedConfig) {
    try {
        var raw = oconeParseConfig(encodedConfig);
        var path = String(raw.path || "");
        if (!path) throw new Error("File path is required.");
        var f = new File(path);
        if (!f.exists) throw new Error("File does not exist: " + path);
        f.encoding = "BINARY";
        var opened = f.open("r");
        if (!opened) throw new Error("Could not open file.");
        var buffer = "";
        try { buffer = f.read(); }
        finally { f.close(); }
        if (!buffer || buffer.length === 0) throw new Error("File is empty.");
        var colors = oconeParseAse(buffer);
        if (colors.length === 0) throw new Error("No colours found in ASE file.");
        var name = decodeURI(f.name);
        return oconeResponse(true, "Read " + colors.length + " colour(s).", {
            name: name,
            colors: colors
        });
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
