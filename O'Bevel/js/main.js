(function () {
    var STORAGE_KEY = "obevel.panel.settings.v1";

    var state = {
        busy: false,
        previewActive: false,
        previewPending: null,
        previewQueued: false,
        profileLoaded: false,
        profilePoints: 0
    };

    var fields = {
        mode: document.getElementById("mode"),
        count: document.getElementById("count"),
        countRange: document.getElementById("countRange"),
        radius: document.getElementById("radius"),
        radiusRange: document.getElementById("radiusRange"),
        flip: document.getElementById("flip"),
        straighten: document.getElementById("straighten"),
        livePreview: document.getElementById("livePreview")
    };

    var buttons = {
        apply: document.getElementById("applyBtn"),
        cancel: document.getElementById("cancelBtn"),
        reset: document.getElementById("resetBtn"),
        loadClipboard: document.getElementById("loadClipboardBtn"),
        countReset: document.getElementById("countResetBtn"),
        radiusReset: document.getElementById("radiusResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var profileStatusEl = document.getElementById("profileStatus");

    var DEFAULTS = {
        mode: "steps",
        count: 3,
        radius: 20,
        flip: false,
        straighten: true
    };

    var SLIDER_PAIRS = [
        ["count", "countRange"],
        ["radius", "radiusRange"]
    ];

    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    function safeStorageGet() {
        try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function safeStorageSet(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function setBusy(isBusy) {
        Object.keys(buttons).forEach(function (key) {
            if (buttons[key]) buttons[key].disabled = isBusy;
        });
        if (!isBusy) {
            buttons.cancel.disabled = !state.previewActive;
        }
        state.busy = isBusy;
    }

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function setProfileStatus(text) { profileStatusEl.textContent = text; }

    function updatePreviewControls() {
        buttons.cancel.disabled = !state.previewActive || state.busy;
        buttons.apply.textContent = state.previewActive ? "APPLY PREVIEW" : "APPLY";
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

    function updateModeButtons() {
        var current = String(fields.mode.value || "steps");
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-mode]"), function (button) {
            var active = button.getAttribute("data-mode") === current;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        Array.prototype.forEach.call(document.querySelectorAll('.panel[data-show-when]'), function (el) {
            el.classList.toggle("is-visible", el.getAttribute("data-show-when") === "mode-" + current);
        });
    }

    function getSnapshot() {
        return {
            mode: fields.mode.value,
            count: fields.count.value,
            radius: fields.radius.value,
            flip: fields.flip.checked,
            straighten: fields.straighten.checked
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        fields.mode.value = String(snapshot.mode || "steps");
        fields.flip.checked = !!snapshot.flip;
        fields.straighten.checked = !!snapshot.straighten;
        SLIDER_PAIRS.forEach(function (pair) {
            syncPair(pair[0], pair[1], snapshot[pair[0]]);
        });
        updateModeButtons();
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
        var config = {
            mode: String(fields.mode.value || "steps"),
            count: parseInt(fields.count.value, 10),
            radius: parseFloat(fields.radius.value),
            flip: !!fields.flip.checked,
            straighten: !!fields.straighten.checked
        };
        if (!Number.isFinite(config.count) || config.count < 1) config.count = 1;
        if (!Number.isFinite(config.radius) || config.radius < 1) config.radius = 1;
        return config;
    }

    function callHost(hostFunction, config) {
        var script;
        if (config !== undefined && config !== null) {
            var payload = escapeForEval(JSON.stringify(config));
            script = hostFunction + "('" + payload + "')";
        } else {
            script = hostFunction + "()";
        }
        return evalHost(script).then(parseHostResponse);
    }

    async function runHostAction(label, hostFunction, config) {
        saveSettings();
        setBusy(true);
        setStatus("info", label + "...");
        try {
            var response = await callHost(hostFunction, config);
            if (!response.ok) throw new Error(response.message || "Illustrator returned an error.");
            setStatus("success", response.message || (label + " complete."));
            return response;
        } catch (error) {
            setStatus("error", error.message);
            return null;
        } finally {
            setBusy(false);
            updatePreviewControls();
        }
    }

    function sendPreviewUpdate() {
        if (!state.previewActive) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var config = collectConfig();
        state.previewPending = callHost("obevelUpdatePreview", config)
            .then(function (response) {
                if (!response.ok) {
                    setStatus("error", response.message || "Preview update failed.");
                    if (response.message && response.message.indexOf("No active") !== -1) {
                        state.previewActive = false;
                        fields.livePreview.checked = false;
                        updatePreviewControls();
                    }
                }
                return response;
            })
            .catch(function (error) {
                setStatus("error", error.message);
            })
            .finally(function () {
                state.previewPending = null;
                if (state.previewQueued && state.previewActive) {
                    state.previewQueued = false;
                    sendPreviewUpdate();
                }
            });
        return state.previewPending;
    }

    function schedulePreviewUpdate() {
        if (!state.previewActive) return;
        sendPreviewUpdate();
    }

    async function startLivePreview() {
        if (state.busy) return false;
        var config = collectConfig();
        if (config.mode === "custom" && !state.profileLoaded) {
            setStatus("error", "Load a clipboard profile first.");
            return false;
        }
        saveSettings();
        setBusy(true);
        setStatus("info", "Starting preview...");
        try {
            var response = await callHost("obevelStartPreview", config);
            if (!response.ok) throw new Error(response.message || "Could not start preview.");
            state.previewActive = true;
            setStatus("success", response.message || "Preview started.");
            return true;
        } catch (error) {
            setStatus("error", error.message);
            return false;
        } finally {
            setBusy(false);
            updatePreviewControls();
        }
    }

    async function cancelLivePreview() {
        if (state.busy) return;
        state.previewQueued = false;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        setBusy(true);
        setStatus("info", "Cancelling preview...");
        try {
            var response = await callHost("obevelCancelPreview");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.previewActive = false;
            setStatus("info", response.message || "Preview cancelled.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            updatePreviewControls();
        }
    }

    async function applyLivePreview() {
        if (state.busy) return;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        if (state.previewQueued && state.previewActive) {
            state.previewQueued = false;
            await sendPreviewUpdate();
            if (state.previewPending) {
                try { await state.previewPending; } catch (e) {}
            }
        }
        setBusy(true);
        setStatus("info", "Applying preview...");
        try {
            var response = await callHost("obevelApplyPreview");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.previewActive = false;
            setStatus("success", response.message || "Bevel applied.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            updatePreviewControls();
        }
    }

    async function loadClipboard() {
        if (state.busy) return;
        setBusy(true);
        setStatus("info", "Reading clipboard...");
        try {
            var response = await callHost("obevelLoadClipboard");
            if (!response.ok) throw new Error(response.message || "Could not load profile.");
            state.profileLoaded = true;
            state.profilePoints = response.points || 0;
            setProfileStatus("Profile: " + state.profilePoints + " points loaded.");
            setStatus("success", response.message || "Profile loaded.");
            if (state.previewActive) schedulePreviewUpdate();
        } catch (error) {
            state.profileLoaded = false;
            setProfileStatus("Profile: " + error.message);
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            updatePreviewControls();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("obevelHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.previewActive) {
                try { await callHost("obevelCancelPreview"); } catch (e) {}
            }
            state.previewActive = false;
            fields.livePreview.checked = false;
            if (handshake.profileLoaded) {
                state.profileLoaded = true;
                state.profilePoints = handshake.profilePoints || 0;
                setProfileStatus("Profile: " + state.profilePoints + " points loaded.");
            }
            updatePreviewControls();
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
        if (state.previewActive) schedulePreviewUpdate();
    }

    function bindSliderPair(numKey, rangeKey) {
        var numField = fields[numKey];
        var rangeField = fields[rangeKey];
        if (rangeField) {
            rangeField.addEventListener("input", function () {
                syncPair(numKey, rangeKey, rangeField.value);
                onParameterChanged();
            });
        }
        if (numField) {
            numField.addEventListener("input", function () {
                syncPair(numKey, rangeKey, numField.value);
                onParameterChanged();
            });
        }
    }

    function bindModeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-mode]"), function (button) {
            button.addEventListener("click", function () {
                fields.mode.value = button.getAttribute("data-mode") || "steps";
                updateModeButtons();
                onParameterChanged();
            });
        });
    }

    function bindCheckboxes() {
        ["flip", "straighten"].forEach(function (key) {
            fields[key].addEventListener("change", onParameterChanged);
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindModeButtons();
    bindCheckboxes();

    buttons.countReset.addEventListener("click", function () {
        syncPair("count", "countRange", DEFAULTS.count);
        onParameterChanged();
    });
    buttons.radiusReset.addEventListener("click", function () {
        syncPair("radius", "radiusRange", DEFAULTS.radius);
        onParameterChanged();
    });

    buttons.loadClipboard.addEventListener("click", loadClipboard);

    fields.livePreview.addEventListener("change", async function () {
        if (fields.livePreview.checked) {
            var ok = await startLivePreview();
            if (!ok) fields.livePreview.checked = false;
        } else {
            await cancelLivePreview();
        }
    });

    buttons.apply.addEventListener("click", async function () {
        if (state.previewActive) {
            await applyLivePreview();
            fields.livePreview.checked = false;
        } else {
            var config = collectConfig();
            if (config.mode === "custom" && !state.profileLoaded) {
                setStatus("error", "Load a clipboard profile first.");
                return;
            }
            await runHostAction("Bevelling selection", "obevelRun", config);
        }
    });

    buttons.cancel.addEventListener("click", async function () {
        await cancelLivePreview();
        fields.livePreview.checked = false;
    });

    buttons.reset.addEventListener("click", function () {
        applySnapshot(getDefaultConfig());
        saveSettings();
        setStatus("info", "Parameters reset to defaults.");
        if (state.previewActive) schedulePreviewUpdate();
    });

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    updatePreviewControls();
    initializePanel();
})();
