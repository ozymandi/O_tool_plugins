#target illustrator
#targetengine "OFractalCEP"

var ofractalSession = {
    active: false,
    previewGroup: null,
    sessionID: null,
    loadedSymbols: [],
    startInfo: null,        // { pos: [x,y], angle: rad, rgb: [r,g,b] }
    levelGradientsNormal: [],
    levelGradientsFlipped: [],
    geoSeed: 42,
    childSeed: 142
};

var OFRACTAL_PREVIEW_NAME = "OF_Preview";
var OFRACTAL_PRESET_FOLDER = new Folder(Folder.myDocuments + "/O_Fractal_Presets");

function ofractalEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function ofractalToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + ofractalEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(ofractalToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(ofractalToJson(String(key)) + ":" + ofractalToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function ofractalResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return ofractalToJson(payload);
}

function ofractalParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function ofractalEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function ofractalNN(value, fallback) {
    var n = parseFloat(value);
    return isNaN(n) ? fallback : n;
}

function ofractalNI(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
}

function ofractalValidateConfig(config) {
    return {
        iterations: ofractalNI(config.iterations, 7),
        baseLength: ofractalNN(config.baseLength, 100),
        branchAngle: ofractalNN(config.branchAngle, 35),
        lenScale: ofractalNN(config.lenScale, 75),
        twistAngle: ofractalNN(config.twistAngle, 0),
        baseStroke: ofractalNN(config.baseStroke, 10),
        strokeScale: ofractalNN(config.strokeScale, 70),
        brightShift: ofractalNN(config.brightShift, 50),
        forceBranch: !!config.forceBranch,
        forceMult: ofractalNN(config.forceMult, 2.0),
        divide: ofractalNI(config.divide, 0),
        tangentBase: ofractalNN(config.tangentBase, 0),
        checkerTangent: !!config.checkerTangent,
        tangentRandom: ofractalNN(config.tangentRandom, 0),
        seed: ofractalNI(config.seed, 42),
        cLevels: ofractalNI(config.cLevels, 1),
        cPerNode: ofractalNI(config.cPerNode, 1),
        cShiftX: ofractalNN(config.cShiftX, 0),
        cShiftY: ofractalNN(config.cShiftY, 0),
        cShiftRand: ofractalNN(config.cShiftRand, 0),
        cRot: ofractalNN(config.cRot, 0),
        cRotRand: ofractalNN(config.cRotRand, 0),
        cScaleX: ofractalNN(config.cScaleX, 100),
        cScaleY: ofractalNN(config.cScaleY, 100),
        cScaleRand: ofractalNN(config.cScaleRand, 0),
        cOpac: ofractalNN(config.cOpac, 100),
        cOpacRand: ofractalNN(config.cOpacRand, 0),
        cHueRand: ofractalNN(config.cHueRand, 0),
        iCount: ofractalNI(config.iCount, 1),
        iScale: ofractalNN(config.iScale, 80),
        iShiftX: ofractalNN(config.iShiftX, 0),
        iShiftY: ofractalNN(config.iShiftY, -20),
        iRand: ofractalNN(config.iRand, 0),
        iStack: ofractalNI(config.iStack, 0),
        iIncChild: !!config.iIncChild,
        iFlip: !!config.iFlip
    };
}

// ---------- COLOR / HSB ----------

function ofractalGetStandardRGB(aiColor) {
    try {
        if (!aiColor || aiColor.typename === "NoColor") return [128, 128, 128];
        if (aiColor.typename === "RGBColor") return [aiColor.red, aiColor.green, aiColor.blue];
        if (aiColor.typename === "CMYKColor") {
            var r = 255 * (1 - aiColor.cyan / 100) * (1 - aiColor.black / 100);
            var g = 255 * (1 - aiColor.magenta / 100) * (1 - aiColor.black / 100);
            var b = 255 * (1 - aiColor.yellow / 100) * (1 - aiColor.black / 100);
            return [r, g, b];
        }
        if (aiColor.typename === "GradientColor") return ofractalGetStandardRGB(aiColor.gradient.gradientStops[0].color);
        if (aiColor.typename === "SpotColor") return ofractalGetStandardRGB(aiColor.spot.color);
        if (aiColor.typename === "GrayColor") {
            var v = 255 - (aiColor.gray * 2.55);
            return [v, v, v];
        }
    } catch (e) {}
    return [128, 128, 128];
}

function ofractalRgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, v = max;
    var d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) h = 0;
    else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, v];
}

