#target illustrator
#targetengine "OAutoShapeCEP"

var OAUTOSHAPE_DEBUG = false;
var oautoshapeDebugLog = new File(Folder.desktop + "/oautoshape_cep_log.txt");

function oautoshapeLog(message) {
    if (!OAUTOSHAPE_DEBUG) return;
    try {
        oautoshapeDebugLog.open("a");
        oautoshapeDebugLog.writeln("[" + new Date().toUTCString() + "] " + message);
        oautoshapeDebugLog.close();
    } catch (e) {}
}

function oautoshapeEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oautoshapeToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oautoshapeEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oautoshapeToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oautoshapeToJson(String(key)) + ":" + oautoshapeToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oautoshapeResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oautoshapeToJson(payload);
}

function oautoshapeParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

// ---------- GEOMETRY HELPERS ----------

function oautoshapeGetDistance(p1, p2) {
    var dx = p2[0] - p1[0];
    var dy = p2[1] - p1[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function oautoshapeGetVector(p1, p2) {
    var dx = p2[0] - p1[0];
    var dy = p2[1] - p1[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return null;
    return [dx / len, dy / len];
}

function oautoshapePointLineDistance(p, l1, l2) {
    var numerator = Math.abs((l2[0] - l1[0]) * (l1[1] - p[1]) - (l1[0] - p[0]) * (l2[1] - l1[1]));
    var denominator = Math.sqrt(Math.pow(l2[0] - l1[0], 2) + Math.pow(l2[1] - l1[1], 2));
    if (denominator === 0) return 0;
    return numerator / denominator;
}

function oautoshapeGetPolygonArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    return Math.abs(a) / 2;
}

function oautoshapeGetCentroid(points) {
    var sumX = 0, sumY = 0;
    for (var i = 0; i < points.length; i++) {
        sumX += points[i][0];
        sumY += points[i][1];
    }
    return [sumX / points.length, sumY / points.length];
}

// ---------- PATH ANALYSIS ----------

function oautoshapeDecimatePath(pts, diag) {
    var pStart = pts[0].anchor;
    var pEnd = pts[pts.length - 1].anchor;
    var simplePts = [pStart];
    var minStep = Math.max(diag * 0.05, 2);
    for (var i = 1; i < pts.length - 1; i++) {
        if (oautoshapeGetDistance(simplePts[simplePts.length - 1], pts[i].anchor) > minStep) {
            simplePts.push(pts[i].anchor);
        }
    }
    if (oautoshapeGetDistance(simplePts[simplePts.length - 1], pEnd) > minStep * 0.5) {
        simplePts.push(pEnd);
    }
    return simplePts;
}

function oautoshapeDetectCorners(simplePts) {
    var corners = [simplePts[0]];
    for (var k = 1; k < simplePts.length - 1; k++) {
        var v1 = oautoshapeGetVector(simplePts[k - 1], simplePts[k]);
        var v2 = oautoshapeGetVector(simplePts[k], simplePts[k + 1]);
        if (v1 && v2) {
            var dot = v1[0] * v2[0] + v1[1] * v2[1];
            if (dot < 0.5) corners.push(simplePts[k]);
        }
    }
    corners.push(simplePts[simplePts.length - 1]);
    return corners;
}

function oautoshapeHasRoundedCorners(path, diag) {
    var pts = path.pathPoints;
    var hasSignificantHandles = 0;
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var handleLength = oautoshapeGetDistance(p.anchor, p.leftDirection) + oautoshapeGetDistance(p.anchor, p.rightDirection);
        if (handleLength > diag * 0.05) hasSignificantHandles++;
    }
    return hasSignificantHandles >= 4;
}

function oautoshapeEstimateCornerRadius(path, diag) {
    var pts = path.pathPoints;
    var totalHandleLength = 0;
    var count = 0;
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var handleLength = (oautoshapeGetDistance(p.anchor, p.leftDirection) + oautoshapeGetDistance(p.anchor, p.rightDirection)) / 2;
        if (handleLength > 0) {
            totalHandleLength += handleLength;
            count++;
        }
    }
    return count > 0 ? totalHandleLength / count : diag * 0.1;
}

