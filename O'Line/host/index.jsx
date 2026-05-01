#target illustrator
#targetengine "OLineCEP"

var OLINE_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/oline_cep_log.txt");

var olineSession = {
    active: false,
    points: [],            // [[x, y], ...] anchor positions captured at LINE click
    previewGroup: null,    // GroupItem ref or null
    randomSeed: [],        // randomSeed[i][k] = target index for point i, take slot k
    seedTake: 0,           // current take size used for seed matrix
    seedN: 0,              // current points count for seed matrix
    tensionPool: [],       // per-edge tension random factors in [-1, 1]
    tensionPoolKey: null   // cache key for the pool — re-rolled when this changes
};

var OLINE_PREVIEW_NAME = "OLine_Preview";

function olineLog(message) {
    if (!OLINE_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function olineEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function olineToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + olineEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(olineToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(olineToJson(String(key)) + ":" + olineToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function olineResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return olineToJson(payload);
}

function olineParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function olineNormalizeNumber(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

function olineNormalizeInteger(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function olineNormalizeBoolean(value, fallback) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function olineEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

var VALID_TOPOLOGIES = {
    "all-to-all": 1, "chain": 1, "loop": 1, "step-skip": 1, "modular-skip": 1,
    "random": 1, "threshold-distance": 1, "radial": 1, "star-from-pivot": 1,
    "nearest": 1, "knn-mutual": 1, "convex-hull": 1, "mst": 1, "delaunay": 1
};

function olineValidateConfig(config) {
    var topology = VALID_TOPOLOGIES.hasOwnProperty(config.topology) ? config.topology : "nearest";
    var n = {
        topology: topology,
        bezier: olineNormalizeBoolean(config.bezier, false),
        tension: olineNormalizeNumber(config.tension, 30),
        tensionRandomness: olineNormalizeNumber(config.tensionRandomness, 0),
        strokeWidth: olineNormalizeNumber(config.strokeWidth, 0.5),
        take: olineNormalizeInteger(config.take, 2),
        skip: olineNormalizeInteger(config.skip, 0),
        distance: olineNormalizeNumber(config.distance, 100)
    };
    if (n.take < 1) n.take = 1;
    if (n.skip < 0) n.skip = 0;
    if (n.distance < 0) n.distance = 0;
    if (n.strokeWidth <= 0) n.strokeWidth = 0.1;
    if (n.tensionRandomness < 0) n.tensionRandomness = 0;
    if (n.tensionRandomness > 100) n.tensionRandomness = 100;
    return n;
}

// ---------- ANCHOR COLLECTION ----------

function olineCollectAnchors(item, out) {
    if (item.typename === "PathItem") {
        var pp = item.pathPoints;
        if (pp.length === 1) {
            out.push([pp[0].anchor[0], pp[0].anchor[1]]);
        } else {
            for (var k = 0; k < pp.length; k++) {
                if (pp[k].selected === PathPointSelection.ANCHORPOINT) {
                    out.push([pp[k].anchor[0], pp[k].anchor[1]]);
                }
            }
        }
    } else if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) {
            olineCollectAnchors(item.pageItems[i], out);
        }
    } else if (item.typename === "CompoundPathItem") {
        for (var j = 0; j < item.pathItems.length; j++) {
            olineCollectAnchors(item.pathItems[j], out);
        }
    }
}

// ---------- DRAWING ----------

function olineDrawStraight(p1, p2, parent, strokeWidth) {
    var l = parent.pathItems.add();
    l.setEntirePath([p1, p2]);
    l.filled = false;
    l.stroked = true;
    l.strokeWidth = strokeWidth;
}

function olineDrawBezier(p1, p2, parent, tension, strokeWidth) {
    var t = tension / 100;
    var dx = p2[0] - p1[0];
    var dy = p2[1] - p1[1];
    var midX = (p1[0] + p2[0]) / 2;
    var midY = (p1[1] + p2[1]) / 2;
    var perpX = -dy * t * 0.5;
    var perpY = dx * t * 0.5;
    var cp = [midX + perpX, midY + perpY];

    var curve = parent.pathItems.add();
    curve.setEntirePath([p1, p2]);
    curve.filled = false;
    curve.stroked = true;
    curve.strokeWidth = strokeWidth;

    curve.pathPoints[0].rightDirection = [
        p1[0] + (cp[0] - p1[0]) * 0.66,
        p1[1] + (cp[1] - p1[1]) * 0.66
    ];
    curve.pathPoints[1].leftDirection = [
        p2[0] + (cp[0] - p2[0]) * 0.66,
        p2[1] + (cp[1] - p2[1]) * 0.66
    ];
}

function olineDrawConnection(a, b, parent, useBezier, tension, strokeWidth) {
    if (useBezier) olineDrawBezier(a, b, parent, tension, strokeWidth);
    else olineDrawStraight(a, b, parent, strokeWidth);
}

// ---------- TOPOLOGY HELPERS ----------

function olineDistSq(a, b) {
    var dx = a[0] - b[0];
    var dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

function olineCentroid(points) {
    var sx = 0, sy = 0;
    for (var i = 0; i < points.length; i++) { sx += points[i][0]; sy += points[i][1]; }
    return [sx / points.length, sy / points.length];
}

function olineEnsureSeed(n, take) {
    var matrix = olineSession.randomSeed;
    if (olineSession.seedN !== n) {
        // Selection changed during session — fully reset seed
        matrix = [];
        for (var i = 0; i < n; i++) {
            var row = [];
            for (var k = 0; k < take; k++) row.push(Math.floor(Math.random() * n));
            matrix.push(row);
        }
        olineSession.randomSeed = matrix;
        olineSession.seedN = n;
        olineSession.seedTake = take;
        return matrix;
    }
    if (take > olineSession.seedTake) {
        // Extend each row with new entries (don't reshuffle existing)
        for (var i = 0; i < n; i++) {
            for (var k = olineSession.seedTake; k < take; k++) {
                matrix[i].push(Math.floor(Math.random() * n));
            }
        }
        olineSession.seedTake = take;
    }
    return matrix;
}

// Tension random pool: array of factors in [-1, 1], one per edge.
// Re-rolled only when the cache key changes (see olineRedrawPreview).
function olineEnsureTensionPool(neededCount, key) {
    if (olineSession.tensionPoolKey !== key) {
        var pool = [];
        for (var i = 0; i < neededCount; i++) pool.push(Math.random() * 2 - 1);
        olineSession.tensionPool = pool;
        olineSession.tensionPoolKey = key;
        return pool;
    }
    if (neededCount > olineSession.tensionPool.length) {
        for (var j = olineSession.tensionPool.length; j < neededCount; j++) {
            olineSession.tensionPool.push(Math.random() * 2 - 1);
        }
    }
    return olineSession.tensionPool;
}

function olineForceReseed(n, take) {
    var matrix = [];
    for (var i = 0; i < n; i++) {
        var row = [];
        for (var k = 0; k < take; k++) row.push(Math.floor(Math.random() * n));
        matrix.push(row);
    }
    olineSession.randomSeed = matrix;
    olineSession.seedN = n;
    olineSession.seedTake = take;
}

// ---------- TOPOLOGY ALGORITHMS ----------

function olineTopologyAllToAll(points) {
    var edges = [];
    var n = points.length;
    for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) edges.push([i, j]);
    }
    return edges;
}

function olineTopologyChain(points) {
    var edges = [];
    for (var i = 0; i < points.length - 1; i++) edges.push([i, i + 1]);
    return edges;
}

function olineTopologyLoop(points) {
    var edges = [];
    var n = points.length;
    for (var i = 0; i < n - 1; i++) edges.push([i, i + 1]);
    if (n >= 2) edges.push([n - 1, 0]);
    return edges;
}

function olineTopologyStepSkip(points, take, skip) {
    var edges = [];
    var n = points.length;
    var stride = take + skip;
    if (stride < 1) stride = 1;
    for (var i = 0; i < n - 1; i += stride) {
        for (var k = 0; k < take; k++) {
            if (i + k + 1 < n) edges.push([i + k, i + k + 1]);
        }
    }
    return edges;
}

function olineTopologyModularSkip(points, k) {
    var edges = [];
    var n = points.length;
    if (n < 2) return edges;
    var step = k;
    if (step < 1) step = 1;
    if (step >= n) step = step % n || 1;
    for (var i = 0; i < n; i++) {
        edges.push([i, (i + step) % n]);
    }
    return edges;
}

function olineTopologyRandom(points, take) {
    var edges = [];
    var n = points.length;
    var seed = olineEnsureSeed(n, take);
    for (var i = 0; i < n; i++) {
        for (var k = 0; k < take; k++) {
            var target = seed[i][k];
            if (target >= n) target = Math.floor(Math.random() * n);
            if (target !== i) edges.push([i, target]);
        }
    }
    return edges;
}

function olineTopologyThresholdDistance(points, distance) {
    var edges = [];
    var n = points.length;
    var threshSq = distance * distance;
    for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
            if (olineDistSq(points[i], points[j]) <= threshSq) edges.push([i, j]);
        }
    }
    return edges;
}

