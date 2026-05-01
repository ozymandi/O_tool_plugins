(function () {
    var STORAGE_KEY = "ospiral.panel.settings.v1";

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false
    };

    var fields = {
        mode: document.getElementById("mode"),
        loops: document.getElementById("loops"),
        loopsRange: document.getElementById("loopsRange"),
        randomness: document.getElementById("randomness"),
        randomnessRange: document.getElementById("randomnessRange"),
        density: document.getElementById("density"),
        densityRange: document.getElementById("densityRange"),
        tension: document.getElementById("tension"),
        tensionRange: document.getElementById("tensionRange"),
        direction: document.getElementById("direction")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        apply: document.getElementById("applyBtn"),
        cancel: document.getElementById("cancelBtn"),
        reset: document.getElementById("resetBtn"),
        loopsReset: document.getElementById("loopsResetBtn"),
        randomnessReset: document.getElementById("randomnessResetBtn"),
        densityReset: document.getElementById("densityResetBtn"),
        tensionReset: document.getElementById("tensionResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");

    var DEFAULTS = {
        mode: "total",
        loops: 15,
        randomness: 0,
        density: 12,
        tension: 33,
        direction: "cw"
    };

    var SLIDER_PAIRS = [
        ["loops", "loopsRange"],
        ["randomness", "randomnessRange"],
        ["density", "densityRange"],
        ["tension", "tensionRange"]
    ];

    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    function safeStorageGet() {
        try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function safeStorageSet(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function refreshControlStates() {
        var idle = !state.active;
        var busy = state.busy;
        var locked = idle || busy;

        var lockableInputs = document.querySelectorAll('.panel[data-lockable] input, .panel[data-lockable] button');
        Array.prototype.forEach.call(lockableInputs, function (el) {
            el.disabled = locked;
        });

        if (state.active) {
            buttons.primary.textContent = "APPLY";
            buttons.primary.disabled = busy;
        } else {
            buttons.primary.textContent = "SPIRAL";
            buttons.primary.disabled = busy;
        }

        buttons.apply.disabled = busy || !state.active;
        buttons.cancel.disabled = busy || !state.active;
        buttons.reset.disabled = locked;

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);
    }

    function setBusy(isBusy) {
        state.busy = isBusy;
        refreshControlStates();
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
        catch (error) {
            return { ok: false, message: "Could not parse Illustrator response: " + result };
        }
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
            var fillStart = Math.min(zeroRatio, valueRatio) * 100;
            var fillEnd = Math.max(zeroRatio, valueRatio) * 100;
            input.style.setProperty("--fill-start", fillStart + "%");
            input.style.setProperty("--fill-end", fillEnd + "%");
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

    function updateModeButtons() {
        var current = String(fields.mode.value || "total");
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-mode]"), function (button) {
            var active = button.getAttribute("data-mode") === current;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function updateDirectionButtons() {
        var current = String(fields.direction.value || "cw");
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-direction]"), function (button) {
            var active = button.getAttribute("data-direction") === current;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function getSnapshot() {
        return {
            mode: fields.mode.value,
            loops: fields.loops.value,
            randomness: fields.randomness.value,
            density: fields.density.value,
            tension: fields.tension.value,
            direction: fields.direction.value
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        fields.mode.value = String(snapshot.mode || "total");
        fields.direction.value = String(snapshot.direction || "cw");
        SLIDER_PAIRS.forEach(function (pair) {
            syncPair(pair[0], pair[1], snapshot[pair[0]]);
        });
        updateModeButtons();
        updateDirectionButtons();
    }

    function restoreSettings() {
        var restored = getDefaultConfig();
        var raw = safeStorageGet();
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                Object.keys(parsed).forEach(function (key) {
                    if (restored.hasOwnProperty(key)) restored[key] = parsed[key];
                });
            } catch (error) {}
        }
        applySnapshot(restored);
    }

    function collectConfig() {
        var loops = parseInt(fields.loops.value, 10);
        if (!Number.isFinite(loops) || loops < 1) loops = 1;
        var randomness = parseFloat(fields.randomness.value);
        if (!Number.isFinite(randomness)) randomness = 0;
        if (randomness < 0) randomness = 0;
        if (randomness > 100) randomness = 100;
        var density = parseInt(fields.density.value, 10);
        if (!Number.isFinite(density) || density < 4) density = 4;
        var tension = parseFloat(fields.tension.value);
        if (!Number.isFinite(tension)) tension = 33;
        return {
            mode: String(fields.mode.value || "total"),
            loops: loops,
            randomness: randomness,
            density: density,
            tension: tension,
            direction: String(fields.direction.value || "cw")
        };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = collectConfig();
        state.previewPending = callHost("ospiralUpdate", cfg)
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
                if (state.previewQueued && state.active) {
                    state.previewQueued = false;
                    sendPreviewUpdate();
                }
            });
        return state.previewPending;
    }

    function schedulePreviewUpdate() {
        if (!state.active) return;
        sendPreviewUpdate();
    }

    async function startSpiral() {
        if (state.busy || state.active) return;
        var cfg = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Building spiral...");
        try {
            var response = await callHost("ospiralStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Spiral preview ready.");
            actionHintEl.textContent = "Adjust parameters. APPLY commits, CANCEL reverts.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function applySpiral() {
        if (state.busy || !state.active) return;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        if (state.previewQueued && state.active) {
            state.previewQueued = false;
            await sendPreviewUpdate();
            if (state.previewPending) {
                try { await state.previewPending; } catch (e) {}
            }
        }
        setBusy(true);
        setStatus("info", "Applying...");
        try {
            var response = await callHost("ospiralApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Select 2 or more circles, then press SPIRAL.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function cancelSpiral() {
        if (state.busy || !state.active) return;
        state.previewQueued = false;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("ospiralCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Select 2 or more circles, then press SPIRAL.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("ospiralHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("ospiralCancel"); } catch (e) {}
            }
            state.active = false;
            refreshControlStates();
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

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
            var field = input.closest(".field");
            var shell = input.parentNode;
            if (!field) return;
            if (shell && shell.classList && shell.classList.contains("slider-capsule")) return;
            if (!shell.classList.contains("number-input-shell")) {
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

    function bindSegRow(name, fieldKey, updateFn) {
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-" + name + "]"), function (button) {
            button.addEventListener("click", function () {
                if (button.disabled) return;
                fields[fieldKey].value = button.getAttribute("data-" + name);
                updateFn();
                onParameterChanged();
            });
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindSegRow("mode", "mode", updateModeButtons);
    bindSegRow("direction", "direction", updateDirectionButtons);

    buttons.loopsReset.addEventListener("click", function () {
        if (buttons.loopsReset.disabled) return;
        syncPair("loops", "loopsRange", DEFAULTS.loops);
        onParameterChanged();
    });
    buttons.randomnessReset.addEventListener("click", function () {
        if (buttons.randomnessReset.disabled) return;
        syncPair("randomness", "randomnessRange", DEFAULTS.randomness);
        onParameterChanged();
    });
    buttons.densityReset.addEventListener("click", function () {
        if (buttons.densityReset.disabled) return;
        syncPair("density", "densityRange", DEFAULTS.density);
        onParameterChanged();
    });
    buttons.tensionReset.addEventListener("click", function () {
        if (buttons.tensionReset.disabled) return;
        syncPair("tension", "tensionRange", DEFAULTS.tension);
        onParameterChanged();
    });

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applySpiral();
        else startSpiral();
    });

    buttons.apply.addEventListener("click", function () {
        if (buttons.apply.disabled) return;
        applySpiral();
    });

    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        cancelSpiral();
    });

    buttons.reset.addEventListener("click", function () {
        if (buttons.reset.disabled) return;
        applySnapshot(getDefaultConfig());
        saveSettings();
        setStatus("info", "Parameters reset to defaults.");
        if (state.active) schedulePreviewUpdate();
    });

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
