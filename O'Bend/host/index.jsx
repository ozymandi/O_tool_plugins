#target illustrator
#targetengine "OBendCEP"

var OBEND_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/obend_cep_log.txt");

function obendLog(message) {
    if (!OBEND_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function obendEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function obendToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + obendEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(obendToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(obendToJson(String(key)) + ":" + obendToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function obendResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return obendToJson(payload);
}

function obendParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function obendNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function obendNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function obendValidateConfig(config) {
    var validAxis = { horizontal: 1, vertical: 1, custom: 1 };
    var validDir = { normal: 1, reverse: 1 };
    var normalized = {
        axis: validAxis.hasOwnProperty(config.axis) ? config.axis : "horizontal",
        direction: validDir.hasOwnProperty(config.direction) ? config.direction : "normal",
        customAngle: obendNormalizeNumber(config.customAngle, 0),
        subdivisions: obendNormalizeInteger(config.subdivisions, 0),
        bendAngle: obendNormalizeNumber(config.bendAngle, 360),
        limit: obendNormalizeNumber(config.limit, 100),
        center: obendNormalizeNumber(config.center, 50),
        offset: obendNormalizeNumber(config.offset, 0),
        radialExpand: obendNormalizeNumber(config.radialExpand, 0),
        axisShift: obendNormalizeNumber(config.axisShift, 0)
    };
    if (normalized.subdivisions < 0) normalized.subdivisions = 0;
    if (normalized.subdivisions > 7) normalized.subdivisions = 7;
    if (normalized.limit < 0) normalized.limit = 0;
    if (normalized.limit > 100) normalized.limit = 100;
    if (normalized.center < 0) normalized.center = 0;
    if (normalized.center > 100) normalized.center = 100;
    return normalized;
}

function obendEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function obendGetGlobalBounds(items, acc) {
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.typename === "PathItem") {
            var b = item.geometricBounds;
            if (b[0] < acc.minX) acc.minX = b[0];
            if (b[1] > acc.maxY) acc.maxY = b[1];
            if (b[2] > acc.maxX) acc.maxX = b[2];
            if (b[3] < acc.minY) acc.minY = b[3];
        } else if (item.typename === "GroupItem") {
            obendGetGlobalBounds(item.pageItems, acc);
        } else if (item.typename === "CompoundPathItem") {
            obendGetGlobalBounds(item.pathItems, acc);
        }
    }
}

function obendBackup(items, dataArr) {
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.typename === "PathItem") {
            var pathData = [];
            var pts = item.pathPoints;
            for (var j = 0; j < pts.length; j++) {
                var pt = pts[j];
                pathData.push({
                    a: [pt.anchor[0], pt.anchor[1]],
                    l: [pt.leftDirection[0], pt.leftDirection[1]],
                    r: [pt.rightDirection[0], pt.rightDirection[1]]
                });
            }
            dataArr.push({ type: "path", isClosed: item.closed, points: pathData, ref: item });
        } else if (item.typename === "GroupItem") {
            var grpData = [];
            dataArr.push({ type: "group", items: grpData, ref: item });
            obendBackup(item.pageItems, grpData);
        } else if (item.typename === "CompoundPathItem") {
            var compData = [];
            dataArr.push({ type: "compound", items: compData, ref: item });
            for (var j = 0; j < item.pathItems.length; j++) {
                var cPath = item.pathItems[j];
                var ppts = cPath.pathPoints;
                var ppdata = [];
                for (var k = 0; k < ppts.length; k++) {
                    var pp = ppts[k];
                    ppdata.push({
                        a: [pp.anchor[0], pp.anchor[1]],
                        l: [pp.leftDirection[0], pp.leftDirection[1]],
                        r: [pp.rightDirection[0], pp.rightDirection[1]]
                    });
                }
                compData.push({ type: "path", isClosed: cPath.closed, points: ppdata, ref: cPath });
            }
        }
    }
}

