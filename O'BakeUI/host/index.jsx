#target illustrator
#targetengine "OBakeUICEP"

var obakeuiSession = {
    active: false,
    paths: [],            // captured PathItems
    previewGroup: null,
    baseZScale: 1
};

function obakeuiEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function obakeuiToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + obakeuiEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(obakeuiToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(obakeuiToJson(String(key)) + ":" + obakeuiToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function obakeuiResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return obakeuiToJson(payload);
}

function obakeuiParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function obakeuiEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function obakeuiValidateConfig(config) {
    var s = parseFloat(config.uiScale);
    if (!isFinite(s) || s <= 0) s = 1.0;
    return {
        bakeHandles: !!config.bakeHandles,
        bakeAnchors: !!config.bakeAnchors,
        bakeCorners: !!config.bakeCorners,
        bakeBBox: !!config.bakeBBox,
        bakeCenter: !!config.bakeCenter,
        uiScale: s,
        deleteParent: !!config.deleteParent
    };
}

// ---------- HELPERS ----------

function obakeuiExtractPaths(items, arr) {
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.typename === "PathItem") {
            arr.push(item);
        } else if (item.typename === "GroupItem") {
            obakeuiExtractPaths(item.pageItems, arr);
        } else if (item.typename === "CompoundPathItem") {
            obakeuiExtractPaths(item.pathItems, arr);
        }
    }
}

function obakeuiIsEqual(p1, p2) {
    var tol = 0.001;
    return Math.abs(p1[0] - p2[0]) < tol && Math.abs(p1[1] - p2[1]) < tol;
}

