(function () {
    var STORAGE_KEY = "ocolor.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        doFill: document.getElementById("doFill"),
        doStroke: document.getElementById("doStroke")
    };

    var buttons = {
        randomize: document.getElementById("randomizeBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    function getDefaultConfig() {
        return { doFill: true, doStroke: false };
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
        Object.keys(fields).forEach(function (key) {
            fields[key].disabled = isBusy;
        });
        state.busy = isBusy;
        if (!isBusy) refreshRandomizeButton();
    }

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function refreshRandomizeButton() {
        var hasMode = fields.doFill.checked || fields.doStroke.checked;
        buttons.randomize.disabled = !hasMode || state.busy;
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

    function getSnapshot() {
        return {
            doFill: !!fields.doFill.checked,
            doStroke: !!fields.doStroke.checked
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        fields.doFill.checked = !!snapshot.doFill;
        fields.doStroke.checked = !!snapshot.doStroke;
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
        return {
            doFill: !!fields.doFill.checked,
            doStroke: !!fields.doStroke.checked
        };
    }

    async function randomize() {
        if (state.busy) return;
        var config = collectConfig();
        if (!config.doFill && !config.doStroke) {
            setStatus("error", "Enable Fill or Stroke first.");
            return;
        }
        saveSettings();
        setBusy(true);
        setStatus("info", "Randomizing...");
        try {
            var response = await callHost("ocolorRandomize", config);
            if (!response.ok) throw new Error(response.message || "Randomize failed.");
            setStatus("success", response.message || "Done.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("ocolorHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            var msg = handshake.message + " " + handshake.hostName + " " + handshake.hostVersion;
            if (typeof handshake.swatches === "number") {
                msg += " (" + handshake.swatches + " swatches selected)";
            }
            setStatus("success", msg);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    fields.doFill.addEventListener("change", function () {
        saveSettings();
        refreshRandomizeButton();
    });
    fields.doStroke.addEventListener("change", function () {
        saveSettings();
        refreshRandomizeButton();
    });

    buttons.randomize.addEventListener("click", randomize);

    restoreSettings();
    refreshRandomizeButton();
    initializePanel();
})();
