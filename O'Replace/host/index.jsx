#target illustrator
#targetengine "OReplaceCEP"

var oreplaceSession = {
    active: false,
    targets: [],          // captured PathItem / CompoundPathItem
    targetData: [],       // [{ obj, lum, color, w, h, cx, cy }]
    sourceItem: null,     // pasted clipboard, hidden master
    previewGroup: null
};

function oreplaceEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oreplaceToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oreplaceEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oreplaceToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oreplaceToJson(String(key)) + ":" + oreplaceToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oreplaceResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oreplaceToJson(payload);
}

function oreplaceParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function oreplaceEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function oreplaceValidateConfig(config) {
    return {
        mode: (config.mode === "light") ? "light" : "color",
        fitting: (config.fitting === "stretch") ? "stretch" : "proportional",
        deleteOriginals: !!config.deleteOriginals,
        maxPct: parseFloat(config.maxPct),
        minPct: parseFloat(config.minPct),
        blackPt: parseFloat(config.blackPt),
        gamma: parseFloat(config.gamma),
        whitePt: parseFloat(config.whitePt)
    };
}

// ---------- HELPERS ----------

function oreplaceCollectTargets(items, out) {
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.typename === "GroupItem") {
            oreplaceCollectTargets(item.pageItems, out);
        } else if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
            out.push(item);
        }
    }
}

function oreplaceGetTargetColor(item) {
    try {
        if (item.typename === "PathItem" && item.filled) return item.fillColor;
        if (item.typename === "CompoundPathItem" && item.pathItems.length > 0) {
            for (var i = 0; i < item.pathItems.length; i++) {
                if (item.pathItems[i].filled) return item.pathItems[i].fillColor;
            }
        }
    } catch (e) {}
    return null;
}

function oreplaceGetBrightness(item) {
    var c = oreplaceGetTargetColor(item);
    if (!c) return 0.5;
    if (c.typename === "GrayColor") return 1 - (c.gray / 100);
    if (c.typename === "RGBColor") return (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) / 255;
    if (c.typename === "CMYKColor") return 1 - ((0.3 * c.cyan + 0.4 * c.magenta + 0.1 * c.yellow + c.black) / 100);
    return 0.5;
}

function oreplaceApplyColorDeep(item, color) {
    if (!color) return;
    try {
        if (item.typename === "PathItem") {
            if (item.filled) item.fillColor = color;
        } else if (item.typename === "GroupItem") {
            for (var i = 0; i < item.pageItems.length; i++) {
                oreplaceApplyColorDeep(item.pageItems[i], color);
            }
        } else if (item.typename === "CompoundPathItem") {
            for (var j = 0; j < item.pathItems.length; j++) {
                if (item.pathItems[j].filled) item.pathItems[j].fillColor = color;
            }
        }
    } catch (e) {}
}

// ---------- CLIPBOARD ----------

function oreplacePasteClipboardAsMaster(doc, savedSelection) {
    try { doc.selection = null; } catch (eDs) {}
    try { app.paste(); } catch (eP) {
        if (savedSelection) {
            for (var s = 0; s < savedSelection.length; s++) try { savedSelection[s].selected = true; } catch (eR) {}
        }
        throw new Error("Clipboard is empty. Copy a vector object (Ctrl+C) first.");
    }
    var sel = doc.selection;
    if (!sel || sel.length === 0) {
        if (savedSelection) {
            for (var s2 = 0; s2 < savedSelection.length; s2++) try { savedSelection[s2].selected = true; } catch (eR2) {}
        }
        throw new Error("Clipboard pasted nothing.");
    }
    var item = sel[0];
    if (item.typename === "TextFrame") {
        try { item.remove(); } catch (eRm) {}
        if (savedSelection) {
            for (var s3 = 0; s3 < savedSelection.length; s3++) try { savedSelection[s3].selected = true; } catch (eR3) {}
        }
        throw new Error("Clipboard contains text. Please copy a vector object.");
    }
    item.visible = false;
    return item;
}

// ---------- DRAW ----------

function oreplaceClearPreview() {
    if (oreplaceSession.previewGroup) {
        try { oreplaceSession.previewGroup.remove(); } catch (e) {}
    }
    oreplaceSession.previewGroup = null;
}

