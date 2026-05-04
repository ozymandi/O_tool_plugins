#target illustrator
#targetengine "OAtractorCEP"

var oatractorSession = {
    active: false,
    attractorPos: null,
    originalData: [],   // [{ pathItem, pointsData: [{ index, origAnchor, origLeft, origRight }] }]
    previewLayer: null,
    previewCircle: null
};

function oatractorEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oatractorToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oatractorEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oatractorToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oatractorToJson(String(key)) + ":" + oatractorToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oatractorResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oatractorToJson(payload);
}

function oatractorParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function oatractorEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function oatractorValidateConfig(config) {
    var n = {
        doHandles: !!config.doHandles,
        doAnchors: !!config.doAnchors,
        force: parseFloat(config.force),
        swirl: parseFloat(config.swirl),
        useFalloff: !!config.useFalloff,
        radius: parseFloat(config.radius)
    };
    if (isNaN(n.force)) n.force = 0;
    if (isNaN(n.swirl)) n.swirl = 0;
    if (isNaN(n.radius) || n.radius <= 0) n.radius = 500;
    return n;
}

// ---------- HELPERS ----------

function oatractorExtractPaths(items, arr) {
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.typename === "PathItem") {
            arr.push(item);
        } else if (item.typename === "GroupItem") {
            oatractorExtractPaths(item.pageItems, arr);
        } else if (item.typename === "CompoundPathItem") {
            oatractorExtractPaths(item.pathItems, arr);
        }
    }
}

function oatractorCalcPosition(hPos, target, force, swirlRad, useFalloff, radius) {
    var dx = hPos[0] - target[0];
    var dy = hPos[1] - target[1];
    var dist = Math.sqrt(dx * dx + dy * dy);
    var weight = 1;
    if (useFalloff) {
        if (dist > radius) weight = 0;
        else weight = 1 - (dist / radius);
    }
    if (weight === 0) return [hPos[0], hPos[1]];

    var forceEffect = force * weight;
    var stepX = hPos[0] - dx * forceEffect;
    var stepY = hPos[1] - dy * forceEffect;

    var angleEffect = swirlRad * weight;
    if (angleEffect !== 0) {
        var cx = stepX - target[0];
        var cy = stepY - target[1];
        var cosA = Math.cos(angleEffect);
        var sinA = Math.sin(angleEffect);
        stepX = target[0] + (cx * cosA - cy * sinA);
        stepY = target[1] + (cx * sinA + cy * cosA);
    }
    return [stepX, stepY];
}

// ---------- PREVIEW LAYER (cyan crosshair + dashed circle) ----------

function oatractorBuildPreview(useFalloff, radius) {
    var doc = app.activeDocument;
    var attractor = oatractorSession.attractorPos;
    if (!attractor) return;

    if (!useFalloff) {
        oatractorRemovePreview();
        return;
    }

    if (!oatractorSession.previewLayer) {
        oatractorSession.previewLayer = doc.layers.add();
        oatractorSession.previewLayer.name = "O_Attractor_Preview";

        var cyan = new RGBColor(); cyan.red = 0; cyan.green = 255; cyan.blue = 255;
        var m = 8;
        var c1 = oatractorSession.previewLayer.pathItems.add();
        c1.setEntirePath([[attractor[0] - m, attractor[1]], [attractor[0] + m, attractor[1]]]);
        c1.stroked = true; c1.strokeColor = cyan; c1.strokeWidth = 1.5; c1.filled = false;
        var c2 = oatractorSession.previewLayer.pathItems.add();
        c2.setEntirePath([[attractor[0], attractor[1] - m], [attractor[0], attractor[1] + m]]);
        c2.stroked = true; c2.strokeColor = cyan; c2.strokeWidth = 1.5; c2.filled = false;

        oatractorSession.previewCircle = oatractorSession.previewLayer.pathItems.ellipse(
            attractor[1] + radius, attractor[0] - radius, radius * 2, radius * 2
        );
        oatractorSession.previewCircle.filled = false;
        oatractorSession.previewCircle.stroked = true;
        oatractorSession.previewCircle.strokeColor = cyan;
        oatractorSession.previewCircle.strokeWidth = 1.5;
        oatractorSession.previewCircle.strokeDashes = [6, 4];
    } else if (oatractorSession.previewCircle) {
        try {
            oatractorSession.previewCircle.top = attractor[1] + radius;
            oatractorSession.previewCircle.left = attractor[0] - radius;
            oatractorSession.previewCircle.width = radius * 2;
            oatractorSession.previewCircle.height = radius * 2;
        } catch (e) {}
    }
}

