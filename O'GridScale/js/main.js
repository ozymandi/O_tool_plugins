(function () {
    var STORAGE_KEY = "ogridscale.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        mode: document.getElementById("mode"),
        easing: document.getElementById("easing"),
        startScale: document.getElementById("startScale"),
        startScaleRange: document.getElementById("startScaleRange"),
        endScale: document.getElementById("endScale"),
        endScaleRange: document.getElementById("endScaleRange"),
        scaleStrokes: document.getElementById("scaleStrokes"),
        invert: document.getElementById("invert")
    };

    var labels = {
        start: document.getElementById("startLabel"),
        end: document.getElementById("endLabel")
    };

    var buttons = {
        apply: document.getElementById("applyBtn"),
        startReset: document.getElementById("startScaleResetBtn"),
        endReset: document.getElementById("endScaleResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    var MODE_LABELS = {
        radial: { start: "Start (center)", end: "End (edges)" },
        horizontal: { start: "Start (left)", end: "End (right)" },
        vertical: { start: "Start (top)", end: "End (bottom)" }
    };

    function getDefaultConfig() {
        return {
            mode: "radial",
            easing: "cosine",
            startScale: "85",
            endScale: "15",
            scaleStrokes: true,
            invert: false
        };
    }

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
        catch (error) {
            return { ok: false, message: "Could not parse Illustrator response: " + result };
        }
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

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

    function syncScaleToUi(which, value, save) {
        var num = Math.round(Number(value));
        if (!Number.isFinite(num)) num = (which === "start") ? 85 : 15;
        if (num < 0) num = 0;
        if (num > 500) num = 500;
        var input = (which === "start") ? fields.startScale : fields.endScale;
        var rangeInput = (which === "start") ? fields.startScaleRange : fields.endScaleRange;
        input.value = String(num);
        if (rangeInput) {
            rangeInput.value = String(clamp(num, 0, 200));
            updateSliderFill(rangeInput);
        }
        if (save !== false) saveSettings();
    }

    function updateModeLabels() {
        var mode = fields.mode.value || "radial";
        var pair = MODE_LABELS[mode] || MODE_LABELS.radial;
        if (labels.start) labels.start.textContent = pair.start;
        if (labels.end) labels.end.textContent = pair.end;
    }

    function updateModeButtons() {
        var current = fields.mode.value || "radial";
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-mode]'), function (btn) {
            btn.classList.toggle("is-active", btn.getAttribute("data-mode") === current);
        });
    }

    function updateEasingButtons() {
        var current = fields.easing.value || "cosine";
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-easing]'), function (btn) {
            btn.classList.toggle("is-active", btn.getAttribute("data-easing") === current);
        });
    }

    function getSnapshot() {
        return {
            mode: fields.mode.value,
            easing: fields.easing.value,
            startScale: fields.startScale.value,
            endScale: fields.endScale.value,
            scaleStrokes: !!fields.scaleStrokes.checked,
            invert: !!fields.invert.checked
        };
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        fields.mode.value = String(snapshot.mode || "radial");
        fields.easing.value = String(snapshot.easing || "cosine");
        fields.scaleStrokes.checked = !!snapshot.scaleStrokes;
        fields.invert.checked = !!snapshot.invert;
        syncScaleToUi("start", snapshot.startScale, false);
        syncScaleToUi("end", snapshot.endScale, false);
        updateModeButtons();
        updateModeLabels();
        updateEasingButtons();
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
        var startScale = parseFloat(fields.startScale.value);
        var endScale = parseFloat(fields.endScale.value);
        var mode = String(fields.mode.value || "radial");
        var easing = String(fields.easing.value || "cosine");

        if (!MODE_LABELS.hasOwnProperty(mode)) throw new Error("Unknown mode: " + mode);
        if (easing !== "cosine" && easing !== "linear") throw new Error("Unknown easing: " + easing);
        if (!Number.isFinite(startScale)) throw new Error("Start scale must be a number.");
        if (!Number.isFinite(endScale)) throw new Error("End scale must be a number.");

        return {
            mode: mode,
            easing: easing,
            startScale: startScale,
            endScale: endScale,
            scaleStrokes: !!fields.scaleStrokes.checked,
            invert: !!fields.invert.checked
        };
    }

    async function runHostAction(label, hostFunction, config) {
        saveSettings();
        setBusy(true);
        setStatus("info", label + "...");
        try {
            var payload = escapeForEval(JSON.stringify(config));
            var response = parseHostResponse(await evalHost(hostFunction + "('" + payload + "')"));
            if (!response.ok) throw new Error(response.message || "Illustrator returned an error.");
            setStatus("success", response.message || (label + " complete."));
            return response;
        } catch (error) {
            setStatus("error", error.message);
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function runCollectedAction(label, hostFunction) {
        var config;
        try { config = collectConfig(); }
        catch (error) {
            setStatus("error", error.message);
            return null;
        }
        return runHostAction(label, hostFunction, config);
    }

    async function initializePanel() {
        try {
            var handshake = parseHostResponse(await evalHost("ogridscaleHandshake()"));
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
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
        var nextValue;

        if (!Number.isFinite(stepValue) || stepValue <= 0) stepValue = 1;
        if (!Number.isFinite(currentValue)) currentValue = 0;
        if (String(stepValue).indexOf(".") !== -1) {
            precision = String(stepValue).split(".")[1].length;
        }

        nextValue = currentValue + direction * stepValue;
        if (Number.isFinite(minValue) && nextValue < minValue) nextValue = minValue;
        if (Number.isFinite(maxValue) && nextValue > maxValue) nextValue = maxValue;
        if (precision > 0) nextValue = Number(nextValue.toFixed(precision));

        input.value = String(nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function bindNumberInputWheelControls() {
        var trackedInput = null;
        var panelTargets = [window, document, document.body, document.querySelector(".app")];
        var numberInputs = Array.prototype.slice.call(document.querySelectorAll('input[type="number"]'));

        function isNumericInput(node) {
            return !!(node && node.matches && node.matches('input[type="number"]'));
        }

        function setTrackedInput(input) {
            if (isNumericInput(input) && !input.disabled && !input.readOnly) trackedInput = input;
        }

        function clearTrackedInput(input) {
            if (trackedInput === input) trackedInput = null;
        }

        function resolveNumericInput(event) {
            var candidates = [];
            var pointNode = null;
            if (event.target && event.target.closest) candidates.push(event.target.closest('input[type="number"]'));
            if (typeof event.clientX === "number" && typeof event.clientY === "number") {
                pointNode = document.elementFromPoint(event.clientX, event.clientY);
                candidates.push(pointNode && pointNode.closest ? pointNode.closest('input[type="number"]') : null);
            }
            candidates.push(document.activeElement);
            candidates.push(trackedInput);
            for (var i = 0; i < candidates.length; i += 1) {
                var candidate = candidates[i];
                if (isNumericInput(candidate) && document.body.contains(candidate) && !candidate.disabled && !candidate.readOnly) {
                    return candidate;
                }
            }
            return null;
        }

        function getWheelDirection(event) {
            var delta = 0;
            if (typeof event.deltaY === "number" && event.deltaY !== 0) delta = event.deltaY;
            else if (typeof event.wheelDelta === "number" && event.wheelDelta !== 0) delta = -event.wheelDelta;
            else if (typeof event.detail === "number" && event.detail !== 0) delta = event.detail;
            return delta < 0 ? 1 : delta > 0 ? -1 : 0;
        }

        function handleNumericFieldScroll(event) {
            var input = resolveNumericInput(event);
            var direction = getWheelDirection(event);
            if (!input || !direction) return;
            if (event.preventDefault) event.preventDefault();
            if (event.stopPropagation) event.stopPropagation();
            setTrackedInput(input);
            input.focus();
            adjustNumberInput(input, direction);
            return false;
        }

        numberInputs.forEach(function (input) {
            input.addEventListener("mouseenter", function () { setTrackedInput(input); }, true);
            input.addEventListener("mousemove", function () { setTrackedInput(input); }, true);
            input.addEventListener("focus", function () { setTrackedInput(input); }, true);
            input.addEventListener("mouseleave", function () { clearTrackedInput(input); }, true);
            input.addEventListener("blur", function () { clearTrackedInput(input); }, true);
            input.addEventListener("wheel", handleNumericFieldScroll, true);
            input.addEventListener("mousewheel", handleNumericFieldScroll, true);
            input.onmousewheel = handleNumericFieldScroll;
        });

        panelTargets.forEach(function (target) {
            if (!target || !target.addEventListener) return;
            target.addEventListener("wheel", handleNumericFieldScroll, true);
            target.addEventListener("mousewheel", handleNumericFieldScroll, true);
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
            var handle;
            if (!field) return;
            if (!shell || !shell.classList || !shell.classList.contains("number-input-shell")) {
                if (shell && shell.classList && shell.classList.contains("slider-capsule")) return;
                shell = document.createElement("div");
                shell.className = "number-input-shell";
                input.parentNode.insertBefore(shell, input);
                shell.appendChild(input);
            }
            handle = shell.querySelector(".number-scrub-handle");
            if (!handle) {
                handle = document.createElement("button");
                handle.type = "button";
                handle.className = "number-scrub-handle";
                handle.tabIndex = -1;
                handle.setAttribute("aria-hidden", "true");
                shell.appendChild(handle);
            }
            handle.addEventListener("mousedown", function (event) {
                if (event.button !== 0) return;
                if (input.disabled) return;
                dragState = { input: input, startX: event.clientX, lastSteps: 0 };
                document.body.classList.add("is-number-scrubbing");
                input.focus();
                event.preventDefault();
                event.stopPropagation();
            });
        });

        document.addEventListener("mousemove", function (event) {
            if (!dragState) return;
            var deltaSteps = Math.trunc((event.clientX - dragState.startX) / (event.shiftKey ? 4 : 10));
            var stepDelta = deltaSteps - dragState.lastSteps;
            if (!stepDelta) { event.preventDefault(); return; }
            for (var i = 0; i < Math.abs(stepDelta); i += 1) {
                adjustNumberInput(dragState.input, stepDelta > 0 ? 1 : -1);
            }
            dragState.lastSteps = deltaSteps;
            event.preventDefault();
        }, true);

        document.addEventListener("mouseup", finishScrub, true);
        window.addEventListener("blur", finishScrub);
    }

    function bindSliderControls() {
        if (fields.startScaleRange) {
            fields.startScaleRange.addEventListener("input", function () {
                syncScaleToUi("start", fields.startScaleRange.value, true);
            });
        }
        if (fields.startScale) {
            fields.startScale.addEventListener("input", function () { syncScaleToUi("start", fields.startScale.value, true); });
        }
        if (buttons.startReset) {
            buttons.startReset.addEventListener("click", function () { syncScaleToUi("start", 85, true); });
        }
        if (fields.endScaleRange) {
            fields.endScaleRange.addEventListener("input", function () {
                syncScaleToUi("end", fields.endScaleRange.value, true);
            });
        }
        if (fields.endScale) {
            fields.endScale.addEventListener("input", function () { syncScaleToUi("end", fields.endScale.value, true); });
        }
        if (buttons.endReset) {
            buttons.endReset.addEventListener("click", function () { syncScaleToUi("end", 15, true); });
        }
    }

    function bindModeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-mode]'), function (btn) {
            btn.addEventListener("click", function () {
                fields.mode.value = btn.getAttribute("data-mode") || "radial";
                updateModeButtons();
                updateModeLabels();
                saveSettings();
            });
        });
    }

    function bindEasingButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-easing]'), function (btn) {
            btn.addEventListener("click", function () {
                fields.easing.value = btn.getAttribute("data-easing") || "cosine";
                updateEasingButtons();
                saveSettings();
            });
        });
    }

    function bindCheckboxes() {
        ["scaleStrokes", "invert"].forEach(function (key) {
            fields[key].addEventListener("change", saveSettings);
        });
    }

    buttons.apply.addEventListener("click", function () {
        runCollectedAction("Scaling", "ogridscaleRun");
    });

    restoreSettings();
    bindCheckboxes();
    bindSliderControls();
    bindModeButtons();
    bindEasingButtons();
    bindNumberInputWheelControls();
    bindNumericScrubbers();
    initializePanel();
})();
