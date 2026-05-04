#target illustrator
#targetengine "OTextCEP"

var OTEXT_DEBUG = true;
var otextLogFile = new File(Folder.desktop + "/otext_debug.log");

function otextLog(message) {
    if (!OTEXT_DEBUG) return;
    try {
        otextLogFile.open("a");
        otextLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        otextLogFile.close();
    } catch (e) {}
}

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

        // Truncate previous log so each click is a fresh trace
        try { if (otextLogFile.exists) otextLogFile.remove(); } catch (eClr) {}
        otextLog("=== align run, key=" + key + ", target=" + String(targetAlign) + ", frames=" + frames.length + " ===");
        try {
            var enumKeys = [];
            for (var ek in Justification) { enumKeys.push(ek); }
            otextLog("Justification members: " + enumKeys.join(","));
        } catch (eEnum) { otextLog("enum dump failed: " + eEnum.message); }

        for (var i = 0; i < frames.length; i++) {
            var tf = frames[i];

            otextLog("--- frame " + i + " (typename=" + tf.typename + ", kind=" + (tf.kind || "?") + ") ---");
            try {
                otextLog("  before: tf.paragraphs[0].justification=" + String(tf.paragraphs[0].justification));
            } catch (eBR) { otextLog("  before read failed: " + eBR.message); }

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
                    try { pA[pAi].justification = targetAlign; otextLog("  A[" + pAi + "] ok"); }
                    catch (eA1) { otextLog("  A[" + pAi + "] err: " + eA1.message); }
                }
            } catch (eA0) { otextLog("  A0 err: " + eA0.message); }

            // Channel B: per-paragraph paragraphAttributes
            try {
                var pB = tf.paragraphs;
                for (var pBi = 0; pBi < pB.length; pBi++) {
                    try { pB[pBi].paragraphAttributes.justification = targetAlign; otextLog("  B[" + pBi + "] ok"); }
                    catch (eB1) { otextLog("  B[" + pBi + "] err: " + eB1.message); }
                }
            } catch (eB0) { otextLog("  B0 err: " + eB0.message); }

            // Channel C: story-level
            try { tf.story.textRange.justification = targetAlign; otextLog("  C1 ok"); }
            catch (eC1) { otextLog("  C1 err: " + eC1.message); }
            try { tf.story.textRange.paragraphAttributes.justification = targetAlign; otextLog("  C2 ok"); }
            catch (eC2) { otextLog("  C2 err: " + eC2.message); }

            // Channel D: frame-level
            try { tf.textRange.justification = targetAlign; otextLog("  D1 ok"); }
            catch (eD1) { otextLog("  D1 err: " + eD1.message); }
            try { tf.textRange.paragraphAttributes.justification = targetAlign; otextLog("  D2 ok"); }
            catch (eD2) { otextLog("  D2 err: " + eD2.message); }

            try {
                otextLog("  after channels: tf.paragraphs[0].justification=" + String(tf.paragraphs[0].justification));
            } catch (eAR) { otextLog("  after read failed: " + eAR.message); }

            // Channel E: menu-command fallback. Some Illustrator versions silently
            // refuse Justification.LEFT via scripting. The Type > Paragraph menu
            // commands hit a different code path and do work.
            var stillWrong = false;
            try { stillWrong = (tf.paragraphs[0].justification !== targetAlign); } catch (eCheck) {}
            if (stillWrong) {
                var menuCandidates = [];
                if (key === "L") menuCandidates = ["Left Justify", "Justify Left", "JustifyLeft", "left", "AI Style: Type Align Left"];
                else if (key === "C") menuCandidates = ["Center Justify", "Justify Center", "JustifyCenter", "center"];
                else if (key === "R") menuCandidates = ["Right Justify", "Justify Right", "JustifyRight", "right"];

                // Save current document selection so we can restore it
                var savedSel = [];
                try {
                    var docSel = doc.selection;
                    if (docSel && docSel.length) {
                        for (var sv = 0; sv < docSel.length; sv++) savedSel.push(docSel[sv]);
                    }
                } catch (eSv) {}

                try { doc.selection = null; } catch (eDs) {}
                try { tf.selected = true; } catch (eSel) { otextLog("  E: select frame err: " + eSel.message); }

                for (var mci = 0; mci < menuCandidates.length; mci++) {
                    var cmd = menuCandidates[mci];
                    var pre;
                    try { pre = String(tf.paragraphs[0].justification); } catch (ePre) { pre = "?"; }
                    try { app.executeMenuCommand(cmd); otextLog("  E[" + cmd + "] cmd-ok"); }
                    catch (eM) { otextLog("  E[" + cmd + "] cmd-err: " + eM.message); }
                    var post;
                    try { post = String(tf.paragraphs[0].justification); } catch (ePost) { post = "?"; }
                    otextLog("  E[" + cmd + "] " + pre + " -> " + post);
                    if (post === String(targetAlign)) {
                        otextLog("  E winner: '" + cmd + "'");
                        break;
                    }
                }

                // Restore selection
                try { doc.selection = null; } catch (eRs) {}
                for (var rs = 0; rs < savedSel.length; rs++) {
                    try { savedSel[rs].selected = true; } catch (eRr) {}
                }
            }

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