function obendClonePts(pts) {
    var arr = [];
    for (var i = 0; i < pts.length; i++) {
        arr.push({
            a: [pts[i].a[0], pts[i].a[1]],
            l: [pts[i].l[0], pts[i].l[1]],
            r: [pts[i].r[0], pts[i].r[1]]
        });
    }
    return arr;
}

function obendNormalizeHandles(pts, isClosed) {
    var loops = isClosed ? pts.length : pts.length - 1;
    for (var i = 0; i < loops; i++) {
        var pCurr = pts[i];
        var pNext = pts[(i + 1) % pts.length];
        var dx1 = pCurr.r[0] - pCurr.a[0];
        var dy1 = pCurr.r[1] - pCurr.a[1];
        var dx2 = pNext.l[0] - pNext.a[0];
        var dy2 = pNext.l[1] - pNext.a[1];
        if ((dx1 * dx1 + dy1 * dy1) < 0.01 && (dx2 * dx2 + dy2 * dy2) < 0.01) {
            pCurr.r = [pCurr.a[0] + (pNext.a[0] - pCurr.a[0]) / 3, pCurr.a[1] + (pNext.a[1] - pCurr.a[1]) / 3];
            pNext.l = [pCurr.a[0] + (pNext.a[0] - pCurr.a[0]) * 2 / 3, pCurr.a[1] + (pNext.a[1] - pCurr.a[1]) * 2 / 3];
        }
    }
    return pts;
}

function obendLerp(p1, p2, t) {
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
}

function obendSplitBezier(p1, p2, p3, p4) {
    var m1 = obendLerp(p1, p2, 0.5);
    var m2 = obendLerp(p2, p3, 0.5);
    var m3 = obendLerp(p3, p4, 0.5);
    var m4 = obendLerp(m1, m2, 0.5);
    var m5 = obendLerp(m2, m3, 0.5);
    var m6 = obendLerp(m4, m5, 0.5);
    return {
        leftSeg: { a1: p1, r1: m1, l2: m4, a2: m6 },
        rightSeg: { a1: m6, r1: m5, l2: m3, a2: p4 }
    };
}

function obendMathSubdivide(ptsData, isClosed, levels) {
    if (levels <= 0 || ptsData.length < 2) return ptsData;
    var currentPts = ptsData;
    for (var lvl = 0; lvl < levels; lvl++) {
        var newPts = [];
        var loops = isClosed ? currentPts.length : currentPts.length - 1;
        var prevSplitRightL2 = null;
        for (var i = 0; i < loops; i++) {
            var pCurr = currentPts[i];
            var pNext = currentPts[(i + 1) % currentPts.length];
            var split = obendSplitBezier(pCurr.a, pCurr.r, pNext.l, pNext.a);
            var leftHandle = (i === 0) ? pCurr.l : prevSplitRightL2;
            newPts.push({ a: pCurr.a, l: leftHandle, r: split.leftSeg.r1 });
            newPts.push({ a: split.leftSeg.a2, l: split.leftSeg.l2, r: split.rightSeg.r1 });
            prevSplitRightL2 = split.rightSeg.l2;
            if (i === loops - 1) {
                if (!isClosed) newPts.push({ a: pNext.a, l: prevSplitRightL2, r: pNext.r });
                else newPts[0].l = prevSplitRightL2;
            }
        }
        currentPts = newPts;
    }
    return currentPts;
}

function obendRotatePoint(x, y, cx, cy, angleDeg) {
    var rad = angleDeg * Math.PI / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    return [cos * (x - cx) - sin * (y - cy) + cx, sin * (x - cx) + cos * (y - cy) + cy];
}