function oreplaceShowOriginals(visible) {
    for (var i = 0; i < oreplaceSession.targets.length; i++) {
        try { oreplaceSession.targets[i].hidden = !visible; } catch (e) {}
    }
}

function oreplaceRedraw(config) {
    var doc = app.activeDocument;
    oreplaceClearPreview();

    if (!oreplaceSession.targets || oreplaceSession.targets.length === 0) return 0;
    if (!oreplaceSession.sourceItem) return 0;

    oreplaceSession.previewGroup = doc.groupItems.add();
    try { oreplaceSession.previewGroup.name = "OReplace_Preview"; } catch (eN) {}
    try { oreplaceSession.previewGroup.move(oreplaceSession.targets[0].layer, ElementPlacement.PLACEATEND); } catch (eMv) {}

    // Hide originals during preview
    oreplaceShowOriginals(false);

    var isLight = (config.mode === "light");
    var isStretch = (config.fitting === "stretch");
    var maxPct = isLight ? config.maxPct : 100;
    var minPct = isLight ? config.minPct : 100;
    var inBlack = isLight ? (config.blackPt / 255.0) : 0;
    var inWhite = isLight ? (config.whitePt / 255.0) : 1;
    var gamma = isLight ? config.gamma : 1.0;
    if (inWhite <= inBlack) inWhite = inBlack + 0.0001;
    if (gamma <= 0) gamma = 0.0001;

    var placed = 0;
    for (var i = 0; i < oreplaceSession.targetData.length; i++) {
        var d = oreplaceSession.targetData[i];

        var scaleVal;
        if (isLight) {
            var adjLum = (d.lum - inBlack) / (inWhite - inBlack);
            if (adjLum < 0) adjLum = 0;
            if (adjLum > 1) adjLum = 1;
            var finalLum = Math.pow(adjLum, 1 / gamma);
            scaleVal = minPct + ((maxPct - minPct) * finalLum);
        } else {
            scaleVal = 100;
        }
        if (scaleVal <= 0) continue;

        try {
            var newItem = oreplaceSession.sourceItem.duplicate();
            newItem.moveToBeginning(oreplaceSession.previewGroup);
            newItem.visible = true;

            // Color inheritance
            oreplaceApplyColorDeep(newItem, d.color);

            // Fit
            if (isStretch) {
                if (d.w > 0) newItem.width = d.w;
                if (d.h > 0) newItem.height = d.h;
            } else {
                if (newItem.width > 0 && newItem.height > 0 && d.w > 0 && d.h > 0) {
                    var ratio = Math.min(d.w / newItem.width, d.h / newItem.height);
                    newItem.width *= ratio;
                    newItem.height *= ratio;
                }
            }

            // Center on target
            var nb = newItem.geometricBounds;
            var ncx = nb[0] + (nb[2] - nb[0]) / 2;
            var ncy = nb[1] - (nb[1] - nb[3]) / 2;
            newItem.translate(d.cx - ncx, d.cy - ncy);

            // Brightness-modulated scale (LIGHT mode only)
            if (isLight && scaleVal !== 100) {
                newItem.resize(scaleVal, scaleVal, true, true, true, true, scaleVal, Transformation.CENTER);
            }

            placed++;
        } catch (eD) {}
    }
    return placed;
}

function oreplaceResetSession(removePreview, restoreVisibility) {
    if (removePreview) oreplaceClearPreview();
    if (restoreVisibility) oreplaceShowOriginals(true);
    if (oreplaceSession.sourceItem) {
        try { oreplaceSession.sourceItem.remove(); } catch (e) {}
    }
    oreplaceSession.active = false;
    oreplaceSession.targets = [];
    oreplaceSession.targetData = [];
    oreplaceSession.sourceItem = null;
    oreplaceSession.previewGroup = null;
}

// ---------- ENDPOINTS ----------