function olineTopologyRadial(points) {
    // Returns edges with virtual center as -1 — caller resolves via `centerPt`
    var edges = [];
    for (var i = 0; i < points.length; i++) edges.push([-1, i]);
    return edges;
}

function olineTopologyStarFromPivot(points) {
    var edges = [];
    for (var i = 1; i < points.length; i++) edges.push([0, i]);
    return edges;
}

function olineTopologyNearest(points, take) {
    var edges = [];
    var n = points.length;
    for (var i = 0; i < n; i++) {
        var dists = [];
        for (var j = 0; j < n; j++) {
            if (i !== j) dists.push({ idx: j, d: olineDistSq(points[i], points[j]) });
        }
        dists.sort(function (a, b) { return a.d - b.d; });
        for (var k = 0; k < take && k < dists.length; k++) {
            edges.push([i, dists[k].idx]);
        }
    }
    return edges;
}

function olineTopologyKnnMutual(points, take) {
    var n = points.length;
    var neighbors = [];
    for (var i = 0; i < n; i++) {
        var dists = [];
        for (var j = 0; j < n; j++) {
            if (i !== j) dists.push({ idx: j, d: olineDistSq(points[i], points[j]) });
        }
        dists.sort(function (a, b) { return a.d - b.d; });
        var arr = [];
        for (var k = 0; k < take && k < dists.length; k++) arr.push(dists[k].idx);
        neighbors.push(arr);
    }
    var edges = [];
    var seen = {};
    for (var i = 0; i < n; i++) {
        for (var x = 0; x < neighbors[i].length; x++) {
            var j = neighbors[i][x];
            var iInJ = false;
            for (var y = 0; y < neighbors[j].length; y++) {
                if (neighbors[j][y] === i) { iInJ = true; break; }
            }
            if (iInJ) {
                var key = (i < j ? i + "_" + j : j + "_" + i);
                if (!seen[key]) {
                    seen[key] = true;
                    edges.push([i, j]);
                }
            }
        }
    }
    return edges;
}