function oatractorRemovePreview() {
    if (oatractorSession.previewLayer) {
        try { oatractorSession.previewLayer.remove(); } catch (e) {}
    }
    oatractorSession.previewLayer = null;
    oatractorSession.previewCircle = null;
}

// ---------- CORE ----------

function oatractorRedraw(config) {
    if (!oatractorSession.attractorPos) return 0;
    var force = config.force;
    var swirlRad = config.swirl * (Math.PI / 180);
    var useFalloff = config.useFalloff;
    var radius = config.radius;
    var doHandles = config.doHandles;
    var doAnchors = config.doAnchors;
    var attractor = oatractorSession.attractorPos;

    oatractorBuildPreview(useFalloff, radius);

    var touched = 0;
    for (var i = 0; i < oatractorSession.originalData.length; i++) {
        var itemData = oatractorSession.originalData[i];
        var pts = itemData.pathItem.pathPoints;
        for (var j = 0; j < itemData.pointsData.length; j++) {
            var pData = itemData.pointsData[j];
            var pt;
            try { pt = pts[pData.index]; } catch (eIdx) { continue; }
            if (!pt) continue;

            if (doAnchors) {
                var newAnchor = oatractorCalcPosition(pData.origAnchor, attractor, force, swirlRad, useFalloff, radius);
                var deltaX = newAnchor[0] - pData.origAnchor[0];
                var deltaY = newAnchor[1] - pData.origAnchor[1];
                pt.anchor = newAnchor;
                if (!doHandles) {
                    pt.leftDirection = [pData.origLeft[0] + deltaX, pData.origLeft[1] + deltaY];
                    pt.rightDirection = [pData.origRight[0] + deltaX, pData.origRight[1] + deltaY];
                } else {
                    pt.leftDirection = oatractorCalcPosition(pData.origLeft, attractor, force, swirlRad, useFalloff, radius);
                    pt.rightDirection = oatractorCalcPosition(pData.origRight, attractor, force, swirlRad, useFalloff, radius);
                }
            } else {
                pt.anchor = pData.origAnchor;
                if (doHandles) {
                    pt.leftDirection = oatractorCalcPosition(pData.origLeft, attractor, force, swirlRad, useFalloff, radius);
                    pt.rightDirection = oatractorCalcPosition(pData.origRight, attractor, force, swirlRad, useFalloff, radius);
                } else {
                    pt.leftDirection = pData.origLeft;
                    pt.rightDirection = pData.origRight;
                }
            }
            touched++;
        }
    }
    return touched;
}

function oatractorRestoreOriginals() {
    for (var i = 0; i < oatractorSession.originalData.length; i++) {
        var itemData = oatractorSession.originalData[i];
        var pts;
        try { pts = itemData.pathItem.pathPoints; } catch (eP) { continue; }
        for (var j = 0; j < itemData.pointsData.length; j++) {
            var pData = itemData.pointsData[j];
            var pt;
            try { pt = pts[pData.index]; } catch (eIdx) { continue; }
            if (!pt) continue;
            try { pt.anchor = pData.origAnchor; } catch (e) {}
            try { pt.leftDirection = pData.origLeft; } catch (e) {}
            try { pt.rightDirection = pData.origRight; } catch (e) {}
        }
    }
}

function oatractorResetSession() {
    oatractorRemovePreview();
    oatractorSession.active = false;
    oatractorSession.attractorPos = null;
    oatractorSession.originalData = [];
}

// ---------- ENDPOINTS ----------

