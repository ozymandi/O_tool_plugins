#target illustrator
#targetengine "ONebularCEP"

function onebularEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function onebularToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + onebularEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(onebularToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(onebularToJson(String(key)) + ":" + onebularToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function onebularResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return onebularToJson(payload);
}

function onebularParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function onebularEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function onebularProcessItem(item, cfg, counter) {
    if (!item) return;
    if (item.typename === "PathItem") {
        try {
            item.strokeWidth = cfg.minWidth + Math.random() * (cfg.maxWidth - cfg.minWidth);
            item.opacity = cfg.minOpacity + Math.random() * (cfg.maxOpacity - cfg.minOpacity);
            counter.count++;
        } catch (e) {}
    } else if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) {
            onebularProcessItem(item.pageItems[i], cfg, counter);
        }
    } else if (item.typename === "CompoundPathItem") {
        for (var j = 0; j < item.pathItems.length; j++) {
            onebularProcessItem(item.pathItems[j], cfg, counter);
        }
    }
}

function onebularRun(encodedConfig) {
    try {
        var raw = onebularParseConfig(encodedConfig);
        var minW = parseFloat(raw.minWidth);
        var maxW = parseFloat(raw.maxWidth);
        var minO = parseFloat(raw.minOpacity);
        var maxO = parseFloat(raw.maxOpacity);
        if (!isFinite(minW) || minW <= 0) minW = 0.1;
        if (!isFinite(maxW) || maxW <= 0) maxW = 1.0;
        if (!isFinite(minO)) minO = 30;
        if (!isFinite(maxO)) maxO = 100;
        if (minW > maxW) { var t = minW; minW = maxW; maxW = t; }
        if (minO > maxO) { var t2 = minO; minO = maxO; maxO = t2; }
        if (minO < 0) minO = 0;
        if (maxO > 100) maxO = 100;

        var cfg = { minWidth: minW, maxWidth: maxW, minOpacity: minO, maxOpacity: maxO };

        var doc = onebularEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select one or more paths first.");
        }

        var counter = { count: 0 };
        for (var i = 0; i < sel.length; i++) {
            onebularProcessItem(sel[i], cfg, counter);
        }
        if (counter.count === 0) {
            throw new Error("No paths in selection.");
        }
        app.redraw();
        return onebularResponse(true, "Stylized " + counter.count + " path(s).", { count: counter.count });
    } catch (error) {
        return onebularResponse(false, error.message || String(error));
    }
}

function onebularHandshake() {
    try {
        return onebularResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return onebularResponse(false, error.message || String(error));
    }
}