function oreplaceStart(encodedConfig) {
    try {
        if (oreplaceSession.active) {
            oreplaceResetSession(true, true);
        }
        var config = oreplaceValidateConfig(oreplaceParseConfig(encodedConfig));
        var doc = oreplaceEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select target paths or groups first.");
        }
        // Snapshot selection
        var savedSelection = [];
        for (var s = 0; s < sel.length; s++) savedSelection.push(sel[s]);
        // Collect targets
        var targets = [];
        oreplaceCollectTargets(sel, targets);
        if (targets.length === 0) throw new Error("No paths or compound paths in selection.");
        oreplaceSession.targets = targets;

        // Snapshot target data BEFORE paste (paste changes selection)
        oreplaceSession.targetData = [];
        for (var ti = 0; ti < targets.length; ti++) {
            var t = targets[ti];
            try {
                var b = t.geometricBounds;
                var w = b[2] - b[0];
                var h = b[1] - b[3];
                var cx = b[0] + w / 2;
                var cy = b[1] - h / 2;
                oreplaceSession.targetData.push({
                    obj: t,
                    lum: oreplaceGetBrightness(t),
                    color: oreplaceGetTargetColor(t),
                    w: w, h: h, cx: cx, cy: cy
                });
            } catch (eD) {}
        }

        // Paste master
        oreplaceSession.sourceItem = oreplacePasteClipboardAsMaster(doc, savedSelection);

        // Restore selection so user knows targets
        try { doc.selection = null; } catch (eDs) {}
        for (var rs = 0; rs < savedSelection.length; rs++) {
            try { savedSelection[rs].selected = true; } catch (eR) {}
        }

        oreplaceSession.active = true;
        var n = oreplaceRedraw(config);
        app.redraw();
        return oreplaceResponse(true, "Replaced " + n + " of " + targets.length + " target(s).", {
            placed: n,
            targets: targets.length
        });
    } catch (error) {
        oreplaceResetSession(true, true);
        return oreplaceResponse(false, error.message || String(error));
    }
}

function oreplaceUpdate(encodedConfig) {
    try {
        if (!oreplaceSession.active) return oreplaceResponse(false, "No active session.");
        var config = oreplaceValidateConfig(oreplaceParseConfig(encodedConfig));
        var n = oreplaceRedraw(config);
        app.redraw();
        return oreplaceResponse(true, "Drew " + n + " replacement(s).", { placed: n });
    } catch (error) {
        return oreplaceResponse(false, error.message || String(error));
    }
}

function oreplaceApply(encodedConfig) {
    try {
        if (!oreplaceSession.active) return oreplaceResponse(false, "No active session.");
        var config = oreplaceValidateConfig(oreplaceParseConfig(encodedConfig));
        var n = 0;
        if (oreplaceSession.previewGroup && oreplaceSession.targets.length > 0) {
            // Move preview items in front of the first target
            var anchor = oreplaceSession.targets[0];
            while (oreplaceSession.previewGroup.pageItems.length > 0) {
                try {
                    oreplaceSession.previewGroup.pageItems[0].move(anchor, ElementPlacement.PLACEBEFORE);
                    n++;
                } catch (eMv) { break; }
            }
            try { oreplaceSession.previewGroup.remove(); } catch (eR) {}
            oreplaceSession.previewGroup = null;
        }
        if (config.deleteOriginals) {
            for (var i = oreplaceSession.targets.length - 1; i >= 0; i--) {
                try { oreplaceSession.targets[i].remove(); } catch (eD) {}
            }
        } else {
            oreplaceShowOriginals(true);
        }
        if (oreplaceSession.sourceItem) {
            try { oreplaceSession.sourceItem.remove(); } catch (eS) {}
        }
        oreplaceSession.active = false;
        oreplaceSession.targets = [];
        oreplaceSession.targetData = [];
        oreplaceSession.sourceItem = null;
        app.redraw();
        return oreplaceResponse(true, "Applied " + n + " replacement(s).", { items: n });
    } catch (error) {
        return oreplaceResponse(false, error.message || String(error));
    }
}

function oreplaceCancel() {
    try {
        if (!oreplaceSession.active) return oreplaceResponse(true, "No active session.", { wasActive: false });
        oreplaceResetSession(true, true);
        app.redraw();
        return oreplaceResponse(true, "Cancelled — originals restored.", { wasActive: true });
    } catch (error) {
        return oreplaceResponse(false, error.message || String(error));
    }
}

function oreplaceHandshake() {
    try {
        return oreplaceResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!oreplaceSession.active
        });
    } catch (error) {
        return oreplaceResponse(false, error.message || String(error));
    }
}
