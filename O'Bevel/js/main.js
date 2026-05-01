(function () {
    var STORAGE_KEY = "obevel.panel.settings.v1";

    var state = {
        editing: false,
        busy: false,
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
        straighten: document.getElementById("straighten")
    };

    var buttons = {
        action: document.getElementById("actionBtn"),
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

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function setProfileStatus(text) { profileStatusEl.textContent = text; }

    function refreshControlStates() {
        var idle = !state.editing;
        var busy = state.busy;
        var locked = idle || busy;

        // Lock all interactive elements inside lockable panels (Mode, Steps, Custom, Radius)
        var lockableInputs = document.querySelectorAll('.panel[data-lockable] input, .panel[data-lockable] button');
        Array.prototype.forEach.call(lockableInputs, function (el) {
            el.disabled = locked;
        });

        // Action button: always clickable unless busy. Label flips between BEVEL/APPLY.
        buttons.action.disabled = busy;
        buttons.action.textContent = state.editing ? "APPLY" : "BEVEL";

        // Cancel and Reset only meaningful while editing.
        buttons.cancel.disabled = locked;
        buttons.reset.disabled = locked;

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-editing", !idle);
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

    function sendPreviewUpdate() {
        if (!state.editing) return Promise.resolve(null);
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
                        state.editing = false;
                        refreshControlStates();
                    }
                }
                return response;
            })
            .catch(function (error) {
                setStatus("error", error.message);
            })
            .finally(function () {
                state.previewPending = null;
                if (state.previewQueued && state.editing) {
                    state.previewQueued = false;
                    sendPreviewUpdate();
                }
            });
        return state.previewPending;
    }

    function schedulePreviewUpdate() {
        if (!state.editing) return;
        sendPreviewUpdate();
    }

    async function startBevel() {
        if (state.busy || state.editing) return;

        // Force STEPS mode on every new session for predictable starts.
        fields.mode.value = "steps";
        updateModeButtons();
        saveSettings();

        var config = collectConfig();
        setBusy(true);
        setStatus("info", "Starting bevel...");
        try {
            var response = await callHost("obevelStartPreview", config);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.editing = true;
            setStatus("success", "Bevel started. Adjust parameters, then APPLY.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function applyBevel() {
        if (state.busy || !state.editing) return;

        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        if (state.previewQueued && state.editing) {
            state.previewQueued = false;
            await sendPreviewUpdate();
            if (state.previewPending) {
                try { await state.previewPending; } catch (e) {}
            }
        }

        setBusy(true);
        setStatus("info", "Applying...");
        try {
            var response = await callHost("obevelApplyPreview");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.editing = false;
            setStatus("success", response.message || "Bevel applied. Select another object to start again.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function cancelBevel() {
        if (state.busy || !state.editing) return;

        state.previewQueued = false;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }

        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("obevelCancelPreview");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.editing = false;
            setStatus("info", response.message || "Cancelled. Select an object to start again.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function loadClipboard() {
        if (state.busy || !state.editing) return;
        setBusy(true);
        setStatus("info", "Reading clipboard...");
        try {
            var response = await callHost("obevelLoadClipboard");
            if (!response.ok) throw new Error(response.message || "Could not load profile.");
            state.profileLoaded = true;
            state.profilePoints = response.points || 0;
            setProfileStatus("Profile: " + state.profilePoints + " points loaded.");
            setStatus("success", response.message || "Profile loaded.");
            schedulePreviewUpdate();
        } catch (error) {
            state.profileLoaded = false;
            setProfileStatus("Profile: " + error.message);
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("obevelHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            // Always start clean: cancel any stale session left in the host.
            if (handshake.previewActive) {
                try { await callHost("obevelCancelPreview"); } catch (e) {}
            }
            state.editing = false;
            if (handshake.profileLoaded) {
                state.profileLoaded = true;
                state.profilePoints = handshake.profilePoints || 0;
                setProfileStatus("Profile: " + state.profilePoints + " points loaded.");
            }
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
        if (state.editing) schedulePreviewUpdate();
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

    function bindModeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-mode]"), function (button) {
            button.addEventListener("click", function () {
                if (button.disabled) return;
                fields.mode.value = button.getAttribute("data-mode") || "steps";
                updateModeButtons();
                onParameterChanged();
            });
        });
    }

    function bindCheckboxes() {
        ["flip", "straighten"].forEach(function (key) {
            fields[key].addEventListener("change", function () {
                if (fields[key].disabled) return;
                onParameterChanged();
            });
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindModeButtons();
    bindCheckboxes();

    buttons.countReset.addEventListener("click", function () {
        if (buttons.countReset.disabled) return;
        syncPair("count", "countRange", DEFAULTS.count);
        onParameterChanged();
    });
    buttons.radiusReset.addEventListener("click", function () {
        if (buttons.radiusReset.disabled) return;
        syncPair("radius", "radiusRange", DEFAULTS.radius);
        onParameterChanged();
    });

    buttons.loadClipboard.addEventListener("click", function () {
        if (buttons.loadClipboard.disabled) return;
        loadClipboard();
    });

    buttons.action.addEventListener("click", function () {
        if (buttons.action.disabled) return;
        if (state.editing) applyBevel();
        else startBevel();
    });

    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        cancelBevel();
    });

    buttons.reset.addEventListener("click", function () {
        if (buttons.reset.disabled) return;
        applySnapshot(getDefaultConfig());
        saveSettings();
        setStatus("info", "Parameters reset to defaults.");
        if (state.editing) schedulePreviewUpdate();
    });

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
