(function () {
    var state = { busy: false };

    var buttons = {
        left: document.getElementById("leftBtn"),
        center: document.getElementById("centerBtn"),
        right: document.getElementById("rightBtn")
    };
    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");

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

    var ALIGN_LABELS = { L: "Left", C: "Center", R: "Right" };

    async function runAlign(alignKey) {
        if (state.busy) return;
        setBusy(true);
        setStatus("info", "Aligning " + (ALIGN_LABELS[alignKey] || alignKey).toLowerCase() + "...");
        try {
            var payload = escapeForEval(JSON.stringify({ align: alignKey }));
            var response = parseHostResponse(await evalHost("otextAlign('" + payload + "')"));
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
            var handshake = parseHostResponse(await evalHost("otextHandshake()"));
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    Object.keys(buttons).forEach(function (key) {
        var btn = buttons[key];
        btn.addEventListener("click", function () {
            if (btn.disabled) return;
            runAlign(btn.getAttribute("data-align") || "C");
        });
    });

    initializePanel();
})();
