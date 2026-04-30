#target illustrator
#targetengine "OAlignCEP"

var OALIGN_DEBUG = false;
var debugLogFile = new File(Folder.desktop + "/oalign_cep_log.txt");

function oalignLog(message) {
    if (!OALIGN_DEBUG) return;
    try {
        debugLogFile.open("a");
        debugLogFile.writeln("[" + new Date().toUTCString() + "] " + message);
        debugLogFile.close();
    } catch (e) {}
}

function oalignEscapeString(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, '\\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

function oalignToJson(value) {
    var i, parts, key;
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return '"' + oalignEscapeString(value) + '"';
    if (typeof value === "number") return isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) parts.push(oalignToJson(value[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (key in value) {
        if (value.hasOwnProperty(key)) {
            parts.push(oalignToJson(String(key)) + ":" + oalignToJson(value[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function oalignResponse(ok, message, data) {
    var payload = { ok: !!ok, message: message || "" };
    var key;
    if (data) {
        for (key in data) {
            if (data.hasOwnProperty(key)) payload[key] = data[key];
        }
    }
    return oalignToJson(payload);
}

function oalignParseConfig(encodedConfig) {
    var raw = decodeURIComponent(encodedConfig || "");
    return eval("(" + raw + ")");
}

function oalignValidateConfig(config) {
    var validDir = { auto: 1, horizontal: 1, vertical: 1 };
    var validPivot = { center: 1, first: 1, second: 1 };
    return {
        direction: validDir.hasOwnProperty(config.direction) ? config.direction : "auto",
        pivot: validPivot.hasOwnProperty(config.pivot) ? config.pivot : "center"
    };
}

function oalignEnsureDocument() {
    if (app.documents.length === 0) throw new Error("Open an Illustrator document first.");
    return app.activeDocument;
}

function oalignFindSelectedPoints(items, found) {
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.typename === "PathItem") {
            var pts = item.pathPoints;
            if (item.selected) {
                if (pts.length >= 2) {
                    found.push({ x: pts[0].anchor[0], y: pts[0].anchor[1], parent: item });
                    found.push({ x: pts[pts.length - 1].anchor[0], y: pts[pts.length - 1].anchor[1], parent: item });
                }
            } else {
                for (var j = 0; j < pts.length; j++) {
                    if (pts[j].selected === PathPointSelection.ANCHORPOINT) {
                        found.push({ x: pts[j].anchor[0], y: pts[j].anchor[1], parent: item });
                    }
                }
            }
        } else if (item.typename === "GroupItem" || item.typename === "CompoundPathItem") {
            if (item.pathItems) oalignFindSelectedPoints(item.pathItems, found);
            if (item.pageItems) oalignFindSelectedPoints(item.pageItems, found);
        }
    }
}

function oalignGetTargetParent(item) {
    var current = item;
    while (current.parent && current.parent.typename !== "Layer" && current.parent.typename !== "Document") {
        current = current.parent;
    }
    return current;
}

function oalignGetCenter(obj) {
    return {
        x: obj.left + obj.width / 2,
        y: obj.top - obj.height / 2
    };
}

function oalignComputeRotation(angleDeg, direction) {
    if (direction === "horizontal") {
        if (angleDeg > 90) return 180 - angleDeg;
        if (angleDeg < -90) return -180 - angleDeg;
        return -angleDeg;
    }
    if (direction === "vertical") {
        if (angleDeg >= 0) return 90 - angleDeg;
        return -90 - angleDeg;
    }
    var absAngle = Math.abs(angleDeg);
    if (absAngle <= 45 || absAngle >= 135) {
        if (angleDeg > 90) return 180 - angleDeg;
        if (angleDeg < -90) return -180 - angleDeg;
        return -angleDeg;
    }
    if (angleDeg > 0) return 90 - angleDeg;
    return -90 - angleDeg;
}

function oalignRotateAroundPivot(target, rotationDeg, pivot) {
    if (Math.abs(rotationDeg) < 0.0001) return;

    if (!pivot) {
        target.rotate(rotationDeg);
        return;
    }

    var center = oalignGetCenter(target);
    var dx = pivot.x - center.x;
    var dy = pivot.y - center.y;
    var rad = rotationDeg * Math.PI / 180;
    var cosA = Math.cos(rad);
    var sinA = Math.sin(rad);
    var newDx = dx * cosA - dy * sinA;
    var newDy = dx * sinA + dy * cosA;
    var shiftX = dx - newDx;
    var shiftY = dy - newDy;

    target.rotate(rotationDeg);
    target.translate(shiftX, shiftY);
}

function oalignRun(encodedConfig) {
    try {
        var config = oalignValidateConfig(oalignParseConfig(encodedConfig));
        var doc = oalignEnsureDocument();
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            throw new Error("Select 2 anchor points or a 2-point line first.");
        }

        var found = [];
        oalignFindSelectedPoints(sel, found);

        if (found.length < 2) {
            throw new Error("Need at least 2 anchor points; got " + found.length + ".");
        }

        var p1 = found[0];
        var p2 = found[1];

        var deltaX = p2.x - p1.x;
        var deltaY = p2.y - p1.y;
        var angleDeg = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
        var rotation = oalignComputeRotation(angleDeg, config.direction);

        var target = oalignGetTargetParent(p1.parent);
        var pivot = null;
        if (config.pivot === "first") pivot = { x: p1.x, y: p1.y };
        else if (config.pivot === "second") pivot = { x: p2.x, y: p2.y };

        oalignRotateAroundPivot(target, rotation, pivot);
        app.redraw();

        var actualDir;
        if (config.direction === "auto") {
            var absAngle = Math.abs(angleDeg);
            actualDir = (absAngle <= 45 || absAngle >= 135) ? "horizontal" : "vertical";
        } else {
            actualDir = config.direction;
        }

        return oalignResponse(true, "Aligned to " + actualDir + " (" + rotation.toFixed(2) + " deg).", {
            rotation: rotation,
            direction: actualDir
        });
    } catch (error) {
        oalignLog(error.message || String(error));
        return oalignResponse(false, error.message || String(error));
    }
}

function oalignHandshake() {
    try {
        return oalignResponse(true, "Panel connected.", {
            hostName: app.name,
            hostVersion: app.version
        });
    } catch (error) {
        return oalignResponse(false, error.message || String(error));
    }
}
