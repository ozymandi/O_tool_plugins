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

function otextCollectFrames(items, arr) {
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.locked || item.hidden) continue;
        if (item.typename === "TextFrame") {
            arr.push(item);
        } else if (item.typename === "GroupItem") {
            otextCollectFrames(item.pageItems, arr);
        }
    }
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
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select one or more text frames first.");
        }

        var frames = [];
        otextCollectFrames(sel, frames);
        if (frames.length === 0) {
            throw new Error("No text frames in selection.");
        }

        var aligned = 0;
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

            // 3. Apply justification
            try {
                tf.story.textRange.justification = targetAlign;
            } catch (eJ) {
                try { tf.textRange.justification = targetAlign; } catch (eJ2) {}
            }

            // 4. Restore hyphenation
            if (wasHyphenated) {
                try { tf.story.textRange.paragraphAttributes.hyphenation = true; } catch (eR) {}
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
        return otextResponse(true, "Aligned " + aligned + " frame(s) " + label + ".", { count: aligned });
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
