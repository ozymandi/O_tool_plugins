(function () {
    var STORAGE_KEY = "osplit.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        keepOriginal: document.getElementById("keepOriginal")
    };

    var splitButtons = Array.prototype.slice.call(document.querySelectorAll(".split-btn"));

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    var MODE_LABELS = {
        "paragraphs": "Paragraphs",
        "lines": "Lines",
        "words": "Words",
        "characters": "Characters"
    };

    function getDefaultConfig() {
        return { keepOriginal: false };
    }

    function safeStorageGet() {
        try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function safeStorageSet(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function setBusy(isBusy) {
        splitButtons.forEach(function (btn) { btn.disabled = isBusy; });
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

    function getSnapshot() {
        return { keepOriginal: !!fields.keepOriginal.checked };
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        fields.keepOriginal.checked = !!snapshot.keepOriginal;
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

    async function runSplit(mode) {
        if (state.busy) return;
        if (!MODE_LABELS.hasOwnProperty(mode)) {
            setStatus("error", "Unknown split mode: " + mode);
            return;
        }

        saveSettings();
        setBusy(true);
        setStatus("info", "Splitting " + MODE_LABELS[mode].toLowerCase() + "...");

        try {
            var config = {
                mode: mode,
                keepOriginal: !!fields.keepOriginal.checked
            };
            var payload = escapeForEval(JSON.stringify(config));
            var response = parseHostResponse(await evalHost("osplitRun('" + payload + "')"));
            if (!response.ok) throw new Error(response.message || "Illustrator returned an error.");
            setStatus("success", response.message || (MODE_LABELS[mode] + " split complete."));
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function initializePanel() {
        try {
            var handshake = parseHostResponse(await evalHost("osplitHandshake()"));
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    splitButtons.forEach(function (btn) {
        btn.addEventListener("click", function () {
            runSplit(btn.getAttribute("data-mode"));
        });
    });

    fields.keepOriginal.addEventListener("change", saveSettings);

    restoreSettings();
    initializePanel();
})();
