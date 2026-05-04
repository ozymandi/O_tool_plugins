(function () {
    var STORAGE_KEY = "ofractal.panel.settings.v1";

    var ISTACK_LABELS = ["Behind original", "In front of original"];

    var DEFAULTS = {
        iterations: 7, baseLength: 100, branchAngle: 35, lenScale: 75,
        twistAngle: 0, baseStroke: 10, strokeScale: 70, brightShift: 50,
        forceBranch: false, forceMult: 2.0, divide: 0,
        tangentBase: 0, checkerTangent: true, tangentRandom: 0, seed: 42,
        cLevels: 1, cPerNode: 1,
        cShiftX: 0, cShiftY: 0, cShiftRand: 0,
        cRot: 0, cRotRand: 0,
        cScaleX: 100, cScaleY: 100, cScaleRand: 0,
        cOpac: 100, cOpacRand: 0, cHueRand: 0,
        iCount: 1, iScale: 80, iShiftX: 0, iShiftY: -20, iRand: 0,
        iStack: 0, iIncChild: false, iFlip: false
    };

    var SLIDER_PAIRS = [
        ["iterations", "iterationsRange"],
        ["baseLength", "baseLengthRange"],
        ["branchAngle", "branchAngleRange"],
        ["lenScale", "lenScaleRange"],
        ["twistAngle", "twistAngleRange"],
        ["baseStroke", "baseStrokeRange"],
        ["strokeScale", "strokeScaleRange"],
        ["brightShift", "brightShiftRange"],
        ["forceMult", "forceMultRange"],
        ["divide", "divideRange"],
        ["tangentBase", "tangentBaseRange"],
        ["tangentRandom", "tangentRandomRange"],
        ["seed", "seedRange"],
        ["cLevels", "cLevelsRange"],
        ["cPerNode", "cPerNodeRange"],
        ["cShiftX", "cShiftXRange"],
        ["cShiftY", "cShiftYRange"],
        ["cShiftRand", "cShiftRandRange"],
        ["cRot", "cRotRange"],
        ["cRotRand", "cRotRandRange"],
        ["cScaleX", "cScaleXRange"],
        ["cScaleY", "cScaleYRange"],
        ["cScaleRand", "cScaleRandRange"],
        ["cOpac", "cOpacRange"],
        ["cOpacRand", "cOpacRandRange"],
        ["cHueRand", "cHueRandRange"],
        ["iCount", "iCountRange"],
        ["iScale", "iScaleRange"],
        ["iShiftX", "iShiftXRange"],
        ["iShiftY", "iShiftYRange"],
        ["iRand", "iRandRange"]
    ];

    var CHECK_KEYS = ["forceBranch", "checkerTangent", "iIncChild", "iFlip"];

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        activeDropdown: null,
        iStack: DEFAULTS.iStack,
        currentTab: "fractal",
        presets: [],
        currentPreset: "-- Default --",
        loadedChildrenCount: 0
    };

    var fields = {};
    var allKeys = Object.keys(DEFAULTS);
    allKeys.forEach(function (key) { fields[key] = document.getElementById(key); });
    SLIDER_PAIRS.forEach(function (pair) { fields[pair[1]] = document.getElementById(pair[1]); });
    fields.iStackLabel = document.getElementById("iStackLabel");
    fields.preset = document.getElementById("preset");
    fields.presetLabel = document.getElementById("presetLabel");

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        cancel: document.getElementById("cancelBtn"),
        bake: document.getElementById("bakeBtn"),
        reset: document.getElementById("resetBtn"),
        addChildren: document.getElementById("addChildrenBtn"),
        savePreset: document.getElementById("savePresetBtn"),
        deletePreset: document.getElementById("deletePresetBtn")
    };

    var resetButtons = {};
    SLIDER_PAIRS.forEach(function (pair) {
        var btn = document.getElementById(pair[0] + "ResetBtn");
        if (btn) resetButtons[pair[0]] = btn;
    });

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");
    var presetOptionsEl = document.getElementById("presetOptions");
    var childrenStatusEl = document.getElementById("childrenStatus");

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

        buttons.savePreset.disabled = busy;
        buttons.deletePreset.disabled = busy || (state.currentPreset === "-- Default --");

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);

        // Force multiplier follows force-branch toggle
        var forceMultEnabled = !!fields.forceBranch.checked && !locked;
        fields.forceMult.disabled = !forceMultEnabled;
        fields.forceMultRange.disabled = !forceMultEnabled;
        if (resetButtons.forceMult) resetButtons.forceMult.disabled = !forceMultEnabled;
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
        else if (step === "0.1") num = Math.round(num * 10) / 10;
        numField.value = String(num);
        if (rangeField) {
            var rangeMin = Number(rangeField.min);
            var rangeMax = Number(rangeField.max);
            var clamped = clamp(num, rangeMin, rangeMax);
            rangeField.value = String(clamped);
            updateSliderFill(rangeField);
        }
    }

    // ---------- STORAGE / PRESETS ----------

    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    function getSnapshot() {
        var snap = {};
        SLIDER_PAIRS.forEach(function (pair) { snap[pair[0]] = fields[pair[0]].value; });
        CHECK_KEYS.forEach(function (k) { snap[k] = !!fields[k].checked; });
        snap.iStack = state.iStack;
        return snap;
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        SLIDER_PAIRS.forEach(function (pair) {
            if (snapshot[pair[0]] !== undefined) syncPair(pair[0], pair[1], snapshot[pair[0]]);
        });
        CHECK_KEYS.forEach(function (k) {
            if (snapshot[k] !== undefined) fields[k].checked = !!snapshot[k];
        });
        if (snapshot.iStack !== undefined) {
            state.iStack = parseInt(snapshot.iStack, 10);
            if (isNaN(state.iStack) || state.iStack < 0 || state.iStack > 1) state.iStack = 0;
            fields.iStack.value = String(state.iStack);
            refreshIStackLabel();
            markActiveIStack();
        }
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

    function refreshPresetLabel() {
        fields.presetLabel.textContent = state.currentPreset || "-- Default --";
    }

    function renderPresetDropdown() {
        presetOptionsEl.innerHTML = "";
        var items = [{ name: "-- Default --" }].concat(state.presets);
        for (var i = 0; i < items.length; i++) {
            var p = items[i];
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
        if (name === "-- Default --") {
            state.currentPreset = name;
            fields.preset.value = name;
            applySnapshot(getDefaultConfig());
            saveSettings();
            refreshPresetLabel();
            markActivePreset();
            closeDropdown();
            refreshControlStates();
            if (state.active) schedulePreviewUpdate();
            return;
        }
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
            var resp = await callHost("ofractalListPresets");
            if (resp.ok && resp.presets) {
                state.presets = resp.presets;
                if (state.currentPreset !== "-- Default --" && !findPreset(state.currentPreset)) {
                    state.currentPreset = "-- Default --";
                }
                renderPresetDropdown();
                refreshPresetLabel();
            }
        } catch (e) {}
    }

    async function savePresetAs() {
        if (state.busy) return;
        var name = window.prompt("Preset name:", state.currentPreset && state.currentPreset !== "-- Default --" ? state.currentPreset : "My Plant");
        if (!name) return;
        name = name.replace(/^\s+|\s+$/g, "");
        if (!name) return;
        if (name === "-- Default --") {
            setStatus("error", "Reserved name.");
            return;
        }
        var snap = getSnapshot();
        snap.name = name;
        setBusy(true);
        try {
            var resp = await callHost("ofractalSavePreset", snap);
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
        if (state.busy || state.currentPreset === "-- Default --") return;
        if (!window.confirm("Delete preset '" + state.currentPreset + "'?")) return;
        setBusy(true);
        try {
            var resp = await callHost("ofractalDeletePreset", { name: state.currentPreset });
            if (!resp.ok) throw new Error(resp.message || "Delete failed.");
            state.presets = resp.presets || state.presets;
            state.currentPreset = "-- Default --";
            fields.preset.value = "-- Default --";
            renderPresetDropdown();
            refreshPresetLabel();
            setStatus("info", "Preset deleted.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    // ---------- DROPDOWNS ----------

    function refreshIStackLabel() {
        fields.iStackLabel.textContent = ISTACK_LABELS[state.iStack] || ISTACK_LABELS[0];
    }

    function markActiveIStack() {
        Array.prototype.forEach.call(document.querySelectorAll('#iStackOptions .custom-option'), function (option) {
            var active = parseInt(option.getAttribute("data-value"), 10) === state.iStack;
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

    function handlePickIStack(idx) {
        state.iStack = idx;
        fields.iStack.value = String(idx);
        saveSettings();
        refreshIStackLabel();
        markActiveIStack();
        closeDropdown();
        if (state.active) schedulePreviewUpdate();
    }

    // ---------- TABS ----------

    function setActiveTab(name) {
        state.currentTab = name;
        Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (btn) {
            btn.classList.toggle("is-active", btn.getAttribute("data-tab") === name);
        });
        Array.prototype.forEach.call(document.querySelectorAll("[data-tab-pane]"), function (pane) {
            pane.hidden = pane.getAttribute("data-tab-pane") !== name;
        });
    }

    // ---------- COLLECT / PREVIEW ----------

    function collectConfig() {
        var cfg = {};
        SLIDER_PAIRS.forEach(function (pair) {
            var v = parseFloat(fields[pair[0]].value);
            if (!Number.isFinite(v)) v = DEFAULTS[pair[0]];
            cfg[pair[0]] = v;
        });
        CHECK_KEYS.forEach(function (k) {
            cfg[k] = !!fields[k].checked;
        });
        cfg.iStack = state.iStack;
        return cfg;
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = collectConfig();
        state.previewPending = callHost("ofractalUpdate", cfg)
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
        setStatus("info", "Generating fractal...");
        try {
            var response = await callHost("ofractalStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Preview ready.");
            actionHintEl.textContent = "Adjust parameters live. APPLY commits, BAKE TO SYMBOL stores variant, CANCEL discards.";
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
            var response = await callHost("ofractalApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Optional: select an anchor point to set origin/angle. Then press GENERATE to start a live preview.";
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
            var response = await callHost("ofractalCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Optional: select an anchor point to set origin/angle. Then press GENERATE to start a live preview.";
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
            var response = await callHost("ofractalBake");
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
        var newSeed = Math.floor(Math.random() * 9999) + 1;
        syncPair("seed", "seedRange", newSeed);
        saveSettings();
        if (state.active) schedulePreviewUpdate();
    }

    async function loadChildren() {
        if (state.busy) return;
        setBusy(true);
        setStatus("info", "Loading children from clipboard...");
        try {
            var response = await callHost("ofractalAddChildren");
            if (!response.ok) throw new Error(response.message || "Could not load children.");
            state.loadedChildrenCount = response.count || 0;
            childrenStatusEl.textContent = "Loaded: " + state.loadedChildrenCount + " object(s)";
            setStatus("success", response.message || ("Loaded " + state.loadedChildrenCount + " children."));
            if (state.active) schedulePreviewUpdate();
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("ofractalHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("ofractalCancel"); } catch (e) {}
            }
            state.active = false;
            state.loadedChildrenCount = handshake.loadedChildren || 0;
            childrenStatusEl.textContent = state.loadedChildrenCount > 0
                ? "Loaded: " + state.loadedChildrenCount + " object(s)"
                : "No objects loaded";
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
        var resetBtn = resetButtons[numKey];
        if (resetBtn) {
            resetBtn.addEventListener("click", function () {
                if (resetBtn.disabled) return;
                syncPair(numKey, rangeKey, DEFAULTS[numKey]);
                onParameterChanged();
            });
        }
    }

    function bindCheckbox(key) {
        fields[key].addEventListener("change", function () {
            if (fields[key].disabled) return;
            saveSettings();
            refreshControlStates();
            if (state.active) schedulePreviewUpdate();
        });
    }

    function bindSimpleDropdown(id, onPick) {
        var wrapper = document.querySelector('.simple-dropdown[data-id="' + id + '"]');
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
        Array.prototype.forEach.call(wrapper.querySelectorAll(".custom-option"), function (option) {
            option.addEventListener("click", function () {
                onPick(option.getAttribute("data-value") || "");
            });
        });
    }

    function bindTabs() {
        Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (btn) {
            btn.addEventListener("click", function () {
                setActiveTab(btn.getAttribute("data-tab") || "fractal");
            });
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    CHECK_KEYS.forEach(function (k) { bindCheckbox(k); });
    bindSimpleDropdown("preset", function () {});  // preset clicks handled in renderPresetDropdown
    bindSimpleDropdown("iStack", function (val) { handlePickIStack(parseInt(val, 10) || 0); });
    document.addEventListener("click", function (event) {
        if (!event.target.closest(".simple-dropdown")) closeDropdown();
    });
    bindTabs();

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyGenerate();
        else startGenerate();
    });
    buttons.cancel.addEventListener("click", function () { if (!buttons.cancel.disabled) cancelGenerate(); });
    buttons.bake.addEventListener("click", function () { if (!buttons.bake.disabled) bakeGenerate(); });
    buttons.reset.addEventListener("click", function () { if (!buttons.reset.disabled) rerollSeed(); });
    buttons.addChildren.addEventListener("click", function () { if (!buttons.addChildren.disabled) loadChildren(); });
    buttons.savePreset.addEventListener("click", function () { if (!buttons.savePreset.disabled) savePresetAs(); });
    buttons.deletePreset.addEventListener("click", function () { if (!buttons.deletePreset.disabled) deleteCurrentPreset(); });

    setActiveTab("fractal");
    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
