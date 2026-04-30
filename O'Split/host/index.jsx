#target illustrator
#targetengine "OSplitCEP"

var OSPLIT_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/osplit_cep_log.txt");

function osplitLog(message) {
    if (!OSPLIT_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function osplitEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function osplitToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + osplitEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(osplitToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(osplitToJson(String(key)) + ":" + osplitToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function osplitResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return osplitToJson(payload);
}

function osplitParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function osplitNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function osplitValidateConfig(config) {
    var validModes = { paragraphs: 1, lines: 1, words: 1, characters: 1 };
    var mode = validModes.hasOwnProperty(config.mode) ? config.mode : "words";
    return {
        mode: mode,
        keepOriginal: osplitNormalizeBoolean(config.keepOriginal, false)
    };
}

function osplitEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function osplitGetEarthClusterBounds(item) {
    var allBounds = [];

    function collect(node) {
        if (node.typename === "GroupItem") {
            for (var i = 0; i < node.pageItems.length; i++) collect(node.pageItems[i]);
        } else if (node.typename === "PathItem" || node.typename === "CompoundPathItem") {
            if (node.width > 0.001 || node.height > 0.001) {
                allBounds.push(node.geometricBounds);
            }
        }
    }
    collect(item);

    if (allBounds.length === 0) return null;

    var minVal = 9999999;
    for (var i = 0; i < allBounds.length; i++) {
        if (allBounds[i][1] < minVal) minVal = allBounds[i][1];
        if (allBounds[i][3] < minVal) minVal = allBounds[i][3];
    }

    var finalBounds = [Infinity, -Infinity, -Infinity, Infinity];
    var found = false;

    for (var j = 0; j < allBounds.length; j++) {
        var b = allBounds[j];
        if (b[1] < minVal + 5000) {
            if (b[0] < finalBounds[0]) finalBounds[0] = b[0];
            if (b[1] > finalBounds[1]) finalBounds[1] = b[1];
            if (b[2] > finalBounds[2]) finalBounds[2] = b[2];
            if (b[3] < finalBounds[3]) finalBounds[3] = b[3];
            found = true;
        }
    }
    return found ? finalBounds : null;
}

function osplitGetRelativeInkCenter(originalFrame, mode, index, tCol, nCol, lift) {
    var temp = originalFrame.duplicate();
    var center = null;
    try {
        temp.story.textRange.characterAttributes.baselineShift += lift;
        temp.story.textRange.characterAttributes.fillColor = nCol;
        temp.story.textRange.characterAttributes.strokeColor = nCol;

        var targetRange;
        if (mode === "lines") targetRange = temp.lines[index];
        else targetRange = temp.textRange[mode][index];

        targetRange.characterAttributes.baselineShift -= lift;
        targetRange.characterAttributes.fillColor = tCol;

        var group = temp.createOutline();
        var b = osplitGetEarthClusterBounds(group);
        if (b) {
            center = [b[0] + (b[2] - b[0]) / 2, b[1] + (b[3] - b[1]) / 2];
        }
        group.remove();
    } catch (e) {
        if (temp) {
            try { temp.remove(); } catch (e2) {}
        }
    }
    return center;
}

function osplitGetNewTextInkCenter(newFrame) {
    var temp = newFrame.duplicate();
    var center = null;
    try {
        var group = temp.createOutline();
        var b = group.geometricBounds;
        if (b) {
            center = [b[0] + (b[2] - b[0]) / 2, b[1] + (b[3] - b[1]) / 2];
        }
        group.remove();
    } catch (e) {
        if (temp) {
            try { temp.remove(); } catch (e2) {}
        }
    }
    return center;
}

function osplitApplyStyle(dest, src) {
    var sa = src.characterAttributes;
    var da = dest.characterAttributes;
    try { da.textFont = sa.textFont; } catch (e) {}
    try { da.size = sa.size; } catch (e) {}
    try { da.fillColor = sa.fillColor; } catch (e) {}
    try { da.tracking = sa.tracking; } catch (e) {}
    try { da.baselineShift = sa.baselineShift; } catch (e) {}
    try { da.capitalization = sa.capitalization; } catch (e) {}
    try { da.horizontalScale = sa.horizontalScale; } catch (e) {}
    try { da.verticalScale = sa.verticalScale; } catch (e) {}
    try { dest.paragraphAttributes.justification = src.paragraphAttributes.justification; } catch (e) {}
}

function osplitGetAngle(item) {
    var m = item.matrix;
    return Math.atan2(m.mValueB, m.mValueA) * (180 / Math.PI);
}

function osplitProcessFrame(frame, splitMode, keep, targetColor, noneColor, lift) {
    var count = 0;
    try {
        if (splitMode === "lines") count = frame.lines.length;
        else if (splitMode === "paragraphs") count = frame.paragraphs.length;
        else if (splitMode === "words") count = frame.words.length;
        else if (splitMode === "characters") count = frame.characters.length;
    } catch (e) { return 0; }

    if (count === 0) return 0;
    var createdItems = 0;

    for (var k = 0; k < count; k++) {
        var content = "";
        try {
            if (splitMode === "lines") content = frame.lines[k].contents;
            else content = frame.textRange[splitMode][k].contents;
        } catch (e) { continue; }

        if (!content || content.length === 0) continue;

        var oldInkCenter = osplitGetRelativeInkCenter(frame, splitMode, k, targetColor, noneColor, lift);
        if (!oldInkCenter) continue;

        var newTx;
        if (splitMode === "paragraphs" && frame.kind === TextType.AREATEXT) {
            newTx = frame.duplicate();
            newTx.contents = content;
        } else {
            newTx = frame.layer.textFrames.add();
            newTx.contents = content;
        }

        try {
            var sourceRange;
            if (splitMode === "lines") sourceRange = frame.lines[k];
            else sourceRange = frame.textRange[splitMode][k];
            osplitApplyStyle(newTx.textRange, sourceRange);
        } catch (e) {}

        if (frame.kind !== TextType.AREATEXT || splitMode !== "paragraphs") {
            if (frame.matrix) {
                var angle = osplitGetAngle(frame);
                if (Math.abs(angle) > 0.01) newTx.rotate(angle);
            }
        }

        app.redraw();
        var newInkCenter = osplitGetNewTextInkCenter(newTx);
        if (newInkCenter) {
            var dx = oldInkCenter[0] - newInkCenter[0];
            var dy = oldInkCenter[1] - newInkCenter[1];
            newTx.translate(dx, dy);
        }

        createdItems++;
    }

    if (createdItems > 0) {
        if (!keep) {
            try { frame.remove(); } catch (e) {}
        } else {
            try { frame.hidden = true; } catch (e) {}
        }
    }

    return createdItems;
}

function osplitRun(encodedConfig) {
    try {
        var config = osplitValidateConfig(osplitParseConfig(encodedConfig));
        var doc = osplitEnsureDocument();
        var sel = doc.selection;

        var items = [];
        if (sel && sel.length > 0) {
            for (var i = 0; i < sel.length; i++) {
                if (sel[i].typename === "TextFrame") items.push(sel[i]);
            }
        }
        if (items.length === 0) {
            throw new Error("Select at least one text frame first.");
        }

        var colBlack;
        if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
            colBlack = new CMYKColor();
            colBlack.cyan = 0; colBlack.magenta = 0; colBlack.yellow = 0; colBlack.black = 100;
        } else {
            colBlack = new RGBColor();
            colBlack.red = 0; colBlack.green = 0; colBlack.blue = 0;
        }
        var colNone = new NoColor();
        var LIFT_DIST = 10000;

        var totalCreated = 0;
        for (var j = 0; j < items.length; j++) {
            totalCreated += osplitProcessFrame(items[j], config.mode, config.keepOriginal, colBlack, colNone, LIFT_DIST);
        }

        doc.selection = null;
        app.redraw();

        return osplitResponse(true, "Split into " + totalCreated + " " + config.mode + ".", {
            mode: config.mode,
            created: totalCreated
        });
    } catch (error) {
        osplitLog(error.message || String(error));
        return osplitResponse(false, error.message || String(error));
    }
}

function osplitHandshake() {
    try {
        return osplitResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return osplitResponse(false, error.message || String(error));
    }
}
