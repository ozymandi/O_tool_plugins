(function () {
    var STORAGE_KEY = "oselect.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        includePaths: document.getElementById("includePaths"),
        includeCompound: document.getElementById("includeCompound"),
        includeText: document.getElementById("includeText"),
        includeRaster: document.getElementById("includeRaster"),
        includeMesh: document.getElementById("includeMesh"),
        includePlaced: document.getElementById("includePlaced"),
        skipClipping: document.getElementById("skipClipping"),
        skipHidden: document.getElementById("skipHidden"),
        skipLocked: document.getElementById("skipLocked")
    };

    var buttons = {
        selectObjects: document.getElementById("selectObjectsBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    function getDefaultConfig() {
        return {
            includePaths: true,
            includeCompound: true,
            includeText: true,
            includeRaster: false,
            includeMesh: false,
            includePlaced: false,
            skipClipping: true,
            skipHidden: true,
            skipLocked: true
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

    function getSnapshot() {
        var snap = {};
        Object.keys(fields).forEach(function (key) {
            snap[key] = !!fields[key].checked;
        });
        return snap;
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        Object.keys(fields).forEach(function (key) {
            fields[key].checked = !!snapshot[key];
        });
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
        return getSnapshot();
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
            var handshake = parseHostResponse(await evalHost("oselectHandshake()"));
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    function bindPersistence() {
        Object.keys(fields).forEach(function (key) {
            fields[key].addEventListener("change", saveSettings);
        });
    }

    buttons.selectObjects.addEventListener("click", function () {
        runHostAction("Selecting objects", "oselectSelectObjects", collectConfig());
    });

    restoreSettings();
    bindPersistence();
    initializePanel();
})();