function ofractalHsbToRgb(h, s, v) {
    var r, g, b;
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return [r * 255, g * 255, b * 255];
}

function ofractalShiftColorHue(aiColor, shiftDeg) {
    if (!aiColor || aiColor.typename === "NoColor") return aiColor;
    try {
        if (aiColor.typename === "RGBColor") {
            var hsb = ofractalRgbToHsb(aiColor.red, aiColor.green, aiColor.blue);
            var newH = (hsb[0] * 360 + shiftDeg) % 360;
            if (newH < 0) newH += 360;
            var rgb = ofractalHsbToRgb(newH / 360, hsb[1], hsb[2]);
            var c = new RGBColor(); c.red = rgb[0]; c.green = rgb[1]; c.blue = rgb[2];
            return c;
        } else if (aiColor.typename === "CMYKColor") {
            var r = 255 * (1 - aiColor.cyan / 100) * (1 - aiColor.black / 100);
            var g = 255 * (1 - aiColor.magenta / 100) * (1 - aiColor.black / 100);
            var b = 255 * (1 - aiColor.yellow / 100) * (1 - aiColor.black / 100);
            var hsb2 = ofractalRgbToHsb(r, g, b);
            var newH2 = (hsb2[0] * 360 + shiftDeg) % 360;
            if (newH2 < 0) newH2 += 360;
            var rgb2 = ofractalHsbToRgb(newH2 / 360, hsb2[1], hsb2[2]);
            var c2 = new CMYKColor();
            var cR = 1 - rgb2[0] / 255, cG = 1 - rgb2[1] / 255, cB = 1 - rgb2[2] / 255;
            var cK = Math.min(cR, Math.min(cG, cB));
            c2.black = cK * 100;
            c2.cyan = (cK === 1) ? 0 : ((cR - cK) / (1 - cK)) * 100;
            c2.magenta = (cK === 1) ? 0 : ((cG - cK) / (1 - cK)) * 100;
            c2.yellow = (cK === 1) ? 0 : ((cB - cK) / (1 - cK)) * 100;
            return c2;
        }
    } catch (e) {}
    return aiColor;
}

function ofractalRecursiveHueShift(item, shiftDeg) {
    if (shiftDeg === 0) return;
    try {
        if (item.typename === "PathItem") {
            if (item.filled && item.fillColor.typename !== "NoColor") item.fillColor = ofractalShiftColorHue(item.fillColor, shiftDeg);
            if (item.stroked && item.strokeColor.typename !== "NoColor") item.strokeColor = ofractalShiftColorHue(item.strokeColor, shiftDeg);
        } else if (item.typename === "GroupItem") {
            for (var i = 0; i < item.pageItems.length; i++) {
                ofractalRecursiveHueShift(item.pageItems[i], shiftDeg);
            }
        } else if (item.typename === "CompoundPathItem") {
            if (item.pathItems && item.pathItems.length > 0) {
                for (var j = 0; j < item.pathItems.length; j++) {
                    var p = item.pathItems[j];
                    if (p.filled && p.fillColor.typename !== "NoColor") p.fillColor = ofractalShiftColorHue(p.fillColor, shiftDeg);
                    if (p.stroked && p.strokeColor.typename !== "NoColor") p.strokeColor = ofractalShiftColorHue(p.strokeColor, shiftDeg);
                }
            }
        }
    } catch (e) {}
}

// ---------- PRNG ----------

function ofractalSeededRandomGeo() {
    ofractalSession.geoSeed = (ofractalSession.geoSeed * 9301 + 49297) % 233280;
    return ofractalSession.geoSeed / 233280;
}

function ofractalSeededRandomChild() {
    ofractalSession.childSeed = (ofractalSession.childSeed * 9301 + 49297) % 233280;
    return ofractalSession.childSeed / 233280;
}

// ---------- ORIGIN ----------

