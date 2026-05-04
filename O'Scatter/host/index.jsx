#target illustrator
#targetengine "OScatterCEP"

var oscatterSession = {
    active: false,
    donors: [],          // captured at Start
    previewGroup: null,
    itemStack: [],       // [{ symbolName: string|null }] persistent across sessions
    sessionID: null,
    seedState: 42
};

function oscatterEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oscatterToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oscatterEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oscatterToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oscatterToJson(String(key)) + ":" + oscatterToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oscatterResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oscatterToJson(payload);
}

function oscatterParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function oscatterEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function oscatterValidateConfig(config) {
    return {
        scale: parseFloat(config.scale) || 100,
        seed: parseInt(config.seed, 10) || 0,
        uniquePoints: (config.uniquePoints === undefined) ? true : !!config.uniquePoints,
        removeDonor: !!config.removeDonor
    };
}

// ---------- PRNG ----------

function oscatterSetSeed(s) { oscatterSession.seedState = s; }
function oscatterSeededRandom() {
    oscatterSession.seedState = (oscatterSession.seedState * 9301 + 49297) % 233280;
    return oscatterSession.seedState / 233280;
}

// ---------- SYMBOLS ----------

function oscatterGetSymbolByName(doc, name) {
    if (!name) return null;
    try {
        for (var i = 0; i < doc.symbols.length; i++) {
            if (doc.symbols[i].name === name) return doc.symbols[i];
        }
    } catch (e) {}
    return null;
}

function oscatterListDocSymbolNames(doc) {
    var names = [];
    try {
        for (var i = 0; i < doc.symbols.length; i++) names.push(doc.symbols[i].name);
    } catch (e) {}
    return names;
}

function oscatterResolvePool(doc) {
    var pool = [];
    for (var i = 0; i < oscatterSession.itemStack.length; i++) {
        var slot = oscatterSession.itemStack[i];
        if (!slot || !slot.symbolName) continue;
        var sym = oscatterGetSymbolByName(doc, slot.symbolName);
        if (sym) pool.push(sym);
    }
    return pool;
}

function oscatterBuildStackResponse(doc) {
    return {
        stack: oscatterSession.itemStack,
        docSymbols: oscatterListDocSymbolNames(doc)
    };
}

// ---------- CLIPBOARD ----------

function oscatterPasteClipboardAsSymbol(doc) {
    try { doc.selection = null; } catch (eDs) {}
    try { app.paste(); } catch (eP) {
        throw new Error("Clipboard is empty. Copy an object first (Ctrl+C).");
    }
    var sel = doc.selection;
    if (!sel || sel.length === 0) {
        throw new Error("Clipboard pasted nothing.");
    }
    var sessionID = oscatterSession.sessionID || Math.floor(Math.random() * 99999).toString(16);
    oscatterSession.sessionID = sessionID;
    var added = 0;
    var existing = oscatterSession.itemStack.length;
    for (var i = 0; i < sel.length; i++) {
        try {
            var sym = doc.symbols.add(sel[i]);
            sym.name = "O_Sc_" + sessionID + "_" + (existing + i);
            oscatterSession.itemStack.push({ symbolName: sym.name });
            added++;
        } catch (eS) {}
    }
    for (var j = sel.length - 1; j >= 0; j--) {
        try { sel[j].remove(); } catch (eR) {}
    }
    return added;
}

// ---------- DRAW ----------

function oscatterClearPreview() {
    if (oscatterSession.previewGroup) {
        try { oscatterSession.previewGroup.remove(); } catch (e) {}
    }
    oscatterSession.previewGroup = null;
}

function oscatterCollectAnchors(item, out) {
    if (!item) return;
    if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) {
            oscatterCollectAnchors(item.pageItems[i], out);
        }
    } else if (item.typename === "PathItem") {
        var pp = item.pathPoints;
        for (var j = 0; j < pp.length; j++) {
            out.push([pp[j].anchor[0], pp[j].anchor[1]]);
        }
    } else if (item.typename === "CompoundPathItem") {
        for (var k = 0; k < item.pathItems.length; k++) {
            oscatterCollectAnchors(item.pathItems[k], out);
        }
    }
}

