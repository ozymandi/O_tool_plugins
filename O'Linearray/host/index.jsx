#target illustrator
#targetengine "OLineArrayCEP"

var OLINEARRAY_DEBUG = false;
var olinearrayDebugLog = new File(Folder.desktop + "/olinearray_cep_log.txt");

var olinearraySession = {
    active: false,
    pathItem: null,
    previewGroup: null,
    stack: [],         // [{ symbolName: string|null }]
    pl: [],            // [{ symbolName, w, jitter }]
    rndJitter: [],
    manualMode: false
};

function olinearrayLog(message) {
    if (!OLINEARRAY_DEBUG) return;
    try {
        olinearrayDebugLog.open("a");
        olinearrayDebugLog.writeln("[" + new Date().toUTCString() + "] " + message);
        olinearrayDebugLog.close();
    } catch (e) {}
}

function olinearrayEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function olinearrayToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + olinearrayEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(olinearrayToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(olinearrayToJson(String(key)) + ":" + olinearrayToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function olinearrayResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return olinearrayToJson(payload);
}

function olinearrayParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function olinearrayNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function olinearrayNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function olinearrayValidateConfig(config) {
    var validAnchors = { top: 1, center: 1, bottom: 1 };
    var validScaleModes = { stretch: 1, uniform: 1 };
    var n = {
        touch: olinearrayNormalizeBoolean(config.touch, true),
        fit: olinearrayNormalizeBoolean(config.fit, true),
        scaleMode: validScaleModes.hasOwnProperty(config.scaleMode) ? config.scaleMode : "stretch",
        gap: olinearrayNormalizeNumber(config.gap, 0),
        step: olinearrayNormalizeNumber(config.step, 50),
        offset: olinearrayNormalizeNumber(config.offset, 0),
        rndOffset: olinearrayNormalizeNumber(config.rndOffset, 0),
        anchor: validAnchors.hasOwnProperty(config.anchor) ? config.anchor : "center",
        rotate: olinearrayNormalizeBoolean(config.rotate, true)
    };
    if (n.step < 1) n.step = 1;
    if (n.rndOffset < 0) n.rndOffset = 0;
    return n;
}

function olinearrayEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function olinearrayResetSession(removePreview) {
    if (removePreview && olinearraySession.previewGroup) {
        try { olinearraySession.previewGroup.remove(); } catch (e) {}
    }
    olinearraySession.active = false;
    olinearraySession.pathItem = null;
    olinearraySession.previewGroup = null;
    olinearraySession.stack = [];
    olinearraySession.pl = [];
    olinearraySession.rndJitter = [];
    olinearraySession.manualMode = false;
}

function olinearrayRefreshJitter() {
    olinearraySession.rndJitter = [];
    for (var i = 0; i < 2000; i++) {
        olinearraySession.rndJitter.push((Math.random() * 2) - 1);
    }
}

// ---------- SYMBOL HELPERS ----------

function olinearrayGetSymbolByName(doc, name) {
    if (!name) return null;
    try {
        for (var i = 0; i < doc.symbols.length; i++) {
            if (doc.symbols[i].name === name) return doc.symbols[i];
        }
    } catch (e) {}
    return null;
}

function olinearrayListDocSymbolNames(doc) {
    var names = [];
    try {
        for (var i = 0; i < doc.symbols.length; i++) {
            names.push(doc.symbols[i].name);
        }
    } catch (e) {}
    return names;
}

function olinearrayProbeSymbolWidth(doc, sym) {
    var tempGroup = doc.groupItems.add();
    var w = 0;
    try {
        var tempItem = tempGroup.symbolItems.add(sym);
        w = tempItem.width;
    } catch (e) {
        olinearrayLog("probeSymbolWidth: " + e.message);
    }
    try { tempGroup.remove(); } catch (e2) {}
    return w;
}

// ---------- PATH SAMPLING ----------

function olinearrayGetPathData(p) {
    var segments = [];
    var total = 0;
    var pp = p.pathPoints;
    for (var i = 0; i < pp.length - 1; i++) {
        var p0 = pp[i].anchor;
        var p1 = pp[i].rightDirection;
        var p2 = pp[i + 1].leftDirection;
        var p3 = pp[i + 1].anchor;
        var len = 0;
        var prev = p0;
        for (var k = 1; k <= 20; k++) {
            var t = k / 20;
            var cx = 3 * (p1[0] - p0[0]);
            var bx = 3 * (p2[0] - p1[0]) - cx;
            var ax = p3[0] - p0[0] - cx - bx;
            var cy = 3 * (p1[1] - p0[1]);
            var by = 3 * (p2[1] - p1[1]) - cy;
            var ay = p3[1] - p0[1] - cy - by;
            var curr = [
                (ax * Math.pow(t, 3)) + (bx * Math.pow(t, 2)) + (cx * t) + p0[0],
                (ay * Math.pow(t, 3)) + (by * Math.pow(t, 2)) + (cy * t) + p0[1]
            ];
            len += Math.sqrt(Math.pow(curr[0] - prev[0], 2) + Math.pow(curr[1] - prev[1], 2));
            prev = curr;
        }
        if (len > 0) {
            segments.push({ len: len, p0: p0, p1: p1, p2: p2, p3: p3, start: total });
            total += len;
        }
    }
    return { segs: segments, total: total };
}

function olinearrayGetInfo(data, dist) {
    var d = Math.max(0, Math.min(dist, data.total));
    var s = data.segs[0];
    for (var i = 0; i < data.segs.length; i++) {
        if (d >= data.segs[i].start && d <= data.segs[i].start + data.segs[i].len) {
            s = data.segs[i];
            break;
        }
    }
    var t = (s && s.len > 0) ? (d - s.start) / s.len : 0;
    var p0 = s.p0, p1 = s.p1, p2 = s.p2, p3 = s.p3;
    var cx = 3 * (p1[0] - p0[0]);
    var bx = 3 * (p2[0] - p1[0]) - cx;
    var ax = p3[0] - p0[0] - cx - bx;
    var cy = 3 * (p1[1] - p0[1]);
    var by = 3 * (p2[1] - p1[1]) - cy;
    var ay = p3[1] - p0[1] - cy - by;
    return {
        p: [
            (ax * Math.pow(t, 3)) + (bx * Math.pow(t, 2)) + (cx * t) + p0[0],
            (ay * Math.pow(t, 3)) + (by * Math.pow(t, 2)) + (cy * t) + p0[1]
        ],
        tg: [
            (3 * ax * Math.pow(t, 2)) + (2 * bx * t) + cx,
            (3 * ay * Math.pow(t, 2)) + (2 * by * t) + cy
        ]
    };
}

// ---------- PLACEMENT ----------

function olinearrayPlaceItem(item, data, dist, off, anchorMode, rotateAlong) {
    var inf = olinearrayGetInfo(data, dist);
    var tLen = Math.sqrt(inf.tg[0] * inf.tg[0] + inf.tg[1] * inf.tg[1]);
    if (isNaN(tLen) || tLen === 0) tLen = 1;
    var nx = -inf.tg[1] / tLen;
    var ny = inf.tg[0] / tLen;
    var anchor = [inf.p[0] + nx * off, inf.p[1] + ny * off];
    var tO = Transformation.CENTER;
    if (anchorMode === "top") {
        item.left = anchor[0] - item.width / 2;
        item.top = anchor[1];
        tO = Transformation.TOP;
    } else if (anchorMode === "bottom") {
        item.left = anchor[0] - item.width / 2;
        item.top = anchor[1] + item.height;
        tO = Transformation.BOTTOM;
    } else {
        item.left = anchor[0] - item.width / 2;
        item.top = anchor[1] + item.height / 2;
    }
    if (rotateAlong) {
        var angle = Math.atan2(inf.tg[1], inf.tg[0]) * 180 / Math.PI;
        if (!isNaN(angle)) item.rotate(angle, true, true, true, true, tO);
    }
}

// ---------- DRAW ----------

function olinearrayResolveFilledSymbols(doc) {
    var filled = [];
    for (var i = 0; i < olinearraySession.stack.length; i++) {
        var slot = olinearraySession.stack[i];
        if (!slot || !slot.symbolName) continue;
        var sym = olinearrayGetSymbolByName(doc, slot.symbolName);
        if (sym) filled.push(sym);
    }
    return filled;
}

function olinearrayDeriveStartEndMiddles(filledSymbols) {
    var n = filledSymbols.length;
    if (n === 0) return null;
    if (n === 1) return { start: filledSymbols[0], end: null, middles: [filledSymbols[0]] };
    if (n === 2) return { start: filledSymbols[0], end: filledSymbols[1], middles: [filledSymbols[0]] };
    return {
        start: filledSymbols[0],
        end: filledSymbols[n - 1],
        middles: filledSymbols.slice(1, n - 1)
    };
}

function olinearrayRedraw(config) {
    var doc = app.activeDocument;
    if (!olinearraySession.pathItem) return 0;

    if (olinearraySession.previewGroup) {
        try { olinearraySession.previewGroup.remove(); } catch (e) {}
    }
    olinearraySession.previewGroup = doc.groupItems.add();

    var filled = olinearrayResolveFilledSymbols(doc);
    if (filled.length === 0) {
        olinearraySession.pl = [];
        return 0;
    }

    var data = olinearrayGetPathData(olinearraySession.pathItem);
    if (data.total <= 0) return 0;
    var total = data.total;

    var derived = olinearrayDeriveStartEndMiddles(filled);
    var startSymbol = derived.start;
    var endSymbol = derived.end;
    var middles = derived.middles;

    // Place start (always)
    var sIt = olinearraySession.previewGroup.symbolItems.add(startSymbol);
    var startL = sIt.width / 2;

    // Place end (if distinct)
    var eIt = null;
    var endL;
    if (endSymbol) {
        eIt = olinearraySession.previewGroup.symbolItems.add(endSymbol);
        endL = total - eIt.width / 2;
    } else {
        endL = total;
    }

    // Auto fill pl if not in manual mode
    if (!olinearraySession.manualMode) {
        olinearraySession.pl = [];
        var curRun = startL;
        var idx = 0;
        var jitter = olinearraySession.rndJitter;
        var safety = 0;
        while (true) {
            safety++;
            if (safety > 5000) break;
            var sym = middles[Math.floor(Math.random() * middles.length)];
            var w = olinearrayProbeSymbolWidth(doc, sym);
            if (w <= 0) break;
            var pD = config.touch ? curRun + config.gap + w / 2 : curRun + config.step;
            if (pD + w / 2 > endL) break;
            olinearraySession.pl.push({
                symbolName: sym.name,
                w: w,
                jitter: jitter[idx % jitter.length]
            });
            curRun = pD + (config.touch ? w / 2 : 0);
            idx++;
            if (idx > 1000) break;
        }
    }

    var pl = olinearraySession.pl;

    var scale = 1.0;
    var wStep = config.step;
    if (config.touch && config.fit && pl.length > 0) {
        var tw = 0;
        for (var p = 0; p < pl.length; p++) tw += pl[p].w;
        var avail = endL - startL;
        scale = Math.max(0.01, (avail - (pl.length + 1) * config.gap) / tw);
    }
    if (!config.touch && config.fit) {
        wStep = total / (pl.length + 1);
    }

    olinearrayPlaceItem(sIt, data, 0, config.offset, config.anchor, config.rotate);
    if (eIt) olinearrayPlaceItem(eIt, data, total, config.offset, config.anchor, config.rotate);

    var run = startL;
    var fCur = wStep;
    for (var k = 0; k < pl.length; k++) {
        var symRef = olinearrayGetSymbolByName(doc, pl[k].symbolName);
        if (!symRef) continue; // skip stale entries
        var it = olinearraySession.previewGroup.symbolItems.add(symRef);
        if (config.touch && config.fit) {
            it.width *= scale;
            if (config.scaleMode === "uniform") it.height *= scale;
        }
        var d = config.touch ? run + config.gap + it.width / 2 : fCur;
        olinearrayPlaceItem(it, data, d, config.offset + pl[k].jitter * config.rndOffset, config.anchor, config.rotate);
        run = d + it.width / 2;
        fCur += wStep;
    }
    try { sIt.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (e3) {}
    if (eIt) { try { eIt.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (e4) {} }

    return pl.length + (endSymbol ? 2 : 1);
}

// ---------- ENDPOINTS ----------

function olinearrayBuildStackResponse(doc) {
    return {
        stack: olinearraySession.stack,
        docSymbols: olinearrayListDocSymbolNames(doc)
    };
}

function olinearrayStart(encodedConfig) {
    try {
        if (olinearraySession.active) {
            olinearrayResetSession(true);
        }
        var config = olinearrayValidateConfig(olinearrayParseConfig(encodedConfig));
        var doc = olinearrayEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length < 2) {
            throw new Error("Select 1 path + 2+ items (any objects or symbols).");
        }

        var pathItem = null;
        var rawItems = [];
        for (var i = 0; i < sel.length; i++) {
            if (sel[i].typename === "PathItem" && !pathItem) pathItem = sel[i];
            else rawItems.push(sel[i]);
        }
        if (!pathItem) throw new Error("Selection must include 1 path item.");
        if (rawItems.length === 0) throw new Error("Need at least 1 non-path item.");

        var processedSymbols = [];
        for (var j = 0; j < rawItems.length; j++) {
            var item = rawItems[j];
            var sym;
            if (item.typename === "SymbolItem") {
                sym = item.symbol;
            } else {
                var symName = "OLineArr_GenSym_" + Math.floor(Math.random() * 100000);
                try {
                    sym = doc.symbols.add(item);
                    sym.name = symName;
                } catch (e) {
                    olinearrayLog("symbol convert failed: " + e.message);
                    continue;
                }
            }
            processedSymbols.push(sym);
        }

        if (processedSymbols.length === 0) {
            throw new Error("Could not convert any selected items into symbols.");
        }

        // Build initial stack to match original behavior:
        //   stack[0] = startSymbol (last in selection),
        //   stack[last] = endSymbol (first in selection),
        //   middles in between
        // i.e. reverse of processedSymbols
        olinearraySession.stack = [];
        for (var p = processedSymbols.length - 1; p >= 0; p--) {
            olinearraySession.stack.push({ symbolName: processedSymbols[p].name });
        }

        olinearraySession.pathItem = pathItem;
        olinearraySession.pl = [];
        olinearraySession.manualMode = false;
        olinearraySession.previewGroup = null;
        olinearrayRefreshJitter();
        olinearraySession.active = true;

        var drawn = olinearrayRedraw(config);
        app.redraw();
        var stackInfo = olinearrayBuildStackResponse(doc);
        return olinearrayResponse(true, "Preview ready (" + drawn + " items).", {
            items: drawn,
            stack: stackInfo.stack,
            docSymbols: stackInfo.docSymbols
        });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        olinearrayResetSession(true);
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayUpdate(encodedConfig) {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        var config = olinearrayValidateConfig(olinearrayParseConfig(encodedConfig));
        var drawn = olinearrayRedraw(config);
        app.redraw();
        return olinearrayResponse(true, "Drew " + drawn + " items.", { items: drawn });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayGetStack() {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        var doc = app.activeDocument;
        var info = olinearrayBuildStackResponse(doc);
        return olinearrayResponse(true, "OK.", {
            stack: info.stack,
            docSymbols: info.docSymbols
        });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearraySetStack(encodedConfig) {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        var raw = olinearrayParseConfig(encodedConfig);
        var config = olinearrayValidateConfig(raw);
        var newStack = [];
        if (raw.stack && raw.stack.length) {
            for (var i = 0; i < raw.stack.length; i++) {
                var s = raw.stack[i] || {};
                var name = (typeof s.symbolName === "string" && s.symbolName.length) ? s.symbolName : null;
                newStack.push({ symbolName: name });
            }
        }
        olinearraySession.stack = newStack;
        // Stack edits reset auto-fill so pool changes show up immediately
        olinearraySession.manualMode = false;
        olinearraySession.pl = [];
        var drawn = olinearrayRedraw(config);
        app.redraw();
        var doc = app.activeDocument;
        var info = olinearrayBuildStackResponse(doc);
        return olinearrayResponse(true, "Stack updated (" + drawn + " items).", {
            items: drawn,
            stack: info.stack,
            docSymbols: info.docSymbols
        });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayReplacePath(encodedConfig) {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        var config = olinearrayValidateConfig(olinearrayParseConfig(encodedConfig));
        var doc = olinearrayEnsureDocument();
        var sel = doc.selection;
        var newPath = null;
        if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) {
                if (sel[i].typename === "PathItem") { newPath = sel[i]; break; }
            }
        }
        if (!newPath) throw new Error("Select a path item in Illustrator first.");
        olinearraySession.pathItem = newPath;
        olinearraySession.manualMode = false;
        olinearraySession.pl = [];
        var drawn = olinearrayRedraw(config);
        app.redraw();
        return olinearrayResponse(true, "Path replaced (" + drawn + " items).", { items: drawn });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayQty(encodedConfig) {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        var config = olinearrayValidateConfig(olinearrayParseConfig(encodedConfig));
        var raw = olinearrayParseConfig(encodedConfig);
        var action = (raw.qtyAction === "remove") ? "remove" : "add";
        var at = raw.qtyAt || "center";

        var doc = app.activeDocument;
        var filled = olinearrayResolveFilledSymbols(doc);
        var derived = olinearrayDeriveStartEndMiddles(filled);
        if (!derived) throw new Error("Stack has no symbols. Add a slot with a symbol first.");
        var middles = derived.middles;

        olinearraySession.manualMode = true;

        var pl = olinearraySession.pl;
        var idx = 0;
        if (at === "left") idx = 0;
        else if (at === "right") idx = pl.length;
        else idx = Math.floor(pl.length / 2);

        if (action === "add") {
            var sym = middles[Math.floor(Math.random() * middles.length)];
            var w = olinearrayProbeSymbolWidth(doc, sym);
            pl.splice(idx, 0, {
                symbolName: sym.name,
                w: w,
                jitter: (Math.random() * 2) - 1
            });
        } else if (pl.length > 0) {
            var tIdx = (idx >= pl.length) ? pl.length - 1 : idx;
            pl.splice(tIdx, 1);
        }

        var drawn = olinearrayRedraw(config);
        app.redraw();
        return olinearrayResponse(true, action === "add" ? "Added item." : "Removed item.", { items: drawn });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayReroll(encodedConfig) {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        var config = olinearrayValidateConfig(olinearrayParseConfig(encodedConfig));
        olinearraySession.manualMode = false;
        olinearraySession.pl = [];
        olinearrayRefreshJitter();
        var drawn = olinearrayRedraw(config);
        app.redraw();
        return olinearrayResponse(true, "Re-rolled. " + drawn + " items.", { items: drawn });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayBake() {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        if (!olinearraySession.previewGroup) return olinearrayResponse(false, "Preview is empty.");
        var doc = app.activeDocument;

        var temp = doc.groupItems.add();
        try { olinearraySession.pathItem.duplicate(temp, ElementPlacement.PLACEATEND); } catch (eDup1) {}
        try { olinearraySession.previewGroup.duplicate(temp, ElementPlacement.PLACEATBEGINNING); } catch (eDup2) {}
        var stamp = String(Date.now());
        var symbolName = "OLineArr_" + stamp.substring(stamp.length - 5);
        var symbol = doc.symbols.add(temp);
        symbol.name = symbolName;
        try { temp.remove(); } catch (e) {}

        app.redraw();
        return olinearrayResponse(true, "Baked '" + symbolName + "'.", { symbolName: symbolName });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayApply() {
    try {
        if (!olinearraySession.active) return olinearrayResponse(false, "No active session.");
        var n = olinearraySession.previewGroup ? olinearraySession.previewGroup.pageItems.length : 0;
        olinearrayResetSession(false);
        app.redraw();
        return olinearrayResponse(true, "Applied " + n + " items.", { items: n });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayCancel() {
    try {
        if (!olinearraySession.active) return olinearrayResponse(true, "No active session.", { wasActive: false });
        olinearrayResetSession(true);
        app.redraw();
        return olinearrayResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        olinearrayLog(error.message || String(error));
        return olinearrayResponse(false, error.message || String(error));
    }
}

function olinearrayHandshake() {
    try {
        return olinearrayResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!olinearraySession.active
        });
    } catch (error) {
        return olinearrayResponse(false, error.message || String(error));
    }
}
