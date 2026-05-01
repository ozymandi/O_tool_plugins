#target illustrator
#targetengine "OVoronCEP"

var OVORON_DEBUG = false;
var ovoronDebugLog = new File(Folder.desktop + "/ovoron_cep_log.txt");

var ovoronSession = {
    active: false,
    previewGroup: null,
    targetShapes: [],
    seedState: 12345
};

var OVORON_PRESET_FILE = new File(Folder.userData + "/OVoron_Presets.json");

var OVORON_DEFAULT_PRESET = {
    name: "Default", metric: 0, seed: 12345, density: 20, randomness: 0,
    block: 8, steps: 0, outline: false, outWidth: 1,
    bounds: true, origCol: false, delPar: true
};

function ovoronLog(message) {
    if (!OVORON_DEBUG) return;
    try {
        ovoronDebugLog.open("a");
        ovoronDebugLog.writeln("[" + new Date().toUTCString() + "] " + message);
        ovoronDebugLog.close();
    } catch (e) {}
}

function ovoronEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function ovoronToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + ovoronEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(ovoronToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(ovoronToJson(String(key)) + ":" + ovoronToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function ovoronResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return ovoronToJson(payload);
}

function ovoronParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function ovoronEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function ovoronValidateConfig(config) {
    var n = {
        metric: parseInt(config.metric, 10),
        seed: parseInt(config.seed, 10),
        density: parseInt(config.density, 10),
        randomness: parseFloat(config.randomness),
        block: parseInt(config.block, 10),
        steps: parseInt(config.steps, 10),
        outline: !!config.outline,
        outWidth: parseInt(config.outWidth, 10),
        bounds: !!config.bounds,
        origCol: !!config.origCol,
        delPar: !!config.delPar
    };
    if (isNaN(n.metric) || n.metric < 0 || n.metric > 3) n.metric = 0;
    if (isNaN(n.seed)) n.seed = 12345;
    if (isNaN(n.density) || n.density < 0) n.density = 0;
    if (isNaN(n.randomness)) n.randomness = 0;
    if (n.randomness < 0) n.randomness = 0;
    if (n.randomness > 1) n.randomness = 1;
    if (isNaN(n.block) || n.block < 2) n.block = 2;
    if (isNaN(n.steps) || n.steps < 0) n.steps = 0;
    if (isNaN(n.outWidth) || n.outWidth < 1) n.outWidth = 1;
    return n;
}

// ---------- PRNG ----------

function ovoronSetSeed(s) { ovoronSession.seedState = s; }
function ovoronSeededRandom() {
    ovoronSession.seedState = (ovoronSession.seedState * 9301 + 49297) % 233280;
    return ovoronSession.seedState / 233280;
}

// ---------- MATH ----------

function ovoronGetDistance(p1, p2, metricIndex) {
    var dx = Math.abs(p1.x - p2.x);
    var dy = Math.abs(p1.y - p2.y);
    if (metricIndex === 1) return dx + dy;
    if (metricIndex === 2) return Math.max(dx, dy);
    if (metricIndex === 3) return Math.pow(Math.pow(dx, 3) + Math.pow(dy, 3), 1 / 3);
    return Math.sqrt(dx * dx + dy * dy);
}

function ovoronIsInsideEuclidean(p, a, b) {
    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;
    var vx = b.x - a.x;
    var vy = b.y - a.y;
    var px = p.x - mx;
    var py = p.y - my;
    return (vx * px + vy * py) <= 0;
}

function ovoronGetIntersection(p1, p2, a, b) {
    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;
    var vx = b.x - a.x;
    var vy = b.y - a.y;
    var num = vx * (mx - p1.x) + vy * (my - p1.y);
    var den = vx * (p2.x - p1.x) + vy * (p2.y - p1.y);
    var t = 0;
    if (den !== 0) t = num / den;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

function ovoronClipPolygon(poly, a, b) {
    var newPoly = [];
    for (var i = 0; i < poly.length; i++) {
        var p1 = poly[i];
        var p2 = poly[(i + 1) % poly.length];
        var in1 = ovoronIsInsideEuclidean(p1, a, b);
        var in2 = ovoronIsInsideEuclidean(p2, a, b);
        if (in1) newPoly.push(p1);
        if (in1 !== in2) newPoly.push(ovoronGetIntersection(p1, p2, a, b));
    }
    return newPoly;
}

// ---------- COLOR ----------

function ovoronGetRGB(color) {
    var c = new RGBColor();
    c.red = 128; c.green = 128; c.blue = 128;
    if (!color) return c;
    try {
        if (color.typename === "RGBColor") {
            c.red = color.red; c.green = color.green; c.blue = color.blue;
        } else if (color.typename === "CMYKColor") {
            c.red = Math.round(255 * (1 - color.cyan / 100) * (1 - color.black / 100));
            c.green = Math.round(255 * (1 - color.magenta / 100) * (1 - color.black / 100));
            c.blue = Math.round(255 * (1 - color.yellow / 100) * (1 - color.black / 100));
        } else if (color.typename === "GrayColor") {
            var v = 255 - Math.round(color.gray * 2.55);
            c.red = v; c.green = v; c.blue = v;
        } else if (color.typename === "SpotColor") {
            return ovoronGetRGB(color.spot.color);
        }
    } catch (e) {
        ovoronLog("Color conv: " + e.message);
    }
    return c;
}

function ovoronGetBaseFill(shape) {
    try {
        if (shape.typename === "PathItem" && shape.filled) {
            return shape.fillColor;
        } else if (shape.typename === "CompoundPathItem" && shape.pathItems.length > 0) {
            for (var i = 0; i < shape.pathItems.length; i++) {
                if (shape.pathItems[i].filled) return shape.pathItems[i].fillColor;
            }
        }
    } catch (e) {
        ovoronLog("Base fill: " + e.message);
    }
    return null;
}

function ovoronGetSampledColor(fill, px, py, bounds) {
    if (!fill) return ovoronGetRGB(null);
    try {
        if (fill.typename === "GradientColor") {
            var grad = fill.gradient;
            var stops = grad.gradientStops;
            if (!stops || stops.length === 0) return ovoronGetRGB(null);
            var left = bounds[0];
            var top = bounds[1];
            var right = bounds[2];
            var bottom = bounds[3];
            var cx = (left + right) / 2;
            var cy = (top + bottom) / 2;
            var isRadial = false;
            try { isRadial = (grad.type === GradientType.RADIAL); } catch (e) {}
            var t = 0;
            if (isRadial) {
                var origin = [cx, cy];
                var length = Math.max((right - left) / 2, (top - bottom) / 2);
                try { origin = fill.origin; } catch (e2) {}
                try { length = fill.length; } catch (e3) {}
                var ddx = px - origin[0];
                var ddy = py - origin[1];
                var dist = Math.sqrt(ddx * ddx + ddy * ddy);
                t = length > 0 ? (dist / length) : 0;
            } else {
                var angle = 0;
                try { angle = fill.angle; } catch (e4) {}
                var rad = -angle * Math.PI / 180;
                var ldx = px - cx;
                var ldy = py - cy;
                var ldist = ldx * Math.cos(rad) - ldy * Math.sin(rad);
                var spanX = (right - left) / 2;
                var spanY = (top - bottom) / 2;
                var maxDist = Math.abs(spanX * Math.cos(rad)) + Math.abs(spanY * Math.sin(rad));
                if (maxDist === 0) maxDist = 1;
                t = (ldist + maxDist) / (2 * maxDist);
            }
            t = Math.max(0, Math.min(1, t));
            var targetRamp = t * 100;
            var stop1 = stops[0];
            var stop2 = stops[stops.length - 1];
            for (var i = 0; i < stops.length - 1; i++) {
                var s1 = stops[i];
                var s2 = stops[i + 1];
                if (targetRamp >= s1.rampPoint && targetRamp <= s2.rampPoint) {
                    stop1 = s1; stop2 = s2; break;
                }
            }
            var range = stop2.rampPoint - stop1.rampPoint;
            var localT = 0;
            if (range > 0) localT = (targetRamp - stop1.rampPoint) / range;
            var c1 = ovoronGetRGB(stop1.color);
            var c2 = ovoronGetRGB(stop2.color);
            var res = new RGBColor();
            res.red = Math.round(c1.red + (c2.red - c1.red) * localT);
            res.green = Math.round(c1.green + (c2.green - c1.green) * localT);
            res.blue = Math.round(c1.blue + (c2.blue - c1.blue) * localT);
            return res;
        }
    } catch (eg) {
        ovoronLog("Gradient eval: " + eg.message);
    }
    return ovoronGetRGB(fill);
}

function ovoronGetDarkenedColor(color) {
    var d = new RGBColor();
    d.red = Math.max(0, Math.floor(color.red * 0.5));
    d.green = Math.max(0, Math.floor(color.green * 0.5));
    d.blue = Math.max(0, Math.floor(color.blue * 0.5));
    return d;
}

// ---------- POLY EXTRACTION ----------

function ovoronGetPathPoints(pathItem) {
    var pts = [];
    var ptsCount = pathItem.pathPoints.length;
    if (ptsCount === 0) return pts;
    var bezierSteps = 10;
    for (var i = 0; i < ptsCount; i++) {
        var pt1 = pathItem.pathPoints[i];
        var pt2 = pathItem.pathPoints[(i + 1) % ptsCount];
        if (!pathItem.closed && i === ptsCount - 1) break;
        var p0 = pt1.anchor;
        var p1d = pt1.rightDirection;
        var p2d = pt2.leftDirection;
        var p3 = pt2.anchor;
        var isStraight = (p0[0] === p1d[0] && p0[1] === p1d[1] && p3[0] === p2d[0] && p3[1] === p2d[1]);
        if (isStraight) {
            pts.push({ x: p0[0], y: p0[1] });
        } else {
            for (var t = 0; t < bezierSteps; t++) {
                var u = t / bezierSteps;
                var mum1 = 1 - u;
                var mum13 = mum1 * mum1 * mum1;
                var mu3 = u * u * u;
                var x = mum13 * p0[0] + 3 * u * mum1 * mum1 * p1d[0] + 3 * u * u * mum1 * p2d[0] + mu3 * p3[0];
                var y = mum13 * p0[1] + 3 * u * mum1 * mum1 * p1d[1] + 3 * u * u * mum1 * p2d[1] + mu3 * p3[1];
                pts.push({ x: x, y: y });
            }
        }
    }
    return pts;
}

function ovoronExtractPolygons(shape) {
    var polys = [];
    if (shape.typename === "PathItem") {
        polys.push(ovoronGetPathPoints(shape));
    } else if (shape.typename === "CompoundPathItem") {
        for (var i = 0; i < shape.pathItems.length; i++) {
            polys.push(ovoronGetPathPoints(shape.pathItems[i]));
        }
    }
    return polys;
}

function ovoronIsPointInPolygons(p, polys) {
    var inside = false;
    for (var i = 0; i < polys.length; i++) {
        var poly = polys[i];
        var j = poly.length - 1;
        for (var k = 0; k < poly.length; k++) {
            if (((poly[k].y > p.y) !== (poly[j].y > p.y)) &&
                (p.x < (poly[j].x - poly[k].x) * (p.y - poly[k].y) / (poly[j].y - poly[k].y) + poly[k].x)) {
                inside = !inside;
            }
            j = k;
        }
    }
    return inside;
}

// ---------- GENERATE ----------

function ovoronClearPreview() {
    if (ovoronSession.previewGroup) {
        try { ovoronSession.previewGroup.remove(); } catch (e) {}
        ovoronSession.previewGroup = null;
    }
}

function ovoronGenerate(config) {
    var doc = app.activeDocument;
    ovoronClearPreview();
    ovoronSession.previewGroup = doc.groupItems.add();
    ovoronSession.previewGroup.name = "O_Voron_Preview_Master";

    var density = config.density;
    var randomness = config.randomness;
    var metric = config.metric;
    var blockSize = config.block;
    var bounds = config.bounds;
    var origCol = config.origCol;
    var doDelete = config.delPar;
    var useOutline = config.outline;
    var outlineWidth = config.outWidth;
    var baseSeed = config.seed;
    var numSteps = config.steps;

    var totalCells = 0;

    for (var objIndex = 0; objIndex < ovoronSession.targetShapes.length; objIndex++) {
        var targetShape = ovoronSession.targetShapes[objIndex];
        ovoronSetSeed(baseSeed + objIndex);

        try { targetShape.hidden = doDelete; } catch (eHide) {}

        var objectGroup = ovoronSession.previewGroup.groupItems.add();
        objectGroup.name = "Shatter_Object_" + objIndex;

        var shapeBounds = targetShape.visibleBounds;
        var left = shapeBounds[0];
        var top = shapeBounds[1];
        var right = shapeBounds[2];
        var bottom = shapeBounds[3];
        var w = right - left;
        var h = top - bottom;
        var margin = Math.max(w, h) * 1.5;

        var baseFill = ovoronGetBaseFill(targetShape);
        var centerColor = ovoronGetSampledColor(baseFill, (left + right) / 2, (top + bottom) / 2, shapeBounds);
        var strokeColorDark = ovoronGetDarkenedColor(centerColor);

        var outlineGroup = objectGroup.groupItems.add();
        outlineGroup.name = "Outline_Sandwich";
        var cellsGroup = objectGroup.groupItems.add();
        cellsGroup.name = "Cells";

        var applyVectorMask = true;

        function applyOutlineLogic(cellRect) {
            if (!useOutline) return;
            var outRect = cellRect.duplicate(outlineGroup, ElementPlacement.PLACEATEND);
            outRect.filled = true;
            outRect.fillColor = strokeColorDark;
            outRect.stroked = true;
            outRect.strokeColor = strokeColorDark;
            outRect.strokeWidth = outlineWidth * 2;
            try { outRect.strokeJoin = StrokeJoin.MITERENDJOIN; } catch (eJoin) {}
        }

        function getCellColor(rc1, rc2, rc3, origColor) {
            var c = new RGBColor();
            if (numSteps > 0) {
                var t = Math.floor(rc1 * numSteps) / (numSteps > 1 ? (numSteps - 1) : 1);
                if (origCol) {
                    c.red = Math.round(origColor.red * t);
                    c.green = Math.round(origColor.green * t);
                    c.blue = Math.round(origColor.blue * t);
                } else {
                    var gray = Math.round(255 * t);
                    c.red = gray; c.green = gray; c.blue = gray;
                }
            } else {
                if (origCol) {
                    c.red = origColor.red; c.green = origColor.green; c.blue = origColor.blue;
                } else {
                    c.red = Math.floor(rc1 * 256);
                    c.green = Math.floor(rc2 * 256);
                    c.blue = Math.floor(rc3 * 256);
                }
            }
            return c;
        }

        if (density === 0) {
            var gridResolution = blockSize;
            var shapePolys = bounds ? ovoronExtractPolygons(targetShape) : [];
            applyVectorMask = !bounds;

            for (var px = left; px < right; px += gridResolution) {
                for (var py = top; py > bottom; py -= gridResolution) {
                    var cellCenter = { x: px + gridResolution / 2, y: py - gridResolution / 2 };
                    if (bounds && !ovoronIsPointInPolygons(cellCenter, shapePolys)) continue;
                    var rc1 = ovoronSeededRandom();
                    var rc2 = ovoronSeededRandom();
                    var rc3 = ovoronSeededRandom();
                    var origC = ovoronGetSampledColor(baseFill, cellCenter.x, cellCenter.y, shapeBounds);
                    var rect = cellsGroup.pathItems.rectangle(py, px, gridResolution, gridResolution);
                    rect.filled = true;
                    rect.fillColor = getCellColor(rc1, rc2, rc3, origC);
                    rect.stroked = false;
                    applyOutlineLogic(rect);
                    totalCells++;
                }
            }
        } else {
            var points = [];
            var pointColors = [];
            var area = w * h;
            var step = Math.sqrt(area / Math.max(1, density));
            var cols = Math.max(1, Math.ceil(w / step));
            var rows = Math.max(1, Math.ceil(h / step));
            var dx = step;
            var dy = step;
            var startX = left + (w - (cols * dx)) / 2 + (dx / 2);
            var startY = top - (h - (rows * dy)) / 2 - (dy / 2);

            for (var i = 0; i < cols; i++) {
                for (var j = 0; j < rows; j++) {
                    var rx = ovoronSeededRandom();
                    var ry = ovoronSeededRandom();
                    var rcA = ovoronSeededRandom();
                    var rcB = ovoronSeededRandom();
                    var rcC = ovoronSeededRandom();
                    var ptX = startX + (i * dx) + (rx - 0.5) * dx * randomness;
                    var ptY = startY - (j * dy) + (ry - 0.5) * dy * randomness;
                    points.push({ x: ptX, y: ptY });
                    var origCol2 = ovoronGetSampledColor(baseFill, ptX, ptY, shapeBounds);
                    pointColors.push(getCellColor(rcA, rcB, rcC, origCol2));
                }
            }

            if (metric === 0) {
                var boundingBox = [
                    { x: left - margin, y: top + margin },
                    { x: right + margin, y: top + margin },
                    { x: right + margin, y: bottom - margin },
                    { x: left - margin, y: bottom - margin }
                ];
                for (var ip = 0; ip < points.length; ip++) {
                    var poly = boundingBox.slice();
                    for (var jp = 0; jp < points.length; jp++) {
                        if (ip === jp) continue;
                        poly = ovoronClipPolygon(poly, points[ip], points[jp]);
                        if (poly.length < 3) break;
                    }
                    if (poly.length >= 3) {
                        var path = cellsGroup.pathItems.add();
                        var pathPts = [];
                        for (var kp = 0; kp < poly.length; kp++) {
                            pathPts.push([poly[kp].x, poly[kp].y]);
                        }
                        path.setEntirePath(pathPts);
                        path.closed = true;
                        path.filled = true;
                        path.fillColor = pointColors[ip];
                        path.stroked = false;
                        applyOutlineLogic(path);
                        totalCells++;
                    }
                }
            } else {
                var gridResolution2 = blockSize;
                var shapePolys2 = bounds ? ovoronExtractPolygons(targetShape) : [];
                for (var x = left; x < right; x += gridResolution2) {
                    for (var y = top; y > bottom; y -= gridResolution2) {
                        var cc = { x: x + gridResolution2 / 2, y: y - gridResolution2 / 2 };
                        if (bounds) {
                            if (!ovoronIsPointInPolygons(cc, shapePolys2)) continue;
                            applyVectorMask = false;
                        }
                        var closestIndex = 0;
                        var minDistance = Infinity;
                        for (var ic = 0; ic < points.length; ic++) {
                            var dist2 = ovoronGetDistance(cc, points[ic], metric);
                            if (dist2 < minDistance) { minDistance = dist2; closestIndex = ic; }
                        }
                        var rect2 = cellsGroup.pathItems.rectangle(y, x, gridResolution2, gridResolution2);
                        rect2.filled = true;
                        rect2.fillColor = pointColors[closestIndex];
                        rect2.stroked = false;
                        applyOutlineLogic(rect2);
                        totalCells++;
                    }
                }
            }
        }

        // Vector mask for clipping
        if (applyVectorMask) {
            try {
                var dummy = objectGroup.pathItems.add();
                dummy.setEntirePath([[left, top], [right, top], [right, bottom], [left, bottom]]);
                dummy.closed = true;
                dummy.clipping = true;
                objectGroup.clipped = true;
                var maskShape = targetShape.duplicate(objectGroup, ElementPlacement.PLACEATBEGINNING);
                maskShape.hidden = false;
                maskShape.locked = false;
                if (maskShape.typename === "CompoundPathItem") {
                    for (var pmi = 0; pmi < maskShape.pathItems.length; pmi++) {
                        try { maskShape.pathItems[pmi].filled = false; } catch (eM1) {}
                        try { maskShape.pathItems[pmi].stroked = false; } catch (eM2) {}
                    }
                    try { maskShape.pathItems[0].clipping = true; } catch (eM3) {}
                } else if (maskShape.typename === "PathItem") {
                    try { maskShape.filled = false; } catch (eM4) {}
                    try { maskShape.stroked = false; } catch (eM5) {}
                    try { maskShape.clipping = true; } catch (eM6) {}
                }
                dummy.remove();
            } catch (eMask) {
                ovoronLog("Mask error " + objIndex + ": " + eMask.message);
            }
        }
    }

    return totalCells;
}

function ovoronResetSession(removePreview, restoreOriginals) {
    if (removePreview) ovoronClearPreview();
    if (restoreOriginals) {
        for (var i = 0; i < ovoronSession.targetShapes.length; i++) {
            try { ovoronSession.targetShapes[i].hidden = false; } catch (e) {}
        }
    }
    ovoronSession.active = false;
    ovoronSession.previewGroup = null;
    ovoronSession.targetShapes = [];
}

// ---------- ENDPOINTS ----------

function ovoronStart(encodedConfig) {
    try {
        if (ovoronSession.active) {
            ovoronResetSession(true, true);
        }
        var config = ovoronValidateConfig(ovoronParseConfig(encodedConfig));
        var doc = ovoronEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select at least one path or compound path.");
        }
        var validShapes = [];
        for (var s = 0; s < sel.length; s++) {
            var item = sel[s];
            if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
                validShapes.push(item);
            }
        }
        if (validShapes.length === 0) {
            throw new Error("No valid Paths or Compound Paths in selection.");
        }
        validShapes.reverse();
        ovoronSession.targetShapes = validShapes;
        ovoronSession.active = true;
        var totalCells = ovoronGenerate(config);
        app.redraw();
        return ovoronResponse(true, "Preview ready (" + totalCells + " cells, " + validShapes.length + " object(s)).", {
            cells: totalCells,
            shapes: validShapes.length
        });
    } catch (error) {
        ovoronLog(error.message || String(error));
        ovoronResetSession(true, true);
        return ovoronResponse(false, error.message || String(error));
    }
}