function ofractalGetStartingInfo(doc) {
    var defaultAngle = Math.PI / 2;
    var defaultColor = [128, 128, 128];
    try {
        var sel = doc.selection;
        if (sel && sel.length > 0) {
            for (var i = 0; i < sel.length; i++) {
                var item = sel[i];
                if (item.typename === "PathItem") {
                    for (var j = 0; j < item.pathPoints.length; j++) {
                        if (item.pathPoints[j].selected === PathPointSelection.ANCHORPOINT) {
                            var pt = item.pathPoints[j];
                            var dx = pt.rightDirection[0] - pt.leftDirection[0];
                            var dy = pt.rightDirection[1] - pt.leftDirection[1];
                            var angle = defaultAngle;
                            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                                angle = Math.atan2(dy, dx) + Math.PI / 2;
                            }
                            var extColor = null;
                            if (item.stroked && item.strokeColor.typename !== "NoColor") extColor = item.strokeColor;
                            else if (item.filled && item.fillColor.typename !== "NoColor") extColor = item.fillColor;
                            return { pos: [pt.anchor[0], pt.anchor[1]], angle: angle, rgb: ofractalGetStandardRGB(extColor) };
                        }
                    }
                }
            }
        }
        var c;
        try { c = doc.activeView.centerPoint; } catch (eC) { c = [0, 0]; }
        return { pos: [c[0], c[1]], angle: defaultAngle, rgb: defaultColor };
    } catch (e) {
        return { pos: [0, 0], angle: defaultAngle, rgb: defaultColor };
    }
}

// ---------- GRADIENTS ----------

function ofractalGetOrMakeGradient(doc, name) {
    try {
        for (var i = 0; i < doc.gradients.length; i++) {
            try {
                if (doc.gradients[i].name === name) return doc.gradients[i];
            } catch (e) {}
        }
    } catch (e) {}
    var g = doc.gradients.add();
    try { g.name = name; } catch (eN) {}
    g.type = GradientType.LINEAR;
    return g;
}

function ofractalBuildGradients(doc, config, rootRGB) {
    var lvls = config.iterations;
    var shiftAmount = config.brightShift / 100.0;
    var targetRGB = shiftAmount > 0 ? [255, 255, 255] : [0, 0, 0];
    var absShift = Math.abs(shiftAmount);

    var normals = [];
    var flips = [];
    for (var lvl = 0; lvl < lvls; lvl++) {
        var t1 = absShift * (lvl / lvls);
        var t2 = absShift * ((lvl + 1) / lvls);
        if (t1 < 0) t1 = 0; if (t1 > 1) t1 = 1;
        if (t2 < 0) t2 = 0; if (t2 > 1) t2 = 1;

        var c1 = new RGBColor();
        c1.red = rootRGB[0] + (targetRGB[0] - rootRGB[0]) * t1;
        c1.green = rootRGB[1] + (targetRGB[1] - rootRGB[1]) * t1;
        c1.blue = rootRGB[2] + (targetRGB[2] - rootRGB[2]) * t1;
        var c2 = new RGBColor();
        c2.red = rootRGB[0] + (targetRGB[0] - rootRGB[0]) * t2;
        c2.green = rootRGB[1] + (targetRGB[1] - rootRGB[1]) * t2;
        c2.blue = rootRGB[2] + (targetRGB[2] - rootRGB[2]) * t2;

        var gradN = ofractalGetOrMakeGradient(doc, "OF_G_N_" + ofractalSession.sessionID + "_" + lvl);
        try {
            while (gradN.gradientStops.length < 4) gradN.gradientStops.add();
            while (gradN.gradientStops.length > 4) gradN.gradientStops[gradN.gradientStops.length - 1].remove();
            gradN.gradientStops[0].rampPoint = 0; gradN.gradientStops[0].color = c1;
            gradN.gradientStops[1].rampPoint = 10; gradN.gradientStops[1].color = c1;
            gradN.gradientStops[2].rampPoint = 90; gradN.gradientStops[2].color = c2;
            gradN.gradientStops[3].rampPoint = 100; gradN.gradientStops[3].color = c2;
        } catch (eg) {}
        normals.push(gradN);

        var gradF = ofractalGetOrMakeGradient(doc, "OF_G_F_" + ofractalSession.sessionID + "_" + lvl);
        try {
            while (gradF.gradientStops.length < 4) gradF.gradientStops.add();
            while (gradF.gradientStops.length > 4) gradF.gradientStops[gradF.gradientStops.length - 1].remove();
            gradF.gradientStops[0].rampPoint = 0; gradF.gradientStops[0].color = c2;
            gradF.gradientStops[1].rampPoint = 10; gradF.gradientStops[1].color = c2;
            gradF.gradientStops[2].rampPoint = 90; gradF.gradientStops[2].color = c1;
            gradF.gradientStops[3].rampPoint = 100; gradF.gradientStops[3].color = c1;
        } catch (egf) {}
        flips.push(gradF);
    }
    ofractalSession.levelGradientsNormal = normals;
    ofractalSession.levelGradientsFlipped = flips;
}