function obendTransformPointPolar(p, ctx) {
    var locP = obendRotatePoint(p[0], p[1], ctx.gCx, ctx.gCy, -ctx.rotAngleDeg);
    var lx = locP[0];
    var ly = locP[1] - ctx.gCy - ctx.offset;
    var bendCenter = ctx.lMinX + ctx.lWidth * (ctx.centerPct / 100);
    var L = (ctx.lWidth / 2) * (ctx.limitPct / 100);
    var theta = ctx.bendAngleDeg * Math.PI / 180;
    var newX = lx;
    var newY = ly;

    if (Math.abs(theta) > 0.0001 && L > 0.1) {
        var actualR = (L * 2) / theta;
        var dx = lx - bendCenter;

        if (dx >= -L && dx <= L) {
            var alpha = dx / actualR;
            var turns = alpha / (2 * Math.PI);
            var dR = turns * ctx.spiralR;
            var dZ = turns * ctx.spiralZ;
            var currentR = actualR + dR;
            newX = bendCenter + dZ + (currentR - ly) * Math.sin(alpha);
            newY = actualR - (currentR - ly) * Math.cos(alpha);
        } else if (dx > L) {
            var aMax = L / actualR;
            var turnsMax = aMax / (2 * Math.PI);
            var dRMax = turnsMax * ctx.spiralR;
            var dZMax = turnsMax * ctx.spiralZ;
            var currR1 = actualR + dRMax;
            var edgeX1 = bendCenter + dZMax + (currR1 - ly) * Math.sin(aMax);
            var edgeY1 = actualR - (currR1 - ly) * Math.cos(aMax);
            newX = edgeX1 + (dx - L) * Math.cos(aMax);
            newY = edgeY1 + (dx - L) * Math.sin(aMax);
        } else {
            var aMin = -L / actualR;
            var turnsMin = aMin / (2 * Math.PI);
            var dRMin = turnsMin * ctx.spiralR;
            var dZMin = turnsMin * ctx.spiralZ;
            var currR2 = actualR + dRMin;
            var edgeX2 = bendCenter + dZMin + (currR2 - ly) * Math.sin(aMin);
            var edgeY2 = actualR - (currR2 - ly) * Math.cos(aMin);
            newX = edgeX2 + (dx - (-L)) * Math.cos(aMin);
            newY = edgeY2 + (dx - (-L)) * Math.sin(aMin);
        }
    }

    return obendRotatePoint(newX, newY + ctx.gCy + ctx.offset, ctx.gCx, ctx.gCy, ctx.rotAngleDeg);
}

function obendTransformHandle(hOrig, aOrig, aNew, ctx) {
    var vx = hOrig[0] - aOrig[0];
    var vy = hOrig[1] - aOrig[1];
    if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001) return [aNew[0], aNew[1]];

    var eps = 0.001;
    var pPlusX = obendTransformPointPolar([aOrig[0] + eps, aOrig[1]], ctx);
    var pMinusX = obendTransformPointPolar([aOrig[0] - eps, aOrig[1]], ctx);
    var pPlusY = obendTransformPointPolar([aOrig[0], aOrig[1] + eps], ctx);
    var pMinusY = obendTransformPointPolar([aOrig[0], aOrig[1] - eps], ctx);

    var jxx = (pPlusX[0] - pMinusX[0]) / (2 * eps);
    var jxy = (pPlusX[1] - pMinusX[1]) / (2 * eps);
    var jyx = (pPlusY[0] - pMinusY[0]) / (2 * eps);
    var jyy = (pPlusY[1] - pMinusY[1]) / (2 * eps);

    return [aNew[0] + vx * jxx + vy * jyx, aNew[1] + vx * jxy + vy * jyy];
}

function obendComputeLocalBounds(dataArray, ctx, acc) {
    for (var i = 0; i < dataArray.length; i++) {
        var d = dataArray[i];
        if (d.type === "path") {
            for (var j = 0; j < d.points.length; j++) {
                var p = obendRotatePoint(d.points[j].a[0], d.points[j].a[1], ctx.gCx, ctx.gCy, -ctx.rotAngleDeg);
                if (p[0] < acc.minX) acc.minX = p[0];
                if (p[0] > acc.maxX) acc.maxX = p[0];
            }
        } else if (d.type === "group" || d.type === "compound") {
            obendComputeLocalBounds(d.items, ctx, acc);
        }
    }
}

