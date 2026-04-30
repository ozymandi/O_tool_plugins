(function () {
    var STORAGE_KEY = "otrim.panel.settings.v1";
    var state = { busy: false, activeDropdown: null };

    var fields = {
        mode: document.getElementById("mode"),
        cols: document.getElementById("cols"),
        rows: document.getElementById("rows"),
        scale: document.getElementById("scale"),
        scaleRange: document.getElementById("scaleRange"),
        gap: document.getElementById("gap"),
        anchor: document.getElementById("anchor"),
        proportional: document.getElementById("proportional")
    };

    var buttons = {
        trim: document.getElementById("trimBtn"),
        scaleReset: document.getElementById("scaleResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    var ANCHOR_LABELS = {
        "center": "Center",
        "top-left": "Top-Left",
        "top-right": "Top-Right",
        "bottom-left": "Bottom-Left",
        "bottom-right": "Bottom-Right"
    };

    function getDefaultConfig() {
        return {
            mode: "col",
            cols: "5",
            rows: "1",
            scale: "80",
            gap: "0",
            anchor: "center",
            proportional: true
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

    function syncScaleToUi(value, save) {
        var safeValue = clamp(Math.round(Number(value) || 0), 1, 500);
        fields.scale.value = String(safeValue);
        if (fields.scaleRange) {
            var rangeMax = Number(fields.scaleRange.max);
            fields.scaleRange.value = String(Math.min(safeValue, rangeMax));
            updateSliderFill(fields.scaleRange);
        }
        if (save !== false) saveSettings();
    }

    function updateModeButtons() {
        var current = String(fields.mode.value || "col");
        Array.prototype.forEach.call(document.querySelectorAll(".mode-seg"), function (button) {
            var active = button.getAttribute("data-mode") === current;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        applyModeConstraints(current);
    }

    function applyModeConstraints(mode) {
        if (mode === "col") {
            fields.cols.disabled = false;
            fields.rows.disabled = true;
            fields.rows.value = "1";
        } else if (mode === "row") {
            fields.cols.disabled = true;
            fields.cols.value = "1";
            fields.rows.disabled = false;
        } else {
            fields.cols.disabled = false;
            fields.rows.disabled = false;
        }
    }

    function updateAnchorDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="anchor"]');
        var label = wrapper ? wrapper.querySelector(".ui-dropdown-label") : null;
        var value = fields.anchor.value || "center";
        var text = ANCHOR_LABELS[value] || value;

        Array.prototype.forEach.call(document.querySelectorAll('.simple-dropdown[data-id="anchor"] .custom-option'), function (option) {
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
            mode: fields.mode.value,
            cols: fields.cols.value,
            rows: fields.rows.value,
            scale: fields.scale.value,
            gap: fields.gap.value,
            anchor: fields.anchor.value,
            proportional: fields.proportional.checked
        };
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        fields.mode.value = String(snapshot.mode || "col");
        fields.cols.value = String(snapshot.cols);
        fields.rows.value = String(snapshot.rows);
        fields.gap.value = String(snapshot.gap);
        fields.anchor.value = String(snapshot.anchor || "center");
        fields.proportional.checked = !!snapshot.proportional;
        syncScaleToUi(snapshot.scale, false);
        updateModeButtons();
        updateAnchorDropdown();
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
        var mode = String(fields.mode.value || "col");
        var cols = parseInt(fields.cols.value, 10);
        var rows = parseInt(fields.rows.value, 10);
        var scale = parseFloat(fields.scale.value);
        var gap = parseFloat(fields.gap.value);
        var anchor = String(fields.anchor.value || "center");
        var proportional = !!fields.proportional.checked;

        if (mode === "col") rows = 1;
        if (mode === "row") cols = 1;

        if (!Number.isFinite(cols) || cols < 1) throw new Error("Cols must be 1 or greater.");
        if (!Number.isFinite(rows) || rows < 1) throw new Error("Rows must be 1 or greater.");
        if (!Number.isFinite(scale) || scale <= 0) throw new Error("Scale must be greater than zero.");
        if (!Number.isFinite(gap)) throw new Error("Gap must be numeric.");

        if (!ANCHOR_LABELS.hasOwnProperty(anchor)) throw new Error("Unknown anchor: " + anchor);

        return {
            mode: mode,
            cols: cols,
            rows: rows,
            scale: scale,
            gap: gap,
            anchor: anchor,
            proportional: proportional
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
            var handshake = parseHostResponse(await evalHost("otrimHandshake()"));
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
                fields.mode.value = button.getAttribute("data-mode") || "col";
                updateModeButtons();
                saveSettings();
            });
        });
    }

    function bindScaleControls() {
        if (fields.scaleRange) {
            fields.scaleRange.addEventListener("input", function () {
                syncScaleToUi(fields.scaleRange.value, true);
            });
        }
        if (fields.scale) {
            fields.scale.addEventListener("input", function () {
                syncScaleToUi(fields.scale.value, true);
            });
        }
        if (buttons.scaleReset) {
            buttons.scaleReset.addEventListener("click", function () {
                syncScaleToUi(100, true);
            });
        }
    }

    function bindAnchorDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="anchor"]');
        var toggle = wrapper ? wrapper.querySelector(".ui-dropdown-toggle") : null;
        if (!wrapper || !toggle) return;

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (wrapper.classList.contains("open")) closeDropdown();
            else openDropdown(wrapper);
        });

        toggle.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (wrapper.classList.contains("open")) closeDropdown();
                else openDropdown(wrapper);
            } else if (event.key === "Escape") {
                closeDropdown();
            }
        });

        Array.prototype.forEach.call(wrapper.querySelectorAll(".custom-option"), function (option) {
            option.addEventListener("click", function () {
                fields.anchor.value = option.getAttribute("data-value") || "center";
                updateAnchorDropdown();
                closeDropdown();
                saveSettings();
            });
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    buttons.trim.addEventListener("click", function () {
        runCollectedAction("Trimming selection", "otrimRun");
    });

    restoreSettings();
    bindPersistence();
    bindModeButtons();
    bindScaleControls();
    bindAnchorDropdown();
    bindNumberInputWheelControls();
    bindNumericScrubbers();
    initializePanel();
})();
