#target illustrator
#targetengine "OTrimCEP"

var OTRIM_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/otrim_cep_log.txt");

function otrimLog(message) {
    if (!OTRIM_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function otrimEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function otrimToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + otrimEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(otrimToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(otrimToJson(String(key)) + ":" + otrimToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function otrimResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return otrimToJson(payload);
}

function otrimParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function otrimNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function otrimNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function otrimNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function otrimEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function otrimEnsureSelection(message) {
    var doc = otrimEnsureDocument();
    if (!doc.selection || doc.selection.length === 0) {
        throw new Error(message || "Select an object to trim first.");
    }
    return doc.selection;
}

function otrimValidateConfig(config) {
    var validModes = { col: 1, row: 1, grid: 1 };
    var validAnchors = {
        "center": 1,
        "top-left": 1,
        "top-right": 1,
        "bottom-left": 1,
        "bottom-right": 1
    };
    var normalized = {
        mode: validModes.hasOwnProperty(config.mode) ? config.mode : "col",
        cols: otrimNormalizeInteger(config.cols, 5),
        rows: otrimNormalizeInteger(config.rows, 1),
        scale: otrimNormalizeNumber(config.scale, 80),
        gap: otrimNormalizeNumber(config.gap, 0),
        anchor: validAnchors.hasOwnProperty(config.anchor) ? config.anchor : "center",
        proportional: otrimNormalizeBoolean(config.proportional, true)
    };

    if (normalized.mode === "col") normalized.rows = 1;
    if (normalized.mode === "row") normalized.cols = 1;

    if (normalized.cols < 1) normalized.cols = 1;
    if (normalized.rows < 1) normalized.rows = 1;
    if (normalized.scale <= 0) throw new Error("Scale must be greater than zero.");
    if (!isFinite(normalized.gap)) throw new Error("Gap must be numeric.");

    return normalized;
}

function otrimGetRealMaskBounds(groupItem) {
    try {
        for (var i = 0; i < groupItem.pageItems.length; i++) {
            var item = groupItem.pageItems[i];
            if (item.typename === "PathItem" && item.clipping === true) {
                return item.visibleBounds;
            }
        }
    } catch (e) {}
    return groupItem.visibleBounds;
}

function otrimAlignNextToPrev(anchorItem, moveItem, gap, direction) {
    var anchorB = otrimGetRealMaskBounds(anchorItem);
    var moveB = otrimGetRealMaskBounds(moveItem);
    var shiftX = 0;
    if (direction === "right") {
        shiftX = (anchorB[2] + gap) - moveB[0];
    } else if (direction === "left") {
        shiftX = (anchorB[0] - gap) - moveB[2];
    }
    moveItem.translate(shiftX, 0);
}

function otrimGetVerticalShift(anchorItem, moveItem, gap, direction) {
    var anchorB = otrimGetRealMaskBounds(anchorItem);
    var moveB = otrimGetRealMaskBounds(moveItem);
    if (direction === "down") {
        return (anchorB[3] - gap) - moveB[1];
    }
    if (direction === "up") {
        return (anchorB[1] + gap) - moveB[3];
    }
    return 0;
}

function otrimMoveWholeRow(rowArray, shiftY) {
    for (var c = 0; c < rowArray.length; c++) {
        if (rowArray[c]) rowArray[c].translate(0, shiftY);
    }
}

function otrimGetAnchorIndices(anchor, rows, cols) {
    if (anchor === "center") {
        return { r: Math.floor(rows / 2), c: Math.floor(cols / 2) };
    }
    if (anchor === "top-left") return { r: 0, c: 0 };
    if (anchor === "top-right") return { r: 0, c: cols - 1 };
    if (anchor === "bottom-left") return { r: rows - 1, c: 0 };
    if (anchor === "bottom-right") return { r: rows - 1, c: cols - 1 };
    return { r: 0, c: 0 };
}

function otrimProcess(sourceObj, config) {
    var doc = app.activeDocument;
    var rows = config.rows;
    var cols = config.cols;
    var scalePct = config.scale;
    var gap = config.gap;
    var mode = config.mode;
    var isProp = config.proportional;

    var bounds = sourceObj.visibleBounds;
    var startX = bounds[0];
    var startY = bounds[1];
    var totalW = bounds[2] - bounds[0];
    var totalH = bounds[1] - bounds[3];

    var cellW = totalW / cols;
    var cellH = totalH / rows;

    var matrix = [];
    for (var i = 0; i < rows; i++) matrix[i] = [];

    var anchorIdx = otrimGetAnchorIndices(config.anchor, rows, cols);
    var anchorR = anchorIdx.r;
    var anchorC = anchorIdx.c;

    for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
            var clone = sourceObj.duplicate();

            var maskL = startX + (c * cellW);
            var maskT = startY - (r * cellH);
            var maskRect = doc.pathItems.rectangle(maskT, maskL, cellW, cellH);

            doc.selection = null;
            clone.selected = true;
            maskRect.selected = true;
            maskRect.zOrder(ZOrderMethod.BRINGTOFRONT);
            app.executeMenuCommand("makeMask");

            var clipGroup = doc.selection[0];

            var distX = Math.abs(c - anchorC);
            var distY = Math.abs(r - anchorR);
            var scaleX = 1.0;
            var scaleY = 1.0;
            var factor;

            if (mode === "col") {
                factor = Math.pow(scalePct / 100, distX);
                scaleX = factor;
                scaleY = isProp ? factor : 1.0;
            } else if (mode === "row") {
                factor = Math.pow(scalePct / 100, distY);
                scaleX = isProp ? factor : 1.0;
                scaleY = factor;
            } else {
                scaleX = Math.pow(scalePct / 100, distX);
                scaleY = Math.pow(scalePct / 100, distY);
            }

            var pctX = scaleX * 100;
            var pctY = scaleY * 100;
            if (pctX < 0.1) pctX = 0.1;
            if (pctY < 0.1) pctY = 0.1;

            clipGroup.resize(pctX, pctY, true, true, true, true, pctX);

            matrix[r][c] = clipGroup;
        }
    }

    sourceObj.remove();

    for (var rr = 0; rr < rows; rr++) {
        var rowItems = matrix[rr];
        for (var cr = anchorC + 1; cr < cols; cr++) {
            otrimAlignNextToPrev(rowItems[cr - 1], rowItems[cr], gap, "right");
        }
        for (var cl = anchorC - 1; cl >= 0; cl--) {
            otrimAlignNextToPrev(rowItems[cl + 1], rowItems[cl], gap, "left");
        }
    }

    var spineCol = anchorC;
    for (var rd = anchorR + 1; rd < rows; rd++) {
        var prevDown = matrix[rd - 1][spineCol];
        var currDown = matrix[rd][spineCol];
        var shiftDown = otrimGetVerticalShift(prevDown, currDown, gap, "down");
        otrimMoveWholeRow(matrix[rd], shiftDown);
    }
    for (var ru = anchorR - 1; ru >= 0; ru--) {
        var prevUp = matrix[ru + 1][spineCol];
        var currUp = matrix[ru][spineCol];
        var shiftUp = otrimGetVerticalShift(prevUp, currUp, gap, "up");
        otrimMoveWholeRow(matrix[ru], shiftUp);
    }

    app.redraw();

    return {
        cells: rows * cols,
        rows: rows,
        cols: cols
    };
}

function otrimRun(encodedConfig) {
    try {
        var config = otrimValidateConfig(otrimParseConfig(encodedConfig));
        var sel = otrimEnsureSelection();

        app.executeMenuCommand("group");
        var sourceObj = app.activeDocument.selection[0];

        var data = otrimProcess(sourceObj, config);
        return otrimResponse(true, "Trim complete: " + data.rows + "x" + data.cols + " cells.", data);
    } catch (error) {
        otrimLog(error.message || String(error));
        return otrimResponse(false, error.message || String(error));
    }
}

function otrimHandshake() {
    try {
        return otrimResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return otrimResponse(false, error.message || String(error));
    }
}