function olineTopologyConvexHull(points) {
    var n = points.length;
    if (n < 2) return [];
    if (n === 2) return [[0, 1]];

    // Find leftmost (then bottommost as tiebreaker)
    var leftmost = 0;
    for (var i = 1; i < n; i++) {
        if (points[i][0] < points[leftmost][0] ||
            (points[i][0] === points[leftmost][0] && points[i][1] < points[leftmost][1])) {
            leftmost = i;
        }
    }
    var hull = [];
    var p = leftmost, q;
    var safety = 0;
    do {
        hull.push(p);
        q = (p + 1) % n;
        for (var i2 = 0; i2 < n; i2++) {
            var dx1 = points[q][0] - points[p][0];
            var dy1 = points[q][1] - points[p][1];
            var dx2 = points[i2][0] - points[p][0];
            var dy2 = points[i2][1] - points[p][1];
            var cross = dx1 * dy2 - dy1 * dx2;
            if (cross < 0) q = i2;
        }
        p = q;
        safety++;
    } while (p !== leftmost && safety < n + 1);

    var edges = [];
    for (var h = 0; h < hull.length; h++) {
        edges.push([hull[h], hull[(h + 1) % hull.length]]);
    }
    return edges;
}

function olineTopologyMst(points) {
    var n = points.length;
    if (n < 2) return [];
    var inTree = [];
    for (var i = 0; i < n; i++) inTree.push(false);
    inTree[0] = true;
    var edges = [];
    for (var step = 0; step < n - 1; step++) {
        var bestI = -1, bestJ = -1, bestDist = Infinity;
        for (var i = 0; i < n; i++) {
            if (!inTree[i]) continue;
            for (var j = 0; j < n; j++) {
                if (inTree[j]) continue;
                var d = olineDistSq(points[i], points[j]);
                if (d < bestDist) {
                    bestDist = d;
                    bestI = i;
                    bestJ = j;
                }
            }
        }
        if (bestJ < 0) break;
        edges.push([bestI, bestJ]);
        inTree[bestJ] = true;
    }
    return edges;
}