function ovoronUpdate(encodedConfig) {
    try {
        if (!ovoronSession.active) return ovoronResponse(false, "No active session.");
        var config = ovoronValidateConfig(ovoronParseConfig(encodedConfig));
        var totalCells = ovoronGenerate(config);
        app.redraw();
        return ovoronResponse(true, "Drew " + totalCells + " cells.", { cells: totalCells });
    } catch (error) {
        ovoronLog(error.message || String(error));
        return ovoronResponse(false, error.message || String(error));
    }
}

function ovoronApply(encodedConfig) {
    try {
        if (!ovoronSession.active) return ovoronResponse(false, "No active session.");
        var config = ovoronValidateConfig(ovoronParseConfig(encodedConfig));
        var doDelete = config.delPar;
        var n = ovoronSession.previewGroup ? ovoronSession.previewGroup.pageItems.length : 0;
        // Detach preview from session: keep group on canvas as final result.
        ovoronSession.previewGroup = null;
        // Originals: delete or restore
        if (doDelete) {
            for (var i = 0; i < ovoronSession.targetShapes.length; i++) {
                try { ovoronSession.targetShapes[i].remove(); } catch (eR) {}
            }
        } else {
            for (var j = 0; j < ovoronSession.targetShapes.length; j++) {
                try { ovoronSession.targetShapes[j].hidden = false; } catch (eS) {}
            }
        }
        ovoronSession.active = false;
        ovoronSession.targetShapes = [];
        app.redraw();
        return ovoronResponse(true, "Applied " + n + " object(s).", { items: n });
    } catch (error) {
        ovoronLog(error.message || String(error));
        return ovoronResponse(false, error.message || String(error));
    }
}

