#target illustrator
#targetengine "OSelectCEP"

var OSELECT_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/oselect_cep_log.txt");

function oselectLog(message) {
    if (!OSELECT_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function oselectEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oselectToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oselectEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oselectToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oselectToJson(String(key)) + ":" + oselectToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oselectResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oselectToJson(payload);
}

function oselectParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function oselectNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function oselectValidateConfig(config) {
    return {
        includePaths: oselectNormalizeBoolean(config.includePaths, true),
        includeCompound: oselectNormalizeBoolean(config.includeCompound, true),
        includeText: oselectNormalizeBoolean(config.includeText, true),
        includeRaster: oselectNormalizeBoolean(config.includeRaster, false),
        includeMesh: oselectNormalizeBoolean(config.includeMesh, false),
        includePlaced: oselectNormalizeBoolean(config.includePlaced, false),
        skipClipping: oselectNormalizeBoolean(config.skipClipping, true),
        skipHidden: oselectNormalizeBoolean(config.skipHidden, true),
        skipLocked: oselectNormalizeBoolean(config.skipLocked, true)
    };
}

function oselectEnsureDocument() {
    if (app.documents.length === 0) {
        throw new Error("Open an Illustrator document first.");
    }
    return app.activeDocument;
}

function oselectCollectLeaves(item, config, found) {
    var type = item.typename;

    if (config.skipHidden && item.hidden) return;
    if (config.skipLocked && item.locked) return;

    if (type === "PathItem") {
        if (config.skipClipping && item.clipping) return;
        if (config.includePaths) found.push(item);
        return;
    }

    if (type === "CompoundPathItem") {
        if (config.includeCompound) found.push(item);
        return;
    }

    if (type === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) {
            oselectCollectLeaves(item.pageItems[i], config, found);
        }
        return;
    }

    if (type === "TextFrame") {
        if (config.includeText) found.push(item);
        return;
    }

    if (type === "RasterItem") {
        if (config.includeRaster) found.push(item);
        return;
    }

    if (type === "MeshItem") {
        if (config.includeMesh) found.push(item);
        return;
    }

    if (type === "PlacedItem") {
        if (config.includePlaced) found.push(item);
        return;
    }
}

function oselectSelectObjects(encodedConfig) {
    try {
        var config = oselectValidateConfig(oselectParseConfig(encodedConfig));
        var doc = oselectEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select at least one group or object first.");
        }

        var found = [];
        for (var i = 0; i < sel.length; i++) {
            oselectCollectLeaves(sel[i], config, found);
        }

        if (found.length === 0) {
            doc.selection = null;
            return oselectResponse(true, "No matching leaves found.", { count: 0 });
        }

        doc.selection = null;
        for (var j = 0; j < found.length; j++) {
            try { found[j].selected = true; } catch (e) {}
        }
        app.redraw();

        return oselectResponse(true, "Selected " + found.length + " objects.", { count: found.length });
    } catch (error) {
        oselectLog(error.message || String(error));
        return oselectResponse(false, error.message || String(error));
    }
}

function oselectHandshake() {
    try {
        return oselectResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return oselectResponse(false, error.message || String(error));
    }
}
