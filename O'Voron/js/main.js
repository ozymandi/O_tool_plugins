(function () {
    var STORAGE_KEY = "ovoron.panel.settings.v1";

    var METRIC_LABELS = ["Euclidean", "Manhattan", "Chebychev", "Minkowski"];

    var DEFAULTS = {
        metric: 0,
        seed: 12345,
        density: 20,
        randomness: 0,
        block: 8,
        steps: 0,
        outline: false,
        outWidth: 1,
        bounds: true,
        origCol: false,
        delPar: true
    };

    var SLIDER_PAIRS = [
        ["density", "densityRange"],
        ["randomness", "randomnessRange"],
        ["block", "blockRange"],
        ["steps", "stepsRange"],
        ["outWidth", "outWidthRange"]
    ];

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        activeDropdown: null,
        metric: DEFAULTS.metric,
        presets: [],
        currentPreset: "Default"
    };

    var fields = {
        metric: document.getElementById("metric"),
        metricLabel: document.getElementById("metricLabel"),
        preset: document.getElementById("preset"),
        presetLabel: document.getElementById("presetLabel"),
        seed: document.getElementById("seed"),
        density: document.getElementById("density"),
        densityRange: document.getElementById("densityRange"),
        randomness: document.getElementById("randomness"),
        randomnessRange: document.getElementById("randomnessRange"),
        block: document.getElementById("block"),
        blockRange: document.getElementById("blockRange"),
        steps: document.getElementById("steps"),
        stepsRange: document.getElementById("stepsRange"),
        outline: document.getElementById("outline"),
        outWidth: document.getElementById("outWidth"),
        outWidthRange: document.getElementById("outWidthRange"),
        bounds: document.getElementById("bounds"),
        origCol: document.getElementById("origCol"),
        delPar: document.getElementById("delPar")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        cancel: document.getElementById("cancelBtn"),
        bake: document.getElementById("bakeBtn"),
        reset: document.getElementById("resetBtn"),
        newSeed: document.getElementById("newSeedBtn"),
        savePreset: document.getElementById("savePresetBtn"),
        deletePreset: document.getElementById("deletePresetBtn"),
        densityReset: document.getElementById("densityResetBtn"),
        randomnessReset: document.getElementById("randomnessResetBtn"),
        blockReset: document.getElementById("blockResetBtn"),
        stepsReset: document.getElementById("stepsResetBtn"),
        outWidthReset: document.getElementById("outWidthResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");
    var presetOptionsEl = document.getElementById("presetOptions");

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

    // ---------- VISIBILITY / CONTROL STATE ----------

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

        if (state.active) {
            buttons.primary.textContent = "APPLY";
            buttons.primary.disabled = busy;
        } else {
            buttons.primary.textContent = "GENERATE";
            buttons.primary.disabled = busy;
        }
        buttons.cancel.disabled = busy || !state.active;
        buttons.bake.disabled = busy || !state.active;
        buttons.reset.disabled = locked;

        // Preset controls always usable (presets edit settings, not the canvas)
        buttons.savePreset.disabled = busy;
        buttons.deletePreset.disabled = busy || (state.currentPreset === "Default");

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);
    }

    function setBusy(isBusy) {
        state.busy = isBusy;
        refreshControlStates();
    }

    // ---------- HOST BRIDGE ----------

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

    // ---------- SLIDERS ----------

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function updateSliderFill(input) {
        if (!input) return;
        var min = Number(input.min);
        var max = Number(input.max);
        var value = Number(input.value);
        if (!Number.isFinite(min)) min = 0;
        if (!Number.isFinite(max) || max === min) max = 100;
        if (!Number.isFinite(value)) value = 0;
        var ratio = clamp((value - min) / (max - min), 0, 1) * 100;
        input.style.setProperty("--fill-start", "0%");
        input.style.setProperty("--fill-end", ratio + "%");
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

    // ---------- STORAGE ----------

    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    function getSnapshot() {
        return {
            metric: state.metric,
            seed: fields.seed.value,
            density: fields.density.value,
            randomness: fields.randomness.value,
            block: fields.block.value,
            steps: fields.steps.value,
            outline: !!fields.outline.checked,
            outWidth: fields.outWidth.value,
            bounds: !!fields.bounds.checked,
            origCol: !!fields.origCol.checked,
            delPar: !!fields.delPar.checked
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        state.metric = parseInt(snapshot.metric, 10);
        if (isNaN(state.metric) || state.metric < 0 || state.metric > 3) state.metric = 0;
        fields.metric.value = String(state.metric);
        fields.seed.value = String(snapshot.seed);
        fields.outline.checked = !!snapshot.outline;
        fields.bounds.checked = !!snapshot.bounds;
        fields.origCol.checked = !!snapshot.origCol;
        fields.delPar.checked = !!snapshot.delPar;
        SLIDER_PAIRS.forEach(function (pair) { syncPair(pair[0], pair[1], snapshot[pair[0]]); });
        refreshMetricLabel();
        markActiveMetric();
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
            } catch (e) {}
        }
        applySnapshot(restored);
    }

    // ---------- METRIC DROPDOWN ----------

    function refreshMetricLabel() {
        fields.metricLabel.textContent = METRIC_LABELS[state.metric] || METRIC_LABELS[0];
    }

    function markActiveMetric() {
        Array.prototype.forEach.call(document.querySelectorAll('#metricOptions .custom-option'), function (option) {
            var active = parseInt(option.getAttribute("data-value"), 10) === state.metric;
            option.classList.toggle("is-selected", active);
            option.setAttribute("aria-selected", active ? "true" : "false");
        });
    }

    function openDropdown(wrapper) {
        if (!wrapper) return;
        closeDropdown();
        wrapper.classList.add("open");
        var toggle = wrapper.querySelector(".ui-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "true");
        state.activeDropdown = wrapper;
    }
    function closeDropdown() {
        if (!state.activeDropdown) return;
        state.activeDropdown.classList.remove("open");
        var toggle = state.activeDropdown.querySelector(".ui-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
        state.activeDropdown = null;
    }

    function handlePickMetric(idx) {
        state.metric = idx;
        fields.metric.value = String(idx);
        saveSettings();
        refreshMetricLabel();
        markActiveMetric();
        closeDropdown();
        if (state.active) schedulePreviewUpdate();
    }

    // ---------- PRESET DROPDOWN ----------

    function refreshPresetLabel() {
        fields.presetLabel.textContent = state.currentPreset || "Default";
    }

    function renderPresetDropdown() {
        presetOptionsEl.innerHTML = "";
        for (var i = 0; i < state.presets.length; i++) {
            var p = state.presets[i];
            var row = document.createElement("div");
            row.className = "custom-option";
            row.setAttribute("data-value", p.name);
            row.textContent = p.name;
            (function (name) {
                row.addEventListener("click", function () { handlePickPreset(name); });
            })(p.name);
            presetOptionsEl.appendChild(row);
        }
        markActivePreset();
    }

    function markActivePreset() {
        Array.prototype.forEach.call(presetOptionsEl.querySelectorAll(".custom-option"), function (option) {
            var active = option.getAttribute("data-value") === state.currentPreset;
            option.classList.toggle("is-selected", active);
            option.setAttribute("aria-selected", active ? "true" : "false");
        });
    }

    function findPreset(name) {
        for (var i = 0; i < state.presets.length; i++) {
            if (state.presets[i].name === name) return state.presets[i];
        }
        return null;
    }

    function handlePickPreset(name) {
        var p = findPreset(name);
        if (!p) return;
        state.currentPreset = name;
        fields.preset.value = name;
        applySnapshot(p);
        saveSettings();
        refreshPresetLabel();
        markActivePreset();
        closeDropdown();
        refreshControlStates();
        if (state.active) schedulePreviewUpdate();
    }

    async function loadPresets() {
        try {
            var resp = await callHost("ovoronListPresets");
            if (resp.ok && resp.presets) {
                state.presets = resp.presets;
                if (!findPreset(state.currentPreset)) state.currentPreset = "Default";
                renderPresetDropdown();
                refreshPresetLabel();
            }
        } catch (e) {}
    }

    async function savePresetAs() {
        if (state.busy) return;
        var name = window.prompt("Preset name:", state.currentPreset && state.currentPreset !== "Default" ? state.currentPreset : "Custom Preset");
        if (!name) return;
        name = name.replace(/^\s+|\s+$/g, "");
        if (!name) return;
        if (name === "Default") {
            setStatus("error", "Cannot overwrite the Default preset.");
            return;
        }
        var snap = getSnapshot();
        snap.name = name;
        setBusy(true);
        try {
            var resp = await callHost("ovoronSavePreset", snap);
            if (!resp.ok) throw new Error(resp.message || "Save failed.");
            state.presets = resp.presets || state.presets;
            state.currentPreset = name;
            fields.preset.value = name;
            renderPresetDropdown();
            refreshPresetLabel();
            setStatus("success", "Preset '" + name + "' saved.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function deleteCurrentPreset() {
        if (state.busy || state.currentPreset === "Default") return;
        if (!window.confirm("Delete preset '" + state.currentPreset + "'?")) return;
        setBusy(true);
        try {
            var resp = await callHost("ovoronDeletePreset", { name: state.currentPreset });
            if (!resp.ok) throw new Error(resp.message || "Delete failed.");
            state.presets = resp.presets || state.presets;
            state.currentPreset = "Default";
            fields.preset.value = "Default";
            renderPresetDropdown();
            refreshPresetLabel();
            setStatus("info", "Preset deleted.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    // ---------- COLLECT / PREVIEW ----------

    function collectConfig() {
        var randomness = parseFloat(fields.randomness.value);
        if (!Number.isFinite(randomness)) randomness = 0;
        if (randomness < 0) randomness = 0;
        if (randomness > 100) randomness = 100;
        return {
            metric: state.metric,
            seed: parseInt(fields.seed.value, 10) || 0,
            density: parseInt(fields.density.value, 10) || 0,
            randomness: randomness / 100,
            block: parseInt(fields.block.value, 10) || 8,
            steps: parseInt(fields.steps.value, 10) || 0,
            outline: !!fields.outline.checked,
            outWidth: parseInt(fields.outWidth.value, 10) || 1,
            bounds: !!fields.bounds.checked,
            origCol: !!fields.origCol.checked,
            delPar: !!fields.delPar.checked
        };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = collectConfig();
        state.previewPending = callHost("ovoronUpdate", cfg)
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

    // ---------- ACTIONS ----------

    async function startGenerate() {
        if (state.busy || state.active) return;
        var cfg = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Building voronoi...");
        try {
            var response = await callHost("ovoronStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Preview ready.");
            actionHintEl.textContent = "Adjust parameters live. APPLY commits, BAKE TO SYMBOL stores variant, CANCEL reverts.";
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
            var cfg = collectConfig();
            var response = await callHost("ovoronApply", cfg);
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Select a path or compound path, then press GENERATE.";
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
            var response = await callHost("ovoronCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Select a path or compound path, then press GENERATE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function bakeGenerate() {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        setBusy(true);
        setStatus("info", "Baking...");
        try {
            var response = await callHost("ovoronBake");
            if (!response.ok) throw new Error(response.message || "Bake failed.");
            setStatus("success", response.message || "Baked.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    function rerollSeed() {
        var newSeed = Math.floor(Math.random() * 999999);
        fields.seed.value = String(newSeed);
        saveSettings();
        if (state.active) schedulePreviewUpdate();
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("ovoronHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("ovoronCancel"); } catch (e) {}
            }
            state.active = false;
            await loadPresets();
            refreshControlStates();
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
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
            for (var i = 0; i < Math.abs(stepDelta); i += 1) {
                adjustNumberInput(dragState.input, stepDelta > 0 ? 1 : -1);
            }
            dragState.lastSteps = deltaSteps;
            e.preventDefault();
        }, true);
        document.addEventListener("mouseup", finishScrub, true);
        window.addEventListener("blur", finishScrub);
    }

    // ---------- BIND ----------

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

    function bindSimpleInput(key) {
        fields[key].addEventListener("input", function () {
            if (fields[key].disabled) return;
            onParameterChanged();
        });
    }

    function bindCheckbox(key) {
        fields[key].addEventListener("change", function () {
            if (fields[key].disabled) return;
            onParameterChanged();
        });
    }

    function bindMetricDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="metric"]');
        var toggle = wrapper ? wrapper.querySelector(".ui-dropdown-toggle") : null;
        if (!wrapper || !toggle) return;

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (toggle.style.pointerEvents === "none") return;
            if (state.activeDropdown === wrapper) closeDropdown();
            else openDropdown(wrapper);
        });
        toggle.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (state.activeDropdown === wrapper) closeDropdown();
                else openDropdown(wrapper);
            } else if (event.key === "Escape") closeDropdown();
        });
        Array.prototype.forEach.call(wrapper.querySelectorAll(".custom-option"), function (option) {
            option.addEventListener("click", function () {
                handlePickMetric(parseInt(option.getAttribute("data-value"), 10) || 0);
            });
        });
    }

    function bindPresetDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="preset"]');
        var toggle = wrapper ? wrapper.querySelector(".ui-dropdown-toggle") : null;
        if (!wrapper || !toggle) return;

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (toggle.disabled) return;
            if (state.activeDropdown === wrapper) closeDropdown();
            else openDropdown(wrapper);
        });
        toggle.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (state.activeDropdown === wrapper) closeDropdown();
                else openDropdown(wrapper);
            } else if (event.key === "Escape") closeDropdown();
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindSimpleInput("seed");
    bindCheckbox("outline");
    bindCheckbox("bounds");
    bindCheckbox("origCol");
    bindCheckbox("delPar");
    bindMetricDropdown();
    bindPresetDropdown();

    Object.keys(buttons).forEach(function (key) {
        // skip; specific bindings below
    });
    buttons.densityReset.addEventListener("click", function () {
        if (buttons.densityReset.disabled) return;
        syncPair("density", "densityRange", DEFAULTS.density);
        onParameterChanged();
    });
    buttons.randomnessReset.addEventListener("click", function () {
        if (buttons.randomnessReset.disabled) return;
        syncPair("randomness", "randomnessRange", DEFAULTS.randomness);
        onParameterChanged();
    });
    buttons.blockReset.addEventListener("click", function () {
        if (buttons.blockReset.disabled) return;
        syncPair("block", "blockRange", DEFAULTS.block);
        onParameterChanged();
    });
    buttons.stepsReset.addEventListener("click", function () {
        if (buttons.stepsReset.disabled) return;
        syncPair("steps", "stepsRange", DEFAULTS.steps);
        onParameterChanged();
    });
    buttons.outWidthReset.addEventListener("click", function () {
        if (buttons.outWidthReset.disabled) return;
        syncPair("outWidth", "outWidthRange", DEFAULTS.outWidth);
        onParameterChanged();
    });

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyGenerate();
        else startGenerate();
    });
    buttons.cancel.addEventListener("click", function () { if (!buttons.cancel.disabled) cancelGenerate(); });
    buttons.bake.addEventListener("click", function () { if (!buttons.bake.disabled) bakeGenerate(); });
    buttons.reset.addEventListener("click", function () {
        if (buttons.reset.disabled) return;
        rerollSeed();
    });
    buttons.newSeed.addEventListener("click", function () {
        if (buttons.newSeed.disabled) return;
        rerollSeed();
    });
    buttons.savePreset.addEventListener("click", function () {
        if (!buttons.savePreset.disabled) savePresetAs();
    });
    buttons.deletePreset.addEventListener("click", function () {
        if (!buttons.deletePreset.disabled) deleteCurrentPreset();
    });

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
