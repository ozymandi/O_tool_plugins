#target illustrator
#targetengine "OBevelCEP"

var OBEVEL_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/obevel_cep_log.txt");

var obevelSession = {
    active: false,
    sources: [],
    customProfile: null
};

function obevelLog(message) {
    if (!OBEVEL_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function obevelEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function obevelToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + obevelEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(obevelToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(obevelToJson(String(key)) + ":" + obevelToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function obevelResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return obevelToJson(payload);
}

function obevelParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function obevelNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function obevelNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function obevelNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function obevelValidateConfig(config) {
    var validModes = { steps: 1, custom: 1 };
    var normalized = {
        mode: validModes.hasOwnProperty(config.mode) ? config.mode : "steps",
        count: obevelNormalizeInteger(config.count, 3),
        radius: obevelNormalizeNumber(config.radius, 20),
        flip: obevelNormalizeBoolean(config.flip, false),
        straighten: obevelNormalizeBoolean(config.straighten, true)
    };
    if (normalized.count < 1) normalized.count = 1;
    if (normalized.radius < 0.1) normalized.radius = 0.1;
    return normalized;
}

function obevelEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function obevelCollectPaths(items, collector) {
    for (var i = 0; i < items.length; i++) {
        if (items[i].typename === "PathItem") {
            collector.push(items[i]);
        } else if (items[i].typename === "GroupItem") {
            obevelCollectPaths(items[i].pageItems, collector);
        } else if (items[i].typename === "CompoundPathItem") {
            if (items[i].pathItems.length > 0) collector.push(items[i].pathItems[0]);
        }
    }
}

function obevelGetPoints(path) {
    var pts = path.pathPoints;
    var coords = [];
    for (var i = 0; i < pts.length; i++) {
        coords.push({
            a: [pts[i].anchor[0], pts[i].anchor[1]],
            l: [pts[i].leftDirection[0], pts[i].leftDirection[1]],
            r: [pts[i].rightDirection[0], pts[i].rightDirection[1]],
            t: pts[i].pointType
        });
    }
    return coords;
}

function obevelRotateVec(vx, vy, rot, scale) {
    return {
        x: (vx * Math.cos(rot) - vy * Math.sin(rot)) * scale,
        y: (vx * Math.sin(rot) + vy * Math.cos(rot)) * scale
    };
}

function obevelTransform(u, v, x0, y0, scale, rot) {
    var tx = (u * Math.cos(rot) - v * Math.sin(rot)) * scale;
    var ty = (u * Math.sin(rot) + v * Math.cos(rot)) * scale;
    return { x: x0 + tx, y: y0 + ty };
}

function obevelAddPoint(arr, x, y) {
    arr.push({ a: [x, y], l: [x, y], r: [x, y], t: PointType.CORNER });
}

function obevelCalculateCornerPath(rawPts, isClosed, reqRad, steps, isCustom, flip, straighten, customProfile) {
    var input = [];
    for (var i = 0; i < rawPts.length; i++) input.push({ x: rawPts[i].a[0], y: rawPts[i].a[1] });

    var result = [];
    var count = input.length;

    for (var i = 0; i < count; i++) {
        var curr = input[i];
        var prev = input[(i - 1 + count) % count];
        var next = input[(i + 1) % count];

        if (!isClosed && (i === 0 || i === count - 1)) {
            obevelAddPoint(result, curr.x, curr.y);
            continue;
        }

        var v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
        var v2 = { x: next.x - curr.x, y: next.y - curr.y };
        var len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        var len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

        if (len1 < 0.001 || len2 < 0.001) {
            obevelAddPoint(result, curr.x, curr.y);
            continue;
        }

        var n1 = { x: v1.x / len1, y: v1.y / len1 };
        var n2 = { x: v2.x / len2, y: v2.y / len2 };

        var safeRadius = Math.min(reqRad, len1 * 0.49, len2 * 0.49);

        if (safeRadius < 0.5) {
            obevelAddPoint(result, curr.x, curr.y);
            continue;
        }

        var startP = { x: curr.x - n1.x * safeRadius, y: curr.y - n1.y * safeRadius };
        var endP = { x: curr.x + n2.x * safeRadius, y: curr.y + n2.y * safeRadius };

        if (isCustom && customProfile) {
            var dx = endP.x - startP.x;
            var dy = endP.y - startP.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var angle = Math.atan2(dy, dx);

            for (var k = 0; k < customProfile.length; k++) {
                var cp = customProfile[k];
                var cpY = flip ? -cp.y : cp.y;
                var cplY = flip ? -cp.ly : cp.ly;
                var cprY = flip ? -cp.ry : cp.ry;

                var tAnchor = obevelTransform(cp.x, cpY, startP.x, startP.y, dist, angle);
                var tL = obevelRotateVec(cp.lx, cplY, angle, dist);
                var tR = obevelRotateVec(cp.rx, cprY, angle, dist);

                if (straighten) {
                    if (k === 0) tL = { x: 0, y: 0 };
                    if (k === customProfile.length - 1) tR = { x: 0, y: 0 };
                }

                result.push({
                    a: [tAnchor.x, tAnchor.y],
                    l: [tAnchor.x + tL.x, tAnchor.y + tL.y],
                    r: [tAnchor.x + tR.x, tAnchor.y + tR.y],
                    t: cp.t
                });
            }
        } else {
            obevelAddPoint(result, startP.x, startP.y);

            var stepSize = safeRadius / steps;
            var vIn = { x: n1.x * stepSize, y: n1.y * stepSize };
            var vOut = { x: n2.x * stepSize, y: n2.y * stepSize };
            var curPos = { x: startP.x, y: startP.y };

            for (var s = 0; s < steps; s++) {
                curPos.x += vOut.x; curPos.y += vOut.y;
                obevelAddPoint(result, curPos.x, curPos.y);
                curPos.x += vIn.x; curPos.y += vIn.y;
                obevelAddPoint(result, curPos.x, curPos.y);
            }
        }
    }
    return result;
}

function obevelDrawPath(path, coords) {
    if (coords.length < 2) return;

    var anchorArray = [];
    for (var i = 0; i < coords.length; i++) anchorArray.push(coords[i].a);
    path.setEntirePath(anchorArray);

    for (var j = 0; j < coords.length; j++) {
        path.pathPoints[j].leftDirection = coords[j].l;
        path.pathPoints[j].rightDirection = coords[j].r;
        path.pathPoints[j].pointType = coords[j].t;
    }
}

function obevelGenerate(session, config) {
    var doc = app.activeDocument;

    for (var i = 0; i < session.sources.length; i++) {
        if (session.sources[i].previewItem) {
            try { session.sources[i].previewItem.remove(); } catch (e) {}
            session.sources[i].previewItem = null;
        }
    }

    for (var j = 0; j < session.sources.length; j++) {
        var d = session.sources[j];
        var coords = obevelCalculateCornerPath(
            d.points,
            d.closed,
            config.radius,
            config.count,
            config.mode === "custom",
            config.flip,
            config.straighten,
            session.customProfile
        );

        var newItem = doc.pathItems.add();
        newItem.name = "OBevel_Result";

        try {
            obevelDrawPath(newItem, coords);
            newItem.closed = d.closed;
            if (d.fillColor) { newItem.filled = true; newItem.fillColor = d.fillColor; }
            else { newItem.filled = false; }
            if (d.strokeColor) {
                newItem.stroked = true;
                newItem.strokeColor = d.strokeColor;
                newItem.strokeWidth = d.strokeWidth;
            } else {
                newItem.stroked = false;
            }
            newItem.move(d.original, ElementPlacement.PLACEBEFORE);
            d.previewItem = newItem;
        } catch (err) {
            try { newItem.remove(); } catch (e) {}
            obevelLog("Generate error on item " + j + ": " + err.message);
        }
    }
}

function obevelBuildSession(sel) {
    var paths = [];
    obevelCollectPaths(sel, paths);

    var sources = [];
    for (var i = 0; i < paths.length; i++) {
        var item = paths[i];
        var pts = obevelGetPoints(item);
        if (pts.length > 1) {
            sources.push({
                original: item,
                points: pts,
                closed: item.closed,
                fillColor: item.filled ? item.fillColor : null,
                strokeColor: item.stroked ? item.strokeColor : null,
                strokeWidth: item.stroked ? item.strokeWidth : 1,
                previewItem: null
            });
        }
    }

    if (sources.length === 0) {
        throw new Error("No valid paths found in the selection.");
    }

    return sources;
}

function obevelHideOriginals(session) {
    for (var i = 0; i < session.sources.length; i++) {
        try { session.sources[i].original.hidden = true; } catch (e) {}
    }
}

function obevelShowOriginals(session) {
    for (var i = 0; i < session.sources.length; i++) {
        try { session.sources[i].original.hidden = false; } catch (e) {}
    }
}

function obevelCommitSession(session) {
    for (var i = 0; i < session.sources.length; i++) {
        try { session.sources[i].original.remove(); } catch (e) {}
        if (session.sources[i].previewItem) {
            try { session.sources[i].previewItem.selected = true; } catch (e) {}
        }
    }
}

function obevelCancelSessionRevert(session) {
    for (var i = 0; i < session.sources.length; i++) {
        if (session.sources[i].previewItem) {
            try { session.sources[i].previewItem.remove(); } catch (e) {}
            session.sources[i].previewItem = null;
        }
    }
    obevelShowOriginals(session);
}

function obevelClearSession() {
    obevelSession.active = false;
    obevelSession.sources = [];
}

function obevelLoadClipboard() {
    try {
        var doc = obevelEnsureDocument();
        var selInit = [];
        for (var i = 0; i < doc.selection.length; i++) selInit.push(doc.selection[i]);

        doc.selection = null;
        try { app.paste(); } catch (pasteErr) {
            for (var r = 0; r < selInit.length; r++) {
                try { selInit[r].selected = true; } catch (e) {}
            }
            throw new Error("Paste failed: " + (pasteErr.message || pasteErr));
        }

        if (!doc.selection || doc.selection.length === 0) {
            for (var r2 = 0; r2 < selInit.length; r2++) {
                try { selInit[r2].selected = true; } catch (e) {}
            }
            throw new Error("Clipboard is empty or did not yield a path.");
        }

        var item = doc.selection[0];
        if (item.typename === "GroupItem" && item.pathItems && item.pathItems.length > 0) {
            item = item.pathItems[0];
        }

        if (item.typename !== "PathItem") {
            try { doc.selection[0].remove(); } catch (e) {}
            for (var r3 = 0; r3 < selInit.length; r3++) {
                try { selInit[r3].selected = true; } catch (e) {}
            }
            throw new Error("Clipboard contains a non-path item.");
        }

        var pts = item.pathPoints;
        if (pts.length < 2) {
            try { doc.selection[0].remove(); } catch (e) {}
            for (var r4 = 0; r4 < selInit.length; r4++) {
                try { selInit[r4].selected = true; } catch (e) {}
            }
            throw new Error("Profile path needs at least 2 anchor points.");
        }

        var pStart = pts[0].anchor;
        var pEnd = pts[pts.length - 1].anchor;
        var dx = pEnd[0] - pStart[0];
        var dy = pEnd[1] - pStart[1];
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) {
            try { doc.selection[0].remove(); } catch (e) {}
            for (var r5 = 0; r5 < selInit.length; r5++) {
                try { selInit[r5].selected = true; } catch (e) {}
            }
            throw new Error("Profile path has zero length.");
        }
        var ang = Math.atan2(dy, dx);

        var data = [];
        for (var k = 0; k < pts.length; k++) {
            var p = pts[k];
            var rx = p.anchor[0] - pStart[0];
            var ry = p.anchor[1] - pStart[1];

            var flatX = rx * Math.cos(-ang) - ry * Math.sin(-ang);
            var flatY = rx * Math.sin(-ang) + ry * Math.cos(-ang);

            var nx = flatX / len;
            var ny = flatY / len;

            var lrx = p.leftDirection[0] - p.anchor[0];
            var lry = p.leftDirection[1] - p.anchor[1];
            var nl = obevelRotateVec(lrx, lry, -ang, 1 / len);

            var rrx = p.rightDirection[0] - p.anchor[0];
            var rry = p.rightDirection[1] - p.anchor[1];
            var nr = obevelRotateVec(rrx, rry, -ang, 1 / len);

            data.push({ x: nx, y: ny, lx: nl.x, ly: nl.y, rx: nr.x, ry: nr.y, t: p.pointType });
        }

        try { doc.selection[0].remove(); } catch (e) {}
        for (var r6 = 0; r6 < selInit.length; r6++) {
            try { selInit[r6].selected = true; } catch (e) {}
        }

        obevelSession.customProfile = data;
        return obevelResponse(true, "Profile loaded.", { points: data.length });
    } catch (error) {
        obevelLog(error.message || String(error));
        return obevelResponse(false, error.message || String(error));
    }
}

function obevelRun(encodedConfig) {
    try {
        if (obevelSession.active) {
            obevelCancelSessionRevert(obevelSession);
            obevelClearSession();
        }

        var config = obevelValidateConfig(obevelParseConfig(encodedConfig));
        if (config.mode === "custom" && !obevelSession.customProfile) {
            throw new Error("Custom mode needs a clipboard profile. Click LOAD CLIPBOARD first.");
        }

        var doc = obevelEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select an object to bevel first.");
        }

        var sources = obevelBuildSession(sel);
        var session = { sources: sources, customProfile: obevelSession.customProfile };
        obevelHideOriginals(session);
        obevelGenerate(session, config);
        obevelCommitSession(session);
        app.redraw();

        return obevelResponse(true, "Bevelled " + sources.length + " path(s).", { paths: sources.length });
    } catch (error) {
        obevelLog(error.message || String(error));
        return obevelResponse(false, error.message || String(error));
    }
}

function obevelStartPreview(encodedConfig) {
    try {
        if (obevelSession.active) {
            obevelCancelSessionRevert(obevelSession);
            obevelClearSession();
        }

        var config = obevelValidateConfig(obevelParseConfig(encodedConfig));
        if (config.mode === "custom" && !obevelSession.customProfile) {
            throw new Error("Custom mode needs a clipboard profile. Click LOAD CLIPBOARD first.");
        }

        var doc = obevelEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select an object first.");
        }

        var sources = obevelBuildSession(sel);
        obevelSession.active = true;
        obevelSession.sources = sources;

        obevelHideOriginals(obevelSession);
        obevelGenerate(obevelSession, config);
        app.redraw();

        return obevelResponse(true, "Preview started: " + sources.length + " path(s).", { paths: sources.length });
    } catch (error) {
        obevelLog(error.message || String(error));
        return obevelResponse(false, error.message || String(error));
    }
}

