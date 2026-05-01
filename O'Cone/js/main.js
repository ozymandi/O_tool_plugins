(function () {
    var STORAGE_KEY = "ocone.panel.settings.v2";
    var ASE_LIB_KEY = "ocone.panel.aseLib.v1";

    // ---------- PRESETS (mirror of original O'Cone tables) ----------

    var PRESETS = [
        {
            id: "preset:0",
            label: "Silver (Metallic)",
            stops: [
                [0, [255, 255, 255]],
                [0.25, [180, 180, 180]],
                [0.5, [255, 255, 255]],
                [0.75, [150, 150, 150]],
                [1, [255, 255, 255]]
            ]
        },
        {
            id: "preset:1",
            label: "Gold (Metallic)",
            stops: [
                [0, [255, 240, 150]],
                [0.25, [194, 135, 50]],
                [0.5, [255, 252, 200]],
                [0.75, [194, 135, 50]],
                [1, [255, 240, 150]]
            ]
        },
        {
            id: "preset:2",
            label: "Holographic (Rainbow)",
            stops: [
                [0, [255, 0, 0]],
                [0.16, [255, 255, 0]],
                [0.33, [0, 255, 0]],
                [0.5, [0, 255, 255]],
                [0.66, [0, 0, 255]],
                [0.83, [255, 0, 255]],
                [1, [255, 0, 0]]
            ]
        },
        {
            id: "preset:3",
            label: "Radar (Green)",
            stops: [
                [0, [0, 255, 0]],
                [0.95, [0, 50, 0]],
                [1, [0, 255, 0]]
            ]
        },
        {
            id: "preset:4",
            label: "Spectrum (Full RGB)",
            stops: [
                [0, [0, 0, 0]],
                [0.5, [128, 128, 128]],
                [1, [255, 255, 255]]
            ]
        }
    ];

    var DEFAULT_STYLE_ID = "preset:0";

    // ---------- STATE ----------

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        activeDropdown: null,

        styleId: DEFAULT_STYLE_ID,
        loop: true,
        quality: 180,

        swatchGroups: [],     // [{name, count}] — refreshed on dropdown open
        aseLibrary: []        // [{id, name, colors}]
    };

    var fields = {
        style: document.getElementById("style"),
        styleLabel: document.getElementById("styleLabel"),
        quality: document.getElementById("quality"),
        qualityRange: document.getElementById("qualityRange"),
        loop: document.getElementById("loop")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        cancel: document.getElementById("cancelBtn"),
        reset: document.getElementById("resetBtn"),
        qualityReset: document.getElementById("qualityResetBtn")
    };

    var paletteSection = document.getElementById("paletteSection");
    var paletteInfoEl = document.getElementById("paletteInfo");
    var styleOptionsEl = document.getElementById("styleOptions");
    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");

    // ---------- STORAGE ----------

    function safeStorageGet(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }

    function safeStorageSet(key, value) {
        try { window.localStorage.setItem(key, value); } catch (e) {}
    }

    function getDefaultSettings() {
        return { styleId: DEFAULT_STYLE_ID, loop: true, quality: 180 };
    }

    function saveSettings() {
        safeStorageSet(STORAGE_KEY, JSON.stringify({
            styleId: state.styleId,
            loop: state.loop,
            quality: parseInt(fields.quality.value, 10) || 180
        }));
    }

    function restoreSettings() {
        var restored = getDefaultSettings();
        var raw = safeStorageGet(STORAGE_KEY);
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                if (parsed.styleId) restored.styleId = parsed.styleId;
                if (typeof parsed.loop === "boolean") restored.loop = parsed.loop;
                if (parsed.quality) restored.quality = parsed.quality;
            } catch (e) {}
        }
        state.styleId = restored.styleId;
        state.loop = restored.loop;
        state.quality = restored.quality;
        fields.loop.checked = state.loop;
        syncQuality(state.quality);
    }

    function saveAseLibrary() {
        safeStorageSet(ASE_LIB_KEY, JSON.stringify(state.aseLibrary));
    }

    function restoreAseLibrary() {
        var raw = safeStorageGet(ASE_LIB_KEY);
        if (!raw) return;
        try {
            var parsed = JSON.parse(raw);
            if (parsed && parsed instanceof Array) state.aseLibrary = parsed;
        } catch (e) {}
    }

    // ---------- STATUS / CONTROL STATES ----------

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function updatePaletteSectionVisibility() {
        var isCustom = !state.styleId.startsWith || !state.styleId.indexOf
            ? false
            : state.styleId.indexOf("preset:") !== 0;
        paletteSection.hidden = !isCustom;
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
            buttons.primary.textContent = "CONE";
            buttons.primary.disabled = busy;
        }

        buttons.cancel.disabled = busy || !state.active;
        buttons.reset.disabled = locked;

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);
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

    // ---------- STOPS / PALETTE ----------

    function findPreset(id) {
        for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
        return null;
    }

    function findAse(id) {
        for (var i = 0; i < state.aseLibrary.length; i++) if (state.aseLibrary[i].id === id) return state.aseLibrary[i];
        return null;
    }

    function findSwatchGroup(name) {
        for (var i = 0; i < state.swatchGroups.length; i++) if (state.swatchGroups[i].name === name) return state.swatchGroups[i];
        return null;
    }

    function buildStopsFromColors(colors, loop) {
        var n = colors.length;
        if (n === 0) return [[0, [128, 128, 128]], [1, [128, 128, 128]]];
        if (n === 1) return [[0, colors[0]], [1, colors[0]]];
        var stops = [];
        if (loop) {
            for (var i = 0; i <= n; i++) {
                stops.push([i / n, colors[i % n]]);
            }
        } else {
            for (var j = 0; j < n; j++) {
                stops.push([j / (n - 1), colors[j]]);
            }
        }
        return stops;
    }

    // Resolves the active style ID into:
    //   { stops: [[t, [r,g,b]], ...], label: "...", custom: bool, source: "preset"|"swatch"|"ase", count: N }
    // For "swatch:Name" — needs colors loaded async via loadActiveSwatchColors() before resolveActiveStops.
    var swatchColorsCache = {}; // name -> colors array

    function resolveActiveStops() {
        var id = state.styleId;
        if (id.indexOf("preset:") === 0) {
            var preset = findPreset(id);
            if (!preset) preset = PRESETS[0];
            return { stops: preset.stops, label: preset.label, custom: false };
        }
        if (id.indexOf("ase:") === 0) {
            var ase = findAse(id.substring(4));
            if (!ase) {
                state.styleId = DEFAULT_STYLE_ID;
                return resolveActiveStops();
            }
            return {
                stops: buildStopsFromColors(ase.colors, state.loop),
                label: ase.name,
                custom: true,
                source: "ase",
                count: ase.colors.length
            };
        }
        if (id.indexOf("swatch:") === 0) {
            var name = id.substring(7);
            var colors = swatchColorsCache[name];
            if (!colors) {
                // No cached colours — fall back to default until they're loaded
                return null;
            }
            return {
                stops: buildStopsFromColors(colors, state.loop),
                label: "Group: " + name,
                custom: true,
                source: "swatch",
                count: colors.length
            };
        }
        state.styleId = DEFAULT_STYLE_ID;
        return resolveActiveStops();
    }

    async function ensureActiveStopsAvailable() {
        var id = state.styleId;
        if (id.indexOf("swatch:") === 0) {
            var name = id.substring(7);
            if (!swatchColorsCache[name]) {
                try {
                    var resp = await callHost("oconeReadSwatchGroup", { name: name });
                    if (resp.ok && resp.colors && resp.colors.length > 0) {
                        swatchColorsCache[name] = resp.colors;
                    } else {
                        // Group missing — fall back
                        state.styleId = DEFAULT_STYLE_ID;
                        saveSettings();
                        setStatus("error", "Swatch group not found in document — fell back to preset.");
                    }
                } catch (e) {
                    state.styleId = DEFAULT_STYLE_ID;
                    saveSettings();
                }
            }
        }
    }

    function getStyleLabelFromId(id) {
        if (id.indexOf("preset:") === 0) {
            var p = findPreset(id);
            return p ? p.label : "—";
        }
        if (id.indexOf("ase:") === 0) {
            var ase = findAse(id.substring(4));
            return ase ? ase.name : "—";
        }
        if (id.indexOf("swatch:") === 0) {
            return "Group: " + id.substring(7);
        }
        return "—";
    }

    function refreshStyleLabel() {
        fields.styleLabel.textContent = getStyleLabelFromId(state.styleId);
    }

    function refreshPaletteInfo() {
        if (state.styleId.indexOf("preset:") === 0) {
            paletteInfoEl.textContent = "—";
            return;
        }
        if (state.styleId.indexOf("ase:") === 0) {
            var ase = findAse(state.styleId.substring(4));
            if (ase) {
                paletteInfoEl.textContent = "Source: ASE • " + ase.name + " • " + ase.colors.length + " colours";
            } else {
                paletteInfoEl.textContent = "—";
            }
            return;
        }
        if (state.styleId.indexOf("swatch:") === 0) {
            var name = state.styleId.substring(7);
            var colors = swatchColorsCache[name];
            paletteInfoEl.textContent = "Source: Swatch group • " + name +
                (colors ? " • " + colors.length + " colours" : "");
            return;
        }
    }

    // ---------- DROPDOWN RENDER ----------

    function renderDropdown() {
        styleOptionsEl.innerHTML = "";

        var sectPresets = document.createElement("div");
        sectPresets.className = "custom-section-label";
        sectPresets.textContent = "Presets";
        styleOptionsEl.appendChild(sectPresets);

        for (var i = 0; i < PRESETS.length; i++) renderOption(PRESETS[i].id, PRESETS[i].label, false);

        styleOptionsEl.appendChild(makeDivider());

        var sectGroups = document.createElement("div");
        sectGroups.className = "custom-section-label";
        sectGroups.textContent = "Document swatch groups";
        styleOptionsEl.appendChild(sectGroups);

        if (state.swatchGroups.length === 0) {
            var emptyG = document.createElement("div");
            emptyG.className = "custom-empty";
            emptyG.textContent = "No named swatch groups in this document.";
            styleOptionsEl.appendChild(emptyG);
        } else {
            for (var g = 0; g < state.swatchGroups.length; g++) {
                var grp = state.swatchGroups[g];
                renderOption("swatch:" + grp.name, grp.name + " (" + grp.count + ")", false);
            }
        }

        styleOptionsEl.appendChild(makeDivider());

        var sectAse = document.createElement("div");
        sectAse.className = "custom-section-label";
        sectAse.textContent = "Loaded ASE";
        styleOptionsEl.appendChild(sectAse);

        if (state.aseLibrary.length === 0) {
            var emptyA = document.createElement("div");
            emptyA.className = "custom-empty";
            emptyA.textContent = "No ASE files loaded yet.";
            styleOptionsEl.appendChild(emptyA);
        } else {
            for (var k = 0; k < state.aseLibrary.length; k++) {
                var ase = state.aseLibrary[k];
                renderOption("ase:" + ase.id, ase.name + " (" + ase.colors.length + ")", true, ase.id);
            }
        }

        styleOptionsEl.appendChild(makeDivider());

        var loadBtn = document.createElement("div");
        loadBtn.className = "custom-action";
        loadBtn.setAttribute("data-action", "load-ase");
        loadBtn.textContent = "+ Load .ase file…";
        loadBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            handleLoadAse();
        });
        styleOptionsEl.appendChild(loadBtn);

        markActiveOption();
    }

    function makeDivider() {
        var d = document.createElement("div");
        d.className = "custom-divider";
        return d;
    }

    function renderOption(id, label, withRemove, removeId) {
        var row = document.createElement("div");
        row.className = "custom-option";
        row.setAttribute("data-value", id);
        row.setAttribute("role", "option");

        var lbl = document.createElement("span");
        lbl.className = "custom-option-label";
        lbl.textContent = label;
        row.appendChild(lbl);

        if (withRemove) {
            var x = document.createElement("button");
            x.type = "button";
            x.className = "custom-option-x";
            x.title = "Remove this palette";
            x.textContent = "✕";
            x.addEventListener("click", function (e) {
                e.stopPropagation();
                handleRemoveAse(removeId);
            });
            row.appendChild(x);
        }

        row.addEventListener("click", function () {
            handlePickStyle(id);
        });

        styleOptionsEl.appendChild(row);
    }

    function markActiveOption() {
        Array.prototype.forEach.call(styleOptionsEl.querySelectorAll(".custom-option"), function (option) {
            var active = option.getAttribute("data-value") === state.styleId;
            option.classList.toggle("is-selected", active);
            option.setAttribute("aria-selected", active ? "true" : "false");
        });
    }

    // ---------- DROPDOWN BEHAVIOUR ----------

    async function refreshSwatchGroups() {
        try {
            var resp = await callHost("oconeListSwatchGroups");
            if (resp.ok && resp.groups instanceof Array) {
                state.swatchGroups = resp.groups;
            } else {
                state.swatchGroups = [];
            }
        } catch (e) {
            state.swatchGroups = [];
        }
    }

    async function openDropdown(wrapper) {
        if (!wrapper) return;
        closeDropdown();
        // Refresh swatch groups on each open so list mirrors the document live
        await refreshSwatchGroups();
        renderDropdown();
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

    // ---------- PICK / LOAD / REMOVE ----------

    async function handlePickStyle(id) {
        state.styleId = id;
        fields.style.value = id;
        saveSettings();
        refreshStyleLabel();
        updatePaletteSectionVisibility();
        await ensureActiveStopsAvailable();
        refreshPaletteInfo();
        markActiveOption();
        closeDropdown();
        if (state.active) schedulePreviewUpdate();
    }

    async function handleLoadAse() {
        if (state.busy) return;
        var fs = window.cep && window.cep.fs;
        if (!fs || typeof fs.showOpenDialogEx !== "function") {
            setStatus("error", "File picker not available in this CEP build.");
            return;
        }
        var picker = fs.showOpenDialogEx(false, false, "Select an .ase file", "", ["ase"]);
        if (!picker || picker.err !== 0) {
            // user cancelled or error
            return;
        }
        var data = picker.data;
        if (!data || data.length === 0) return;
        var path = data[0];

        setBusy(true);
        setStatus("info", "Reading ASE file...");
        try {
            var resp = await callHost("oconeReadAseFile", { path: path });
            if (!resp.ok) throw new Error(resp.message || "Failed to read ASE.");
            if (!resp.colors || resp.colors.length === 0) throw new Error("ASE contains no colours.");
            var newId = "ase_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
            var entry = {
                id: newId,
                name: resp.name || "ase",
                colors: resp.colors
            };
            state.aseLibrary.push(entry);
            saveAseLibrary();
            // Switch to the new palette
            state.styleId = "ase:" + newId;
            saveSettings();
            refreshStyleLabel();
            updatePaletteSectionVisibility();
            refreshPaletteInfo();
            renderDropdown();
            setStatus("success", "ASE loaded: " + entry.colors.length + " colour(s).");
            if (state.active) schedulePreviewUpdate();
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    function handleRemoveAse(id) {
        var idx = -1;
        for (var i = 0; i < state.aseLibrary.length; i++) {
            if (state.aseLibrary[i].id === id) { idx = i; break; }
        }
        if (idx < 0) return;
        state.aseLibrary.splice(idx, 1);
        saveAseLibrary();
        if (state.styleId === "ase:" + id) {
            state.styleId = DEFAULT_STYLE_ID;
            saveSettings();
            refreshStyleLabel();
            updatePaletteSectionVisibility();
            if (state.active) schedulePreviewUpdate();
        }
        renderDropdown();
        setStatus("info", "Palette removed.");
    }

    // ---------- QUALITY HELPERS ----------

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

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

    function syncQuality(value) {
        var num = Number(value);
        if (!Number.isFinite(num)) num = 180;
        var nMin = Number(fields.quality.min);
        var nMax = Number(fields.quality.max);
        if (Number.isFinite(nMin) && num < nMin) num = nMin;
        if (Number.isFinite(nMax) && num > nMax) num = nMax;
        num = Math.round(num);
        fields.quality.value = String(num);
        var rMin = Number(fields.qualityRange.min);
        var rMax = Number(fields.qualityRange.max);
        var clamped = clamp(num, rMin, rMax);
        fields.qualityRange.value = String(clamped);
        updateSliderFill(fields.qualityRange);
        state.quality = num;
    }

    // ---------- SESSION ----------

    function buildHostConfig() {
        var resolved = resolveActiveStops();
        if (!resolved) {
            // Should not normally happen — fallback
            resolved = { stops: PRESETS[0].stops };
        }
        return {
            quality: state.quality,
            stops: resolved.stops
        };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = buildHostConfig();
        state.previewPending = callHost("oconeUpdate", cfg)
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

    async function startCone() {
        if (state.busy || state.active) return;
        await ensureActiveStopsAvailable();
        var cfg = buildHostConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Building cones...");
        try {
            var response = await callHost("oconeStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            setStatus("success", response.message || "Cone preview ready.");
            actionHintEl.textContent = "Adjust Style and Quality. APPLY commits, CANCEL reverts.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function applyCone() {
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
            var response = await callHost("oconeApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Select one or more shapes on the artboard, then press CONE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function cancelCone() {
        if (state.busy || !state.active) return;
        state.previewQueued = false;
        if (state.previewPending) {
            try { await state.previewPending; } catch (e) {}
        }
        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("oconeCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Select one or more shapes on the artboard, then press CONE.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("oconeHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("oconeCancel"); } catch (e) {}
            }
            state.active = false;
            await ensureActiveStopsAvailable();
            refreshStyleLabel();
            updatePaletteSectionVisibility();
            refreshPaletteInfo();
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

    function bindStyleDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="style"]');
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
            } else if (event.key === "Escape") closeDropdown();
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    function bindQualityControls() {
        fields.qualityRange.addEventListener("input", function () {
            if (fields.qualityRange.disabled) return;
            syncQuality(fields.qualityRange.value);
            saveSettings();
            schedulePreviewUpdate();
        });
        fields.quality.addEventListener("input", function () {
            if (fields.quality.disabled) return;
            syncQuality(fields.quality.value);
            saveSettings();
            schedulePreviewUpdate();
        });
        buttons.qualityReset.addEventListener("click", function () {
            if (buttons.qualityReset.disabled) return;
            syncQuality(180);
            saveSettings();
            schedulePreviewUpdate();
        });
    }

    function bindLoopCheckbox() {
        fields.loop.addEventListener("change", function () {
            if (fields.loop.disabled) return;
            state.loop = !!fields.loop.checked;
            saveSettings();
            refreshPaletteInfo();
            schedulePreviewUpdate();
        });
    }

    // ---------- WIRE UP ----------

    restoreAseLibrary();
    restoreSettings();

    bindStyleDropdown();
    bindQualityControls();
    bindLoopCheckbox();

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyCone();
        else startCone();
    });

    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        cancelCone();
    });

    buttons.reset.addEventListener("click", function () {
        if (buttons.reset.disabled) return;
        var d = getDefaultSettings();
        state.styleId = d.styleId;
        state.loop = d.loop;
        state.quality = d.quality;
        fields.loop.checked = d.loop;
        syncQuality(d.quality);
        saveSettings();
        refreshStyleLabel();
        updatePaletteSectionVisibility();
        refreshPaletteInfo();
        setStatus("info", "Parameters reset to defaults.");
        if (state.active) schedulePreviewUpdate();
    });

    bindNumberWheel();
    bindNumericScrubbers();
    refreshStyleLabel();
    updatePaletteSectionVisibility();
    refreshPaletteInfo();
    refreshControlStates();
    initializePanel();
})();