function oautoshapeIsStraightLine(path) {
    var pts = path.pathPoints;
    if (pts.length < 2) return false;
    var pStart = pts[0].anchor;
    var pEnd = pts[pts.length - 1].anchor;
    var lineLength = oautoshapeGetDistance(pStart, pEnd);
    if (lineLength < 1) return false;
    var maxDeviation = 0;
    for (var i = 1; i < pts.length - 1; i++) {
        var d = oautoshapePointLineDistance(pts[i].anchor, pStart, pEnd);
        if (d > maxDeviation) maxDeviation = d;
    }
    return (maxDeviation / lineLength < 0.05);
}

function oautoshapeIsStarShape(corners, center) {
    if (corners.length < 5) return false;
    var distances = [];
    for (var i = 0; i < corners.length; i++) {
        distances.push(oautoshapeGetDistance(center, corners[i]));
    }
    var sorted = distances.slice();
    sorted.sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var innerCount = 0, outerCount = 0;
    for (var j = 0; j < distances.length; j++) {
        if (distances[j] < median * 0.8) innerCount++;
        else if (distances[j] > median * 1.2) outerCount++;
    }
    return (Math.abs(innerCount - outerCount) <= 2);
}

// ---------- SHAPE GENERATORS ----------

function oautoshapeCreatePolygon(parent, center, radius, sides) {
    var shape = parent.pathItems.add();
    var angleStep = (2 * Math.PI) / sides;
    var startAngle = Math.PI / 2;
    for (var i = 0; i < sides; i++) {
        var angle = startAngle + i * angleStep;
        var pt = shape.pathPoints.add();
        pt.anchor = [
            center[0] + radius * Math.cos(angle),
            center[1] + radius * Math.sin(angle)
        ];
        pt.leftDirection = pt.anchor;
        pt.rightDirection = pt.anchor;
    }
    shape.closed = true;
    return shape;
}

function oautoshapeCreateStar(parent, center, radius, points) {
    var shape = parent.pathItems.add();
    var innerRadius = radius * 0.4;
    var angleStep = (2 * Math.PI) / (points * 2);
    var startAngle = Math.PI / 2;
    for (var i = 0; i < points * 2; i++) {
        var angle = startAngle + i * angleStep;
        var r = (i % 2 === 0) ? radius : innerRadius;
        var pt = shape.pathPoints.add();
        pt.anchor = [
            center[0] + r * Math.cos(angle),
            center[1] + r * Math.sin(angle)
        ];
        pt.leftDirection = pt.anchor;
        pt.rightDirection = pt.anchor;
    }
    shape.closed = true;
    return shape;
}

function oautoshapeCreateRectGrid(parent, bounds, rowsIn, colsIn, rowsEn, colsEn) {
    var group = parent.groupItems.add();
    var left = bounds[0], top = bounds[1], right = bounds[2], bottom = bounds[3];
    var w = Math.abs(right - left);
    var h = Math.abs(top - bottom);
    var finalRows = rowsIn;
    var finalCols = colsIn;
    var cellSize;
    if (rowsEn && !colsEn) {
        if (finalRows < 1) finalRows = 1;
        cellSize = h / finalRows;
        finalCols = Math.round(w / cellSize);
        if (finalCols < 1) finalCols = 1;
    } else if (!rowsEn && colsEn) {
        if (finalCols < 1) finalCols = 1;
        cellSize = w / finalCols;
        finalRows = Math.round(h / cellSize);
        if (finalRows < 1) finalRows = 1;
    } else if (!rowsEn && !colsEn) {
        finalRows = 1;
        finalCols = 1;
    }
    group.pathItems.rectangle(top, left, w, h);
    for (var i = 1; i < finalCols; i++) {
        var x = left + (w / finalCols) * i;
        var vLine = group.pathItems.add();
        vLine.setEntirePath([[x, top], [x, bottom]]);
    }
    for (var j = 1; j < finalRows; j++) {
        var y = top - (h / finalRows) * j;
        var hLine = group.pathItems.add();
        hLine.setEntirePath([[left, y], [right, y]]);
    }
    return group;
}