function ovoronCancel() {
    try {
        if (!ovoronSession.active) return ovoronResponse(true, "No active session.", { wasActive: false });
        ovoronResetSession(true, true);
        app.redraw();
        return ovoronResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        ovoronLog(error.message || String(error));
        return ovoronResponse(false, error.message || String(error));
    }
}

function ovoronBake() {
    try {
        if (!ovoronSession.active) return ovoronResponse(false, "No active session.");
        if (!ovoronSession.previewGroup) return ovoronResponse(false, "Preview is empty.");
        var doc = app.activeDocument;
        var sym = doc.symbols.add(ovoronSession.previewGroup);
        var stamp = String(Date.now());
        sym.name = "O_Voron_Baked_" + stamp.substring(stamp.length - 5);
        app.redraw();
        return ovoronResponse(true, "Baked '" + sym.name + "'.", { symbolName: sym.name });
    } catch (error) {
        ovoronLog(error.message || String(error));
        return ovoronResponse(false, error.message || String(error));
    }
}

function ovoronHandshake() {
    try {
        return ovoronResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!ovoronSession.active
        });
    } catch (error) {
        return ovoronResponse(false, error.message || String(error));
    }
}

// ---------- PRESETS ----------

function ovoronReadPresetsFromDisk() {
    var list = [];
    if (OVORON_PRESET_FILE.exists) {
        try {
            OVORON_PRESET_FILE.open("r");
            var content = OVORON_PRESET_FILE.read();
            OVORON_PRESET_FILE.close();
            var parsed = eval("(" + content + ")");
            if (parsed && parsed.length) {
                for (var i = 0; i < parsed.length; i++) {
                    var p = parsed[i];
                    if (p && p.name) list.push(p);
                }
            }
        } catch (e) {
            ovoronLog("Read presets: " + e.message);
        }
    }
    return list;
}