// ---------- DRAW ----------

function ofractalDrawFractal(x, y, length, currentAngle, depth, parentGroup, bP, cP) {
    if (depth === 0) return;

    currentAngle += bP.twistAngle * (Math.PI / 180);
    var endX = x + length * Math.cos(currentAngle);
    var endY = y + length * Math.sin(currentAngle);

    var line = parentGroup.pathItems.add();
    try { line.zOrder(ZOrderMethod.SENDTOBACK); } catch (eZ) {}

    line.stroked = true;
    line.filled = false;
    try { line.strokeCap = StrokeCap.ROUNDENDCAP; } catch (eC) {}
    try { line.strokeJoin = StrokeJoin.ROUNDENDJOIN; } catch (eJ) {}

    var levelIndex = bP.iterations - depth;
    var currentThickness = bP.baseStroke * Math.pow(bP.strokeScale, levelIndex);
    if (bP.forceBranch && (levelIndex === 0 || levelIndex === 1)) {
        currentThickness *= bP.forceMult;
    }
    line.strokeWidth = currentThickness;

    var isFlipped = (endX < x);
    var gradColor = new GradientColor();
    gradColor.gradient = isFlipped ? bP.levelGradientsFlipped[levelIndex] : bP.levelGradientsNormal[levelIndex];
    var degAngle = (currentAngle * 180 / Math.PI) % 360;
    if (degAngle > 180) degAngle -= 360;
    else if (degAngle < -180) degAngle += 360;
    gradColor.angle = degAngle;
    line.strokeColor = gradColor;

    var numSegments = bP.divide + 1;
    var subLen = length / numSegments;
    var hLenX = Math.cos(currentAngle) * (subLen / 3);
    var hLenY = Math.sin(currentAngle) * (subLen / 3);

    var effectiveTangentBase = bP.tangentBase;
    if (bP.checkerTangent && (levelIndex % 2 !== 0)) effectiveTangentBase *= -1;

    for (var i = 0; i <= numSegments; i++) {
        var pt = line.pathPoints.add();
        var t = i / numSegments;
        var ptx = x + t * (endX - x);
        var pty = y + t * (endY - y);
        pt.anchor = [ptx, pty];

        var sign = (i % 2 === 0) ? 1 : -1;
        var randomOffset = (ofractalSeededRandomGeo() * 2 - 1) * bP.tangentRandom;
        var bend = (effectiveTangentBase * sign) + randomOffset;
        var perpX = -Math.sin(currentAngle) * (bend * subLen / 100);
        var perpY = Math.cos(currentAngle) * (bend * subLen / 100);

        var rightX = ptx + hLenX + perpX;
        var rightY = pty + hLenY + perpY;
        var leftX = ptx - hLenX - perpX;
        var leftY = pty - hLenY - perpY;

        if (i === 0) {
            pt.leftDirection = pt.anchor;
            pt.rightDirection = [rightX, rightY];
        } else if (i === numSegments) {
            pt.leftDirection = [leftX, leftY];
            pt.rightDirection = pt.anchor;
        } else {
            pt.leftDirection = [leftX, leftY];
            pt.rightDirection = [rightX, rightY];
        }
    }

    if (depth <= cP.levels && cP.symbols.length > 0) {
        for (var c = 0; c < cP.perNode; c++) {
            var symIndex = Math.floor(ofractalSeededRandomChild() * cP.symbols.length);
            var childSym = cP.symbols[symIndex];

            var baseRot = (currentAngle * 180 / Math.PI) - 90;
            var randRot = (ofractalSeededRandomChild() * 2 - 1) * cP.rotRand;
            var finalRot = baseRot + cP.rot + randRot;

            var randScale = (ofractalSeededRandomChild() * 2 - 1) * cP.sRand;
            var finalSX = Math.max(1, cP.sX + randScale);
            var finalSY = Math.max(1, cP.sY + randScale);

            var randOp = (ofractalSeededRandomChild() * 2 - 1) * cP.opacRand;
            var finalOp = Math.max(0, Math.min(100, cP.opac + randOp));

            var randHue = (ofractalSeededRandomChild() * 2 - 1) * cP.hueRand;

            var randShiftX = (ofractalSeededRandomChild() * 2 - 1) * cP.shiftRand;
            var randShiftY = (ofractalSeededRandomChild() * 2 - 1) * cP.shiftRand;
            var finalShiftX = cP.shiftX + randShiftX;
            var finalShiftY = cP.shiftY + randShiftY;

            try {
                var instance = parentGroup.symbolItems.add(childSym);

                if (cP.hueRand === 0) {
                    instance.position = [endX - instance.width / 2, endY + instance.height / 2];
                    instance.resize(finalSX, finalSY, true, true, true, true, finalSX, Transformation.CENTER);
                    instance.translate(finalShiftX, finalShiftY);
                    instance.rotate(finalRot, true, true, true, true, Transformation.CENTER);
                    instance.opacity = finalOp;
                } else {
                    instance.breakLink();
                    var linkedItem = parentGroup.pageItems[0];
                    linkedItem.position = [endX - linkedItem.width / 2, endY + linkedItem.height / 2];
                    linkedItem.resize(finalSX, finalSY, true, true, true, true, finalSX, Transformation.CENTER);
                    linkedItem.translate(finalShiftX, finalShiftY);
                    linkedItem.rotate(finalRot, true, true, true, true, Transformation.CENTER);
                    linkedItem.opacity = finalOp;
                    ofractalRecursiveHueShift(linkedItem, randHue);
                }
            } catch (eIn) {}
        }
    }

    var angleOffset = bP.branchAngle * (Math.PI / 180);
    ofractalDrawFractal(endX, endY, length * bP.scale, currentAngle - angleOffset, depth - 1, parentGroup, bP, cP);
    ofractalDrawFractal(endX, endY, length * bP.scale, currentAngle + angleOffset, depth - 1, parentGroup, bP, cP);
}