function obakeuiGetVector(p1, p2) {
    var dx = p2[0] - p1[0];
    var dy = p2[1] - p1[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return null;
    return [dx / len, dy / len];
}

function obakeuiGetBisector(v1, v2) {
    var bx = v1[0] + v2[0];
    var by = v1[1] + v2[1];
    var len = Math.sqrt(bx * bx + by * by);
    if (len === 0) return null;
    return [bx / len, by / len];
}

function obakeuiGetNormalIntersection(p1, t1, p2, t2) {
    var dx1 = t1[0] - p1[0];
    var dy1 = t1[1] - p1[1];
    var n1x = -dy1, n1y = dx1;
    var dx2 = t2[0] - p2[0];
    var dy2 = t2[1] - p2[1];
    var n2x = -dy2, n2y = dx2;
    var denom = n1x * n2y - n1y * n2x;
    if (Math.abs(denom) < 0.001) return null;
    var u = ((p2[0] - p1[0]) * n2y - (p2[1] - p1[1]) * n2x) / denom;
    if (Math.abs(u) > 8000) return null;
    var cx = p1[0] + u * n1x;
    var cy = p1[1] + u * n1y;
    if (Math.abs(cx) > 16000 || Math.abs(cy) > 16000) return null;
    return [cx, cy];
}

// ---------- SHAPE BUILDERS ----------

function obakeuiCreateHandleShape(anchor, dir, parent, layerColor, whiteColor, zScale) {
    var strokeThickness = 1.25 * zScale;
    var dotRadius = 2.5 * zScale;
    var line = parent.pathItems.add();
    line.setEntirePath([anchor, dir]);
    line.stroked = true;
    line.filled = false;
    line.strokeColor = layerColor;
    line.strokeWidth = strokeThickness;
    var dot = parent.pathItems.ellipse(dir[1] + dotRadius, dir[0] - dotRadius, dotRadius * 2, dotRadius * 2);
    dot.stroked = true;
    dot.strokeColor = layerColor;
    dot.strokeWidth = strokeThickness;
    dot.filled = true;
    dot.fillColor = whiteColor;
}

function obakeuiCreateAnchorShape(pos, parent, layerColor, zScale) {
    var size = 5.5 * zScale;
    var half = size / 2;
    var rect = parent.pathItems.rectangle(pos[1] + half, pos[0] - half, size, size);
    rect.stroked = false;
    rect.filled = true;
    rect.fillColor = layerColor;
}

function obakeuiCreateCornerWidget(pos, parent, layerColor, whiteColor, zScale) {
    if (!pos || isNaN(pos[0]) || isNaN(pos[1])) return;
    var radius = 4.5 * zScale;
    var dotRadius = 1.5 * zScale;
    var strokeThickness = 1.25 * zScale;
    var outer = parent.pathItems.ellipse(pos[1] + radius, pos[0] - radius, radius * 2, radius * 2);
    outer.stroked = true;
    outer.strokeColor = layerColor;
    outer.strokeWidth = strokeThickness;
    outer.filled = true;
    outer.fillColor = whiteColor;
    var inner = parent.pathItems.ellipse(pos[1] + dotRadius, pos[0] - dotRadius, dotRadius * 2, dotRadius * 2);
    inner.stroked = false;
    inner.filled = true;
    inner.fillColor = layerColor;
}

function obakeuiCreateBBoxHandle(pos, parent, layerColor, whiteColor, zScale) {
    var size = 5.5 * zScale;
    var half = size / 2;
    var rect = parent.pathItems.rectangle(pos[1] + half, pos[0] - half, size, size);
    rect.stroked = true;
    rect.strokeColor = layerColor;
    rect.strokeWidth = 1.0 * zScale;
    rect.filled = true;
    rect.fillColor = whiteColor;
}

function obakeuiCreateCenterMark(pos, parent, layerColor, zScale) {
    if (!pos || isNaN(pos[0]) || isNaN(pos[1])) return;
    var size = 3 * zScale;
    var half = size / 2;
    var strokeThickness = 0.75 * zScale;
    var lineLen = 3 * zScale;
    var gap = 1 * zScale;
    var rect = parent.pathItems.rectangle(pos[1] + half, pos[0] - half, size, size);
    rect.stroked = false;
    rect.filled = true;
    rect.fillColor = layerColor;
    var lines = [
        [[pos[0], pos[1] + half + gap], [pos[0], pos[1] + half + gap + lineLen]],
        [[pos[0], pos[1] - half - gap], [pos[0], pos[1] - half - gap - lineLen]],
        [[pos[0] - half - gap, pos[1]], [pos[0] - half - gap - lineLen, pos[1]]],
        [[pos[0] + half + gap, pos[1]], [pos[0] + half + gap + lineLen, pos[1]]]
    ];
    for (var i = 0; i < lines.length; i++) {
        var line = parent.pathItems.add();
        line.setEntirePath(lines[i]);
        line.stroked = true;
        line.strokeColor = layerColor;
        line.strokeWidth = strokeThickness;
        line.filled = false;
    }
}

// ---------- DRAW ----------

function obakeuiClearPreview() {
    if (obakeuiSession.previewGroup) {
        try { obakeuiSession.previewGroup.remove(); } catch (e) {}
    }
    obakeuiSession.previewGroup = null;
}

function obakeuiRedraw(config) {
    var doc = app.activeDocument;
    obakeuiClearPreview();

    if (!obakeuiSession.paths || obakeuiSession.paths.length === 0) return 0;

    obakeuiSession.previewGroup = doc.activeLayer.groupItems.add();
    obakeuiSession.previewGroup.name = "Baked UI Preview";

    var whiteColor = new RGBColor(); whiteColor.red = 255; whiteColor.green = 255; whiteColor.blue = 255;
    var currentScale = obakeuiSession.baseZScale * config.uiScale;

    var bboxGroup, centerGroup, handlesGroup, anchorsGroup, cornersGroup;
    if (config.bakeBBox) { bboxGroup = obakeuiSession.previewGroup.groupItems.add(); bboxGroup.name = "Bounding Box"; }
    if (config.bakeCenter) { centerGroup = obakeuiSession.previewGroup.groupItems.add(); centerGroup.name = "Center Point"; }
    if (config.bakeHandles) { handlesGroup = obakeuiSession.previewGroup.groupItems.add(); handlesGroup.name = "Handles"; }
    if (config.bakeAnchors) { anchorsGroup = obakeuiSession.previewGroup.groupItems.add(); anchorsGroup.name = "Anchor Points"; }
    if (config.bakeCorners) { cornersGroup = obakeuiSession.previewGroup.groupItems.add(); cornersGroup.name = "Corner Widgets"; }

    var minX = Infinity, maxY = -Infinity, maxX = -Infinity, minY = Infinity;
    var totalShapes = 0;

    for (var pi = 0; pi < obakeuiSession.paths.length; pi++) {
        var path = obakeuiSession.paths[pi];
        var pts;
        try { pts = path.pathPoints; } catch (eP) { continue; }
        var layerColor;
        try { layerColor = path.layer.color; } catch (eL) { layerColor = new RGBColor(); layerColor.red = 0; layerColor.green = 120; layerColor.blue = 255; }
        var isClosed = path.closed;

        if (config.bakeBBox || config.bakeCenter) {
            try {
                var bounds = path.geometricBounds;
                if (bounds && bounds.length === 4) {
                    if (bounds[0] < minX) minX = bounds[0];
                    if (bounds[1] > maxY) maxY = bounds[1];
                    if (bounds[2] > maxX) maxX = bounds[2];
                    if (bounds[3] < minY) minY = bounds[3];
                }
            } catch (eB) {}
        }

        for (var j = 0; j < pts.length; j++) {
            var pt = pts[j];
            var anchor = pt.anchor;
            var left = pt.leftDirection;
            var right = pt.rightDirection;
            var hasLeft = !obakeuiIsEqual(anchor, left);
            var hasRight = !obakeuiIsEqual(anchor, right);

            if (config.bakeHandles) {
                if (hasLeft) { obakeuiCreateHandleShape(anchor, left, handlesGroup, layerColor, whiteColor, currentScale); totalShapes++; }
                if (hasRight) { obakeuiCreateHandleShape(anchor, right, handlesGroup, layerColor, whiteColor, currentScale); totalShapes++; }
            }
            if (config.bakeAnchors) {
                obakeuiCreateAnchorShape(anchor, anchorsGroup, layerColor, currentScale);
                totalShapes++;
            }
            if (config.bakeCorners) {
                if (isClosed || (j > 0 && j < pts.length - 1)) {
                    var prevIdx = (j - 1 + pts.length) % pts.length;
                    var nextIdx = (j + 1) % pts.length;
                    var targetPrev = hasLeft ? left : pts[prevIdx].anchor;
                    var targetNext = hasRight ? right : pts[nextIdx].anchor;
                    var v1 = obakeuiGetVector(anchor, targetPrev);
                    var v2 = obakeuiGetVector(anchor, targetNext);
                    if (v1 && v2) {
                        var dotProduct = v1[0] * v2[0] + v1[1] * v2[1];
                        if (dotProduct > -0.995) {
                            var bisector = obakeuiGetBisector(v1, v2);
                            if (bisector) {
                                var widgetDist = 18 * currentScale;
                                var widgetPos = [
                                    anchor[0] + bisector[0] * widgetDist,
                                    anchor[1] + bisector[1] * widgetDist
                                ];
                                obakeuiCreateCornerWidget(widgetPos, cornersGroup, layerColor, whiteColor, currentScale);
                                totalShapes++;
                            }
                        }
                    }
                }
                if (isClosed || j < pts.length - 1) {
                    var nextVIdx = (j + 1) % pts.length;
                    var pt2 = pts[nextVIdx];
                    var pt1StraightIn = obakeuiIsEqual(pt.anchor, pt.leftDirection);
                    var pt1CurvedOut = !obakeuiIsEqual(pt.anchor, pt.rightDirection);
                    var pt2CurvedIn = !obakeuiIsEqual(pt2.anchor, pt2.leftDirection);
                    var pt2StraightOut = obakeuiIsEqual(pt2.anchor, pt2.rightDirection);
                    if (pt1StraightIn && pt1CurvedOut && pt2CurvedIn && pt2StraightOut) {
                        var arcCenter = obakeuiGetNormalIntersection(pt.anchor, pt.rightDirection, pt2.anchor, pt2.leftDirection);
                        if (arcCenter) {
                            obakeuiCreateCornerWidget(arcCenter, cornersGroup, layerColor, whiteColor, currentScale);
                            totalShapes++;
                        }
                    }
                }
            }
        }
    }

    if ((config.bakeBBox || config.bakeCenter) && minX !== Infinity) {
        var mainLayerColor;
        try { mainLayerColor = obakeuiSession.paths[0].layer.color; } catch (eM) {
            mainLayerColor = new RGBColor(); mainLayerColor.red = 0; mainLayerColor.green = 120; mainLayerColor.blue = 255;
        }
        if (config.bakeBBox) {
            var rectW = maxX - minX;
            var rectH = maxY - minY;
            if (rectW <= 0) rectW = 0.001;
            if (rectH <= 0) rectH = 0.001;
            var boxLine = bboxGroup.pathItems.rectangle(maxY, minX, rectW, rectH);
            boxLine.stroked = true;
            boxLine.filled = false;
            boxLine.strokeColor = mainLayerColor;
            boxLine.strokeWidth = 0.75 * obakeuiSession.baseZScale * config.uiScale;
            var hp = [
                [minX, maxY], [(minX + maxX) / 2, maxY], [maxX, maxY],
                [minX, (minY + maxY) / 2], [maxX, (minY + maxY) / 2],
                [minX, minY], [(minX + maxX) / 2, minY], [maxX, minY]
            ];
            for (var h = 0; h < hp.length; h++) {
                obakeuiCreateBBoxHandle(hp[h], bboxGroup, mainLayerColor, whiteColor, obakeuiSession.baseZScale * config.uiScale);
                totalShapes++;
            }
            totalShapes++;
        }
        if (config.bakeCenter) {
            var centerX = (minX + maxX) / 2;
            var centerY = (minY + maxY) / 2;
            obakeuiCreateCenterMark([centerX, centerY], centerGroup, mainLayerColor, obakeuiSession.baseZScale * config.uiScale);
            totalShapes++;
        }
    }

    return totalShapes;
}

function obakeuiResetSession(removePreview, restoreVisibility) {
    if (removePreview) obakeuiClearPreview();
    if (restoreVisibility) {
        for (var i = 0; i < obakeuiSession.paths.length; i++) {
            try { obakeuiSession.paths[i].hidden = false; } catch (e) {}
        }
    }
    obakeuiSession.active = false;
    obakeuiSession.paths = [];
    obakeuiSession.previewGroup = null;
}

// ---------- ENDPOINTS ----------

function obakeuiStart(encodedConfig) {
    try {
        if (obakeuiSession.active) {
            obakeuiResetSession(true, true);
        }
        var config = obakeuiValidateConfig(obakeuiParseConfig(encodedConfig));
        var doc = obakeuiEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select 1+ paths first.");
        }
        var paths = [];
        obakeuiExtractPaths(sel, paths);
        if (paths.length === 0) {
            throw new Error("No path items in selection.");
        }
        var baseZ = 1;
        try { if (doc.views.length > 0) baseZ = 1 / doc.views[0].zoom; } catch (eZ) {}
        obakeuiSession.paths = paths;
        obakeuiSession.baseZScale = baseZ;
        obakeuiSession.active = true;

        // If delete-parent is on, hide originals during preview
        if (config.deleteParent) {
            for (var i = 0; i < paths.length; i++) {
                try { paths[i].hidden = true; } catch (eH) {}
            }
        }

        var n = obakeuiRedraw(config);
        app.redraw();
        return obakeuiResponse(true, "Preview ready (" + n + " shape(s) on " + paths.length + " path(s)).", { shapes: n, paths: paths.length });
    } catch (error) {
        obakeuiResetSession(true, true);
        return obakeuiResponse(false, error.message || String(error));
    }
}

