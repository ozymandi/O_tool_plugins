(function () {
    var STORAGE_KEY = "oalign.panel.settings.v1";
    var state = { busy: false };

    var fields = {
        direction: document.getElementById("direction"),
        pivot: document.getElementById("pivot")
    };

    var buttons = {
        align: document.getElementById("alignBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

    function getDefaultConfig() {
        return { direction: "auto", pivot: "center" };
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

    function updateSegRow(name, value) {
        Array.prototype.forEach.call(document.querySelectorAll('.seg[data-' + name + ']'), function (button) {
            var active = button.getAttribute("data-" + name) === value;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function getSnapshot() {
        return {
            direction: fields.direction.value,
            pivot: fields.pivot.value
        };
    }

    function saveSettings() {
        safeStorageSet(JSON.stringify(getSnapshot()));
    }

    function applySnapshot(snapshot) {
        fields.direction.value = String(snapshot.direction || "auto");
        fields.pivot.value = String(snapshot.pivot || "center");
        updateSegRow("direction", fields.direction.value);
        updateSegRow("pivot", fields.pivot.value);
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
            direction: String(fields.direction.value || "auto"),
            pivot: String(fields.pivot.value || "center")
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
            var handshake = parseHostResponse(await evalHost("oalignHandshake()"));
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    function bindSegRow(name, fieldKey) {
        Array.prototype.forEach.call(document.querySelectorAll('.seg[data-' + name + ']'), function (button) {
            button.addEventListener("click", function () {
                fields[fieldKey].value = button.getAttribute("data-" + name);
                updateSegRow(name, fields[fieldKey].value);
                saveSettings();
            });
        });
    }

    buttons.align.addEventListener("click", function () {
        runHostAction("Aligning", "oalignRun", collectConfig());
    });

    restoreSettings();
    bindSegRow("direction", "direction");
    bindSegRow("pivot", "pivot");
    initializePanel();
})();
