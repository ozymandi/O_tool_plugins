(function () {
    var STORAGE_KEY = "ofit.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        mode: document.getElementById("mode"),
        padX: document.getElementById("padX"),
        padY: document.getElementById("padY"),
        align: document.getElementById("align")
    };

    var buttons = {
        fit: document.getElementById("fitBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    function getDefaultConfig() {
        return {
            mode: "contain",
            padX: "0",
            padY: "0",
            align: "middle-center"
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

    function updateModeButtons() {
        var current = String(fields.mode.value || "contain");
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-mode]"), function (button) {
            var active = button.getAttribute("data-mode") === current;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function updateAlignGrid() {
        var current = String(fields.align.value || "middle-center");
        Array.prototype.forEach.call(document.querySelectorAll(".align-cell"), function (cell) {
            var active = cell.getAttribute("data-align") === current;
            cell.classList.toggle("is-active", active);
            cell.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function getSnapshot() {
        return {
            mode: fields.mode.value,
            padX: fields.padX.value,
            padY: fields.padY.value,
            align: fields.align.value
        };
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        fields.mode.value = String(snapshot.mode || "contain");
        fields.padX.value = String(snapshot.padX);
        fields.padY.value = String(snapshot.padY);
        fields.align.value = String(snapshot.align || "middle-center");
        updateModeButtons();
        updateAlignGrid();
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
        var mode = String(fields.mode.value || "contain");
        var padX = parseFloat(fields.padX.value);
        var padY = parseFloat(fields.padY.value);
        var align = String(fields.align.value || "middle-center");

        if (!Number.isFinite(padX)) padX = 0;
        if (!Number.isFinite(padY)) padY = 0;

        return {
            mode: mode,
            padX: padX,
            padY: padY,
            align: align
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

    async function initializePanel() {
        try {
            var handshake = parseHostResponse(await evalHost("ofitHandshake()"));
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

    function bindModeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-mode]"), function (button) {
            button.addEventListener("click", function () {
                fields.mode.value = button.getAttribute("data-mode") || "contain";
                updateModeButtons();
                saveSettings();
            });
        });
    }

    function bindAlignGrid() {
        Array.prototype.forEach.call(document.querySelectorAll(".align-cell"), function (cell) {
            cell.addEventListener("click", function () {
                fields.align.value = cell.getAttribute("data-align") || "middle-center";
                updateAlignGrid();
                saveSettings();
            });
        });
    }

    function bindPersistence() {
        ["padX", "padY"].forEach(function (key) {
            fields[key].addEventListener("change", saveSettings);
            fields[key].addEventListener("input", saveSettings);
        });
    }

    buttons.fit.addEventListener("click", function () {
        runHostAction("Fitting to artboard", "ofitRun", collectConfig());
    });

    restoreSettings();
    bindModeButtons();
    bindAlignGrid();
    bindPersistence();
    bindNumberWheel();
    bindNumericScrubbers();
    initializePanel();
})();