function obakeuiUpdate(encodedConfig) {
    try {
        if (!obakeuiSession.active) return obakeuiResponse(false, "No active session.");
        var config = obakeuiValidateConfig(obakeuiParseConfig(encodedConfig));
        // Reflect deleteParent toggle on parent visibility live
        for (var i = 0; i < obakeuiSession.paths.length; i++) {
            try { obakeuiSession.paths[i].hidden = !!config.deleteParent; } catch (e) {}
        }
        var n = obakeuiRedraw(config);
        app.redraw();
        return obakeuiResponse(true, "Drew " + n + " shape(s).", { shapes: n });
    } catch (error) {
        return obakeuiResponse(false, error.message || String(error));
    }
}

function obakeuiApply(encodedConfig) {
    try {
        if (!obakeuiSession.active) return obakeuiResponse(false, "No active session.");
        var config = obakeuiValidateConfig(obakeuiParseConfig(encodedConfig));
        if (obakeuiSession.previewGroup) {
            try { obakeuiSession.previewGroup.name = "O'BakeUI Result"; } catch (eN) {}
        }
        if (config.deleteParent) {
            for (var i = obakeuiSession.paths.length - 1; i >= 0; i--) {
                try { obakeuiSession.paths[i].remove(); } catch (eR) {}
            }
        } else {
            for (var j = 0; j < obakeuiSession.paths.length; j++) {
                try { obakeuiSession.paths[j].hidden = false; } catch (eS) {}
            }
        }
        var n = 0;
        try { n = obakeuiSession.previewGroup ? obakeuiSession.previewGroup.pageItems.length : 0; } catch (e) {}
        obakeuiSession.active = false;
        obakeuiSession.paths = [];
        obakeuiSession.previewGroup = null;
        app.redraw();
        return obakeuiResponse(true, "Applied (" + n + " items).", { items: n });
    } catch (error) {
        return obakeuiResponse(false, error.message || String(error));
    }
}

function obakeuiCancel() {
    try {
        if (!obakeuiSession.active) return obakeuiResponse(true, "No active session.", { wasActive: false });
        obakeuiResetSession(true, true);
        app.redraw();
        return obakeuiResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        return obakeuiResponse(false, error.message || String(error));
    }
}

function obakeuiHandshake() {
    try {
        return obakeuiResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!obakeuiSession.active
        });
    } catch (error) {
        return obakeuiResponse(false, error.message || String(error));
    }
}
