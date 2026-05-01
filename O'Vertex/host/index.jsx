#target illustrator
#targetengine "OVertexCEP"

function overtexEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function overtexToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + overtexEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(overtexToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(overtexToJson(String(key)) + ":" + overtexToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function overtexResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return overtexToJson(payload);
}

function overtexParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function overtexEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function overtexRun(encodedConfig) {
    try {
        var config = overtexParseConfig(encodedConfig);
        var strokeWidth = parseFloat(config.strokeWidth);
        if (!isFinite(strokeWidth) || strokeWidth <= 0) strokeWidth = 0.1;

        var doc = overtexEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select anchor points with the Direct Selection Tool first.");
        }

        var newPoints = [];
        for (var i = 0; i < sel.length; i++) {
            var item = sel[i];
            if (item.typename !== "PathItem") continue;
            var points = item.pathPoints;
            for (var j = 0; j < points.length; j++) {
                var p = points[j];
                if (p.selected !== PathPointSelection.ANCHORPOINT) continue;
                var pos = p.anchor;
                var node = doc.pathItems.add();
                var nodePoint = node.pathPoints.add();
                nodePoint.anchor = pos;
                nodePoint.leftDirection = pos;
                nodePoint.rightDirection = pos;
                node.filled = false;
                node.stroked = true;
                node.strokeWidth = strokeWidth;
                newPoints.push(node);
            }
        }

        if (newPoints.length === 0) {
            throw new Error("No anchor points selected. Switch to the Direct Selection Tool (A) and click anchors.");
        }

        var nodeGroup = doc.groupItems.add();
        nodeGroup.name = "Vertex_Generation_Nodes";
        for (var k = 0; k < newPoints.length; k++) {
            newPoints[k].move(nodeGroup, ElementPlacement.PLACEATEND);
        }

        doc.selection = null;
        nodeGroup.selected = true;
        app.redraw();

        return overtexResponse(true, "Created " + newPoints.length + " vertex node(s).", {
            count: newPoints.length
        });
    } catch (error) {
        return overtexResponse(false, error.message || String(error));
    }
}

function overtexHandshake() {
    try {
        return overtexResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return overtexResponse(false, error.message || String(error));
    }
}