function obendApplyToPathItem(pathItem, pathData, ctx) {
    var clonedPts = obendClonePts(pathData.points);
    clonedPts = obendNormalizeHandles(clonedPts, pathData.isClosed);
    var subPts = obendMathSubdivide(clonedPts, pathData.isClosed, ctx.subLevel);

    var finalPts = [];
    for (var j = 0; j < subPts.length; j++) {
        var aOrig = subPts[j].a;
        var lOrig = subPts[j].l;
        var rOrig = subPts[j].r;
        var aNew = obendTransformPointPolar(aOrig, ctx);
        var lNew = obendTransformHandle(lOrig, aOrig, aNew, ctx);
        var rNew = obendTransformHandle(rOrig, aOrig, aNew, ctx);
        finalPts.push({ a: aNew, l: lNew, r: rNew });
    }

    var itemPts = pathItem.pathPoints;
    while (itemPts.length < finalPts.length) itemPts.add();
    while (itemPts.length > finalPts.length) itemPts[itemPts.length - 1].remove();

    for (var k = 0; k < finalPts.length; k++) {
        itemPts[k].anchor = finalPts[k].a;
        itemPts[k].leftDirection = finalPts[k].l;
        itemPts[k].rightDirection = finalPts[k].r;
    }
}

function obendApplyToData(dataArray, ctx) {
    for (var i = 0; i < dataArray.length; i++) {
        var d = dataArray[i];
        if (d.type === "path") {
            obendApplyToPathItem(d.ref, d, ctx);
        } else if (d.type === "group") {
            obendApplyToData(d.items, ctx);
        } else if (d.type === "compound") {
            for (var c = 0; c < d.items.length; c++) {
                obendApplyToPathItem(d.items[c].ref, d.items[c], ctx);
            }
        }
    }
}

function obendCountPaths(dataArray) {
    var count = 0;
    for (var i = 0; i < dataArray.length; i++) {
        var d = dataArray[i];
        if (d.type === "path") count++;
        else if (d.type === "group") count += obendCountPaths(d.items);
        else if (d.type === "compound") count += d.items.length;
    }
    return count;
}

function obendRun(encodedConfig) {
    try {
        var config = obendValidateConfig(obendParseConfig(encodedConfig));
        var doc = obendEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select an object to bend first.");
        }

        var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        obendGetGlobalBounds(sel, bounds);
        if (!isFinite(bounds.minX)) {
            throw new Error("Selection has no path geometry.");
        }
        var gCx = bounds.minX + (bounds.maxX - bounds.minX) / 2;
        var gCy = bounds.minY + (bounds.maxY - bounds.minY) / 2;

        var data = [];
        obendBackup(sel, data);

        var rotAng = 0;
        if (config.axis === "vertical") rotAng = 90;
        else if (config.axis === "custom") rotAng = config.customAngle;

        var dirMult = config.direction === "normal" ? 1 : -1;

        var ctx = {
            subLevel: config.subdivisions,
            rotAngleDeg: rotAng,
            bendAngleDeg: config.bendAngle * dirMult,
            limitPct: config.limit,
            centerPct: config.center,
            offset: config.offset,
            spiralR: config.radialExpand * dirMult,
            spiralZ: config.axisShift * dirMult,
            gCx: gCx,
            gCy: gCy,
            lMinX: 0,
            lWidth: 1
        };

        var localBounds = { minX: Infinity, maxX: -Infinity };
        obendComputeLocalBounds(data, ctx, localBounds);
        ctx.lMinX = localBounds.minX;
        ctx.lWidth = localBounds.maxX - localBounds.minX;
        if (!isFinite(ctx.lWidth) || ctx.lWidth === 0) ctx.lWidth = 1;

        obendApplyToData(data, ctx);
        app.redraw();

        var pathCount = obendCountPaths(data);
        return obendResponse(true, "Bent " + pathCount + " path(s).", { paths: pathCount });
    } catch (error) {
        obendLog(error.message || String(error));
        return obendResponse(false, error.message || String(error));
    }
}

function obendHandshake() {
    try {
        return obendResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return obendResponse(false, error.message || String(error));
    }
}
