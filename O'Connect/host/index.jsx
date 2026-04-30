#target illustrator
#targetengine "OConnectCEP"

var OCONNECT_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/oconnect_cep_log.txt");

function oconnectLog(message) {
    if (!OCONNECT_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function oconnectEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oconnectToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oconnectEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oconnectToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oconnectToJson(String(key)) + ":" + oconnectToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oconnectResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oconnectToJson(payload);
}

function oconnectParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function oconnectNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function oconnectValidateConfig(config) {
    var validColors = { hub: 1, black: 1, swatch: 1 };
    var normalized = {
        tension: oconnectNormalizeNumber(config.tension, 0.35),
        angle: oconnectNormalizeNumber(config.angle, 20),
        strokeWidth: oconnectNormalizeNumber(config.strokeWidth, 2),
        colorMode: validColors.hasOwnProperty(config.colorMode) ? config.colorMode : "hub"
    };
    if (normalized.tension < 0) normalized.tension = 0;
    if (normalized.angle < 1) normalized.angle = 1;
    if (normalized.angle > 89) normalized.angle = 89;
    if (normalized.strokeWidth <= 0) throw new Error("Stroke width must be greater than 0.");
    return normalized;
}

function oconnectEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function oconnectGetCenter(obj) {
    return {
        x: obj.left + obj.width / 2,
        y: obj.top - obj.height / 2
    };
}

function oconnectMakeStrokeColor(doc, mode, hub) {
    if (mode === "black") {
        if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
            var cmyk = new CMYKColor();
            cmyk.cyan = 0; cmyk.magenta = 0; cmyk.yellow = 0; cmyk.black = 100;
            return cmyk;
        }
        var rgb = new RGBColor();
        rgb.red = 0; rgb.green = 0; rgb.blue = 0;
        return rgb;
    }
    if (mode === "swatch") {
        return doc.swatches[0].color;
    }
    if (hub && hub.typename === "PathItem" && hub.stroked) {
        return hub.strokeColor;
    }
    return doc.swatches[0].color;
}

function oconnectDrawPath(doc, p1, p2, h1, h2, strokeColor, strokeWidth) {
    var line = doc.pathItems.add();

    var pt1 = line.pathPoints.add();
    pt1.anchor = p1;
    pt1.rightDirection = h1;
    pt1.leftDirection = p1;

    var pt2 = line.pathPoints.add();
    pt2.anchor = p2;
    pt2.leftDirection = h2;
    pt2.rightDirection = p2;

    line.filled = false;
    line.stroked = true;
    line.strokeWidth = strokeWidth;
    line.strokeColor = strokeColor;
    line.zOrder(ZOrderMethod.SENDTOBACK);
    return line;
}

function oconnectConnectNode(doc, hub, node, config, strokeColor) {
    var hC = oconnectGetCenter(hub);
    var nC = oconnectGetCenter(node);
    var dx = nC.x - hC.x;
    var dy = nC.y - hC.y;
    var angle = Math.atan2(dy, dx) * 180 / Math.PI;
    var threshold = config.angle;
    var tension = config.tension;
    var startPt, endPt, c1, c2, handleLen;

    if (angle >= -threshold && angle < threshold) {
        startPt = [hub.left + hub.width, hC.y];
        endPt = [node.left, nC.y];
        handleLen = Math.abs(dx) * tension;
        c1 = [startPt[0] + handleLen, startPt[1]];
        c2 = [endPt[0] - handleLen, endPt[1]];
    } else if (angle >= (180 - threshold) || angle < -(180 - threshold)) {
        startPt = [hub.left, hC.y];
        endPt = [node.left + node.width, nC.y];
        handleLen = Math.abs(dx) * tension;
        c1 = [startPt[0] - handleLen, startPt[1]];
        c2 = [endPt[0] + handleLen, endPt[1]];
    } else if (angle >= threshold && angle < (180 - threshold)) {
        startPt = [hC.x, hub.top];
        endPt = [nC.x, node.top - node.height];
        handleLen = Math.abs(dy) * tension;
        c1 = [startPt[0], startPt[1] + handleLen];
        c2 = [endPt[0], endPt[1] - handleLen];
    } else {
        startPt = [hC.x, hub.top - hub.height];
        endPt = [nC.x, node.top];
        handleLen = Math.abs(dy) * tension;
        c1 = [startPt[0], startPt[1] - handleLen];
        c2 = [endPt[0], endPt[1] + handleLen];
    }

    return oconnectDrawPath(doc, startPt, endPt, c1, c2, strokeColor, config.strokeWidth);
}

function oconnectRun(encodedConfig) {
    try {
        var config = oconnectValidateConfig(oconnectParseConfig(encodedConfig));
        var doc = oconnectEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length < 2) {
            throw new Error("Select at least 2 objects. The Hub must be the front-most.");
        }

        var hub = sel[0];
        var children = [];
        for (var i = 1; i < sel.length; i++) children.push(sel[i]);

        var strokeColor = oconnectMakeStrokeColor(doc, config.colorMode, hub);

        var created = 0;
        for (var j = 0; j < children.length; j++) {
            try {
                oconnectConnectNode(doc, hub, children[j], config, strokeColor);
                created++;
            } catch (e) {
                oconnectLog("Failed connection " + j + ": " + e.message);
            }
        }

        app.redraw();
        return oconnectResponse(true, "Connected " + created + " nodes to hub.", { count: created });
    } catch (error) {
        oconnectLog(error.message || String(error));
        return oconnectResponse(false, error.message || String(error));
    }
}

function oconnectHandshake() {
    try {
        return oconnectResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return oconnectResponse(false, error.message || String(error));
    }
}