function oautoshapeCreatePolarGrid(parent, cx, cy, radius, concentric, radial) {
    var group = parent.groupItems.add();
    for (var i = 1; i <= concentric; i++) {
        var r = (radius / concentric) * i;
        group.pathItems.ellipse(cy + r, cx - r, r * 2, r * 2);
    }
    for (var j = 0; j < radial; j++) {
        var angle = (2 * Math.PI / radial) * j;
        var x = cx + radius * Math.cos(angle);
        var y = cy + radius * Math.sin(angle);
        var line = group.pathItems.add();
        line.setEntirePath([[cx, cy], [x, y]]);
    }
    return group;
}

// ---------- DETECTION ----------

function oautoshapeFindBestFallback(guessedType, activeTypes, isClosed, aspectRatio, cornerCount) {
    var closedFallbacks = [
        ["Circle", "Ellipse", "Square", "Rectangle", "RoundedRectangle"],
        ["Ellipse", "Circle", "RoundedRectangle", "Rectangle", "Square"],
        ["Square", "Rectangle", "Circle", "Ellipse", "RoundedRectangle"],
        ["Rectangle", "Square", "RoundedRectangle", "Ellipse", "Circle"],
        ["RoundedRectangle", "Rectangle", "Square", "Ellipse", "Circle"],
        ["Triangle", "Hexagon", "Polygon", "Circle"],
        ["Hexagon", "Polygon", "Triangle", "Circle"],
        ["Star", "Hexagon", "Polygon", "Triangle"],
        ["Polygon", "Hexagon", "Star", "Circle"]
    ];
    var openFallbacks = [
        ["Line", "Polyline", "Arc"],
        ["Polyline", "Line", "Arc"],
        ["Arc", "Polyline", "Line"]
    ];
    var fallbackList = [];
    if (isClosed) {
        if (guessedType === "Circle") fallbackList = closedFallbacks[0];
        else if (guessedType === "Ellipse") fallbackList = closedFallbacks[1];
        else if (guessedType === "Square") fallbackList = closedFallbacks[2];
        else if (guessedType === "Rectangle") fallbackList = closedFallbacks[3];
        else if (guessedType === "RoundedRectangle") fallbackList = closedFallbacks[4];
        else if (guessedType === "Triangle") fallbackList = closedFallbacks[5];
        else if (guessedType === "Hexagon") fallbackList = closedFallbacks[6];
        else if (guessedType === "Star") fallbackList = closedFallbacks[7];
        else if (guessedType === "Polygon") fallbackList = closedFallbacks[8];
        else fallbackList = (aspectRatio > 0.9) ? closedFallbacks[0] : closedFallbacks[3];
    } else {
        if (guessedType === "Line") fallbackList = openFallbacks[0];
        else if (guessedType === "Polyline") fallbackList = openFallbacks[1];
        else if (guessedType === "Arc") fallbackList = openFallbacks[2];
        else fallbackList = openFallbacks[2];
    }
    for (var i = 0; i < fallbackList.length; i++) {
        if (activeTypes[fallbackList[i]] && fallbackList[i] !== "RectangularGrid" && fallbackList[i] !== "PolarGrid") {
            return fallbackList[i];
        }
    }
    for (var key in activeTypes) {
        if (activeTypes[key] && key !== "RectangularGrid" && key !== "PolarGrid") return key;
    }
    return "Unknown";
}