function olineInCircumcircle(p, a, b, c) {
    var ax = a[0] - p[0], ay = a[1] - p[1];
    var bx = b[0] - p[0], by = b[1] - p[1];
    var cx = c[0] - p[0], cy = c[1] - p[1];
    var d = ax * (by * (cx * cx + cy * cy) - cy * (bx * bx + by * by))
          - ay * (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by))
          + (ax * ax + ay * ay) * (bx * cy - by * cx);
    return d > 0;
}

function olineTopologyDelaunay(points) {
    var n = points.length;
    if (n < 3) {
        if (n === 2) return [[0, 1]];
        return [];
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < n; i++) {
        if (points[i][0] < minX) minX = points[i][0];
        if (points[i][0] > maxX) maxX = points[i][0];
        if (points[i][1] < minY) minY = points[i][1];
        if (points[i][1] > maxY) maxY = points[i][1];
    }
    var dx = maxX - minX || 1, dy = maxY - minY || 1;
    var dmax = Math.max(dx, dy) * 10;
    var midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;

    var allPts = points.slice();
    allPts.push([midX - dmax, midY - dmax]);
    allPts.push([midX, midY + dmax * 2]);
    allPts.push([midX + dmax, midY - dmax]);
    var sA = n, sB = n + 1, sC = n + 2;

    var triangles = [[sA, sB, sC]];

    for (var i = 0; i < n; i++) {
        var p = allPts[i];
        var bad = [];
        for (var t = 0; t < triangles.length; t++) {
            var tri = triangles[t];
            if (olineInCircumcircle(p, allPts[tri[0]], allPts[tri[1]], allPts[tri[2]])) {
                bad.push(t);
            }
        }
        var edgeMap = {};
        for (var bi = 0; bi < bad.length; bi++) {
            var btri = triangles[bad[bi]];
            var triEdges = [
                [btri[0], btri[1]],
                [btri[1], btri[2]],
                [btri[2], btri[0]]
            ];
            for (var ei = 0; ei < 3; ei++) {
                var ek = Math.min(triEdges[ei][0], triEdges[ei][1]) + "_" + Math.max(triEdges[ei][0], triEdges[ei][1]);
                if (edgeMap[ek]) edgeMap[ek].count++;
                else edgeMap[ek] = { v: triEdges[ei], count: 1 };
            }
        }
        // Remove bad triangles in reverse
        bad.sort(function (a, b) { return b - a; });
        for (var bj = 0; bj < bad.length; bj++) triangles.splice(bad[bj], 1);
        // Add new triangles for each unique boundary edge
        for (var ekey in edgeMap) {
            if (edgeMap.hasOwnProperty(ekey) && edgeMap[ekey].count === 1) {
                var ev = edgeMap[ekey].v;
                triangles.push([ev[0], ev[1], i]);
            }
        }
    }

    var edges = [];
    var seen = {};
    for (var ti = 0; ti < triangles.length; ti++) {
        var tt = triangles[ti];
        if (tt[0] >= n || tt[1] >= n || tt[2] >= n) continue;
        var triEdges2 = [
            [tt[0], tt[1]],
            [tt[1], tt[2]],
            [tt[2], tt[0]]
        ];
        for (var ej = 0; ej < 3; ej++) {
            var key = Math.min(triEdges2[ej][0], triEdges2[ej][1]) + "_" + Math.max(triEdges2[ej][0], triEdges2[ej][1]);
            if (!seen[key]) {
                seen[key] = true;
                edges.push([triEdges2[ej][0], triEdges2[ej][1]]);
            }
        }
    }
    return edges;
}

// ---------- DISPATCH + DRAW ----------

