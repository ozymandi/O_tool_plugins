(function () {
    var STORAGE_KEY = "onebular.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        minWidth: document.getElementById("minWidth"),
        maxWidth: document.getElementById("maxWidth"),
        minOpacity: document.getElementById("minOpacity"),
        maxOpacity: document.getElementById("maxOpacity")
    };
    var buttons = { stylize: document.getElementById("stylizeBtn") };
    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    var DEFAULTS = { minWidth: "0.1", maxWidth: "1.0", minOpacity: "30", maxOpacity: "100" };

    function safeStorageGet() {
        try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }
    function safeStorageSet(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function setBusy(isBusy) {
        Object.keys(buttons).forEach(function (k) { if (buttons[k]) buttons[k].disabled = isBusy; });
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
        catch (error) { return { ok: false, message: "Could not parse Illustrator response: " + result }; }
    }

    function getSnapshot() {
        return {
            minWidth: fields.minWidth.value,
            maxWidth: fields.maxWidth.value,
            minOpacity: fields.minOpacity.value,
            maxOpacity: fields.maxOpacity.value
        };
    }
    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snap) {
        fields.minWidth.value = String(snap.minWidth);
        fields.maxWidth.value = String(snap.maxWidth);
        fields.minOpacity.value = String(snap.minOpacity);
        fields.maxOpacity.value = String(snap.maxOpacity);
    }

    function restoreSettings() {
        var restored = JSON.parse(JSON.stringify(DEFAULTS));
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

    function collectConfig() {
        var minW = parseFloat(fields.minWidth.value);
        var maxW = parseFloat(fields.maxWidth.value);
        var minO = parseFloat(fields.minOpacity.value);
        var maxO = parseFloat(fields.maxOpacity.value);
        if (!Number.isFinite(minW) || minW <= 0) minW = 0.1;
        if (!Number.isFinite(maxW) || maxW <= 0) maxW = 1.0;
        if (!Number.isFinite(minO)) minO = 30;
        if (!Number.isFinite(maxO)) maxO = 100;
        if (minW > maxW) { var t = minW; minW = maxW; maxW = t; }
        if (minO > maxO) { var t2 = minO; minO = maxO; maxO = t2; }
        if (minO < 0) minO = 0; if (maxO > 100) maxO = 100;
        return { minWidth: minW, maxWidth: maxW, minOpacity: minO, maxOpacity: maxO };
    }

    async function runStylize() {
        if (state.busy) return;
        var cfg = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Stylizing...");
        try {
            var payload = escapeForEval(JSON.stringify(cfg));
            var response = parseHostResponse(await evalHost("onebularRun('" + payload + "')"));
            if (!response.ok) throw new Error(response.message || "Illustrator returned an error.");
            setStatus("success", response.message || "Done.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function initializePanel() {
        try {
            var handshake = parseHostResponse(await evalHost("onebularHandshake()"));
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

    Object.keys(fields).forEach(function (k) {
        fields[k].addEventListener("change", saveSettings);
        fields[k].addEventListener("input", saveSettings);
    });
    buttons.stylize.addEventListener("click", runStylize);

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    initializePanel();
})();