function obevelUpdatePreview(encodedConfig) {
    try {
        if (!obevelSession.active) {
            return obevelResponse(false, "No active preview session.");
        }
        var config = obevelValidateConfig(obevelParseConfig(encodedConfig));
        if (config.mode === "custom" && !obevelSession.customProfile) {
            return obevelResponse(false, "Custom mode needs a clipboard profile. Click LOAD CLIPBOARD first.");
        }
        obevelGenerate(obevelSession, config);
        app.redraw();
        return obevelResponse(true, "Preview updated.");
    } catch (error) {
        obevelLog(error.message || String(error));
        return obevelResponse(false, error.message || String(error));
    }
}

function obevelApplyPreview() {
    try {
        if (!obevelSession.active) {
            return obevelResponse(false, "No active preview session.");
        }
        var paths = obevelSession.sources.length;
        obevelCommitSession(obevelSession);
        obevelClearSession();
        app.redraw();
        return obevelResponse(true, "Bevel applied: " + paths + " path(s).", { paths: paths });
    } catch (error) {
        obevelLog(error.message || String(error));
        return obevelResponse(false, error.message || String(error));
    }
}

function obevelCancelPreview() {
    try {
        if (!obevelSession.active) {
            return obevelResponse(true, "No active preview to cancel.", { wasActive: false });
        }
        obevelCancelSessionRevert(obevelSession);
        obevelClearSession();
        app.redraw();
        return obevelResponse(true, "Preview cancelled.", { wasActive: true });
    } catch (error) {
        obevelLog(error.message || String(error));
        return obevelResponse(false, error.message || String(error));
    }
}

function obevelHandshake() {
    try {
        return obevelResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            previewActive: !!obevelSession.active,
            profileLoaded: !!obevelSession.customProfile,
            profilePoints: obevelSession.customProfile ? obevelSession.customProfile.length : 0
        });
    } catch (error) {
        return obevelResponse(false, error.message || String(error));
    }
}