// ---------- REDRAW ----------

function ofractalClearPreview() {
    if (ofractalSession.previewGroup) {
        try { ofractalSession.previewGroup.remove(); } catch (e) {}
    }
    ofractalSession.previewGroup = null;
}

function ofractalRedraw(config) {
    var doc = app.activeDocument;
    ofractalClearPreview();

    if (!ofractalSession.startInfo) return 0;

    ofractalBuildGradients(doc, config, ofractalSession.startInfo.rgb);

    ofractalSession.previewGroup = doc.groupItems.add();
    try { ofractalSession.previewGroup.name = OFRACTAL_PREVIEW_NAME; } catch (eN) {}

    var startX = ofractalSession.startInfo.pos[0];
    var startY = ofractalSession.startInfo.pos[1];
    var rootAngle = ofractalSession.startInfo.angle;

    var iCount = config.iCount;
    var iScale = config.iScale / 100.0;
    var iRand = config.iRand;
    var iShiftX = config.iShiftX;
    var iShiftY = config.iShiftY;

    var renderOrder = [];
    if (config.iStack === 0) {
        for (var i = iCount - 1; i >= 0; i--) renderOrder.push(i);
    } else {
        for (var ii = 0; ii < iCount; ii++) renderOrder.push(ii);
    }

    var totalLines = 0;
    for (var k = 0; k < renderOrder.length; k++) {
        var inst = renderOrder[k];
        var instGroup = ofractalSession.previewGroup.groupItems.add();

        var scaleMult = Math.pow(iScale, inst);
        var isInstanceFlipped = config.iFlip && (inst % 2 !== 0);

        var instStartX = startX + (inst * iShiftX);
        var instStartY = startY + (inst * iShiftY);

        var bP = {
            iterations: config.iterations,
            baseLength: config.baseLength * scaleMult,
            branchAngle: config.branchAngle,
            scale: config.lenScale / 100.0,
            twistAngle: isInstanceFlipped ? -config.twistAngle : config.twistAngle,
            baseStroke: config.baseStroke * scaleMult,
            strokeScale: config.strokeScale / 100.0,
            forceBranch: config.forceBranch,
            forceMult: config.forceMult,
            divide: config.divide,
            tangentBase: isInstanceFlipped ? -config.tangentBase : config.tangentBase,
            checkerTangent: config.checkerTangent,
            tangentRandom: config.tangentRandom,
            levelGradientsNormal: ofractalSession.levelGradientsNormal,
            levelGradientsFlipped: ofractalSession.levelGradientsFlipped
        };
        var cP = {
            symbols: ofractalSession.loadedSymbols,
            levels: config.cLevels,
            perNode: config.cPerNode,
            shiftX: (isInstanceFlipped ? -config.cShiftX : config.cShiftX) * scaleMult,
            shiftY: config.cShiftY * scaleMult,
            shiftRand: config.cShiftRand * scaleMult,
            rot: isInstanceFlipped ? -config.cRot : config.cRot,
            rotRand: config.cRotRand,
            sX: config.cScaleX * scaleMult,
            sY: config.cScaleY * scaleMult,
            sRand: config.cScaleRand * scaleMult,
            opac: config.cOpac,
            opacRand: config.cOpacRand,
            hueRand: config.cHueRand
        };

        ofractalSession.geoSeed = config.seed + (inst * iRand);
        ofractalSession.childSeed = (config.seed + 100) + (config.iIncChild ? (inst * iRand) : 0);

        ofractalDrawFractal(instStartX, instStartY, bP.baseLength, rootAngle, bP.iterations, instGroup, bP, cP);
        try { totalLines += instGroup.pageItems.length; } catch (eC) {}
    }

    return totalLines;
}