function oautoshapeGuessShape(item, activeTypes) {
    var activeList = [];
    for (var key in activeTypes) {
        if (activeTypes[key]) activeList.push(key);
    }
    var bounds = item.geometricBounds;
    var w = Math.abs(bounds[2] - bounds[0]);
    var h = Math.abs(bounds[1] - bounds[3]);

    if (item.typename === "GroupItem" || item.typename === "CompoundPathItem") {
        if (activeList.length === 1) {
            var dummyCorners = [[bounds[0], bounds[3]], [bounds[2], bounds[3]], [bounds[0] + w / 2, bounds[1]]];
            return { type: activeList[0], corners: dummyCorners, metadata: {} };
        }
        return { type: "Unknown", corners: [] };
    }

    var pts = item.pathPoints;
    if (!pts || pts.length < 2) return { type: "Unknown", corners: [] };

    var pStart = pts[0].anchor;
    var pEnd = pts[pts.length - 1].anchor;
    var diag = Math.sqrt(w * w + h * h);
    var distStartEnd = oautoshapeGetDistance(pStart, pEnd);
    var aspectRatio = (w > 0 && h > 0) ? Math.min(w, h) / Math.max(w, h) : 0;
    var isEffectivelyClosed = item.closed || (distStartEnd < (diag * 0.35));

    var simplePts = oautoshapeDecimatePath(pts, diag);
    var corners = oautoshapeDetectCorners(simplePts);

    var realCorners = 0;
    var ptsCopy = simplePts.slice();
    if (isEffectivelyClosed && ptsCopy.length > 2 && oautoshapeGetDistance(ptsCopy[0], ptsCopy[ptsCopy.length - 1]) < diag * 0.35) {
        ptsCopy.pop();
    }
    var rcLen = ptsCopy.length;
    var c, v1, v2;
    if (isEffectivelyClosed && rcLen >= 3) {
        for (c = 0; c < rcLen; c++) {
            var prev = ptsCopy[(c - 1 + rcLen) % rcLen];
            var curr = ptsCopy[c];
            var next = ptsCopy[(c + 1) % rcLen];
            v1 = oautoshapeGetVector(prev, curr);
            v2 = oautoshapeGetVector(curr, next);
            if (v1 && v2 && (v1[0] * v2[0] + v1[1] * v2[1] < 0.75)) realCorners++;
        }
    } else {
        for (c = 1; c < rcLen - 1; c++) {
            v1 = oautoshapeGetVector(ptsCopy[c - 1], ptsCopy[c]);
            v2 = oautoshapeGetVector(ptsCopy[c], ptsCopy[c + 1]);
            if (v1 && v2 && (v1[0] * v2[0] + v1[1] * v2[1] < 0.75)) realCorners++;
        }
    }

    if (activeList.length === 1) {
        return { type: activeList[0], corners: corners, metadata: { sides: realCorners >= 3 ? realCorners : 5 } };
    }

    var guessedType = "Unknown";
    var metadata = {};
    if (isEffectivelyClosed) {
        var polyPts = [];
        for (var ip = 0; ip < pts.length; ip++) polyPts.push(pts[ip].anchor);
        var realArea = oautoshapeGetPolygonArea(polyPts);
        var areaRatio = (w > 0 && h > 0) ? realArea / (w * h) : 0;
        var cx = bounds[0] + w / 2;
        var cy = bounds[3] + h / 2;

        if (realCorners >= 5 && realCorners <= 20) {
            if (oautoshapeIsStarShape(corners, [cx, cy])) {
                guessedType = "Star";
                metadata.starPoints = Math.floor(realCorners / 2);
            }
        }
        if (guessedType === "Unknown") {
            if (realCorners === 3) {
                guessedType = "Triangle";
            } else if (realCorners === 4) {
                if (areaRatio > 0.75) {
                    if (oautoshapeHasRoundedCorners(item, diag)) {
                        guessedType = "RoundedRectangle";
                        metadata.cornerRadius = oautoshapeEstimateCornerRadius(item, diag);
                    } else if (aspectRatio > 0.9) {
                        guessedType = "Square";
                    } else {
                        guessedType = "Rectangle";
                    }
                }
            } else if (realCorners === 6) {
                guessedType = "Hexagon";
            } else if (realCorners >= 5) {
                guessedType = "Polygon";
                metadata.sides = realCorners;
            }
        }
        if (guessedType === "Unknown") {
            if (areaRatio > 0.82) guessedType = (aspectRatio > 0.9) ? "Square" : "Rectangle";
            else if (areaRatio > 0.65) guessedType = (aspectRatio > 0.9) ? "Circle" : "Ellipse";
            else if (areaRatio < 0.6) guessedType = "Triangle";
        }
    } else {
        if (oautoshapeIsStraightLine(item)) guessedType = "Line";
        else if (realCorners >= 1) guessedType = "Polyline";
        else guessedType = "Arc";
    }

    if (activeTypes[guessedType]) {
        return { type: guessedType, corners: corners, metadata: metadata };
    }
    var fallbackType = oautoshapeFindBestFallback(guessedType, activeTypes, isEffectivelyClosed, aspectRatio, realCorners);
    return { type: fallbackType, corners: corners, metadata: metadata };
}

