(function () {
    var STORAGE_KEY = "odeselect.panel.settings.v1";
    var state = {
        busy: false
    };

    var fields = {
        mode: document.getElementById("mode"),
        selectedCount: document.getElementById("selectedCount"),
        unselectedCount: document.getElementById("unselectedCount"),
        offset: document.getElementById("offset"),
        probability: document.getElementById("probability"),
        probabilityRange: document.getElementById("probabilityRange")
    };

    var buttons = {
        apply: document.getElementById("applyBtn"),
        saveSelection: document.getElementById("saveSelectionBtn"),
        probabilityReset: document.getElementById("probabilityResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    function getDefaultConfig() {
        return {
            mode: "sequence",
            selectedCount: "1",
            unselectedCount: "1",
            offset: "0",
            probability: "50"
        };
    }

    function safeStorageGet() {
        try {
            return window.localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            return null;
        }
    }

    function safeStorageSet(value) {
        try {
            window.localStorage.setItem(STORAGE_KEY, value);
        } catch (error) {}
    }

    function setBusy(isBusy) {
        Object.keys(buttons).forEach(function (key) {
            if (buttons[key]) {
                buttons[key].disabled = isBusy;
            }
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

            try {
                cep = getCepApi();
            } catch (error) {
                reject(error);
                return;
            }

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
        try {
            return JSON.parse(result);
        } catch (error) {
            return {
                ok: false,
                message: "Could not parse Illustrator response: " + result
            };
        }
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function updateSliderFill(input) {
        if (!input) {
            return;
        }
        var min = Number(input.min);
        var max = Number(input.max);
        var value = Number(input.value);
        if (!Number.isFinite(min)) min = 0;
        if (!Number.isFinite(max) || max === min) max = 100;
        if (!Number.isFinite(value)) value = 0;
        var ratio = clamp((value - min) / (max - min), 0, 1) * 100;
        input.style.setProperty("--fill-end", ratio + "%");
    }

    function syncProbabilityToUi(value, save) {
        var safeValue = clamp(Math.round(Number(value) || 0), 0, 100);
        fields.probability.value = String(safeValue);
        if (fields.probabilityRange) {
            fields.probabilityRange.value = String(safeValue);
            updateSliderFill(fields.probabilityRange);
        }
        if (save !== false) {
            saveSettings();
        }
    }

    function updateModeButtons() {
        var current = String(fields.mode.value || "sequence");
        Array.prototype.forEach.call(document.querySelectorAll(".mode-seg"), function (button) {
            var active = button.getAttribute("data-mode") === current;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        Array.prototype.forEach.call(document.querySelectorAll("[data-mode-section]"), function (section) {
            section.classList.toggle("is-visible", section.getAttribute("data-mode-section") === current);
        });
    }

    function getSnapshot() {
        return {
            mode: fields.mode.value,
            selectedCount: fields.selectedCount.value,
            unselectedCount: fields.unselectedCount.value,
            offset: fields.offset.value,
            probability: fields.probability.value
        };
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        fields.mode.value = String(snapshot.mode || "sequence");
        fields.selectedCount.value = String(snapshot.selectedCount);
        fields.unselectedCount.value = String(snapshot.unselectedCount);
        fields.offset.value = String(snapshot.offset);
        syncProbabilityToUi(snapshot.probability, false);
        updateModeButtons();
    }

    function restoreSettings() {
        var restored = getDefaultConfig();
        var raw = safeStorageGet();
        var parsed;
        var key;

        if (raw) {
            try {
                parsed = JSON.parse(raw);
                for (key in parsed) {
                    if (parsed.hasOwnProperty(key) && restored.hasOwnProperty(key)) {
                        restored[key] = parsed[key];
                    }
                }
            } catch (error) {}
        }

        applySnapshot(restored);
    }

    function collectConfig() {
        var mode = String(fields.mode.value || "sequence");
        var config = { mode: mode };

        if (mode === "random") {
            var prob = Number(fields.probability.value);
            if (!Number.isFinite(prob)) {
                throw new Error("Probability must be numeric.");
            }
            config.probability = clamp(prob, 0, 100);
        } else {
            var sel = parseInt(fields.selectedCount.value, 10);
            var unsel = parseInt(fields.unselectedCount.value, 10);
            var off = parseInt(fields.offset.value, 10);

            if (!Number.isFinite(sel) || sel < 0) {
                throw new Error("Selected count must be zero or greater.");
            }
            if (!Number.isFinite(unsel) || unsel < 0) {
                throw new Error("Unselected count must be zero or greater.");
            }
            if (!Number.isFinite(off)) {
                throw new Error("Offset must be numeric.");
            }
            if (sel + unsel < 1) {
                throw new Error("Selected and Unselected together must be at least 1.");
            }

            config.selectedCount = sel;
            config.unselectedCount = unsel;
            config.offset = off;
        }

        return config;
    }

    async function runHostAction(label, hostFunction, config) {
        var payload;
        var response;

        saveSettings();
        setBusy(true);
        setStatus("info", label + "...");

        try {
            payload = escapeForEval(JSON.stringify(config));
            response = parseHostResponse(await evalHost(hostFunction + "('" + payload + "')"));

            if (!response.ok) {
                throw new Error(response.message || "Illustrator returned an error.");
            }

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
        try {
            config = collectConfig();
        } catch (error) {
            setStatus("error", error.message);
            return null;
        }
        return runHostAction(label, hostFunction, config);
    }

    async function initializePanel() {
        try {
            var handshake = parseHostResponse(await evalHost("odeselectHandshake()"));
            if (!handshake.ok) {
                throw new Error(handshake.message || "Could not connect to Illustrator.");
            }
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
            if (isNumericInput(input) && !input.disabled && !input.readOnly) {
                trackedInput = input;
            }
        }

        function clearTrackedInput(input) {
            if (trackedInput === input) trackedInput = null;
        }

        function resolveNumericInput(event) {
            var candidates = [];
            var pointNode = null;

            if (event.target && event.target.closest) {
                candidates.push(event.target.closest('input[type="number"]'));
            }
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
                if (shell && shell.classList && shell.classList.contains("slider-capsule")) {
                    return;
                }
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
                dragState = {
                    input: input,
                    startX: event.clientX,
                    lastSteps: 0
                };
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
            if (!stepDelta) {
                event.preventDefault();
                return;
            }
            for (var i = 0; i < Math.abs(stepDelta); i += 1) {
                adjustNumberInput(dragState.input, stepDelta > 0 ? 1 : -1);
            }
            dragState.lastSteps = deltaSteps;
            event.preventDefault();
        }, true);

        document.addEventListener("mouseup", finishScrub, true);
        window.addEventListener("blur", finishScrub);
    }

    function bindPersistence() {
        Object.keys(fields).forEach(function (key) {
            var element = fields[key];
            if (!element) return;
            var eventName = element.type === "checkbox" ? "change" : "input";
            element.addEventListener("change", saveSettings);
            if (element.type !== "hidden") {
                element.addEventListener(eventName, saveSettings);
            }
        });
    }

    function bindModeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll(".mode-seg"), function (button) {
            button.addEventListener("click", function () {
                fields.mode.value = button.getAttribute("data-mode") || "sequence";
                updateModeButtons();
                saveSettings();
            });
        });
    }

    function bindProbabilityControls() {
        if (fields.probabilityRange) {
            fields.probabilityRange.addEventListener("input", function () {
                syncProbabilityToUi(fields.probabilityRange.value, true);
            });
        }
        if (fields.probability) {
            fields.probability.addEventListener("input", function () {
                syncProbabilityToUi(fields.probability.value, true);
            });
        }
        if (buttons.probabilityReset) {
            buttons.probabilityReset.addEventListener("click", function () {
                syncProbabilityToUi(50, true);
            });
        }
    }

    buttons.apply.addEventListener("click", function () {
        runCollectedAction("Applying selection pattern", "odeselectApply");
    });

    buttons.saveSelection.addEventListener("click", function () {
        runCollectedAction("Saving selection", "odeselectSaveSelection");
    });

    restoreSettings();
    bindPersistence();
    bindModeButtons();
    bindProbabilityControls();
    bindNumberInputWheelControls();
    bindNumericScrubbers();
    initializePanel();
})();