function ofractalResetSession(removePreview) {
    if (removePreview) ofractalClearPreview();
    ofractalSession.active = false;
    ofractalSession.previewGroup = null;
    ofractalSession.startInfo = null;
    // Keep loadedSymbols across sessions (so user doesn't reload) — they live until cancel
}

// ---------- ENDPOINTS ----------

function ofractalStart(encodedConfig) {
    try {
        if (ofractalSession.active) {
            ofractalResetSession(true);
        }
        var config = ofractalValidateConfig(ofractalParseConfig(encodedConfig));
        var doc = ofractalEnsureDocument();
        ofractalSession.sessionID = Math.floor(Math.random() * 99999).toString(16);
        ofractalSession.startInfo = ofractalGetStartingInfo(doc);
        ofractalSession.active = true;
        var n = ofractalRedraw(config);
        app.redraw();
        return ofractalResponse(true, "Fractal preview ready (" + n + " element(s)).", { items: n });
    } catch (error) {
        ofractalResetSession(true);
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalUpdate(encodedConfig) {
    try {
        if (!ofractalSession.active) return ofractalResponse(false, "No active session.");
        var config = ofractalValidateConfig(ofractalParseConfig(encodedConfig));
        var n = ofractalRedraw(config);
        app.redraw();
        return ofractalResponse(true, "Drew " + n + " element(s).", { items: n });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalApply() {
    try {
        if (!ofractalSession.active) return ofractalResponse(false, "No active session.");
        var n = 0;
        try { n = ofractalSession.previewGroup ? ofractalSession.previewGroup.pageItems.length : 0; } catch (e) {}
        // Detach: rename preview to final
        if (ofractalSession.previewGroup) {
            try { ofractalSession.previewGroup.name = "OF_Final_" + ofractalSession.sessionID; } catch (eR) {}
        }
        ofractalSession.active = false;
        ofractalSession.previewGroup = null;
        ofractalSession.startInfo = null;
        app.redraw();
        return ofractalResponse(true, "Applied (" + n + " items).", { items: n });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalCancel() {
    try {
        if (!ofractalSession.active) return ofractalResponse(true, "No active session.", { wasActive: false });
        ofractalResetSession(true);
        app.redraw();
        return ofractalResponse(true, "Cancelled.", { wasActive: true });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalBake() {
    try {
        if (!ofractalSession.active) return ofractalResponse(false, "No active session.");
        if (!ofractalSession.previewGroup) return ofractalResponse(false, "Preview is empty.");
        var doc = app.activeDocument;
        var dup = ofractalSession.previewGroup.duplicate();
        var sym = doc.symbols.add(dup);
        sym.name = "OF_Bake_" + Math.floor(Math.random() * 9999);
        try { dup.remove(); } catch (e) {}
        app.redraw();
        return ofractalResponse(true, "Baked '" + sym.name + "'.", { symbolName: sym.name });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalAddChildren() {
    try {
        var doc = ofractalEnsureDocument();
        try { doc.selection = null; } catch (eDs) {}
        try { app.paste(); } catch (eP) { throw new Error("Clipboard is empty. Copy objects first."); }
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Clipboard pasted nothing.");
        }
        var sessionID = ofractalSession.sessionID || Math.floor(Math.random() * 99999).toString(16);
        ofractalSession.sessionID = sessionID;
        // Don't replace previously loaded symbols — extend the pool
        var added = 0;
        var existing = ofractalSession.loadedSymbols.length;
        for (var i = 0; i < sel.length; i++) {
            try {
                var sym = doc.symbols.add(sel[i]);
                sym.name = "O_Ch_" + sessionID + "_" + (existing + i);
                ofractalSession.loadedSymbols.push(sym);
                added++;
            } catch (eS) {}
        }
        // Remove the pasted originals (they're now in the symbol pool)
        for (var j = sel.length - 1; j >= 0; j--) {
            try { sel[j].remove(); } catch (eR) {}
        }
        app.redraw();
        return ofractalResponse(true, "Loaded " + added + " child object(s). Pool size: " + ofractalSession.loadedSymbols.length + ".", {
            count: ofractalSession.loadedSymbols.length,
            added: added
        });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalHandshake() {
    try {
        return ofractalResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version,
            sessionActive: !!ofractalSession.active,
            loadedChildren: ofractalSession.loadedSymbols.length
        });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

// ---------- PRESETS ----------

function ofractalEnsurePresetFolder() {
    if (!OFRACTAL_PRESET_FOLDER.exists) {
        try { OFRACTAL_PRESET_FOLDER.create(); } catch (e) {}
    }
}

function ofractalReadPresetsFromDisk() {
    var list = [];
    ofractalEnsurePresetFolder();
    if (!OFRACTAL_PRESET_FOLDER.exists) return list;
    try {
        var files = OFRACTAL_PRESET_FOLDER.getFiles("*.txt");
        if (files) {
            for (var i = 0; i < files.length; i++) {
                try {
                    var f = files[i];
                    if (f.open("r")) {
                        var content = f.read();
                        f.close();
                        var name = decodeURI(f.name).replace(/\.txt$/i, "");
                        var data = { name: name };
                        var lines = content.split("\n");
                        for (var li = 0; li < lines.length; li++) {
                            var ln = lines[li].replace(/\r$/, "");
                            var idx = ln.indexOf(":");
                            if (idx === -1) continue;
                            var k = ln.substring(0, idx);
                            var v = ln.substring(idx + 1);
                            if (v === "true") data[k] = true;
                            else if (v === "false") data[k] = false;
                            else {
                                var num = parseFloat(v);
                                data[k] = isNaN(num) ? v : num;
                            }
                        }
                        list.push(data);
                    }
                } catch (eF) {}
            }
        }
    } catch (eD) {}
    return list;
}

function ofractalWritePresetToDisk(preset) {
    try {
        ofractalEnsurePresetFolder();
        var f = new File(OFRACTAL_PRESET_FOLDER.fsName + "/" + preset.name + ".txt");
        f.open("w");
        for (var k in preset) {
            if (preset.hasOwnProperty(k) && k !== "name") {
                f.writeln(k + ":" + preset[k]);
            }
        }
        f.close();
        return true;
    } catch (e) { return false; }
}

function ofractalListPresets() {
    try {
        var list = ofractalReadPresetsFromDisk();
        return ofractalResponse(true, "OK.", { presets: list });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalSavePreset(encodedConfig) {
    try {
        var raw = ofractalParseConfig(encodedConfig);
        var name = String(raw.name || "");
        name = name.replace(/^\s+|\s+$/g, "");
        if (!name) throw new Error("Preset name is empty.");
        if (name === "-- Default --") throw new Error("Reserved name.");
        if (!ofractalWritePresetToDisk(raw)) throw new Error("Could not write preset file.");
        var list = ofractalReadPresetsFromDisk();
        return ofractalResponse(true, "Preset saved.", { presets: list });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}

function ofractalDeletePreset(encodedConfig) {
    try {
        var raw = ofractalParseConfig(encodedConfig);
        var name = String(raw.name || "");
        if (!name) throw new Error("Preset name is empty.");
        if (name === "-- Default --") throw new Error("Cannot delete default.");
        ofractalEnsurePresetFolder();
        var f = new File(OFRACTAL_PRESET_FOLDER.fsName + "/" + name + ".txt");
        if (f.exists) {
            try { f.remove(); } catch (e) {}
        }
        var list = ofractalReadPresetsFromDisk();
        return ofractalResponse(true, "Preset deleted.", { presets: list });
    } catch (error) {
        return ofractalResponse(false, error.message || String(error));
    }
}
