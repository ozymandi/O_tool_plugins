#target illustrator
#targetengine "OTextCEP"

function otextEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function otextToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + otextEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(otextToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(otextToJson(String(key)) + ":" + otextToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function otextResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return otextToJson(payload);
}

function otextParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function otextEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function otextCollectAllFrames(doc) {
    var arr = [];
    var all = doc.textFrames;
    for (var i = 0; i < all.length; i++) {
        var tf = all[i];
        try {
            if (tf.locked || tf.hidden) continue;
            if (tf.layer && (tf.layer.locked || !tf.layer.visible)) continue;
            arr.push(tf);
        } catch (e) {}
    }
    return arr;
}

function otextAlign(encodedConfig) {
    try {
        var config = otextParseConfig(encodedConfig);
        var key = String(config.align || "");

        var targetAlign;
        if (key === "L") targetAlign = Justification.LEFT;
        else if (key === "C") targetAlign = Justification.CENTER;
        else if (key === "R") targetAlign = Justification.RIGHT;
        else throw new Error("Invalid alignment key.");

        var doc = otextEnsureDocument();
        var frames = otextCollectAllFrames(doc);
        if (frames.length === 0) {
            throw new Error("No editable text frames in this document.");
        }

        var aligned = 0;
        var verified = 0;
        var diag = [];
        for (var i = 0; i < frames.length; i++) {
            var tf = frames[i];

            // 1. Snapshot center
            var b1 = tf.geometricBounds;
            var cx1 = b1[0] + (b1[2] - b1[0]) / 2;
            var cy1 = b1[1] + (b1[3] - b1[1]) / 2;

            // 2. Suspend hyphenation if active (avoids reflow bug)
            var wasHyphenated = false;
            try {
                if (tf.story.textRange.paragraphAttributes.hyphenation) {
                    wasHyphenated = true;
                    tf.story.textRange.paragraphAttributes.hyphenation = false;
                }
            } catch (eH) {}

            // 3. Apply justification — through every channel, no early break.
            //    For LEFT specifically, force a CENTER pass first to break any
            //    "sticky-non-LEFT" state Illustrator silently keeps on the paragraph.
            if (key === "L") {
                try { tf.textRange.justification = Justification.CENTER; } catch (eF1) {}
                try { tf.story.textRange.justification = Justification.CENTER; } catch (eF2) {}
                try {
                    var preParas = tf.paragraphs;
                    for (var pi = 0; pi < preParas.length; pi++) {
                        try { preParas[pi].justification = Justification.CENTER; } catch (eFp) {}
                    }
                } catch (eFa) {}
            }

            // Channel A: per-paragraph top-level setter
            try {
                var pA = tf.paragraphs;
                for (var pAi = 0; pAi < pA.length; pAi++) {
                    try { pA[pAi].justification = targetAlign; } catch (eA1) {}
                }
            } catch (eA0) {}

            // Channel B: per-paragraph paragraphAttributes
            try {
                var pB = tf.paragraphs;
                for (var pBi = 0; pBi < pB.length; pBi++) {
                    try { pB[pBi].paragraphAttributes.justification = targetAlign; } catch (eB1) {}
                }
            } catch (eB0) {}

            // Channel C: story-level
            try { tf.story.textRange.justification = targetAlign; } catch (eC1) {}
            try { tf.story.textRange.paragraphAttributes.justification = targetAlign; } catch (eC2) {}

            // Channel D: frame-level
            try { tf.textRange.justification = targetAlign; } catch (eD1) {}
            try { tf.textRange.paragraphAttributes.justification = targetAlign; } catch (eD2) {}

            // 4. Restore hyphenation
            if (wasHyphenated) {
                try { tf.story.textRange.paragraphAttributes.hyphenation = true; } catch (eR) {}
            }

            // Verify and gather diagnostics
            var beforeStr = "?", afterStr = "?", expectedStr = "?";
            try { expectedStr = String(targetAlign); } catch (eD0) {}
            try { afterStr = String(tf.paragraphs[0].justification); } catch (eD1) {}
            if (afterStr === expectedStr) verified++;
            if (i === 0) {
                diag.push("expected=" + expectedStr);
                diag.push("got=" + afterStr);
                try { diag.push("typeofExpected=" + typeof targetAlign); } catch (eD2) {}
            }

            app.redraw();

            // 5. Snapshot new center, translate-back delta
            var b2 = tf.geometricBounds;
            var cx2 = b2[0] + (b2[2] - b2[0]) / 2;
            var cy2 = b2[1] + (b2[3] - b2[1]) / 2;
            var dx = cx1 - cx2;
            var dy = cy1 - cy2;
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                try { tf.translate(dx, dy); } catch (eT) {}
            }
            aligned++;
        }
        app.redraw();

        var label = (key === "L") ? "left" : (key === "C") ? "center" : "right";
        var summary = "Aligned " + verified + "/" + aligned + " frame(s) " + label + ".";
        if (verified < aligned && diag.length > 0) {
            summary += " [" + diag.join(", ") + "]";
        }
        return otextResponse(true, summary, { count: aligned, verified: verified, diag: diag });
    } catch (error) {
        return otextResponse(false, error.message || String(error));
    }
}

function otextHandshake() {
    try {
        return otextResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return otextResponse(false, error.message || String(error));
    }
}
