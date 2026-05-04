(function () {
    var STORAGE_KEY = "osymbol.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        replace: document.getElementById("replace")
    };
    var buttons = {
        create: document.getElementById("createBtn")
    };
    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

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
        return { replace: !!fields.replace.checked };
    }
    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snap) {
        fields.replace.checked = !!snap.replace;
    }

    function restoreSettings() {
        var restored = { replace: true };
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
        return { replace: !!fields.replace.checked };
    }

    async function runCreate() {
        if (state.busy) return;
        var cfg = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Creating symbols...");
        try {
            var payload = escapeForEval(JSON.stringify(cfg));
            var response = parseHostResponse(await evalHost("osymbolRun('" + payload + "')"));
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
            var handshake = parseHostResponse(await evalHost("osymbolHandshake()"));
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    fields.replace.addEventListener("change", saveSettings);
    buttons.create.addEventListener("click", runCreate);

    restoreSettings();
    initializePanel();
})();
