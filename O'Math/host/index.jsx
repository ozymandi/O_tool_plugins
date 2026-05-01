#target illustrator
#targetengine "OMathCEP"

var OMATH_DEBUG = false;
var omathDebugLog = new File(Folder.desktop + "/omath_cep_log.txt");

var omathSession = {
    active: false,
    previewGroup: null
};

var OMATH_PREVIEW_NAME = "OMath_Preview";
var OMATH_FINAL_NAME = "O'Math_Surface";

function omathLog(message) {
    if (!OMATH_DEBUG) return;
    try {
        omathDebugLog.open("a");
        omathDebugLog.writeln("[" + new Date().toUTCString() + "] " + message);
        omathDebugLog.close();
    } catch (e) {}
}

function omathEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function omathToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + omathEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(omathToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(omathToJson(String(key)) + ":" + omathToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function omathResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return omathToJson(payload);
}

function omathParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function omathNormNum(value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

var OMATH_VALID_SURFACES = {
    "Ellipsoid": 1, "Cone": 1, "Cylinder": 1, "Pyramid": 1, "Cube (Sharp)": 1,
    "Hyperbolic Paraboloid": 1, "One-sheet Hyperboloid": 1,
    "Torus": 1, "Elliptic Paraboloid": 1, "Superellipsoid (Rounded Cube)": 1,
    "Möbius Strip": 1, "Helicoid": 1, "Pseudosphere": 1, "Klein Bottle": 1,
    "Superegg": 1, "Catalan Surface": 1, "Regulus": 1
};

function omathValidateConfig(config) {
    var n = {
        surface: OMATH_VALID_SURFACES.hasOwnProperty(config.surface) ? config.surface : "Cube (Sharp)",
        paramA: omathNormNum(config.paramA, 1.0),
        paramB: omathNormNum(config.paramB, 1.0),
        paramC: omathNormNum(config.paramC, 1.0),
        paramD: omathNormNum(config.paramD, 2.5),
        viewMode: (config.viewMode === "wire") ? "wire" : "hidden",
        scale: omathNormNum(config.scale, 60),
        density: parseInt(config.density, 10),
        smooth: !!config.smooth
    };
    if (isNaN(n.density) || n.density < 3) n.density = 3;
    if (n.density > 80) n.density = 80;
    if (n.scale < 1) n.scale = 1;
    return n;
}

function omathEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

// ---------- MATH HELPERS ----------

function omathCosh(x) { return (Math.exp(x) + Math.exp(-x)) / 2; }
function omathSinh(x) { return (Math.exp(x) - Math.exp(-x)) / 2; }
function omathSPow(val, p) { return (val < 0 ? -1 : 1) * Math.pow(Math.abs(val), p); }

function omathGetPt(type, u, v, valA, valB, valC, valD) {
    var uR = u * 2 * Math.PI;
    var vR = v * Math.PI - Math.PI / 2;

    if (type === "Ellipsoid") {
        return { x: valA * Math.cos(vR) * Math.cos(uR), y: valB * Math.cos(vR) * Math.sin(uR), z: valC * Math.sin(vR) };
    } else if (type === "Cone") {
        var zC = (v * 2 - 1) * 2;
        return { x: valA * Math.abs(zC) * Math.cos(uR), y: valB * Math.abs(zC) * Math.sin(uR), z: zC * valC };
    } else if (type === "Cylinder") {
        return { x: valA * Math.cos(uR), y: valB * Math.sin(uR), z: valC * (v * 2 - 1) };
    } else if (type === "Pyramid") {
        var rSq = 1 / Math.max(Math.abs(Math.cos(uR)), Math.abs(Math.sin(uR)));
        var pScale = 1 - v;
        return { x: valA * pScale * rSq * Math.cos(uR), y: valB * pScale * rSq * Math.sin(uR), z: valC * (v * 2 - 1) };
    } else if (type === "Cube (Sharp)") {
        var x0 = Math.cos(vR) * Math.cos(uR);
        var y0 = Math.cos(vR) * Math.sin(uR);
        var z0 = Math.sin(vR);
        var maxNorm = Math.max(Math.abs(x0), Math.abs(y0), Math.abs(z0));
        if (maxNorm === 0) maxNorm = 1;
        return { x: valA * (x0 / maxNorm), y: valB * (y0 / maxNorm), z: valC * (z0 / maxNorm) };
    } else if (type === "Hyperbolic Paraboloid") {
        var xS = (u * 2 - 1) * 2;
        var yS = (v * 2 - 1) * 2;
        return { x: valA * xS, y: valB * yS, z: (xS * xS - yS * yS) * 0.3 * valC };
    } else if (type === "One-sheet Hyperboloid") {
        var vH = (v * 2 - 1) * 1.5;
        return { x: valA * omathCosh(vH) * Math.cos(uR), y: valB * omathCosh(vH) * Math.sin(uR), z: valC * omathSinh(vH) };
    } else if (type === "Torus") {
        var vT = v * 2 * Math.PI;
        var r = valA + (valB * 0.5) * Math.cos(vT);
        return { x: r * Math.cos(uR), y: r * Math.sin(uR), z: valC * 0.5 * Math.sin(vT) };
    } else if (type === "Elliptic Paraboloid") {
        var rP = v * 1.5;
        return { x: valA * rP * Math.cos(uR), y: valB * rP * Math.sin(uR), z: valC * (rP * rP) * 0.5 };
    } else if (type === "Superellipsoid (Rounded Cube)") {
        return {
            x: valA * omathSPow(Math.cos(vR), valD) * omathSPow(Math.cos(uR), valD),
            y: valB * omathSPow(Math.cos(vR), valD) * omathSPow(Math.sin(uR), valD),
            z: valC * omathSPow(Math.sin(vR), valD)
        };
    } else if (type === "Möbius Strip") {
        var vM = (v - 0.5) * 1.5;
        var rM = valA + (valB * 0.5) * vM * Math.cos(uR / 2);
        return { x: rM * Math.cos(uR), y: rM * Math.sin(uR), z: valC * vM * Math.sin(uR / 2) };
    } else if (type === "Helicoid") {
        var uH = u * 4 * Math.PI;
        var vH2 = (v - 0.5) * 2;
        return { x: valA * vH2 * Math.cos(uH), y: valB * vH2 * Math.sin(uH), z: valC * (u - 0.5) * 4 };
    } else if (type === "Pseudosphere") {
        var uP = 0.01 + u * (Math.PI / 2 - 0.01);
        var vP = v * 2 * Math.PI;
        var sinU = Math.sin(uP), cosU = Math.cos(uP);
        return {
            x: valA * sinU * Math.cos(vP),
            y: valB * sinU * Math.sin(vP),
            z: valC * (cosU + Math.log(Math.tan(uP / 2)))
        };
    } else if (type === "Klein Bottle") {
        var uK = u * 2 * Math.PI;
        var vK = v * 2 * Math.PI;
        var rK = valA + valB * Math.cos(uK / 2) * Math.sin(vK) - valB * Math.sin(uK / 2) * Math.sin(2 * vK);
        return {
            x: rK * Math.cos(uK),
            y: rK * Math.sin(uK),
            z: valC * (Math.sin(uK / 2) * Math.sin(vK) + Math.cos(uK / 2) * Math.sin(2 * vK))
        };
    } else if (type === "Superegg") {
        var pExp = 2.0 / (valD || 2.5);
        return {
            x: valA * omathSPow(Math.cos(vR), pExp) * Math.cos(uR),
            y: valA * omathSPow(Math.cos(vR), pExp) * Math.sin(uR),
            z: valC * omathSPow(Math.sin(vR), pExp)
        };
    } else if (type === "Catalan Surface") {
        var uC = u * 4 * Math.PI;
        var vC = (v - 0.5) * 2.5;
        return {
            x: valA * (uC - Math.sin(uC) * omathCosh(vC)),
            y: valB * (1 - Math.cos(uC) * omathCosh(vC)),
            z: valC * 4 * Math.sin(uC / 2) * omathSinh(vC / 2)
        };
    } else if (type === "Regulus") {
        var uReg = u * 2 * Math.PI;
        var vReg = (v - 0.5) * 2;
        return {
            x: valA * (Math.cos(uReg) - vReg * Math.sin(uReg)),
            y: valB * (Math.sin(uReg) + vReg * Math.cos(uReg)),
            z: valC * vReg
        };
    }
    return { x: 0, y: 0, z: 0 };
}

// ---------- DRAW ----------

function omathApplyCustomSmooth(pathItem) {
    var pts = pathItem.pathPoints;
    if (pts.length < 3) return;
    for (var i = 1; i < pts.length - 1; i++) {
        var p0 = pts[i - 1].anchor;
        var p1 = pts[i].anchor;
        var p2 = pts[i + 1].anchor;
        var dx = (p2[0] - p0[0]) * 0.15;
        var dy = (p2[1] - p0[1]) * 0.15;
        pts[i].rightDirection = [p1[0] + dx, p1[1] + dy];
        pts[i].leftDirection = [p1[0] - dx, p1[1] - dy];
    }
}

function omathRedraw(config) {
    var doc = app.activeDocument;
    var layer = doc.activeLayer;
    if (layer.locked || !layer.visible) {
        throw new Error("Active layer is locked or hidden.");
    }

    if (omathSession.previewGroup) {
        try { omathSession.previewGroup.remove(); } catch (e) {}
    }
    omathSession.previewGroup = layer.groupItems.add();
    omathSession.previewGroup.name = OMATH_PREVIEW_NAME;

    var col = new RGBColor(); col.red = 0; col.green = 120; col.blue = 255;
    var whiteCol = new RGBColor(); whiteCol.red = 255; whiteCol.green = 255; whiteCol.blue = 255;

    var dens = config.density;
    var scale = config.scale;
    var type = config.surface;
    var mode = config.viewMode;
    var doSmooth = config.smooth;
    var valA = config.paramA;
    var valB = config.paramB;
    var valC = config.paramC;
    var valD = config.paramD;

    var pts3D = [];
    var proj2D = [];
    var rx = Math.PI / 6;
    var ry = Math.PI / 4;

    for (var m = 0; m <= dens; m++) {
        pts3D[m] = [];
        proj2D[m] = [];
        for (var n = 0; n <= dens; n++) {
            var u = m / dens;
            var v = n / dens;
            var pt = omathGetPt(type, u, v, valA, valB, valC, valD);

            var x1 = pt.x * Math.cos(ry) - pt.z * Math.sin(ry);
            var z1 = pt.x * Math.sin(ry) + pt.z * Math.cos(ry);
            var y1 = pt.y * Math.cos(rx) - z1 * Math.sin(rx);
            var zDepth = pt.y * Math.sin(rx) + z1 * Math.cos(rx);

            pts3D[m][n] = zDepth;
            proj2D[m][n] = [x1 * scale, y1 * scale];
        }
    }

    var totalPaths = 0;

    if (mode === "wire") {
        for (var axis = 0; axis < 2; axis++) {
            var isU = (axis === 0);
            for (var mw = 0; mw <= dens; mw++) {
                var path = omathSession.previewGroup.pathItems.add();
                path.filled = false;
                path.stroked = true;
                path.strokeColor = col;
                path.strokeWidth = 0.5;
                var linePts = [];
                for (var nw = 0; nw <= dens; nw++) {
                    if (isU) linePts.push(proj2D[mw][nw]);
                    else linePts.push(proj2D[nw][mw]);
                }
                path.setEntirePath(linePts);
                if (doSmooth) omathApplyCustomSmooth(path);
                totalPaths++;
            }
        }
    } else {
        var quads = [];
        for (var mh = 0; mh < dens; mh++) {
            for (var nh = 0; nh < dens; nh++) {
                var p1 = proj2D[mh][nh];
                var p2 = proj2D[mh + 1][nh];
                var p3 = proj2D[mh + 1][nh + 1];
                var p4 = proj2D[mh][nh + 1];
                var zAvg = (pts3D[mh][nh] + pts3D[mh + 1][nh] + pts3D[mh + 1][nh + 1] + pts3D[mh][nh + 1]) / 4;
                quads.push({ pts: [p1, p2, p3, p4], z: zAvg });
            }
        }
        quads.sort(function (a, b) { return b.z - a.z; });
        for (var iq = 0; iq < quads.length; iq++) {
            var qpath = omathSession.previewGroup.pathItems.add();
            qpath.setEntirePath(quads[iq].pts);
            qpath.closed = true;
            qpath.filled = true;
            qpath.fillColor = whiteCol;
            qpath.stroked = true;
            qpath.strokeColor = col;
            qpath.strokeWidth = 0.5;
            totalPaths++;
        }
    }

    try {
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        omathSession.previewGroup.left = (ab[0] + ab[2]) / 2 - omathSession.previewGroup.width / 2;
        omathSession.previewGroup.top = (ab[1] + ab[3]) / 2 + omathSession.previewGroup.height / 2;
    } catch (eAb) {}

    return totalPaths;
}

function omathResetSession(removePreview) {
    if (removePreview && omathSession.previewGroup) {
        try { omathSession.previewGroup.remove(); } catch (e) {}
    }
    omathSession.active = false;
    omathSession.previewGroup = null;
}

// ---------- ENDPOINTS ----------

function omathStart(encodedConfig) {
    try {
        if (omathSession.active) {
            omathResetSession(true);
        }
        var config = omathValidateConfig(omathParseConfig(encodedConfig));
        omathEnsureDocument();
        omathSession.previewGroup = null;
        omathSession.active = true;
        var paths = omathRedraw(config);
        app.redraw();
        return omathResponse(true, "Preview ready (" + paths + " paths).", { paths: paths });
    } catch (error) {
        omathLog(error.message || String(error));
        omathResetSession(true);
        return omathResponse(false, error.message || String(error));
    }
}

function omathUpdate(encodedConfig) {
    try {
        if (!omathSession.active) return omathResponse(false, "No active session.");
        var config = omathValidateConfig(omathParseConfig(encodedConfig));
        var paths = omathRedraw(config);
        app.redraw();
        return omathResponse(true, "Drew " + paths + " paths.", { paths: paths });
    } catch (error) {
        omathLog(error.message || String(error));
        return omathResponse(false, error.message || String(error));
    }
}

function omathApply() {
    try {
        if (!omathSession.active) return omathResponse(false, "No active session.");
        if (omathSession.previewGroup) {
            try { omathSession.previewGroup.name = OMATH_FINAL_NAME; } catch (e) {}
        }
        omathSession.active = false;
        omathSession.previewGroup = null;
        app.redraw();
        return omathResponse(true, "Surface committed.");
    } catch (error) {
        omathLog(error.message || String(error));
        return omathResponse(false, error.message || String(error));
    }
}

function omathCancel() {
    try {
        if (!omathSession.active) return omathResponse(true, "No active session.", { wasActive: false });
        omathResetSession(true);
        app.redraw();
        return omathResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        omathLog(error.message || String(error));
        return omathResponse(false, error.message || String(error));
    }
}

function omathHandshake() {
    try {
        return omathResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!omathSession.active
        });
    } catch (error) {
        return omathResponse(false, error.message || String(error));
    }
}