function oscatterRedraw(config) {
    var doc = app.activeDocument;
    oscatterClearPreview();

    if (!oscatterSession.donors || oscatterSession.donors.length === 0) return 0;

    var pool = oscatterResolvePool(doc);
    if (pool.length === 0) return 0;

    oscatterSession.previewGroup = doc.groupItems.add();
    try { oscatterSession.previewGroup.name = "OScatter_Preview"; } catch (eN) {}

    oscatterSetSeed(config.seed);

    var anchors = [];
    for (var i = 0; i < oscatterSession.donors.length; i++) {
        try { oscatterCollectAnchors(oscatterSession.donors[i], anchors); } catch (eA) {}
    }

    if (config.uniquePoints) {
        var seen = {};
        var deduped = [];
        for (var di = 0; di < anchors.length; di++) {
            // Bucket to 0.01 px so near-identical points (closed-path overlaps) collapse
            var k = Math.round(anchors[di][0] * 100) + "_" + Math.round(anchors[di][1] * 100);
            if (seen[k]) continue;
            seen[k] = true;
            deduped.push(anchors[di]);
        }
        anchors = deduped;
    }

    var scale = config.scale;
    var placed = 0;
    for (var p = 0; p < anchors.length; p++) {
        var a = anchors[p];
        var sym = pool[Math.floor(oscatterSeededRandom() * pool.length)];
        try {
            var inst = oscatterSession.previewGroup.symbolItems.add(sym);
            // Center on anchor
            var cX = inst.left + inst.width / 2;
            var cY = inst.top - inst.height / 2;
            inst.translate(a[0] - cX, a[1] - cY);
            if (scale !== 100) {
                inst.resize(scale, scale, true, true, true, true, scale, Transformation.CENTER);
            }
            placed++;
        } catch (e) {}
    }
    return placed;
}

function oscatterResetSession(removePreview) {
    if (removePreview) oscatterClearPreview();
    oscatterSession.active = false;
    oscatterSession.donors = [];
    oscatterSession.previewGroup = null;
    // Keep itemStack across sessions
}

// ---------- ENDPOINTS ----------

function oscatterStart(encodedConfig) {
    try {
        if (oscatterSession.active) {
            oscatterResetSession(true);
        }
        var config = oscatterValidateConfig(oscatterParseConfig(encodedConfig));
        var doc = oscatterEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select donor path(s) first.");
        }
        // Capture donors
        var donors = [];
        for (var i = 0; i < sel.length; i++) {
            var s = sel[i];
            if (s.typename === "PathItem" || s.typename === "GroupItem" || s.typename === "CompoundPathItem") {
                donors.push(s);
            }
        }
        if (donors.length === 0) {
            throw new Error("Selection has no usable donor paths.");
        }
        oscatterSession.donors = donors;

        // If stack is empty, auto-paste clipboard as the first slot
        if (oscatterSession.itemStack.length === 0) {
            try {
                oscatterPasteClipboardAsSymbol(doc);
            } catch (ePaste) {
                // Restore donor selection so user knows nothing changed
                try { doc.selection = null; } catch (eDs) {}
                for (var rd = 0; rd < donors.length; rd++) {
                    try { donors[rd].selected = true; } catch (eRd) {}
                }
                oscatterResetSession(false);
                throw ePaste;
            }
        }

        // Restore donor selection (paste may have changed it)
        try { doc.selection = null; } catch (eDs) {}
        for (var rd2 = 0; rd2 < donors.length; rd2++) {
            try { donors[rd2].selected = true; } catch (eRd2) {}
        }

        oscatterSession.active = true;
        var n = oscatterRedraw(config);
        app.redraw();
        var info = oscatterBuildStackResponse(doc);
        return oscatterResponse(true, "Scattered " + n + " copy(ies) on " + donors.length + " donor(s).", {
            placed: n,
            donors: donors.length,
            stack: info.stack,
            docSymbols: info.docSymbols
        });
    } catch (error) {
        oscatterResetSession(true);
        return oscatterResponse(false, error.message || String(error));
    }
}