function ovoronWritePresetsToDisk(list) {
    try {
        var lines = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === "Default") continue; // never persist Default
            lines.push(list[i]);
        }
        OVORON_PRESET_FILE.open("w");
        OVORON_PRESET_FILE.write(ovoronToJson(lines));
        OVORON_PRESET_FILE.close();
        return true;
    } catch (e) {
        ovoronLog("Write presets: " + e.message);
        return false;
    }
}

function ovoronGetAllPresets() {
    var list = [OVORON_DEFAULT_PRESET];
    var disk = ovoronReadPresetsFromDisk();
    for (var i = 0; i < disk.length; i++) {
        if (disk[i].name === "Default") continue;
        list.push(disk[i]);
    }
    return list;
}

function ovoronListPresets() {
    try {
        var list = ovoronGetAllPresets();
        return ovoronResponse(true, "OK.", { presets: list });
    } catch (error) {
        return ovoronResponse(false, error.message || String(error));
    }
}

function ovoronSavePreset(encodedConfig) {
    try {
        var raw = ovoronParseConfig(encodedConfig);
        var name = String(raw.name || "");
        name = name.replace(/^\s+|\s+$/g, "");
        if (!name) throw new Error("Preset name is empty.");
        if (name === "Default") throw new Error("Cannot overwrite the Default preset.");
        var preset = {
            name: name,
            metric: parseInt(raw.metric, 10) || 0,
            seed: parseInt(raw.seed, 10) || 0,
            density: parseInt(raw.density, 10) || 0,
            randomness: parseFloat(raw.randomness) || 0,
            block: parseInt(raw.block, 10) || 8,
            steps: parseInt(raw.steps, 10) || 0,
            outline: !!raw.outline,
            outWidth: parseInt(raw.outWidth, 10) || 1,
            bounds: !!raw.bounds,
            origCol: !!raw.origCol,
            delPar: !!raw.delPar
        };
        var disk = ovoronReadPresetsFromDisk();
        var found = false;
        for (var i = 0; i < disk.length; i++) {
            if (disk[i].name === name) {
                disk[i] = preset;
                found = true;
                break;
            }
        }
        if (!found) disk.push(preset);
        if (!ovoronWritePresetsToDisk(disk)) throw new Error("Could not write presets file.");
        var list = ovoronGetAllPresets();
        return ovoronResponse(true, "Preset saved.", { presets: list });
    } catch (error) {
        ovoronLog(error.message || String(error));
        return ovoronResponse(false, error.message || String(error));
    }
}

function ovoronDeletePreset(encodedConfig) {
    try {
        var raw = ovoronParseConfig(encodedConfig);
        var name = String(raw.name || "");
        if (!name) throw new Error("Preset name is empty.");
        if (name === "Default") throw new Error("Cannot delete the Default preset.");
        var disk = ovoronReadPresetsFromDisk();
        var filtered = [];
        for (var i = 0; i < disk.length; i++) {
            if (disk[i].name !== name) filtered.push(disk[i]);
        }
        if (!ovoronWritePresetsToDisk(filtered)) throw new Error("Could not write presets file.");
        var list = ovoronGetAllPresets();
        return ovoronResponse(true, "Preset deleted.", { presets: list });
    } catch (error) {
        ovoronLog(error.message || String(error));
        return ovoronResponse(false, error.message || String(error));
    }
}
