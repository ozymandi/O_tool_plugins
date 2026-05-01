(function () {
    var STORAGE_KEY = "oline.panel.settings.v1";

    var TOPOLOGIES = [
        { category: "Graph" },
        { id: "all-to-all", label: "All to All" },
        { id: "chain", label: "Chain (Sequence)" },
        { id: "loop", label: "Loop (Closed Chain)" },
        { id: "step-skip", label: "Step-Skip" },
        { id: "modular-skip", label: "Modular Skip" },
        { id: "random", label: "Random Connections" },
        { id: "threshold-distance", label: "Threshold Distance" },
        { category: "Radial" },
        { id: "radial", label: "Radial (Center)" },
        { id: "star-from-pivot", label: "Star from Pivot" },
        { category: "Proximity" },
        { id: "nearest", label: "Nearest Neighbors" },
        { id: "knn-mutual", label: "K-Nearest Mutual" },
        { category: "Geometric" },
        { id: "convex-hull", label: "Convex Hull" },
        { id: "mst", label: "Minimum Spanning Tree" },
        { id: "delaunay", label: "Delaunay Triangulation" }
    ];

    var TOPOLOGY_LABELS = {};
    (function () {
        for (var i = 0; i < TOPOLOGIES.length; i++) {
            if (TOPOLOGIES[i].id) TOPOLOGY_LABELS[TOPOLOGIES[i].id] = TOPOLOGIES[i].label;
        }
    })();

    var DEFAULTS = {
        topology: "nearest",
        bezier: false,
        tension: 30,
        strokeWidth: 0.5,
        take: 2,
        skip: 0,
        distance: 100
    };

    var SLIDER_PAIRS = [
        ["tension", "tensionRange"],
        ["take", "takeRange"],
        ["skip", "skipRange"],
        ["distance", "distanceRange"]
    ];

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        activeDropdown: null,
        topology: DEFAULTS.topology
    };

    var fields = {
        topology: document.getElementById("topology"),
        topologyLabel: document.getElementById("topologyLabel"),
        bezier: document.getElementById("bezier"),
        tension: document.getElementById("tension"),
        tensionRange: document.getElementById("tensionRange"),
        strokeWidth: document.getElementById("strokeWidth"),
        take: document.getElementById("take"),
        takeRange: document.getElementById("takeRange"),
        skip: document.getElementById("skip"),
        skipRange: document.getElementById("skipRange"),
        distance: document.getElementById("distance"),
        distanceRange: document.getElementById("distanceRange")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        cancel: document.getElementById("cancelBtn"),
        bake: document.getElementById("bakeBtn"),
        reset: document.getElementById("resetBtn"),
        newSeed: document.getElementById("newSeedBtn"),
        tensionReset: document.getElementById("tensionResetBtn"),
        takeReset: document.getElementById("takeResetBtn"),
        skipReset: document.getElementById("skipResetBtn"),
        distanceReset: document.getElementById("distanceResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");
    var topologyOptionsEl = document.getElementById("topologyOptions");
    var logicSection = document.getElementById("logicSection");
    var seedSection = document.getElementById("seedSection");

    function safeStorageGet() {
        try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function safeStorageSet(value) {
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    // ---------- VISIBILITY / CONTROL STATE ----------

    function updateLogicVisibility() {
        var topology = state.topology;
        var anyVisible = false;
        Array.prototype.forEach.call(document.querySelectorAll('#logicSection .field[data-needed-for]'), function (f) {
            var needed = f.getAttribute("data-needed-for").split(/\s+/);
            var show = needed.indexOf(topology) !== -1;
            f.hidden = !show;
            if (show) anyVisible = true;
        });
        logicSection.hidden = !anyVisible;
        seedSection.hidden = topology !== "random";
    }

    function updateTensionEnabled() {
        var enabled = !!fields.bezier.checked;
        fields.tension.disabled = !enabled || !state.active || state.busy;
        fields.tensionRange.disabled = !enabled || !state.active || state.busy;
        buttons.tensionReset.disabled = !enabled || !state.active || state.busy;
    }

    function refreshControlStates() {
        var idle = !state.active;
        var busy = state.busy;
        var locked = idle || busy;

        var lockableInputs = document.querySelectorAll('.panel[data-lockable] input, .panel[data-lockable] button, .panel[data-lockable] .custom-select');
        Array.prototype.forEach.call(lockableInputs, function (el) {
            if (el.tagName === "DIV") {
                el.style.pointerEvents = locked ? "none" : "";
                el.tabIndex = locked ? -1 : 0;
            } else {
                el.disabled = locked;
            }
        });

        if (state.active) {
            buttons.primary.textContent = "APPLY";
            buttons.primary.disabled = busy;
        } else {
            buttons.primary.textContent = "LINE";
            buttons.primary.disabled = busy;
        }

        buttons.cancel.disabled = busy || !state.active;
        buttons.bake.disabled = busy || !state.active;
        buttons.reset.disabled = locked;

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);

        // After global lock pass, enforce Tension's bezier-dependent state
        updateTensionEnabled();
    }

    function setBusy(isBusy) {
        state.busy = isBusy;
        refreshControlStates();
    }

    // ---------- HOST BRIDGE ----------

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

    function callHost(hostFunction, payload) {
        var script;
        if (payload !== undefined && payload !== null) {
            var encoded = escapeForEval(JSON.stringify(payload));
            script = hostFunction + "('" + encoded + "')";
        } else {
            script = hostFunction + "()";
        }
        return evalHost(script).then(parseHostResponse);
    }

    // ---------- SLIDER UTILITIES ----------

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function updateSliderFill(input) {
        if (!input) return;
        var min = Number(input.min);
        var max = Number(input.max);
        var value = Number(input.value);
        if (!Number.isFinite(min)) min = 0;
        if (!Number.isFinite(max) || max === min) max = 100;
        if (!Number.isFinite(value)) value = 0;
        if (min < 0) {
            var zeroRatio = clamp((0 - min) / (max - min), 0, 1);
            var valueRatio = clamp((value - min) / (max - min), 0, 1);
            var fillStart = Math.min(zeroRatio, valueRatio) * 100;
            var fillEnd = Math.max(zeroRatio, valueRatio) * 100;
            input.style.setProperty("--fill-start", fillStart + "%");
            input.style.setProperty("--fill-end", fillEnd + "%");
        } else {
            var ratio = clamp((value - min) / (max - min), 0, 1) * 100;
            input.style.setProperty("--fill-start", "0%");
            input.style.setProperty("--fill-end", ratio + "%");
        }
    }

    function syncPair(numKey, rangeKey, value) {
        var num = Number(value);
        if (!Number.isFinite(num)) num = 0;
        var numField = fields[numKey];
        var rangeField = fields[rangeKey];
        var numMin = Number(numField.min);
        var numMax = Number(numField.max);
        if (Number.isFinite(numMin) && num < numMin) num = numMin;
        if (Number.isFinite(numMax) && num > numMax) num = numMax;
        var step = numField.getAttribute("step");
        if (step === "1") num = Math.round(num);
        numField.value = String(num);
        if (rangeField) {
            var rangeMin = Number(rangeField.min);
            var rangeMax = Number(rangeField.max);
            var clamped = clamp(num, rangeMin, rangeMax);
            rangeField.value = String(clamped);
            updateSliderFill(rangeField);
        }
    }

    // ---------- STORAGE ----------

    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    function getSnapshot() {
        return {
            topology: state.topology,
            bezier: !!fields.bezier.checked,
            tension: fields.tension.value,
            strokeWidth: fields.strokeWidth.value,
            take: fields.take.value,
            skip: fields.skip.value,
            distance: fields.distance.value
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        state.topology = String(snapshot.topology || DEFAULTS.topology);
        fields.topology.value = state.topology;
        fields.bezier.checked = !!snapshot.bezier;
        fields.strokeWidth.value = String(snapshot.strokeWidth);
        SLIDER_PAIRS.forEach(function (pair) {
            syncPair(pair[0], pair[1], snapshot[pair[0]]);
        });
        refreshTopologyLabel();
        markActiveOption();
        updateLogicVisibility();
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
            } catch (e) {}
        }
        applySnapshot(restored);
    }

    // ---------- TOPOLOGY DROPDOWN ----------

    function refreshTopologyLabel() {
        fields.topologyLabel.textContent = TOPOLOGY_LABELS[state.topology] || "—";
    }

    function renderDropdown() {
        topologyOptionsEl.innerHTML = "";
        for (var i = 0; i < TOPOLOGIES.length; i++) {
            var entry = TOPOLOGIES[i];
            if (entry.category) {
                var label = document.createElement("div");
                label.className = "custom-section-label";
                label.textContent = entry.category;
                topologyOptionsEl.appendChild(label);
                continue;
            }
            var row = document.createElement("div");
            row.className = "custom-option";
            row.setAttribute("data-value", entry.id);
            row.textContent = entry.label;
            (function (id) {
                row.addEventListener("click", function () { handlePickTopology(id); });
            })(entry.id);
            topologyOptionsEl.appendChild(row);
        }
        markActiveOption();
    }

    function markActiveOption() {
        Array.prototype.forEach.call(topologyOptionsEl.querySelectorAll(".custom-option"), function (option) {
            var active = option.getAttribute("data-value") === state.topology;
            option.classList.toggle("is-selected", active);
            option.setAttribute("aria-selected", active ? "true" : "false");
        });
    }

    function openDropdown(wrapper) {
        if (!wrapper) return;
        closeDropdown();
        wrapper.classList.add("open");
        var toggle = wrapper.querySelector(".ui-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "true");
        state.activeDropdown = wrapper;
    }

    function closeDropdown() {
        if (!state.activeDropdown) return;
        state.activeDropdown.classList.remove("open");
        var toggle = state.activeDropdown.querySelector(".ui-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
        state.activeDropdown = null;
    }

    function handlePickTopology(id) {
        state.topology = id;
        fields.topology.value = id;
        saveSettings();
        refreshTopologyLabel();
        updateLogicVisibility();
        markActiveOption();
        closeDropdown();
        if (state.active) schedulePreviewUpdate();
    }

    // ---------- COLLECT CONFIG / PREVIEW ----------

    function collectConfig() {
        var topology = String(state.topology || "nearest");
        var bezier = !!fields.bezier.checked;
        var tension = parseFloat(fields.tension.value);
        if (!Number.isFinite(tension)) tension = DEFAULTS.tension;
        var strokeWidth = parseFloat(fields.strokeWidth.value);
        if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) strokeWidth = DEFAULTS.strokeWidth;
        var take = parseInt(fields.take.value, 10);
        if (!Number.isFinite(take) || take < 1) take = 1;
        var skip = parseInt(fields.skip.value, 10);
        if (!Number.isFinite(skip) || skip < 0) skip = 0;
        var distance = parseFloat(fields.distance.value);
        if (!Number.isFinite(distance) || distance < 0) distance = 0;
        return {
            topology: topology,
            bezier: bezier,
            tension: tension,
            strokeWidth: strokeWidth,
            take: take,
            skip: skip,
            distance: distance
        };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = collectConfig();
        state.previewPending = callHost("olineUpdate", cfg)
            .then(function (response) {
                if (!response.ok) {
                    setStatus("error", response.message || "Update failed.");
                    if (response.message && response.message.indexOf("No active") !== -1) {
                        state.active = false;
                        refreshControlStates();
                    }
                }
                return response;
            })
            .catch(function (error) { setStatus("error", error.message); })
            .finally(function () {
                state.previewPending = null;
                if (state.previewQueued && state.active) {
                    state.previewQueued = false;
                    sendPreviewUpdate();
                }
            });
        return state.previewPending;
    }

    function schedulePreviewUpdate() {
        if (!state.active) return;
        sendPreviewUpdate();
    }

    // ---------- ACTIONS ----------

    async function startLine() {
        if (state.busy || state.active) return;
        var cfg = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Building lines...");
        try {
            var response = await callHost("olineStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Preview ready.");
            actionHintEl.textContent = "Adjust topology and parameters. APPLY commits, BAKE TO SYMBOL stores variant, CANCEL reverts.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function applyLine() {
        if (state.busy || !state.active) return;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        if (state.previewQueued && state.active) {
            state.previewQueued = false;
            await sendPreviewUpdate();
            if (state.previewPending) {
                try { await state.previewPending; } catch (e) {}
            }
        }
        setBusy(true);
        setStatus("info", "Applying...");
        try {
            var response = await callHost("olineApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Select 2+ anchor points or single-point paths, then press LINE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function cancelLine() {
        if (state.busy || !state.active) return;
        state.previewQueued = false;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("olineCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Select 2+ anchor points or single-point paths, then press LINE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function bakeLine() {
        if (state.busy || !state.active) return;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        var cfg = collectConfig();
        setBusy(true);
        setStatus("info", "Baking...");
        try {
            var response = await callHost("olineBake", cfg);
            if (!response.ok) throw new Error(response.message || "Bake failed.");
            setStatus("success", response.message || "Baked.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function newSeed() {
        if (state.busy || !state.active) return;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        var cfg = collectConfig();
        setBusy(true);
        setStatus("info", "Re-rolling seed...");
        try {
            var response = await callHost("olineNewSeed", cfg);
            if (!response.ok) throw new Error(response.message || "Re-roll failed.");
            setStatus("success", response.message || "Re-rolled.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("olineHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("olineCancel"); } catch (e) {}
            }
            state.active = false;
            refreshControlStates();
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    // ---------- BOILERPLATE: scrub + wheel ----------

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
            if (shell && shell.classList && shell.classList.contains("slider-capsule")) return;
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

    // ---------- BIND ----------

    function onParameterChanged() {
        saveSettings();
        if (state.active) schedulePreviewUpdate();
    }

    function bindSliderPair(numKey, rangeKey) {
        var numField = fields[numKey];
        var rangeField = fields[rangeKey];
        if (rangeField) {
            rangeField.addEventListener("input", function () {
                if (rangeField.disabled) return;
                syncPair(numKey, rangeKey, rangeField.value);
                onParameterChanged();
            });
        }
        if (numField) {
            numField.addEventListener("input", function () {
                if (numField.disabled) return;
                syncPair(numKey, rangeKey, numField.value);
                onParameterChanged();
            });
        }
    }

    function bindStrokeWidth() {
        fields.strokeWidth.addEventListener("input", function () {
            if (fields.strokeWidth.disabled) return;
            saveSettings();
            if (state.active) schedulePreviewUpdate();
        });
    }

    function bindBezierCheckbox() {
        fields.bezier.addEventListener("change", function () {
            if (fields.bezier.disabled) return;
            saveSettings();
            updateTensionEnabled();
            if (state.active) schedulePreviewUpdate();
        });
    }

    function bindTopologyDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="topology"]');
        var toggle = wrapper ? wrapper.querySelector(".ui-dropdown-toggle") : null;
        if (!wrapper || !toggle) return;

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (toggle.style.pointerEvents === "none") return;
            if (state.activeDropdown === wrapper) closeDropdown();
            else openDropdown(wrapper);
        });

        toggle.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (state.activeDropdown === wrapper) closeDropdown();
                else openDropdown(wrapper);
            } else if (event.key === "Escape") {
                closeDropdown();
            }
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindStrokeWidth();
    bindBezierCheckbox();
    bindTopologyDropdown();

    buttons.tensionReset.addEventListener("click", function () {
        if (buttons.tensionReset.disabled) return;
        syncPair("tension", "tensionRange", DEFAULTS.tension);
        onParameterChanged();
    });
    buttons.takeReset.addEventListener("click", function () {
        if (buttons.takeReset.disabled) return;
        syncPair("take", "takeRange", DEFAULTS.take);
        onParameterChanged();
    });
    buttons.skipReset.addEventListener("click", function () {
        if (buttons.skipReset.disabled) return;
        syncPair("skip", "skipRange", DEFAULTS.skip);
        onParameterChanged();
    });
    buttons.distanceReset.addEventListener("click", function () {
        if (buttons.distanceReset.disabled) return;
        syncPair("distance", "distanceRange", DEFAULTS.distance);
        onParameterChanged();
    });

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyLine();
        else startLine();
    });
    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        cancelLine();
    });
    buttons.bake.addEventListener("click", function () {
        if (buttons.bake.disabled) return;
        bakeLine();
    });
    buttons.newSeed.addEventListener("click", function () {
        if (buttons.newSeed.disabled) return;
        newSeed();
    });

    buttons.reset.addEventListener("click", function () {
        if (buttons.reset.disabled) return;
        applySnapshot(getDefaultConfig());
        saveSettings();
        setStatus("info", "Parameters reset to defaults.");
        if (state.active) schedulePreviewUpdate();
    });

    renderDropdown();
    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