// ---------- COLLECTION ----------

function oautoshapeExtractItems(items, arr, isSolo) {
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.typename === "PathItem") {
            arr.push(item);
        } else if (item.typename === "GroupItem" || item.typename === "CompoundPathItem") {
            if (isSolo) {
                arr.push(item);
            } else {
                oautoshapeExtractItems(item.pageItems || item.pathItems, arr, isSolo);
            }
        }
    }
}

function oautoshapeGetFirstPath(obj) {
    if (obj.typename === "PathItem") return obj;
    if (obj.typename === "GroupItem") {
        for (var i = 0; i < obj.pageItems.length; i++) {
            var p = oautoshapeGetFirstPath(obj.pageItems[i]);
            if (p) return p;
        }
    }
    if (obj.typename === "CompoundPathItem") {
        if (obj.pathItems.length > 0) return obj.pathItems[0];
    }
    return null;
}

// ---------- MAIN ----------

function oautoshapeProcess(activeTypes, rectRows, rectCols, rectRowsEn, rectColsEn, polarRings, polarRays, keepOriginal) {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    var doc = app.activeDocument;
    var sel = doc.selection;
    if (!sel || sel.length === 0) throw new Error("Select at least one drawn path.");

    var activeList = [];
    for (var key in activeTypes) {
        if (activeTypes[key]) activeList.push(key);
    }
    if (activeList.length === 0) throw new Error("Enable at least one shape type.");

    var isSolo = (activeList.length === 1);
    var pathsToProcess = [];
    oautoshapeExtractItems(sel, pathsToProcess, isSolo);
    if (pathsToProcess.length === 0) throw new Error("No usable paths in selection.");

    var newShapesToConvert = [];
    var convertedCount = 0;
    doc.selection = null;

    for (var i = pathsToProcess.length - 1; i >= 0; i--) {
        var item = pathsToProcess[i];

        var isFilled = false;
        var fColor = null;
        var isStroked = true;
        var sColor = item.layer.color;
        var sWidth = 1;

        var refPath = oautoshapeGetFirstPath(item);
        if (refPath) {
            isFilled = refPath.filled;
            if (isFilled) fColor = refPath.fillColor;
            isStroked = refPath.stroked;
            if (isStroked) {
                sColor = refPath.strokeColor;
                sWidth = refPath.strokeWidth;
            }
        }

        var shapeInfo = oautoshapeGuessShape(item, activeTypes);
        var shapeType = shapeInfo.type;
        var corners = shapeInfo.corners;
        var metadata = shapeInfo.metadata || {};
        if (shapeType === "Unknown") continue;

        var bounds = item.geometricBounds;
        var w = Math.abs(bounds[2] - bounds[0]);
        var h = Math.abs(bounds[1] - bounds[3]);
        var cx = bounds[0] + w / 2;
        var cy = bounds[3] + h / 2;

        var newShape = null;
        var isNewShapeGroup = false;
        var safeToConvertToLiveShape = false;

        if (shapeType === "RectangularGrid") {
            newShape = oautoshapeCreateRectGrid(item.parent, bounds, rectRows, rectCols, rectRowsEn, rectColsEn);
            isNewShapeGroup = true;
        } else if (shapeType === "PolarGrid") {
            var radius = Math.max(w, h) / 2;
            newShape = oautoshapeCreatePolarGrid(item.parent, cx, cy, radius, polarRings, polarRays);
            isNewShapeGroup = true;
        } else if (shapeType === "Circle") {
            var rCir = (w + h) / 4;
            newShape = item.parent.pathItems.ellipse(cy + rCir, cx - rCir, rCir * 2, rCir * 2);
            safeToConvertToLiveShape = true;
        } else if (shapeType === "Ellipse") {
            newShape = item.parent.pathItems.ellipse(bounds[1], bounds[0], w, h);
            safeToConvertToLiveShape = true;
        } else if (shapeType === "Square") {
            var size = Math.max(w, h);
            newShape = item.parent.pathItems.rectangle(cy + size / 2, cx - size / 2, size, size);
            safeToConvertToLiveShape = true;
        } else if (shapeType === "Rectangle") {
            newShape = item.parent.pathItems.rectangle(bounds[1], bounds[0], w, h);
            safeToConvertToLiveShape = true;
        } else if (shapeType === "RoundedRectangle") {
            var rRnd = metadata.cornerRadius || Math.min(w, h) * 0.15;
            newShape = item.parent.pathItems.roundedRectangle(bounds[1], bounds[0], w, h, rRnd, rRnd);
            safeToConvertToLiveShape = true;
        } else if (shapeType === "Triangle") {
            var tRad = Math.max(w, h) / 2;
            newShape = oautoshapeCreatePolygon(item.parent, [cx, cy], tRad, 3);
            if (item.typename === "PathItem") {
                var ptTop = 0;
                var pts = item.pathPoints;
                for (var p = 0; p < pts.length; p++) {
                    if (pts[p].anchor[1] > cy) ptTop++;
                }
                if (ptTop >= pts.length * 0.45) newShape.rotate(180);
            }
        } else if (shapeType === "Hexagon" || shapeType === "Polygon") {
            var sides = (shapeType === "Hexagon") ? 6 : (metadata.sides || 5);
            var pRad = Math.max(w, h) / 2;
            newShape = oautoshapeCreatePolygon(item.parent, [cx, cy], pRad, sides);
        } else if (shapeType === "Star") {
            var points = metadata.starPoints || 5;
            var sRad = Math.max(w, h) / 2;
            newShape = oautoshapeCreateStar(item.parent, [cx, cy], sRad, points);
        } else if (shapeType === "Line" && item.typename === "PathItem") {
            newShape = item.parent.pathItems.add();
            var ptsLine = item.pathPoints;
            newShape.setEntirePath([ptsLine[0].anchor, ptsLine[ptsLine.length - 1].anchor]);
            newShape.closed = false;
            safeToConvertToLiveShape = true;
        } else if (shapeType === "Polyline" && item.typename === "PathItem") {
            newShape = item.parent.pathItems.add();
            newShape.setEntirePath(corners);
            newShape.closed = false;
        } else if (shapeType === "Arc" && item.typename === "PathItem") {
            newShape = item.parent.pathItems.add();
            var arcPts = item.pathPoints;
            var pStart = arcPts[0].anchor;
            var pEnd = arcPts[arcPts.length - 1].anchor;
            var maxDist = -1;
            var pMid = arcPts[Math.floor(arcPts.length / 2)].anchor;
            for (var k = 1; k < arcPts.length - 1; k++) {
                var d = oautoshapePointLineDistance(arcPts[k].anchor, pStart, pEnd);
                if (d > maxDist) { maxDist = d; pMid = arcPts[k].anchor; }
            }
            newShape.setEntirePath([pStart, pMid, pEnd]);
            var vSE = oautoshapeGetVector(pStart, pEnd);
            if (vSE) {
                var dist = oautoshapeGetDistance(pStart, pEnd) * 0.27;
                newShape.pathPoints[1].leftDirection = [pMid[0] - vSE[0] * dist, pMid[1] - vSE[1] * dist];
                newShape.pathPoints[1].rightDirection = [pMid[0] + vSE[0] * dist, pMid[1] + vSE[1] * dist];
            }
        }

        if (!newShape) continue;

        if (isNewShapeGroup) {
            for (var g = 0; g < newShape.pathItems.length; g++) {
                newShape.pathItems[g].stroked = isStroked;
                if (isStroked) {
                    newShape.pathItems[g].strokeWidth = sWidth;
                    newShape.pathItems[g].strokeColor = sColor;
                }
                newShape.pathItems[g].filled = false;
            }
            if (isFilled && shapeType === "RectangularGrid") {
                newShape.pathItems[0].filled = true;
                newShape.pathItems[0].fillColor = fColor;
            }
        } else {
            newShape.stroked = isStroked;
            if (isStroked) {
                newShape.strokeWidth = sWidth;
                newShape.strokeColor = sColor;
            }
            newShape.filled = isFilled;
            if (isFilled) newShape.fillColor = fColor;
        }

        try {
            newShape.move(item, ElementPlacement.PLACEAFTER);
        } catch (e) {
            try { newShape.zOrder(ZOrderMethod.SENDTOBACK); } catch (e2) {}
        }

        if (!keepOriginal) {
            try { item.remove(); } catch (eRem) {}
        }

        if (safeToConvertToLiveShape) {
            newShapesToConvert.push(newShape);
        } else {
            try { newShape.selected = true; } catch (eSel) {}
        }
        convertedCount++;
    }

    if (newShapesToConvert.length > 0) {
        doc.selection = null;
        for (var ns = 0; ns < newShapesToConvert.length; ns++) {
            try { newShapesToConvert[ns].selected = true; } catch (eSelNS) {}
        }
        app.redraw();
        try { app.executeMenuCommand("ConvertToShape"); } catch (eMenu) {}
        app.redraw();
    }

    if (keepOriginal) {
        doc.selection = null;
        for (var r = 0; r < pathsToProcess.length; r++) {
            try { pathsToProcess[r].selected = true; } catch (ePathSel) {}
        }
    }

    return { converted: convertedCount, total: pathsToProcess.length };
}