function olineBuildEdges(topology, points, params) {
    switch (topology) {
        case "all-to-all": return olineTopologyAllToAll(points);
        case "chain": return olineTopologyChain(points);
        case "loop": return olineTopologyLoop(points);
        case "step-skip": return olineTopologyStepSkip(points, params.take, params.skip);
        case "modular-skip": return olineTopologyModularSkip(points, params.skip);
        case "random": return olineTopologyRandom(points, params.take);
        case "threshold-distance": return olineTopologyThresholdDistance(points, params.distance);
        case "radial": return olineTopologyRadial(points);
        case "star-from-pivot": return olineTopologyStarFromPivot(points);
        case "nearest": return olineTopologyNearest(points, params.take);
        case "knn-mutual": return olineTopologyKnnMutual(points, params.take);
        case "convex-hull": return olineTopologyConvexHull(points);
        case "mst": return olineTopologyMst(points);
        case "delaunay": return olineTopologyDelaunay(points);
    }
    return [];
}

function olineRedrawPreview(config) {
    var doc = app.activeDocument;
    var points = olineSession.points;
    var n = points.length;

    // Ensure preview group exists
    if (!olineSession.previewGroup) {
        var grp = doc.groupItems.add();
        grp.name = OLINE_PREVIEW_NAME;
        olineSession.previewGroup = grp;
    } else {
        // Wipe contents
        var pg = olineSession.previewGroup;
        while (pg.pageItems.length > 0) {
            try { pg.pageItems[0].remove(); } catch (e) { break; }
        }
    }

    var edges = olineBuildEdges(config.topology, points, config);
    var center = (config.topology === "radial") ? olineCentroid(points) : null;

    // Tension random pool: per-edge factor in [-1, 1]. Re-rolled only when the user
    // changes the Tension randomness slider; topology / tension / other parameters
    // reuse the same pool so dragging them does not re-shuffle the pattern.
    var poolKey = "r=" + config.tensionRandomness;
    var tensionPool = olineEnsureTensionPool(edges.length + 16, poolKey);

    // Dedupe by coordinate-pair key (handles overlapping edges from different algorithms)
    var seen = {};
    var drawn = 0;
    var edgeDrawIdx = 0;
    for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var pa = (e[0] === -1) ? center : points[e[0]];
        var pb = (e[1] === -1) ? center : points[e[1]];
        if (!pa || !pb) continue;
        var key = Math.round(pa[0]) + "_" + Math.round(pa[1]) + "|" + Math.round(pb[0]) + "_" + Math.round(pb[1]);
        var keyR = Math.round(pb[0]) + "_" + Math.round(pb[1]) + "|" + Math.round(pa[0]) + "_" + Math.round(pa[1]);
        if (seen[key] || seen[keyR]) continue;
        seen[key] = true;
        // Per-line tension: base + random factor * randomness * 4 (so randomness=100 → ±400)
        var lineFactor = tensionPool[edgeDrawIdx % tensionPool.length];
        edgeDrawIdx++;
        var lineTension = config.tension + lineFactor * config.tensionRandomness * 4;
        try {
            olineDrawConnection(pa, pb, olineSession.previewGroup, config.bezier, lineTension, config.strokeWidth);
            drawn++;
        } catch (drawErr) {
            olineLog("Draw error on edge " + i + ": " + drawErr.message);
        }
    }
    return drawn;
}

// ---------- ENDPOINTS ----------

function olineStart(encodedConfig) {
    try {
        // Cancel any stale session first
        if (olineSession.active) {
            if (olineSession.previewGroup) {
                try { olineSession.previewGroup.remove(); } catch (e) {}
            }
            olineSession.active = false;
            olineSession.points = [];
            olineSession.previewGroup = null;
            olineSession.randomSeed = [];
            olineSession.seedN = 0;
            olineSession.seedTake = 0;
            olineSession.tensionPool = [];
            olineSession.tensionPoolKey = null;
        }

        var config = olineValidateConfig(olineParseConfig(encodedConfig));
        var doc = olineEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select 2+ anchor points (Direct Selection) or single-point paths first.");
        }

        var anchors = [];
        for (var i = 0; i < sel.length; i++) olineCollectAnchors(sel[i], anchors);

        if (anchors.length < 2) {
            throw new Error("Need at least 2 anchor points (got " + anchors.length + ").");
        }

        olineSession.points = anchors;
        olineSession.previewGroup = null;
        olineSession.randomSeed = [];
        olineSession.seedN = 0;
        olineSession.seedTake = 0;
            olineSession.tensionPool = [];
            olineSession.tensionPoolKey = null;
        olineSession.active = true;

        var drawn = olineRedrawPreview(config);
        app.redraw();

        return olineResponse(true, "Built " + drawn + " edge(s) over " + anchors.length + " anchor(s).", {
            anchors: anchors.length,
            edges: drawn
        });
    } catch (error) {
        olineLog(error.message || String(error));
        if (olineSession.previewGroup) {
            try { olineSession.previewGroup.remove(); } catch (e) {}
        }
        olineSession.active = false;
        olineSession.points = [];
        olineSession.previewGroup = null;
        olineSession.randomSeed = [];
        olineSession.seedN = 0;
        olineSession.seedTake = 0;
            olineSession.tensionPool = [];
            olineSession.tensionPoolKey = null;
        return olineResponse(false, error.message || String(error));
    }
}

