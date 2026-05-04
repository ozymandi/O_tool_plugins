(function () {
    var STORAGE_KEY = "olumegradient.panel.settings.v1";

    var DEFAULTS = {
        doFill: true,
        doStroke: false,
        gradType: "linear",
        angle: -90,
        stops: 2,
        intensity: 50
    };

    var SLIDER_PAIRS = [
        ["angle", "angleRange"],
        ["stops", "stopsRange"],
        ["intensity", "intensityRange"]
    ];

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        gradType: DEFAULTS.gradType
    };

    var fields = {
        doFill: document.getElementById("doFill"),
        doStroke: document.getElementById("doStroke"),
        gradType: document.getElementById("gradType"),
        angle: document.getElementById("angle"),
        angleRange: document.getElementById("angleRange"),
        stops: document.getElementById("stops"),
        stopsRange: document.getElementById("stopsRange"),
        intensity: document.getElementById("intensity"),
        intensityRange: document.getElementById("intensityRange")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        cancel: document.getElementById("cancelBtn"),
        reset: document.getElementById("resetBtn"),
        angleReset: document.getElementById("angleResetBtn"),
        stopsReset: document.getElementById("stopsResetBtn"),
        intensityReset: document.getElementById("intensityResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");

    function safeStorageGet() { try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } }
    function safeStorageSet(v) { try { window.localStorage.setItem(STORAGE_KEY, v); } catch (e) {} }

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function refreshControlStates() {
        var idle = !state.active;
        var busy = state.busy;
        var locked = idle || busy;
        var lockableInputs = document.querySelectorAll('.panel[data-lockable] input, .panel[data-lockable] button, .panel[data-lockable] .custom-select');
        Array.prototype.forEach.call(lockableInputs, function (el) {
            if (el.tagName === "DIV") {
                el.style.pointerEvents = locked ? "none" : "";
                el.tabIndex = locked ? -1 : 0;
            } else {
                el.disabled = locked;
            }
        });
        if (state.active) { buttons.primary.textContent = "APPLY"; buttons.primary.disabled = busy; }
        else { buttons.primary.textContent = "GENERATE"; buttons.primary.disabled = busy; }
        buttons.cancel.disabled = busy || !state.active;
        buttons.reset.disabled = busy || !state.active;
        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);
    }

    function setBusy(isBusy) { state.busy = isBusy; refreshControlStates(); }

    function getCepApi() {
        if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
            throw new Error("CEP host bridge is not available.");
        }
        return window.__adobe_cep__;
    }
    function escapeForEval(value) { return encodeURIComponent(value).replace(/'/g, "%27"); }
    function evalHost(script) {
        return new Promise(function (resolve, reject) {
            var cep;
            try { cep = getCepApi(); } catch (error) { reject(error); return; }
            cep.evalScript(script, function (result) {
                if (!result || result === "EvalScript error.") { reject(new Error("Illustrator returned an empty response.")); return; }
                resolve(result);
            });
        });
    }
    function parseHostResponse(result) {
        try { return JSON.parse(result); }
        catch (error) { return { ok: false, message: "Could not parse Illustrator response: " + result }; }
    }
    function callHost(hostFunction, payload) {
        var script;
        if (payload !== undefined && payload !== null) {
            var encoded = escapeForEval(JSON.stringify(payload));
            script = hostFunction + "('" + encoded + "')";
        } else {
            script = hostFunction + "()";
        }
        return evalHost(script).then(parseHostResponse);
    }

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
    function updateSliderFill(input) {
        if (!input) return;
        var min = Number(input.min);
        var max = Number(input.max);
        var value = Number(input.value);
        if (!Number.isFinite(min)) min = 0;
        if (!Number.isFinite(max) || max === min) max = 100;
        if (!Number.isFinite(value)) value = 0;
        if (min < 0) {
            var zeroRatio = clamp((0 - min) / (max - min), 0, 1);
            var valueRatio = clamp((value - min) / (max - min), 0, 1);
            input.style.setProperty("--fill-start", Math.min(zeroRatio, valueRatio) * 100 + "%");
            input.style.setProperty("--fill-end", Math.max(zeroRatio, valueRatio) * 100 + "%");
        } else {
            var ratio = clamp((value - min) / (max - min), 0, 1) * 100;
            input.style.setProperty("--fill-start", "0%");
            input.style.setProperty("--fill-end", ratio + "%");
        }
    }
    function syncPair(numKey, rangeKey, value) {
        var num = Number(value);
        if (!Number.isFinite(num)) num = 0;
        var numField = fields[numKey];
        var rangeField = fields[rangeKey];
        var numMin = Number(numField.min);
        var numMax = Number(numField.max);
        if (Number.isFinite(numMin) && num < numMin) num = numMin;
        if (Number.isFinite(numMax) && num > numMax) num = numMax;
        var step = numField.getAttribute("step");
        if (step === "1") num = Math.round(num);
        numField.value = String(num);
        if (rangeField) {
            var rangeMin = Number(rangeField.min);
            var rangeMax = Number(rangeField.max);
            var clamped = clamp(num, rangeMin, rangeMax);
            rangeField.value = String(clamped);
            updateSliderFill(rangeField);
        }
    }

    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    function getSnapshot() {
        return {
            doFill: !!fields.doFill.checked,
            doStroke: !!fields.doStroke.checked,
            gradType: state.gradType,
            angle: fields.angle.value,
            stops: fields.stops.value,
            intensity: fields.intensity.value
        };
    }
    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snap) {
        fields.doFill.checked = !!snap.doFill;
        fields.doStroke.checked = !!snap.doStroke;
        state.gradType = (snap.gradType === "radial") ? "radial" : "linear";
        fields.gradType.value = state.gradType;
        SLIDER_PAIRS.forEach(function (pair) { syncPair(pair[0], pair[1], snap[pair[0]]); });
        refreshTypeButtons();
    }

    function restoreSettings() {
        var restored = getDefaultConfig();
        var raw = safeStorageGet();
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                Object.keys(parsed).forEach(function (k) {
                    if (restored.hasOwnProperty(k)) restored[k] = parsed[k];
                });
            } catch (e) {}
        }
        applySnapshot(restored);
    }

    function refreshTypeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-type]'), function (btn) {
            btn.classList.toggle("is-active", btn.getAttribute("data-type") === state.gradType);
        });
    }

    function collectConfig() {
        var ang = parseFloat(fields.angle.value);
        var st = parseInt(fields.stops.value, 10);
        var it = parseFloat(fields.intensity.value);
        if (!Number.isFinite(ang)) ang = -90;
        if (!Number.isFinite(st) || st < 2) st = 2;
        if (!Number.isFinite(it) || it < 0) it = 0;
        return {
            doFill: !!fields.doFill.checked,
            doStroke: !!fields.doStroke.checked,
            gradType: state.gradType,
            angle: ang,
            stops: st,
            intensity: it / 100
        };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = collectConfig();
        state.previewPending = callHost("olumegradientUpdate", cfg)
            .then(function (response) {
                if (!response.ok) {
                    setStatus("error", response.message || "Update failed.");
                    if (response.message && response.message.indexOf("No active") !== -1) {
                        state.active = false;
                        refreshControlStates();
                    }
                }
                return response;
            })
            .catch(function (error) { setStatus("error", error.message); })
            .finally(function () {
                state.previewPending = null;
                if (state.previewQueued && state.active) { state.previewQueued = false; sendPreviewUpdate(); }
            });
        return state.previewPending;
    }
    function schedulePreviewUpdate() { if (state.active) sendPreviewUpdate(); }

    async function startGenerate() {
        if (state.busy || state.active) return;
        var cfg = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Building gradients...");
        try {
            var response = await callHost("olumegradientStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Preview ready.");
            actionHintEl.textContent = "Adjust type / angle / stops / intensity. APPLY commits, CANCEL restores originals.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }
    async function applyGenerate() {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        if (state.previewQueued && state.active) {
            state.previewQueued = false;
            await sendPreviewUpdate();
            if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        }
        setBusy(true);
        setStatus("info", "Applying...");
        try {
            var response = await callHost("olumegradientApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Select objects with solid fill or stroke, then press GENERATE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }
    async function cancelGenerate() {
        if (state.busy || !state.active) return;
        state.previewQueued = false;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("olumegradientCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled — originals restored.");
            actionHintEl.textContent = "Select objects with solid fill or stroke, then press GENERATE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }
    function resetDefaults() {
        applySnapshot(getDefaultConfig());
        saveSettings();
        if (state.active) schedulePreviewUpdate();
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("olumegradientHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("olumegradientCancel"); } catch (e) {}
            }
            state.active = false;
            refreshControlStates();
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) { setStatus("error", error.message); }
    }

    // ---------- BOILERPLATE ----------

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
            if (shell && shell.classList && shell.classList.contains("slider-capsule")) return;
            if (!shell || !shell.classList || !shell.classList.contains("number-input-shell")) {
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
            for (var i = 0; i < Math.abs(stepDelta); i += 1) adjustNumberInput(dragState.input, stepDelta > 0 ? 1 : -1);
            dragState.lastSteps = deltaSteps;
            e.preventDefault();
        }, true);
        document.addEventListener("mouseup", finishScrub, true);
        window.addEventListener("blur", finishScrub);
    }

    function onParameterChanged() {
        saveSettings();
        if (state.active) schedulePreviewUpdate();
    }
    function bindSliderPair(numKey, rangeKey) {
        var numField = fields[numKey];
        var rangeField = fields[rangeKey];
        if (rangeField) {
            rangeField.addEventListener("input", function () {
                if (rangeField.disabled) return;
                syncPair(numKey, rangeKey, rangeField.value);
                onParameterChanged();
            });
        }
        if (numField) {
            numField.addEventListener("input", function () {
                if (numField.disabled) return;
                syncPair(numKey, rangeKey, numField.value);
                onParameterChanged();
            });
        }
    }
    function bindCheckbox(key) {
        fields[key].addEventListener("change", function () {
            if (fields[key].disabled) return;
            saveSettings();
            if (state.active) schedulePreviewUpdate();
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindCheckbox("doFill");
    bindCheckbox("doStroke");

    Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-type]'), function (btn) {
        btn.addEventListener("click", function () {
            state.gradType = btn.getAttribute("data-type") || "linear";
            fields.gradType.value = state.gradType;
            refreshTypeButtons();
            saveSettings();
            if (state.active) schedulePreviewUpdate();
        });
    });

    buttons.angleReset.addEventListener("click", function () {
        if (buttons.angleReset.disabled) return;
        syncPair("angle", "angleRange", DEFAULTS.angle);
        onParameterChanged();
    });
    buttons.stopsReset.addEventListener("click", function () {
        if (buttons.stopsReset.disabled) return;
        syncPair("stops", "stopsRange", DEFAULTS.stops);
        onParameterChanged();
    });
    buttons.intensityReset.addEventListener("click", function () {
        if (buttons.intensityReset.disabled) return;
        syncPair("intensity", "intensityRange", DEFAULTS.intensity);
        onParameterChanged();
    });

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyGenerate();
        else startGenerate();
    });
    buttons.cancel.addEventListener("click", function () { if (!buttons.cancel.disabled) cancelGenerate(); });
    buttons.reset.addEventListener("click", function () { if (!buttons.reset.disabled) resetDefaults(); });

    refreshTypeButtons();
    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
