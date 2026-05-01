#target illustrator
#targetengine "OColorCEP"

var OCOLOR_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/ocolor_cep_log.txt");

function ocolorLog(message) {
    if (!OCOLOR_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function ocolorEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function ocolorToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + ocolorEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(ocolorToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(ocolorToJson(String(key)) + ":" + ocolorToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function ocolorResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return ocolorToJson(payload);
}

function ocolorParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function ocolorNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function ocolorEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function ocolorGetSelectedSwatches(doc) {
    var sw = [];
    try {
        sw = doc.swatches.getSelected();
    } catch (e) {
        sw = [];
    }
    return sw || [];
}

function ocolorApplyToItem(item, doFill, doStroke, swatches) {
    if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) {
            ocolorApplyToItem(item.pageItems[i], doFill, doStroke, swatches);
        }
        return 0;
    }

    if (item.typename !== "PathItem" && item.typename !== "CompoundPathItem" && item.typename !== "TextFrame") {
        return 0;
    }

    var painted = 0;

    if (doFill) {
        var fillSwatch = swatches[Math.floor(Math.random() * swatches.length)];
        if (item.typename === "CompoundPathItem") {
            if (item.pathItems.length > 0) {
                try {
                    item.pathItems[0].filled = true;
                    item.pathItems[0].fillColor = fillSwatch.color;
                    painted++;
                } catch (e) {}
            }
        } else {
            try {
                item.filled = true;
                item.fillColor = fillSwatch.color;
                painted++;
            } catch (e) {}
        }
    }

    if (doStroke) {
        var strokeSwatch = swatches[Math.floor(Math.random() * swatches.length)];
        if (item.typename === "CompoundPathItem") {
            if (item.pathItems.length > 0) {
                try {
                    item.pathItems[0].stroked = true;
                    item.pathItems[0].strokeColor = strokeSwatch.color;
                    painted++;
                } catch (e) {}
            }
        } else {
            try {
                item.stroked = true;
                item.strokeColor = strokeSwatch.color;
                painted++;
            } catch (e) {}
        }
    }

    return painted;
}

function ocolorCountTouchableLeaves(items) {
    var count = 0;
    for (var i = 0; i < items.length; i++) {
        var t = items[i].typename;
        if (t === "GroupItem") count += ocolorCountTouchableLeaves(items[i].pageItems);
        else if (t === "PathItem" || t === "CompoundPathItem" || t === "TextFrame") count++;
    }
    return count;
}

function ocolorRandomize(encodedConfig) {
    try {
        var raw = ocolorParseConfig(encodedConfig);
        var config = {
            doFill: ocolorNormalizeBoolean(raw.doFill, true),
            doStroke: ocolorNormalizeBoolean(raw.doStroke, false)
        };

        if (!config.doFill && !config.doStroke) {
            throw new Error("Enable Fill or Stroke first.");
        }

        var doc = ocolorEnsureDocument();
        var swatches = ocolorGetSelectedSwatches(doc);
        if (swatches.length < 1) {
            throw new Error("Select at least one swatch in the Swatches panel.");
        }

        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select objects on the artboard first.");
        }

        var painted = 0;
        for (var i = 0; i < sel.length; i++) {
            painted += ocolorApplyToItem(sel[i], config.doFill, config.doStroke, swatches);
        }

        var leaves = ocolorCountTouchableLeaves(sel);
        app.redraw();

        return ocolorResponse(true, "Coloured " + leaves + " items from " + swatches.length + " swatches.", {
            leaves: leaves,
            painted: painted,
            swatches: swatches.length
        });
    } catch (error) {
        ocolorLog(error.message || String(error));
        return ocolorResponse(false, error.message || String(error));
    }
}

function ocolorHandshake() {
    try {
        var swatchCount = 0;
        if (app.documents.length > 0) {
            try { swatchCount = app.activeDocument.swatches.getSelected().length; } catch (e) {}
        }
        return ocolorResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            swatches: swatchCount
        });
    } catch (error) {
        return ocolorResponse(false, error.message || String(error));
    }
}