function olineUpdate(encodedConfig) {
    try {
        if (!olineSession.active) return olineResponse(false, "No active session.");
        var config = olineValidateConfig(olineParseConfig(encodedConfig));
        var drawn = olineRedrawPreview(config);
        app.redraw();
        return olineResponse(true, "Drew " + drawn + " edge(s).", { edges: drawn });
    } catch (error) {
        olineLog(error.message || String(error));
        return olineResponse(false, error.message || String(error));
    }
}

function olineNewSeed(encodedConfig) {
    try {
        if (!olineSession.active) return olineResponse(false, "No active session.");
        var config = olineValidateConfig(olineParseConfig(encodedConfig));
        olineForceReseed(olineSession.points.length, config.take);
        var drawn = olineRedrawPreview(config);
        app.redraw();
        return olineResponse(true, "New seed. Drew " + drawn + " edge(s).", { edges: drawn });
    } catch (error) {
        olineLog(error.message || String(error));
        return olineResponse(false, error.message || String(error));
    }
}

function olineBake(encodedConfig) {
    try {
        if (!olineSession.active) return olineResponse(false, "No active session.");
        if (!olineSession.previewGroup) return olineResponse(false, "Preview is empty.");
        if (olineSession.previewGroup.pageItems.length === 0) {
            return olineResponse(false, "Preview is empty — nothing to bake.");
        }
        var config = olineValidateConfig(olineParseConfig(encodedConfig));
        var doc = app.activeDocument;
        var suffix = config.bezier ? "Bez" : "Lin";
        var stamp = String(Date.now());
        var symbolName = "OLine_" + suffix + "_" + stamp.substring(stamp.length - 5);
        var symbol = doc.symbols.add(olineSession.previewGroup);
        symbol.name = symbolName;
        try { olineSession.previewGroup.remove(); } catch (e) {}
        olineSession.previewGroup = null;
        var drawn = olineRedrawPreview(config);
        app.redraw();
        return olineResponse(true, "Baked '" + symbolName + "'. New preview ready (" + drawn + " edges).", {
            symbolName: symbolName,
            edges: drawn
        });
    } catch (error) {
        olineLog(error.message || String(error));
        return olineResponse(false, error.message || String(error));
    }
}

function olineApply() {
    try {
        if (!olineSession.active) return olineResponse(false, "No active session.");
        var n = olineSession.previewGroup ? olineSession.previewGroup.pageItems.length : 0;
        // Detach preview from session (keep it as result)
        olineSession.active = false;
        olineSession.previewGroup = null;
        olineSession.points = [];
        olineSession.randomSeed = [];
        olineSession.seedN = 0;
        olineSession.seedTake = 0;
            olineSession.tensionPool = [];
            olineSession.tensionPoolKey = null;
        app.redraw();
        return olineResponse(true, "Applied " + n + " edge(s).", { edges: n });
    } catch (error) {
        olineLog(error.message || String(error));
        return olineResponse(false, error.message || String(error));
    }
}

function olineCancel() {
    try {
        if (!olineSession.active) return olineResponse(true, "No active session.", { wasActive: false });
        if (olineSession.previewGroup) {
            try { olineSession.previewGroup.remove(); } catch (e) {}
        }
        olineSession.active = false;
        olineSession.previewGroup = null;
        olineSession.points = [];
        olineSession.randomSeed = [];
        olineSession.seedN = 0;
        olineSession.seedTake = 0;
            olineSession.tensionPool = [];
            olineSession.tensionPoolKey = null;
        app.redraw();
        return olineResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        olineLog(error.message || String(error));
        return olineResponse(false, error.message || String(error));
    }
}

function olineHandshake() {
    try {
        return olineResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!olineSession.active
        });
    } catch (error) {
        return olineResponse(false, error.message || String(error));
    }
}
