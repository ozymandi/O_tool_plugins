#target illustrator
#targetengine "OFillCEP"

var OFILL_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/ofill_cep_log.txt");

var ofillSession = {
    active: false,
    container: null,
    containerInfo: null,
    stack: [],
    previewGroup: null
};

var OFILL_PREVIEW_GROUP_NAME = "OFILL_PREVIEW_FINAL";

function ofillLog(message) {
    if (!OFILL_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function ofillEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function ofillToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + ofillEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(ofillToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(ofillToJson(String(key)) + ":" + ofillToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function ofillResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return ofillToJson(payload);
}

function ofillParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function ofillNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function ofillNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function ofillNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function ofillEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function ofillStackForJs() {
    var arr = [];
    for (var i = 0; i < ofillSession.stack.length; i++) {
        var s = ofillSession.stack[i];
        arr.push({
            name: s.name || "",
            typename: s.typename || ""
        });
    }
    return arr;
}

function ofillContainerInfoForJs() {
    if (!ofillSession.containerInfo) return null;
    return {
        name: ofillSession.containerInfo.name,
        typename: ofillSession.containerInfo.typename
    };
}

function ofillRemovePreview() {
    if (ofillSession.previewGroup) {
        try { ofillSession.previewGroup.remove(); } catch (e) {}
        ofillSession.previewGroup = null;
    }
    // Defensive cleanup: also try by name in case ref was lost
    if (app.documents.length > 0) {
        try {
            var doc = app.activeDocument;
            doc.groupItems.getByName(OFILL_PREVIEW_GROUP_NAME).remove();
        } catch (e) {}
    }
}

function ofillClearSession() {
    ofillRemovePreview();
    ofillSession.active = false;
    ofillSession.container = null;
    ofillSession.containerInfo = null;
    ofillSession.stack = [];
    ofillSession.previewGroup = null;
}

function ofillSelectShape() {
    try {
        var doc = ofillEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length < 1) {
            throw new Error("Select a shape on the artboard first.");
        }
        if (sel.length > 1) {
            throw new Error("Select exactly one shape (you have " + sel.length + " items selected).");
        }

        // Drop existing preview if container changes
        ofillRemovePreview();

        var item = sel[0];
        ofillSession.active = true;
        ofillSession.container = item;
        ofillSession.containerInfo = {
            name: item.name || "",
            typename: item.typename || ""
        };

        var label = ofillSession.containerInfo.name && ofillSession.containerInfo.name !== ""
            ? ofillSession.containerInfo.name
            : ofillSession.containerInfo.typename;

        return ofillResponse(true, "Container set: " + label + ".", {
            shape: ofillContainerInfoForJs(),
            stack: ofillStackForJs()
        });
    } catch (error) {
        ofillLog(error.message || String(error));
        return ofillResponse(false, error.message || String(error));
    }
}

function ofillCollectDonorsFromSelection(items, out) {
    var doc = app.activeDocument;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        // Skip the container if it sneaks back into selection
        if (ofillSession.container && item === ofillSession.container) continue;

        var sym = null;
        try {
            if (item.typename === "SymbolItem" || item.typename === "SymbolInstance") {
                sym = item.symbol;
            } else {
                sym = doc.symbols.add(item);
            }
        } catch (e) {
            ofillLog("Symbol convert failed for item: " + e.message);
            continue;
        }

        var bounds = item.geometricBounds;
        var radius = Math.max(Math.abs(bounds[2] - bounds[0]), Math.abs(bounds[1] - bounds[3])) / 2;
        if (!isFinite(radius) || radius <= 0) {
            ofillLog("Donor has zero/invalid radius, skipping");
            continue;
        }

        out.push({
            symbol: sym,
            baseRadius: radius,
            name: item.name || "",
            typename: item.typename || ""
        });
    }
}

function ofillAddToStack() {
    try {
        if (!ofillSession.active) {
            throw new Error("Set a container shape first (press SELECT SHAPE).");
        }
        var doc = ofillEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length < 1) {
            throw new Error("Select donor objects on the artboard first.");
        }

        var added = [];
        ofillCollectDonorsFromSelection(sel, added);

        if (added.length === 0) {
            throw new Error("Could not convert any selected items to donors.");
        }

        for (var i = 0; i < added.length; i++) {
            ofillSession.stack.push(added[i]);
        }

        return ofillResponse(true, "Added " + added.length + " donor(s).", {
            stack: ofillStackForJs()
        });
    } catch (error) {
        ofillLog(error.message || String(error));
        return ofillResponse(false, error.message || String(error));
    }
}

function ofillReorderStack(encodedConfig) {
    try {
        if (!ofillSession.active) throw new Error("No active session.");
        var raw = ofillParseConfig(encodedConfig);
        var from = ofillNormalizeInteger(raw.from, -1);
        var to = ofillNormalizeInteger(raw.to, -1);
        var len = ofillSession.stack.length;
        if (from < 0 || from >= len || to < 0 || to >= len || from === to) {
            return ofillResponse(true, "No-op.", { stack: ofillStackForJs() });
        }
        var item = ofillSession.stack.splice(from, 1)[0];
        ofillSession.stack.splice(to, 0, item);
        return ofillResponse(true, "Reordered.", { stack: ofillStackForJs() });
    } catch (error) {
        ofillLog(error.message || String(error));
        return ofillResponse(false, error.message || String(error));
    }
}