function oatractorStart(encodedConfig) {
    try {
        if (oatractorSession.active) {
            oatractorRestoreOriginals();
            oatractorResetSession();
        }
        var config = oatractorValidateConfig(oatractorParseConfig(encodedConfig));
        var doc = oatractorEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select a single-point attractor + target anchor points.");
        }

        var allPaths = [];
        oatractorExtractPaths(sel, allPaths);

        var attractorItem = null;
        var attractorPos = null;
        for (var i = allPaths.length - 1; i >= 0; i--) {
            if (allPaths[i].pathPoints.length === 1) {
                attractorPos = [allPaths[i].pathPoints[0].anchor[0], allPaths[i].pathPoints[0].anchor[1]];
                attractorItem = allPaths[i];
                break;
            }
        }
        if (!attractorPos) {
            throw new Error("Attractor not found. Include a standalone single-point path in the selection.");
        }

        var originalData = [];
        for (var k = 0; k < allPaths.length; k++) {
            var item = allPaths[k];
            if (item === attractorItem) continue;
            var pp = item.pathPoints;
            var pointsData = [];
            for (var p = 0; p < pp.length; p++) {
                var pt = pp[p];
                if (pt.selected === PathPointSelection.ANCHORPOINT) {
                    pointsData.push({
                        index: p,
                        origAnchor: [pt.anchor[0], pt.anchor[1]],
                        origLeft: [pt.leftDirection[0], pt.leftDirection[1]],
                        origRight: [pt.rightDirection[0], pt.rightDirection[1]]
                    });
                }
            }
            if (pointsData.length > 0) {
                originalData.push({ pathItem: item, pointsData: pointsData });
            }
        }
        if (originalData.length === 0) {
            throw new Error("No anchor points selected on target paths.");
        }

        oatractorSession.attractorPos = attractorPos;
        oatractorSession.originalData = originalData;
        oatractorSession.active = true;

        var touched = oatractorRedraw(config);
        app.redraw();

        var totalPts = 0;
        for (var t = 0; t < originalData.length; t++) totalPts += originalData[t].pointsData.length;

        return oatractorResponse(true, "Attractor armed: " + originalData.length + " path(s), " + totalPts + " anchor point(s).", {
            paths: originalData.length,
            points: totalPts,
            touched: touched
        });
    } catch (error) {
        oatractorResetSession();
        return oatractorResponse(false, error.message || String(error));
    }
}

function oatractorUpdate(encodedConfig) {
    try {
        if (!oatractorSession.active) return oatractorResponse(false, "No active session.");
        var config = oatractorValidateConfig(oatractorParseConfig(encodedConfig));
        var touched = oatractorRedraw(config);
        app.redraw();
        return oatractorResponse(true, "Updated " + touched + " point(s).", { touched: touched });
    } catch (error) {
        return oatractorResponse(false, error.message || String(error));
    }
}

function oatractorApply() {
    try {
        if (!oatractorSession.active) return oatractorResponse(false, "No active session.");
        // Detach: keep current deformed state on canvas, drop preview circle
        oatractorRemovePreview();
        var n = 0;
        for (var i = 0; i < oatractorSession.originalData.length; i++) {
            n += oatractorSession.originalData[i].pointsData.length;
        }
        oatractorSession.active = false;
        oatractorSession.attractorPos = null;
        oatractorSession.originalData = [];
        app.redraw();
        return oatractorResponse(true, "Applied to " + n + " point(s).", { points: n });
    } catch (error) {
        return oatractorResponse(false, error.message || String(error));
    }
}

function oatractorCancel() {
    try {
        if (!oatractorSession.active) return oatractorResponse(true, "No active session.", { wasActive: false });
        oatractorRestoreOriginals();
        oatractorResetSession();
        app.redraw();
        return oatractorResponse(true, "Cancelled — anchors restored.", { wasActive: true });
    } catch (error) {
        return oatractorResponse(false, error.message || String(error));
    }
}

function oatractorHandshake() {
    try {
        return oatractorResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!oatractorSession.active
        });
    } catch (error) {
        return oatractorResponse(false, error.message || String(error));
    }
}
