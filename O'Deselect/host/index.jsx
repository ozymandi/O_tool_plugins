#target illustrator
#targetengine "ODeselectCEP"

var ODESELECT_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/odeselect_cep_log.txt");

function odeselectLog(message) {
    if (!ODESELECT_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function odeselectEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function odeselectToJson(value) {
    var i;
    var parts;
    var key;

    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + odeselectEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";

    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(odeselectToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }

    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(odeselectToJson(String(key)) + ":" + odeselectToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function odeselectResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return odeselectToJson(payload);
}

function odeselectParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function odeselectNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function odeselectNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function odeselectEnsureDocument() {
    if (app.documents.length === 0) {
        throw new Error("Open an Illustrator document first.");
    }
    return app.activeDocument;
}

function odeselectCollectTargets(doc) {
    var sel = doc.selection;
    var items = [];
    var isPoints = false;
    var i;

    if (!sel || sel.length === 0) {
        throw new Error("Select objects or anchor points first.");
    }

    if (sel.length === 1 && sel[0].typename === "PathItem") {
        isPoints = true;
        var rawPoints = sel[0].pathPoints;
        for (i = 0; i < rawPoints.length; i++) items.push(rawPoints[i]);
    } else {
        for (i = 0; i < sel.length; i++) items.push(sel[i]);
    }

    return { items: items, isPoints: isPoints };
}

function odeselectValidateConfig(config) {
    var mode = config.mode === "random" ? "random" : "sequence";
    var normalized = { mode: mode };

    if (mode === "random") {
        normalized.probability = odeselectNormalizeNumber(config.probability, 50);
        if (!isFinite(normalized.probability)) {
            throw new Error("Probability must be numeric.");
        }
        if (normalized.probability < 0) normalized.probability = 0;
        if (normalized.probability > 100) normalized.probability = 100;
    } else {
        normalized.selectedCount = odeselectNormalizeInteger(config.selectedCount, 1);
        normalized.unselectedCount = odeselectNormalizeInteger(config.unselectedCount, 1);
        normalized.offset = odeselectNormalizeInteger(config.offset, 0);

        if (normalized.selectedCount < 0) {
            throw new Error("Selected count must be zero or greater.");
        }
        if (normalized.unselectedCount < 0) {
            throw new Error("Unselected count must be zero or greater.");
        }
        if (normalized.selectedCount + normalized.unselectedCount < 1) {
            throw new Error("Selected and Unselected together must be at least 1.");
        }
    }

    return normalized;
}

function odeselectApplyPattern(target, config) {
    var items = target.items;
    var isPoints = target.isPoints;
    var keptCount = 0;
    var droppedCount = 0;
    var i;
    var shouldSelect;

    if (config.mode === "random") {
        var threshold = config.probability;
        for (i = 0; i < items.length; i++) {
            shouldSelect = (Math.random() * 100) < threshold;
            if (isPoints) {
                items[i].selected = shouldSelect ? PathPointSelection.ANCHORPOINT : PathPointSelection.NOSELECTION;
            } else {
                items[i].selected = shouldSelect;
            }
            if (shouldSelect) keptCount++;
            else droppedCount++;
        }
    } else {
        var patternLen = config.selectedCount + config.unselectedCount;
        if (patternLen < 1) patternLen = 1;
        for (i = 0; i < items.length; i++) {
            var effectiveIndex = (i - config.offset) % patternLen;
            if (effectiveIndex < 0) effectiveIndex += patternLen;
            shouldSelect = effectiveIndex < config.selectedCount;
            if (isPoints) {
                items[i].selected = shouldSelect ? PathPointSelection.ANCHORPOINT : PathPointSelection.NOSELECTION;
            } else {
                items[i].selected = shouldSelect;
            }
            if (shouldSelect) keptCount++;
            else droppedCount++;
        }
    }

    app.redraw();
    return {
        total: items.length,
        kept: keptCount,
        dropped: droppedCount,
        scope: isPoints ? "anchor points" : "objects"
    };
}

function odeselectRunAction(encodedConfig, runner, successMessage) {
    try {
        var config = odeselectValidateConfig(odeselectParseConfig(encodedConfig));
        var doc = odeselectEnsureDocument();
        var target = odeselectCollectTargets(doc);
        var data = runner(target, config) || {};
        var summary = "";
        if (typeof data.kept === "number" && typeof data.total === "number") {
            summary = " " + data.kept + "/" + data.total + " " + (data.scope || "items") + " kept.";
        }
        return odeselectResponse(true, (successMessage || "Applied.") + summary, data);
    } catch (error) {
        odeselectLog(error.message || String(error));
        return odeselectResponse(false, error.message || String(error));
    }
}

function odeselectHandshake() {
    try {
        return odeselectResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return odeselectResponse(false, error.message || String(error));
    }
}

function odeselectApply(encodedConfig) {
    return odeselectRunAction(encodedConfig, function (target, config) {
        return odeselectApplyPattern(target, config);
    }, "Pattern applied.");
}

function odeselectSaveSelection(encodedConfig) {
    return odeselectRunAction(encodedConfig, function (target, config) {
        var data = odeselectApplyPattern(target, config);
        try {
            app.executeMenuCommand("Selection Hat 10");
        } catch (e) {}
        return data;
    }, "Pattern applied. Save dialog opened.");
}
