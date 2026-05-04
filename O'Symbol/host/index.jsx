#target illustrator
#targetengine "OSymbolCEP"

function osymbolEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function osymbolToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + osymbolEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(osymbolToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(osymbolToJson(String(key)) + ":" + osymbolToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function osymbolResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return osymbolToJson(payload);
}

function osymbolParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function osymbolEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function osymbolRun(encodedConfig) {
    try {
        var config = osymbolParseConfig(encodedConfig);
        var replace = !!config.replace;

        var doc = osymbolEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select at least one object first.");
        }

        var itemsToProcess = [];
        for (var i = 0; i < sel.length; i++) itemsToProcess.push(sel[i]);

        var count = 0;
        for (var j = 0; j < itemsToProcess.length; j++) {
            var item = itemsToProcess[j];
            var name = (item.name && item.name !== "") ? item.name : "O_Symbol_" + (j + 1);
            try {
                var newSymbol = doc.symbols.add(item, SymbolRegistrationPoint.SYMBOLCENTERPOINT);
                newSymbol.name = name;

                if (replace) {
                    var posX = item.left + item.width / 2;
                    var posY = item.top - item.height / 2;
                    var instance = doc.symbolItems.add(newSymbol);
                    instance.left = posX - instance.width / 2;
                    instance.top = posY + instance.height / 2;
                    item.remove();
                }
                count++;
            } catch (e) {
                continue;
            }
        }

        app.redraw();
        return osymbolResponse(true, "Created " + count + " symbol(s).", { count: count });
    } catch (error) {
        return osymbolResponse(false, error.message || String(error));
    }
}

function osymbolHandshake() {
    try {
        return osymbolResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return osymbolResponse(false, error.message || String(error));
    }
}