function oautoshapeRun(encodedConfig) {
    try {
        var config = oautoshapeParseConfig(encodedConfig);
        var activeTypes = config.activeTypes || {};
        var rectRows = parseInt(config.rectRows, 10); if (!(rectRows >= 1)) rectRows = 5;
        var rectCols = parseInt(config.rectCols, 10); if (!(rectCols >= 1)) rectCols = 5;
        var polarRings = parseInt(config.polarRings, 10); if (!(polarRings >= 1)) polarRings = 5;
        var polarRays = parseInt(config.polarRays, 10); if (!(polarRays >= 1)) polarRays = 6;
        var rectRowsEn = !!config.rectRowsEn;
        var rectColsEn = !!config.rectColsEn;
        var keepOriginal = !!config.keepOriginal;

        var result = oautoshapeProcess(activeTypes, rectRows, rectCols, rectRowsEn, rectColsEn, polarRings, polarRays, keepOriginal);
        var msg = (keepOriginal ? "Created " : "Converted ") + result.converted + " of " + result.total + " path(s).";
        return oautoshapeResponse(true, msg, { converted: result.converted, total: result.total });
    } catch (error) {
        oautoshapeLog(error.message || String(error));
        return oautoshapeResponse(false, error.message || String(error));
    }
}

function oautoshapeHandshake() {
    try {
        return oautoshapeResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return oautoshapeResponse(false, error.message || String(error));
    }
}