function ofillRemoveFromStack(encodedConfig) {
    try {
        if (!ofillSession.active) throw new Error("No active session.");
        var raw = ofillParseConfig(encodedConfig);
        var idx = ofillNormalizeInteger(raw.index, -1);
        if (idx < 0 || idx >= ofillSession.stack.length) {
            return ofillResponse(true, "No-op.", { stack: ofillStackForJs() });
        }
        ofillSession.stack.splice(idx, 1);
        return ofillResponse(true, "Removed.", { stack: ofillStackForJs() });
    } catch (error) {
        ofillLog(error.message || String(error));
        return ofillResponse(false, error.message || String(error));
    }
}

// ---------- TURBO FILL (verbatim port) ----------

function ofillIsPointInPoly(pt, poly) {
    var x = pt[0], y = pt[1];
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var xi = poly[i][0], yi = poly[i][1];
        var xj = poly[j][0], yj = poly[j][1];
        var intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function ofillCheckGridCollision(pt, radius, gap, grid, cellSize) {
    var gx = Math.floor(pt.x / cellSize);
    var gy = Math.floor(pt.y / cellSize);

    for (var x = gx - 1; x <= gx + 1; x++) {
        for (var y = gy - 1; y <= gy + 1; y++) {
            var key = x + "_" + y;
            var cellItems = grid[key];
            if (!cellItems) continue;
            for (var k = 0; k < cellItems.length; k++) {
                var neighbor = cellItems[k];
                var distSq = Math.pow(pt.x - neighbor.x, 2) + Math.pow(pt.y - neighbor.y, 2);
                var reqDist = radius + neighbor.r + gap;
                if (distSq < (reqDist * reqDist)) return false;
            }
        }
    }
    return true;
}

function ofillCalculateTurbo(cont, donors, gap, fillPct, originType, isMix, maxIter, minS, maxS) {
    var b = cont.geometricBounds;
    var width = Math.abs(b[2] - b[0]);
    var height = Math.abs(b[1] - b[3]);

    var polyPoints = [];
    if (cont.typename === "PathItem") {
        for (var p = 0; p < cont.pathPoints.length; p++) {
            polyPoints.push([cont.pathPoints[p].anchor[0], cont.pathPoints[p].anchor[1]]);
        }
    } else {
        polyPoints = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
    }

    var maxPossibleRadius = 0;
    for (var d = 0; d < donors.length; d++) {
        if (donors[d].baseRadius > maxPossibleRadius) maxPossibleRadius = donors[d].baseRadius;
    }
    var cellSize = (maxPossibleRadius * maxS * 2) + gap + 1;
    var grid = {};
    var resultList = [];

    for (var i = 0; i < maxIter; i++) {
        var pt = {
            x: b[0] + Math.random() * width,
            y: b[3] + Math.random() * height
        };

        if (pt.y > Math.max(b[1], b[3]) || pt.y < Math.min(b[1], b[3])) continue;
        if (!ofillIsPointInPoly([pt.x, pt.y], polyPoints)) continue;

        var yMin = Math.min(b[1], b[3]);
        var yMax = Math.max(b[1], b[3]);
        var distToStart, limit;

        if (originType === "bottom-up") { distToStart = pt.y - yMin; limit = height * fillPct; }
        else if (originType === "top-down") { distToStart = yMax - pt.y; limit = height * fillPct; }
        else if (originType === "left-right") { distToStart = pt.x - b[0]; limit = width * fillPct; }
        else { distToStart = b[2] - pt.x; limit = width * fillPct; }

        if (distToStart > limit) continue;

        var dIdx;
        if (isMix) {
            dIdx = Math.floor(Math.random() * donors.length);
        } else {
            var t = distToStart / limit;
            dIdx = Math.floor(t * donors.length);
        }
        if (dIdx >= donors.length) dIdx = donors.length - 1;
        if (dIdx < 0) dIdx = 0;

        var currentScale = minS + Math.random() * (maxS - minS);
        var currentRadius = donors[dIdx].baseRadius * currentScale;
        var fits = false;

        if (ofillCheckGridCollision(pt, currentRadius, gap, grid, cellSize)) {
            fits = true;
        } else {
            for (var k = 0; k < 3; k++) {
                currentScale *= 0.75;
                if (currentScale < minS) break;
                currentRadius = donors[dIdx].baseRadius * currentScale;
                if (ofillCheckGridCollision(pt, currentRadius, gap, grid, cellSize)) {
                    fits = true;
                    break;
                }
            }
        }

        if (!fits) continue;

        var newItem = { x: pt.x, y: pt.y, r: currentRadius, sym: donors[dIdx].symbol, scale: currentScale };
        resultList.push(newItem);

        var gx = Math.floor(pt.x / cellSize);
        var gy = Math.floor(pt.y / cellSize);
        var key = gx + "_" + gy;
        if (!grid[key]) grid[key] = [];
        grid[key].push(newItem);
    }

    return resultList;
}

function ofillValidateConfig(config) {
    var validOrigin = { "bottom-up": 1, "top-down": 1, "left-right": 1, "right-left": 1 };
    var normalized = {
        percent: ofillNormalizeNumber(config.percent, 100),
        gap: ofillNormalizeNumber(config.gap, 0),
        attempts: ofillNormalizeNumber(config.attempts, 30),
        minScale: ofillNormalizeNumber(config.minScale, 20),
        maxScale: ofillNormalizeNumber(config.maxScale, 120),
        origin: validOrigin.hasOwnProperty(config.origin) ? config.origin : "bottom-up",
        mix: ofillNormalizeBoolean(config.mix, false),
        rotate: ofillNormalizeBoolean(config.rotate, true),
        mask: ofillNormalizeBoolean(config.mask, true)
    };
    if (normalized.percent < 1) normalized.percent = 1;
    if (normalized.percent > 100) normalized.percent = 100;
    if (normalized.gap < 0) normalized.gap = 0;
    if (normalized.attempts < 1) normalized.attempts = 1;
    if (normalized.minScale < 1) normalized.minScale = 1;
    if (normalized.maxScale < 1) normalized.maxScale = 1;
    if (normalized.maxScale < normalized.minScale) normalized.maxScale = normalized.minScale;
    return normalized;
}

function ofillGenerate(encodedConfig) {
    try {
        if (!ofillSession.active) {
            throw new Error("No active session. Press SELECT SHAPE first.");
        }
        if (!ofillSession.container) {
            throw new Error("Container reference is missing. Press SELECT SHAPE again.");
        }
        if (ofillSession.stack.length === 0) {
            throw new Error("Stack is empty. Add donors first.");
        }

        var config = ofillValidateConfig(ofillParseConfig(encodedConfig));
        var doc = ofillEnsureDocument();

        // Drop the previous preview
        ofillRemovePreview();

        var mainGroup = doc.activeLayer.groupItems.add();
        mainGroup.name = OFILL_PREVIEW_GROUP_NAME;

        var maxIter = Math.round(config.attempts * 1000);
        var minS = config.minScale / 100;
        var maxS = config.maxScale / 100;
        var fillPct = config.percent / 100;

        var positions = ofillCalculateTurbo(
            ofillSession.container,
            ofillSession.stack,
            config.gap,
            fillPct,
            config.origin,
            config.mix,
            maxIter,
            minS,
            maxS
        );

        for (var i = 0; i < positions.length; i++) {
            var p = positions[i];
            try {
                var inst = mainGroup.symbolItems.add(p.sym);
                inst.resize(p.scale * 100, p.scale * 100);
                inst.left = p.x - (inst.width / 2);
                inst.top = p.y + (inst.height / 2);
                if (config.rotate) inst.rotate(Math.random() * 360);
            } catch (placeErr) {
                ofillLog("Place error: " + placeErr.message);
            }
        }

        ofillSession.previewGroup = mainGroup;

        app.redraw();

        return ofillResponse(true, "Placed " + positions.length + " items.", {
            placed: positions.length
        });
    } catch (error) {
        ofillLog(error.message || String(error));
        ofillRemovePreview();
        return ofillResponse(false, error.message || String(error));
    }
}

function ofillApply(encodedConfig) {
    try {
        if (!ofillSession.active) {
            throw new Error("No active session.");
        }
        if (!ofillSession.previewGroup) {
            throw new Error("Generate a preview before applying.");
        }
        var config = ofillValidateConfig(ofillParseConfig(encodedConfig));
        var previewGroup = ofillSession.previewGroup;
        var container = ofillSession.container;

        if (config.mask && container) {
            try {
                container.duplicate(previewGroup, ElementPlacement.PLACEATBEGINNING);
                previewGroup.clipped = true;
            } catch (maskErr) {
                ofillLog("Clipping mask error: " + maskErr.message);
            }
        }

        // Detach preview from session before clearing
        ofillSession.previewGroup = null;
        ofillSession.active = false;
        ofillSession.container = null;
        ofillSession.containerInfo = null;
        ofillSession.stack = [];

        app.redraw();

        return ofillResponse(true, "Fill applied.", {});
    } catch (error) {
        ofillLog(error.message || String(error));
        return ofillResponse(false, error.message || String(error));
    }
}

function ofillCancel() {
    try {
        ofillClearSession();
        app.redraw();
        return ofillResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        ofillLog(error.message || String(error));
        return ofillResponse(false, error.message || String(error));
    }
}

function ofillHandshake() {
    try {
        return ofillResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!ofillSession.active,
            stack: ofillStackForJs(),
            shape: ofillContainerInfoForJs()
        });
    } catch (error) {
        return ofillResponse(false, error.message || String(error));
    }
}
