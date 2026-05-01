(function () {
    var STORAGE_KEY = "oautoshape.panel.settings.v1";
    var state = { busy: false };

    var SHAPE_KEYS = [
        "Circle", "Ellipse", "Square", "Rectangle", "RoundedRectangle",
        "Triangle", "Line", "Polyline", "Arc", "Hexagon", "Star",
        "Polygon", "PolarGrid", "RectangularGrid"
    ];

    var DEFAULTS = {
        Circle: true, Ellipse: true, Square: true, Rectangle: true, RoundedRectangle: true,
        Triangle: true, Line: true, Polyline: true, Arc: true, Hexagon: true, Star: true,
        Polygon: true, PolarGrid: false, RectangularGrid: false,
        rectRows: 5, rectCols: 5, rectRowsEn: true, rectColsEn: true,
        polarRings: 5, polarRays: 6
    };

    var checks = {};
    SHAPE_KEYS.forEach(function (key) {
        checks[key] = document.querySelector('input[data-shape="' + key + '"]');
    });

    var fields = {
        rectRows: document.getElementById("g_rectRows"),
        rectCols: document.getElementById("g_rectCols"),
        rectRowsEn: document.getElementById("g_rectRowsEn"),
        rectColsEn: document.getElementById("g_rectColsEn"),
        polarRings: document.getElementById("g_polarRings"),
        polarRays: document.getElementById("g_polarRays")
    };

    var buttons = {
        process: document.getElementById("processBtn"),
        copy: document.getElementById("copyBtn"),
        toggleAll: document.getElementById("toggleAllBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    function safeStorageGet() {
        try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }
    function safeStorageSet(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function setBusy(isBusy) {
        Object.keys(buttons).forEach(function (k) { if (buttons[k]) buttons[k].disabled = isBusy; });
        state.busy = isBusy;
    }

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function getCepApi() {
        if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
            throw new Error("CEP host bridge is not available.");
        }
        return window.__adobe_cep__;
    }

    function escapeForEval(value) {
        return encodeURIComponent(value).replace(/'/g, "%27");
    }

    function evalHost(script) {
        return new Promise(function (resolve, reject) {
            var cep;
            try { cep = getCepApi(); } catch (error) { reject(error); return; }
            cep.evalScript(script, function (result) {
                if (!result || result === "EvalScript error.") {
                    reject(new Error("Illustrator returned an empty response."));
                    return;
                }
                resolve(result);
            });
        });
    }

    function parseHostResponse(result) {
        try { return JSON.parse(result); }
        catch (error) { return { ok: false, message: "Could not parse Illustrator response: " + result }; }
    }

    function getSnapshot() {
        var snap = {};
        SHAPE_KEYS.forEach(function (key) { snap[key] = !!checks[key].checked; });
        snap.rectRows = fields.rectRows.value;
        snap.rectCols = fields.rectCols.value;
        snap.rectRowsEn = !!fields.rectRowsEn.checked;
        snap.rectColsEn = !!fields.rectColsEn.checked;
        snap.polarRings = fields.polarRings.value;
        snap.polarRays = fields.polarRays.value;
        return snap;
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snap) {
        SHAPE_KEYS.forEach(function (key) { checks[key].checked = !!snap[key]; });
        fields.rectRows.value = String(snap.rectRows);
        fields.rectCols.value = String(snap.rectCols);
        fields.rectRowsEn.checked = !!snap.rectRowsEn;
        fields.rectColsEn.checked = !!snap.rectColsEn;
        fields.polarRings.value = String(snap.polarRings);
        fields.polarRays.value = String(snap.polarRays);
        refreshToggleAllLabel();
    }

    function restoreSettings() {
        var restored = JSON.parse(JSON.stringify(DEFAULTS));
        var raw = safeStorageGet();
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                Object.keys(parsed).forEach(function (key) {
                    if (restored.hasOwnProperty(key)) restored[key] = parsed[key];
                });
            } catch (e) {}
        }
        applySnapshot(restored);
    }

    function collectConfig(keepOriginal) {
        var activeTypes = {};
        SHAPE_KEYS.forEach(function (key) { activeTypes[key] = !!checks[key].checked; });
        var rectRows = parseInt(fields.rectRows.value, 10);
        var rectCols = parseInt(fields.rectCols.value, 10);
        var polarRings = parseInt(fields.polarRings.value, 10);
        var polarRays = parseInt(fields.polarRays.value, 10);
        if (!Number.isFinite(rectRows) || rectRows < 1) rectRows = 1;
        if (!Number.isFinite(rectCols) || rectCols < 1) rectCols = 1;
        if (!Number.isFinite(polarRings) || polarRings < 1) polarRings = 1;
        if (!Number.isFinite(polarRays) || polarRays < 1) polarRays = 1;
        return {
            activeTypes: activeTypes,
            rectRows: rectRows,
            rectCols: rectCols,
            rectRowsEn: !!fields.rectRowsEn.checked,
            rectColsEn: !!fields.rectColsEn.checked,
            polarRings: polarRings,
            polarRays: polarRays,
            keepOriginal: !!keepOriginal
        };
    }

    function refreshToggleAllLabel() {
        var allOn = SHAPE_KEYS.every(function (key) { return !!checks[key].checked; });
        buttons.toggleAll.textContent = allOn ? "DESELECT ALL" : "SELECT ALL";
    }

    async function runProcess(keepOriginal) {
        if (state.busy) return;
        var anyOn = SHAPE_KEYS.some(function (key) { return !!checks[key].checked; });
        if (!anyOn) { setStatus("error", "Enable at least one shape type."); return; }
        var config = collectConfig(keepOriginal);
        saveSettings();
        setBusy(true);
        setStatus("info", keepOriginal ? "Processing as copy..." : "Processing...");
        try {
            var payload = escapeForEval(JSON.stringify(config));
            var response = parseHostResponse(await evalHost("oautoshapeRun('" + payload + "')"));
            if (!response.ok) throw new Error(response.message || "Illustrator returned an error.");
            setStatus("success", response.message || "Done.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function initializePanel() {
        try {
            var handshake = parseHostResponse(await evalHost("oautoshapeHandshake()"));
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    // ---------- Boilerplate scrub/wheel ----------

    function adjustNumberInput(input, direction) {
        var currentValue = Number(input.value);
        var stepAttr = input.getAttribute("step");
        var stepValue = stepAttr && stepAttr !== "any" ? Number(stepAttr) : 1;
        var minAttr = input.getAttribute("min");
        var maxAttr = input.getAttribute("max");
        var minValue = minAttr !== null ? Number(minAttr) : null;
        var maxValue = maxAttr !== null ? Number(maxAttr) : null;
        var precision = 0;
        if (!Number.isFinite(stepValue) || stepValue <= 0) stepValue = 1;
        if (!Number.isFinite(currentValue)) currentValue = 0;
        if (String(stepValue).indexOf(".") !== -1) precision = String(stepValue).split(".")[1].length;
        var nextValue = currentValue + direction * stepValue;
        if (Number.isFinite(minValue) && nextValue < minValue) nextValue = minValue;
        if (Number.isFinite(maxValue) && nextValue > maxValue) nextValue = maxValue;
        if (precision > 0) nextValue = Number(nextValue.toFixed(precision));
        input.value = String(nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function bindNumberWheel() {
        document.querySelectorAll('input[type="number"]').forEach(function (input) {
            input.addEventListener("wheel", function (e) {
                if (input.disabled) return;
                e.preventDefault();
                input.focus();
                adjustNumberInput(input, e.deltaY < 0 ? 1 : -1);
            }, { passive: false });
        });
    }

    function bindNumericScrubbers() {
        var dragState = null;
        function finishScrub() {
            if (!dragState) return;
            dragState.input.dispatchEvent(new Event("change", { bubbles: true }));
            dragState = null;
            document.body.classList.remove("is-number-scrubbing");
        }
        document.querySelectorAll('input[type="number"]').forEach(function (input) {
            var shell = input.parentNode;
            if (!shell || (shell.classList && shell.classList.contains("slider-capsule"))) return;
            if (!shell.classList || !shell.classList.contains("number-input-shell")) {
                shell = document.createElement("div");
                shell.className = "number-input-shell";
                input.parentNode.insertBefore(shell, input);
                shell.appendChild(input);
            }
            var handle = shell.querySelector(".number-scrub-handle");
            if (!handle) {
                handle = document.createElement("button");
                handle.type = "button";
                handle.className = "number-scrub-handle";
                handle.tabIndex = -1;
                handle.setAttribute("aria-hidden", "true");
                shell.appendChild(handle);
            }
            handle.addEventListener("mousedown", function (e) {
                if (e.button !== 0 || input.disabled) return;
                dragState = { input: input, startX: e.clientX, lastSteps: 0 };
                document.body.classList.add("is-number-scrubbing");
                input.focus();
                e.preventDefault();
                e.stopPropagation();
            });
        });
        document.addEventListener("mousemove", function (e) {
            if (!dragState) return;
            var deltaSteps = Math.trunc((e.clientX - dragState.startX) / (e.shiftKey ? 4 : 10));
            var stepDelta = deltaSteps - dragState.lastSteps;
            if (!stepDelta) { e.preventDefault(); return; }
            for (var i = 0; i < Math.abs(stepDelta); i += 1) {
                adjustNumberInput(dragState.input, stepDelta > 0 ? 1 : -1);
            }
            dragState.lastSteps = deltaSteps;
            e.preventDefault();
        }, true);
        document.addEventListener("mouseup", finishScrub, true);
        window.addEventListener("blur", finishScrub);
    }

    SHAPE_KEYS.forEach(function (key) {
        checks[key].addEventListener("change", function () {
            saveSettings();
            refreshToggleAllLabel();
        });
    });

    Object.keys(fields).forEach(function (key) {
        fields[key].addEventListener("change", saveSettings);
        fields[key].addEventListener("input", saveSettings);
    });

    buttons.toggleAll.addEventListener("click", function () {
        var allOn = SHAPE_KEYS.every(function (key) { return !!checks[key].checked; });
        var newValue = !allOn;
        SHAPE_KEYS.forEach(function (key) { checks[key].checked = newValue; });
        saveSettings();
        refreshToggleAllLabel();
    });

    buttons.process.addEventListener("click", function () { runProcess(false); });
    buttons.copy.addEventListener("click", function () { runProcess(true); });

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    initializePanel();
})();
