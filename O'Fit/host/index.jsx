#target illustrator
#targetengine "OFitCEP"

var OFIT_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/ofit_cep_log.txt");

function ofitLog(message) {
    if (!OFIT_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function ofitEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function ofitToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + ofitEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(ofitToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(ofitToJson(String(key)) + ":" + ofitToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function ofitResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return ofitToJson(payload);
}

function ofitParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function ofitNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function ofitValidateConfig(config) {
    var validModes = { contain: 1, cover: 1, stretch: 1 };
    var validAlign = {
        "top-left": 1, "top-center": 1, "top-right": 1,
        "middle-left": 1, "middle-center": 1, "middle-right": 1,
        "bottom-left": 1, "bottom-center": 1, "bottom-right": 1
    };
    return {
        mode: validModes.hasOwnProperty(config.mode) ? config.mode : "contain",
        padX: ofitNormalizeNumber(config.padX, 0),
        padY: ofitNormalizeNumber(config.padY, 0),
        align: validAlign.hasOwnProperty(config.align) ? config.align : "middle-center"
    };
}

function ofitEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function ofitGetActiveArtboard(doc) {
    var idx = doc.artboards.getActiveArtboardIndex();
    var rect = doc.artboards[idx].artboardRect;
    return {
        left: rect[0],
        top: rect[1],
        right: rect[2],
        bottom: rect[3],
        width: rect[2] - rect[0],
        height: rect[1] - rect[3]
    };
}

function ofitGetAlignH(align) {
    if (align.indexOf("left") !== -1) return "left";
    if (align.indexOf("right") !== -1) return "right";
    return "center";
}

function ofitGetAlignV(align) {
    if (align.indexOf("top") !== -1) return "top";
    if (align.indexOf("bottom") !== -1) return "bottom";
    return "middle";
}

function ofitFitItem(item, ab, config) {
    var vb = item.visibleBounds;
    var itemW = vb[2] - vb[0];
    var itemH = vb[1] - vb[3];

    if (itemW <= 0 || itemH <= 0) {
        throw new Error("Item has zero size; cannot fit.");
    }

    var availW = ab.width - config.padX * 2;
    var availH = ab.height - config.padY * 2;

    if (availW <= 0 || availH <= 0) {
        throw new Error("Padding leaves no room inside the artboard.");
    }

    var scaleX = (availW / itemW) * 100;
    var scaleY = (availH / itemH) * 100;
    var sX, sY;

    if (config.mode === "contain") {
        var sMin = Math.min(scaleX, scaleY);
        sX = sMin; sY = sMin;
    } else if (config.mode === "cover") {
        var sMax = Math.max(scaleX, scaleY);
        sX = sMax; sY = sMax;
    } else {
        sX = scaleX; sY = scaleY;
    }

    if (sX < 0.01) sX = 0.01;
    if (sY < 0.01) sY = 0.01;

    item.resize(sX, sY);

    vb = item.visibleBounds;
    var newL = vb[0];
    var newT = vb[1];
    var newR = vb[2];
    var newB = vb[3];
    var newW = newR - newL;
    var newH = newT - newB;

    var alignH = ofitGetAlignH(config.align);
    var alignV = ofitGetAlignV(config.align);

    var targetX;
    if (alignH === "left") targetX = ab.left + config.padX;
    else if (alignH === "right") targetX = ab.right - config.padX - newW;
    else targetX = ab.left + (ab.width - newW) / 2;

    var targetT;
    if (alignV === "top") targetT = ab.top - config.padY;
    else if (alignV === "bottom") targetT = ab.bottom + config.padY + newH;
    else targetT = ab.top - (ab.height - newH) / 2;

    var moveX = targetX - newL;
    var moveY = targetT - newT;

    item.translate(moveX, moveY);

    return { scaleX: sX, scaleY: sY };
}

function ofitRun(encodedConfig) {
    try {
        var config = ofitValidateConfig(ofitParseConfig(encodedConfig));
        var doc = ofitEnsureDocument();
        var sel = doc.selection;

        if (!sel || sel.length === 0) {
            throw new Error("Select an object or group first.");
        }

        var ab = ofitGetActiveArtboard(doc);
        var processed = 0;
        var lastScale = null;

        for (var i = 0; i < sel.length; i++) {
            try {
                lastScale = ofitFitItem(sel[i], ab, config);
                processed++;
            } catch (err) {
                ofitLog("Item " + i + ": " + err.message);
            }
        }

        app.redraw();

        if (processed === 0) {
            throw new Error("Could not fit any selected item.");
        }

        var msg;
        if (config.mode === "stretch") {
            msg = "Fitted " + processed + " item(s) to artboard (stretch).";
        } else {
            msg = "Fitted " + processed + " item(s) to artboard (" + config.mode + " " + lastScale.scaleX.toFixed(1) + "%).";
        }

        return ofitResponse(true, msg, { processed: processed });
    } catch (error) {
        ofitLog(error.message || String(error));
        return ofitResponse(false, error.message || String(error));
    }
}

function ofitHandshake() {
    try {
        return ofitResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return ofitResponse(false, error.message || String(error));
    }
}
