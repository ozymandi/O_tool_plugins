(function () {
    var STORAGE_KEY = "oconnect.panel.settings.v1";
    var state = { busy: false, activeDropdown: null };

    var fields = {
        tension: document.getElementById("tension"),
        tensionRange: document.getElementById("tensionRange"),
        angle: document.getElementById("angle"),
        angleRange: document.getElementById("angleRange"),
        strokeWidth: document.getElementById("strokeWidth"),
        colorMode: document.getElementById("colorMode")
    };

    var buttons = {
        connect: document.getElementById("connectBtn"),
        tensionReset: document.getElementById("tensionResetBtn"),
        angleReset: document.getElementById("angleResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    var COLOR_LABELS = {
        "hub": "Hub stroke",
        "black": "Black",
        "swatch": "First swatch"
    };

    function getDefaultConfig() {
        return {
            tension: "0.35",
            angle: "20",
            strokeWidth: "2",
            colorMode: "hub"
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

    function syncTensionToUi(value, save) {
        var num = Number(value);
        if (!Number.isFinite(num)) num = 0.35;
        if (num < 0) num = 0;
        if (num > 2) num = 2;
        fields.tension.value = String(Number(num.toFixed(2)));
        if (fields.tensionRange) {
            fields.tensionRange.value = String(Math.round(clamp(num, 0, 1) * 100));
            updateSliderFill(fields.tensionRange);
        }
        if (save !== false) saveSettings();
    }

    function syncAngleToUi(value, save) {
        var num = Math.round(Number(value));
        if (!Number.isFinite(num)) num = 20;
        num = clamp(num, 1, 89);
        fields.angle.value = String(num);
        if (fields.angleRange) {
            fields.angleRange.value = String(num);
            updateSliderFill(fields.angleRange);
        }
        if (save !== false) saveSettings();
    }

    function updateColorDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="colorMode"]');
        var label = wrapper ? wrapper.querySelector(".ui-dropdown-label") : null;
        var value = fields.colorMode.value || "hub";
        var text = COLOR_LABELS[value] || value;
        Array.prototype.forEach.call(document.querySelectorAll('.simple-dropdown[data-id="colorMode"] .custom-option'), function (option) {
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
            tension: fields.tension.value,
            angle: fields.angle.value,
            strokeWidth: fields.strokeWidth.value,
            colorMode: fields.colorMode.value
        };
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        fields.strokeWidth.value = String(snapshot.strokeWidth);
        fields.colorMode.value = String(snapshot.colorMode || "hub");
        syncTensionToUi(snapshot.tension, false);
        syncAngleToUi(snapshot.angle, false);
        updateColorDropdown();
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
        var tension = parseFloat(fields.tension.value);
        var angle = parseFloat(fields.angle.value);
        var strokeWidth = parseFloat(fields.strokeWidth.value);
        var colorMode = String(fields.colorMode.value || "hub");

        if (!Number.isFinite(tension) || tension < 0) throw new Error("Tension must be 0 or greater.");
        if (!Number.isFinite(angle) || angle < 1 || angle >= 90) throw new Error("Angle threshold must be between 1 and 89.");
        if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) throw new Error("Stroke width must be greater than 0.");
        if (!COLOR_LABELS.hasOwnProperty(colorMode)) throw new Error("Unknown color mode: " + colorMode);

        return {
            tension: tension,
            angle: angle,
            strokeWidth: strokeWidth,
            colorMode: colorMode
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
            var handshake = parseHostResponse(await evalHost("oconnectHandshake()"));
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
        if (fields.tensionRange) {
            fields.tensionRange.addEventListener("input", function () {
                fields.tension.value = String(Number(fields.tensionRange.value) / 100);
                syncTensionToUi(fields.tension.value, true);
            });
        }
        if (fields.tension) {
            fields.tension.addEventListener("input", function () { syncTensionToUi(fields.tension.value, true); });
        }
        if (buttons.tensionReset) {
            buttons.tensionReset.addEventListener("click", function () { syncTensionToUi(0.35, true); });
        }
        if (fields.angleRange) {
            fields.angleRange.addEventListener("input", function () { syncAngleToUi(fields.angleRange.value, true); });
        }
        if (fields.angle) {
            fields.angle.addEventListener("input", function () { syncAngleToUi(fields.angle.value, true); });
        }
        if (buttons.angleReset) {
            buttons.angleReset.addEventListener("click", function () { syncAngleToUi(20, true); });
        }
    }

    function bindColorDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="colorMode"]');
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
            } else if (event.key === "Escape") closeDropdown();
        });

        Array.prototype.forEach.call(wrapper.querySelectorAll(".custom-option"), function (option) {
            option.addEventListener("click", function () {
                fields.colorMode.value = option.getAttribute("data-value") || "hub";
                updateColorDropdown();
                closeDropdown();
                saveSettings();
            });
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    function bindPersistence() {
        ["strokeWidth"].forEach(function (key) {
            fields[key].addEventListener("change", saveSettings);
            fields[key].addEventListener("input", saveSettings);
        });
    }

    buttons.connect.addEventListener("click", function () {
        runCollectedAction("Connecting hub", "oconnectRun");
    });

    restoreSettings();
    bindPersistence();
    bindSliderControls();
    bindColorDropdown();
    bindNumberInputWheelControls();
    bindNumericScrubbers();
    initializePanel();
})();
