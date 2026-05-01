(function () {
    var STORAGE_KEY = "ocone.panel.settings.v1";

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        activeDropdown: null
    };

    var fields = {
        style: document.getElementById("style"),
        quality: document.getElementById("quality"),
        qualityRange: document.getElementById("qualityRange")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        apply: document.getElementById("applyBtn"),
        cancel: document.getElementById("cancelBtn"),
        reset: document.getElementById("resetBtn"),
        qualityReset: document.getElementById("qualityResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");

    var STYLE_LABELS = {
        "0": "Silver (Metallic)",
        "1": "Gold (Metallic)",
        "2": "Holographic (Rainbow)",
        "3": "Radar (Green)",
        "4": "Spectrum (Full RGB)"
    };

    var DEFAULTS = {
        style: 0,
        quality: 180
    };

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
            buttons.primary.textContent = "CONE";
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
        var ratio = clamp((value - min) / (max - min), 0, 1) * 100;
        input.style.setProperty("--fill-end", ratio + "%");
    }

    function syncQuality(value) {
        var num = Number(value);
        if (!Number.isFinite(num)) num = DEFAULTS.quality;
        var nMin = Number(fields.quality.min);
        var nMax = Number(fields.quality.max);
        if (Number.isFinite(nMin) && num < nMin) num = nMin;
        if (Number.isFinite(nMax) && num > nMax) num = nMax;
        num = Math.round(num);
        fields.quality.value = String(num);
        var rMin = Number(fields.qualityRange.min);
        var rMax = Number(fields.qualityRange.max);
        var clamped = clamp(num, rMin, rMax);
        fields.qualityRange.value = String(clamped);
        updateSliderFill(fields.qualityRange);
    }

    function updateStyleDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="style"]');
        var label = wrapper ? wrapper.querySelector(".ui-dropdown-label") : null;
        var value = String(fields.style.value || "0");
        var text = STYLE_LABELS[value] || "—";
        Array.prototype.forEach.call(document.querySelectorAll('.simple-dropdown[data-id="style"] .custom-option'), function (option) {
            var active = option.getAttribute("data-value") === value;
            option.classList.toggle("is-selected", active);
            option.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (label) label.textContent = text;
    }

    function closeDropdown() {
        if (!state.activeDropdown) return;
        state.activeDropdown.classList.remove("open");
        var toggle = state.activeDropdown.querySelector(".ui-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
        state.activeDropdown = null;
    }

    function openDropdown(wrapper) {
        if (!wrapper) return;
        closeDropdown();
        wrapper.classList.add("open");
        var toggle = wrapper.querySelector(".ui-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "true");
        state.activeDropdown = wrapper;
    }

    function getSnapshot() {
        return {
            style: parseInt(fields.style.value, 10),
            quality: parseInt(fields.quality.value, 10)
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        fields.style.value = String(snapshot.style);
        syncQuality(snapshot.quality);
        updateStyleDropdown();
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
        var style = parseInt(fields.style.value, 10);
        var quality = parseInt(fields.quality.value, 10);
        if (!Number.isFinite(style) || style < 0 || style > 4) style = 0;
        if (!Number.isFinite(quality) || quality < 3) quality = 3;
        return { style: style, quality: quality };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var config = collectConfig();
        state.previewPending = callHost("oconeUpdate", config)
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
            .catch(function (error) {
                setStatus("error", error.message);
            })
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

    async function startCone() {
        if (state.busy || state.active) return;
        var config = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Building cones...");
        try {
            var response = await callHost("oconeStart", config);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Cone preview ready.");
            actionHintEl.textContent = "Adjust Style and Quality. APPLY commits, CANCEL reverts.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function applyCone() {
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
            var response = await callHost("oconeApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Select one or more shapes on the artboard, then press CONE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function cancelCone() {
        if (state.busy || !state.active) return;
        state.previewQueued = false;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("oconeCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Select one or more shapes on the artboard, then press CONE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("oconeHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("oconeCancel"); } catch (e) {}
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

    function bindStyleDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="style"]');
        var toggle = wrapper ? wrapper.querySelector(".ui-dropdown-toggle") : null;
        if (!wrapper || !toggle) return;

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (toggle.getAttribute("aria-expanded") === "true" && state.activeDropdown === wrapper) {
                closeDropdown();
            } else {
                if (toggle.disabled || toggle.style.pointerEvents === "none") return;
                openDropdown(wrapper);
            }
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
                fields.style.value = option.getAttribute("data-value") || "0";
                updateStyleDropdown();
                closeDropdown();
                onParameterChanged();
            });
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    function bindQualityControls() {
        fields.qualityRange.addEventListener("input", function () {
            if (fields.qualityRange.disabled) return;
            syncQuality(fields.qualityRange.value);
            onParameterChanged();
        });
        fields.quality.addEventListener("input", function () {
            if (fields.quality.disabled) return;
            syncQuality(fields.quality.value);
            onParameterChanged();
        });
        buttons.qualityReset.addEventListener("click", function () {
            if (buttons.qualityReset.disabled) return;
            syncQuality(DEFAULTS.quality);
            onParameterChanged();
        });
    }

    bindStyleDropdown();
    bindQualityControls();

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyCone();
        else startCone();
    });

    buttons.apply.addEventListener("click", function () {
        if (buttons.apply.disabled) return;
        applyCone();
    });

    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        cancelCone();
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