function oscatterUpdate(encodedConfig) {
    try {
        if (!oscatterSession.active) return oscatterResponse(false, "No active session.");
        var config = oscatterValidateConfig(oscatterParseConfig(encodedConfig));
        var n = oscatterRedraw(config);
        app.redraw();
        return oscatterResponse(true, "Scattered " + n + " item(s).", { placed: n });
    } catch (error) {
        return oscatterResponse(false, error.message || String(error));
    }
}

function oscatterApply(encodedConfig) {
    try {
        if (!oscatterSession.active) return oscatterResponse(false, "No active session.");
        var config = oscatterValidateConfig(oscatterParseConfig(encodedConfig));
        var doc = app.activeDocument;
        // Move preview items out of the temp group onto the active layer
        var n = 0;
        if (oscatterSession.previewGroup) {
            var layer = doc.activeLayer;
            while (oscatterSession.previewGroup.pageItems.length > 0) {
                try {
                    oscatterSession.previewGroup.pageItems[0].move(layer, ElementPlacement.PLACEATEND);
                    n++;
                } catch (eM) { break; }
            }
            try { oscatterSession.previewGroup.remove(); } catch (eR) {}
            oscatterSession.previewGroup = null;
        }
        if (config.removeDonor) {
            for (var i = 0; i < oscatterSession.donors.length; i++) {
                try { oscatterSession.donors[i].remove(); } catch (eD) {}
            }
        }
        oscatterSession.active = false;
        oscatterSession.donors = [];
        app.redraw();
        return oscatterResponse(true, "Applied " + n + " item(s).", { items: n });
    } catch (error) {
        return oscatterResponse(false, error.message || String(error));
    }
}

function oscatterCancel() {
    try {
        if (!oscatterSession.active) return oscatterResponse(true, "No active session.", { wasActive: false });
        oscatterResetSession(true);
        app.redraw();
        return oscatterResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        return oscatterResponse(false, error.message || String(error));
    }
}

function oscatterGetStack() {
    try {
        var doc = oscatterEnsureDocument();
        var info = oscatterBuildStackResponse(doc);
        return oscatterResponse(true, "OK.", { stack: info.stack, docSymbols: info.docSymbols });
    } catch (error) {
        return oscatterResponse(false, error.message || String(error));
    }
}

function oscatterSetStack(encodedConfig) {
    try {
        var raw = oscatterParseConfig(encodedConfig);
        var newStack = [];
        if (raw.stack && raw.stack.length) {
            for (var i = 0; i < raw.stack.length; i++) {
                var s = raw.stack[i] || {};
                var name = (typeof s.symbolName === "string" && s.symbolName.length) ? s.symbolName : null;
                newStack.push({ symbolName: name });
            }
        }
        oscatterSession.itemStack = newStack;
        var doc = oscatterEnsureDocument();
        var info = oscatterBuildStackResponse(doc);
        return oscatterResponse(true, "Stack updated.", { stack: info.stack, docSymbols: info.docSymbols });
    } catch (error) {
        return oscatterResponse(false, error.message || String(error));
    }
}

function oscatterAddFromClipboard() {
    try {
        var doc = oscatterEnsureDocument();
        var added = oscatterPasteClipboardAsSymbol(doc);
        app.redraw();
        var info = oscatterBuildStackResponse(doc);
        return oscatterResponse(true, "Added " + added + " slot(s) from clipboard.", {
            stack: info.stack,
            docSymbols: info.docSymbols,
            added: added
        });
    } catch (error) {
        return oscatterResponse(false, error.message || String(error));
    }
}

function oscatterHandshake() {
    try {
        return oscatterResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!oscatterSession.active
        });
    } catch (error) {
        return oscatterResponse(false, error.message || String(error));
    }
}
