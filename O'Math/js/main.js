(function () {
    var STORAGE_KEY = "omath.panel.settings.v1";

    var SURFACES = [
        "Ellipsoid", "Cone", "Cylinder", "Pyramid", "Cube (Sharp)",
        "Hyperbolic Paraboloid", "One-sheet Hyperboloid",
        "Torus", "Elliptic Paraboloid", "Superellipsoid (Rounded Cube)",
        "Möbius Strip", "Helicoid", "Pseudosphere", "Klein Bottle",
        "Superegg", "Catalan Surface", "Regulus"
    ];

    var PARAM_LABELS = {
        "Ellipsoid": ["Radius X", "Radius Y", "Radius Z", null],
        "Cone": ["Radius X", "Radius Y", "Height Z", null],
        "Cylinder": ["Radius X", "Radius Y", "Height Z", null],
        "Pyramid": ["Base X", "Base Y", "Height Z", null],
        "Cube (Sharp)": ["Width X", "Depth Y", "Height Z", null],
        "Hyperbolic Paraboloid": ["Curve X", "Curve Y", "Depth Z", null],
        "One-sheet Hyperboloid": ["Waist X", "Waist Y", "Height Z", null],
        "Torus": ["Main rad", "Tube rad", "Z-scale", null],
        "Elliptic Paraboloid": ["Spread X", "Spread Y", "Depth Z", null],
        "Superellipsoid (Rounded Cube)": ["Scale X", "Scale Y", "Scale Z", "Roundness"],
        "Möbius Strip": ["Radius", "Width", "Z-scale", null],
        "Helicoid": ["Radius X", "Radius Y", "Pitch Z", null],
        "Pseudosphere": ["Radius X", "Radius Y", "Length Z", null],
        "Klein Bottle": ["Main rad", "Tube rad", "Z-scale", null],
        "Superegg": ["Radius X/Y", "—", "Height Z", "Exponent"],
        "Catalan Surface": ["Scale X", "Scale Y", "Scale Z", null],
        "Regulus": ["Radius X", "Radius Y", "Height Z", null]
    };

    var DEFAULTS = {
        surface: "Cube (Sharp)",
        paramA: 1.0, paramB: 1.0, paramC: 1.0, paramD: 2.5,
        viewMode: "hidden",
        scale: 60,
        density: 18,
        smooth: false
    };

    var SLIDER_PAIRS = [
        ["scale", "scaleRange"],
        ["density", "densityRange"]
    ];

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        activeDropdown: null,
        surface: DEFAULTS.surface,
        viewMode: DEFAULTS.viewMode
    };

    var fields = {
        surface: document.getElementById("surface"),
        surfaceLabel: document.getElementById("surfaceLabel"),
        viewMode: document.getElementById("viewMode"),
        paramA: document.getElementById("paramA"),
        paramB: document.getElementById("paramB"),
        paramC: document.getElementById("paramC"),
        paramD: document.getElementById("paramD"),
        scale: document.getElementById("scale"),
        scaleRange: document.getElementById("scaleRange"),
        density: document.getElementById("density"),
        densityRange: document.getElementById("densityRange"),
        smooth: document.getElementById("smooth")
    };

    var paramLabels = {
        A: document.getElementById("paramLabelA"),
        B: document.getElementById("paramLabelB"),
        C: document.getElementById("paramLabelC"),
        D: document.getElementById("paramLabelD")
    };
    var paramCells = {
        A: document.getElementById("paramCellA"),
        B: document.getElementById("paramCellB"),
        C: document.getElementById("paramCellC"),
        D: document.getElementById("paramCellD")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        cancel: document.getElementById("cancelBtn"),
        scaleReset: document.getElementById("scaleResetBtn"),
        densityReset: document.getElementById("densityResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");
    var surfaceOptionsEl = document.getElementById("surfaceOptions");

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

    // ---------- VISIBILITY / LABELS ----------

    function updateParamLabels() {
        var labels = PARAM_LABELS[state.surface] || PARAM_LABELS["Cube (Sharp)"];
        var keys = ["A", "B", "C", "D"];
        for (var i = 0; i < 4; i++) {
            var key = keys[i];
            var label = labels[i];
            if (label === null || label === "—") {
                paramLabels[key].textContent = "—";
                paramCells[key].classList.add("is-disabled");
                fields["param" + key].disabled = true;
            } else {
                paramLabels[key].textContent = label;
                paramCells[key].classList.remove("is-disabled");
                // Will be re-disabled by refreshControlStates if needed
                fields["param" + key].disabled = !state.active || state.busy;
            }
        }
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

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);

        // Re-enforce param-cell disabled state from surface
        var labels = PARAM_LABELS[state.surface] || PARAM_LABELS["Cube (Sharp)"];
        var keys = ["A", "B", "C", "D"];
        for (var i = 0; i < 4; i++) {
            if (labels[i] === null || labels[i] === "—") {
                fields["param" + keys[i]].disabled = true;
            }
        }
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
            surface: state.surface,
            paramA: fields.paramA.value,
            paramB: fields.paramB.value,
            paramC: fields.paramC.value,
            paramD: fields.paramD.value,
            viewMode: state.viewMode,
            scale: fields.scale.value,
            density: fields.density.value,
            smooth: !!fields.smooth.checked
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        state.surface = String(snapshot.surface || DEFAULTS.surface);
        if (PARAM_LABELS[state.surface] === undefined) state.surface = DEFAULTS.surface;
        fields.surface.value = state.surface;
        state.viewMode = (snapshot.viewMode === "wire") ? "wire" : "hidden";
        fields.viewMode.value = state.viewMode;
        fields.paramA.value = String(snapshot.paramA);
        fields.paramB.value = String(snapshot.paramB);
        fields.paramC.value = String(snapshot.paramC);
        fields.paramD.value = String(snapshot.paramD);
        fields.smooth.checked = !!snapshot.smooth;
        SLIDER_PAIRS.forEach(function (pair) { syncPair(pair[0], pair[1], snapshot[pair[0]]); });
        refreshSurfaceLabel();
        markActiveOption();
        updateParamLabels();
        refreshViewModeButtons();
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

    // ---------- SURFACE DROPDOWN ----------

    function refreshSurfaceLabel() {
        fields.surfaceLabel.textContent = state.surface;
    }

    function renderDropdown() {
        surfaceOptionsEl.innerHTML = "";
        for (var i = 0; i < SURFACES.length; i++) {
            var entry = SURFACES[i];
            var row = document.createElement("div");
            row.className = "custom-option";
            row.setAttribute("data-value", entry);
            row.textContent = entry;
            (function (id) {
                row.addEventListener("click", function () { handlePickSurface(id); });
            })(entry);
            surfaceOptionsEl.appendChild(row);
        }
        markActiveOption();
    }

    function markActiveOption() {
        Array.prototype.forEach.call(surfaceOptionsEl.querySelectorAll(".custom-option"), function (option) {
            var active = option.getAttribute("data-value") === state.surface;
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

    function handlePickSurface(id) {
        state.surface = id;
        fields.surface.value = id;
        saveSettings();
        refreshSurfaceLabel();
        updateParamLabels();
        markActiveOption();
        closeDropdown();
        if (state.active) schedulePreviewUpdate();
    }

    // ---------- VIEW MODE SEGMENTED ----------

    function refreshViewModeButtons() {
        var current = state.viewMode;
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-view]'), function (btn) {
            btn.classList.toggle("is-active", btn.getAttribute("data-view") === current);
        });
    }

    // ---------- COLLECT / PREVIEW ----------

    function collectConfig() {
        return {
            surface: state.surface,
            paramA: parseFloat(fields.paramA.value) || 0,
            paramB: parseFloat(fields.paramB.value) || 0,
            paramC: parseFloat(fields.paramC.value) || 0,
            paramD: parseFloat(fields.paramD.value) || 0,
            viewMode: state.viewMode,
            scale: parseFloat(fields.scale.value) || 60,
            density: parseInt(fields.density.value, 10) || 18,
            smooth: !!fields.smooth.checked
        };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = collectConfig();
        state.previewPending = callHost("omathUpdate", cfg)
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
        setStatus("info", "Building surface...");
        try {
            var response = await callHost("omathStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Preview ready.");
            actionHintEl.textContent = "Adjust parameters live. APPLY commits the surface, CANCEL discards it.";
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
            var response = await callHost("omathApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Open a document, then press GENERATE to start a live preview.";
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
            var response = await callHost("omathCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Open a document, then press GENERATE to start a live preview.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("omathHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("omathCancel"); } catch (e) {}
            }
            state.active = false;
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

    function bindParamInputs() {
        ["paramA", "paramB", "paramC", "paramD"].forEach(function (key) {
            fields[key].addEventListener("input", function () {
                if (fields[key].disabled) return;
                onParameterChanged();
            });
        });
    }

    function bindSmoothCheckbox() {
        fields.smooth.addEventListener("change", function () {
            if (fields.smooth.disabled) return;
            saveSettings();
            if (state.active) schedulePreviewUpdate();
        });
    }

    function bindSurfaceDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="surface"]');
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

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    function bindViewModeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-view]'), function (btn) {
            btn.addEventListener("click", function () {
                state.viewMode = btn.getAttribute("data-view") || "hidden";
                fields.viewMode.value = state.viewMode;
                refreshViewModeButtons();
                saveSettings();
                if (state.active) schedulePreviewUpdate();
            });
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindParamInputs();
    bindSmoothCheckbox();
    bindSurfaceDropdown();
    bindViewModeButtons();

    buttons.scaleReset.addEventListener("click", function () {
        if (buttons.scaleReset.disabled) return;
        syncPair("scale", "scaleRange", DEFAULTS.scale);
        onParameterChanged();
    });
    buttons.densityReset.addEventListener("click", function () {
        if (buttons.densityReset.disabled) return;
        syncPair("density", "densityRange", DEFAULTS.density);
        onParameterChanged();
    });

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyGenerate();
        else startGenerate();
    });
    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        cancelGenerate();
    });

    renderDropdown();
    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
