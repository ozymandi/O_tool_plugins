(function () {
    var STORAGE_KEY = "olinearray.panel.settings.v1";

    var DEFAULTS = {
        touch: true,
        fit: true,
        scaleMode: "stretch",
        gap: 0,
        step: 50,
        offset: 0,
        rndOffset: 0,
        anchor: "center",
        rotate: true
    };

    var ANCHOR_LABELS = { top: "Top", center: "Center", bottom: "Bottom" };

    var SLIDER_PAIRS = [
        ["gap", "gapRange"],
        ["step", "stepRange"],
        ["offset", "offsetRange"],
        ["rndOffset", "rndOffsetRange"]
    ];

    var state = {
        active: false,
        busy: false,
        previewPending: null,
        previewQueued: false,
        activeDropdown: null,
        anchor: DEFAULTS.anchor,
        scaleMode: DEFAULTS.scaleMode,
        stack: [],          // [{ symbolName: string|null }, ...] mirror of host
        docSymbols: []      // [name, ...]
    };

    var fields = {
        touch: document.getElementById("touch"),
        fit: document.getElementById("fit"),
        fitLabel: document.getElementById("fitLabel"),
        scaleMode: document.getElementById("scaleMode"),
        gap: document.getElementById("gap"),
        gapRange: document.getElementById("gapRange"),
        step: document.getElementById("step"),
        stepRange: document.getElementById("stepRange"),
        offset: document.getElementById("offset"),
        offsetRange: document.getElementById("offsetRange"),
        rndOffset: document.getElementById("rndOffset"),
        rndOffsetRange: document.getElementById("rndOffsetRange"),
        anchor: document.getElementById("anchor"),
        anchorLabel: document.getElementById("anchorLabel"),
        rotate: document.getElementById("rotate")
    };

    var sections = {
        scaleModeField: document.getElementById("scaleModeField"),
        gapField: document.getElementById("gapField"),
        stepField: document.getElementById("stepField")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        cancel: document.getElementById("cancelBtn"),
        bake: document.getElementById("bakeBtn"),
        reset: document.getElementById("resetBtn"),
        gapReset: document.getElementById("gapResetBtn"),
        stepReset: document.getElementById("stepResetBtn"),
        offsetReset: document.getElementById("offsetResetBtn"),
        rndOffsetReset: document.getElementById("rndOffsetResetBtn")
    };

    var qtyButtons = Array.prototype.slice.call(document.querySelectorAll(".qty-btn"));
    var stackListEl = document.getElementById("stackList");
    var addSlotBtn = document.getElementById("addSlotBtn");
    var replacePathBtn = document.getElementById("replacePathBtn");

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");

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

    function updateDistributionVisibility() {
        var touch = !!fields.touch.checked;
        sections.scaleModeField.hidden = !touch;
        sections.gapField.hidden = !touch;
        sections.stepField.hidden = touch;
        fields.fitLabel.textContent = touch ? "Scale to fit path" : "Justify step (fit to end)";
    }

    function refreshControlStates() {
        var idle = !state.active;
        var busy = state.busy;
        var locked = idle || busy;

        var lockableInputs = document.querySelectorAll('.panel[data-lockable] input, .panel[data-lockable] select, .panel[data-lockable] button, .panel[data-lockable] .custom-select');
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
            buttons.primary.textContent = "LINEARRAY";
            buttons.primary.disabled = busy;
        }

        buttons.cancel.disabled = busy || !state.active;
        buttons.bake.disabled = busy || !state.active;
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
        catch (error) { return { ok: false, message: "Could not parse Illustrator response: " + result }; }
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

    // ---------- SLIDERS ----------

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
            touch: !!fields.touch.checked,
            fit: !!fields.fit.checked,
            scaleMode: state.scaleMode,
            gap: fields.gap.value,
            step: fields.step.value,
            offset: fields.offset.value,
            rndOffset: fields.rndOffset.value,
            anchor: state.anchor,
            rotate: !!fields.rotate.checked
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        fields.touch.checked = !!snapshot.touch;
        fields.fit.checked = !!snapshot.fit;
        state.scaleMode = String(snapshot.scaleMode || DEFAULTS.scaleMode);
        fields.scaleMode.value = state.scaleMode;
        state.anchor = String(snapshot.anchor || DEFAULTS.anchor);
        fields.anchor.value = state.anchor;
        fields.rotate.checked = !!snapshot.rotate;
        SLIDER_PAIRS.forEach(function (pair) {
            syncPair(pair[0], pair[1], snapshot[pair[0]]);
        });
        updateDistributionVisibility();
        refreshAnchorLabel();
        markActiveAnchor();
        refreshScaleModeButtons();
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

    // ---------- ANCHOR DROPDOWN ----------

    function refreshAnchorLabel() {
        fields.anchorLabel.textContent = ANCHOR_LABELS[state.anchor] || "—";
    }
    function markActiveAnchor() {
        Array.prototype.forEach.call(document.querySelectorAll('#anchorOptions .custom-option'), function (option) {
            var active = option.getAttribute("data-value") === state.anchor;
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
    function handlePickAnchor(id) {
        state.anchor = id;
        fields.anchor.value = id;
        saveSettings();
        refreshAnchorLabel();
        markActiveAnchor();
        closeDropdown();
        if (state.active) schedulePreviewUpdate();
    }

    // ---------- SCALE MODE SEGMENTED ----------

    function refreshScaleModeButtons() {
        var current = state.scaleMode;
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-scale]'), function (btn) {
            btn.classList.toggle("is-active", btn.getAttribute("data-scale") === current);
        });
    }

    // ---------- COLLECT CONFIG / PREVIEW ----------

    function collectConfig() {
        return {
            touch: !!fields.touch.checked,
            fit: !!fields.fit.checked,
            scaleMode: state.scaleMode,
            gap: parseFloat(fields.gap.value) || 0,
            step: parseFloat(fields.step.value) || 50,
            offset: parseFloat(fields.offset.value) || 0,
            rndOffset: parseFloat(fields.rndOffset.value) || 0,
            anchor: state.anchor,
            rotate: !!fields.rotate.checked
        };
    }

    function sendPreviewUpdate() {
        if (!state.active) return Promise.resolve(null);
        if (state.previewPending) {
            state.previewQueued = true;
            return state.previewPending;
        }
        var cfg = collectConfig();
        state.previewPending = callHost("olinearrayUpdate", cfg)
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

    async function startArray() {
        if (state.busy || state.active) return;
        var cfg = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Building array...");
        try {
            var response = await callHost("olinearrayStart", cfg);
            if (!response.ok) throw new Error(response.message || "Could not start.");
            state.active = true;
            state.stack = response.stack || [];
            state.docSymbols = response.docSymbols || [];
            renderStack();
            setStatus("success", response.message || "Preview ready.");
            actionHintEl.textContent = "Adjust parameters. APPLY commits, BAKE TO SYMBOL stores variant, CANCEL reverts.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function applyArray() {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        if (state.previewQueued && state.active) {
            state.previewQueued = false;
            await sendPreviewUpdate();
            if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        }
        setBusy(true);
        setStatus("info", "Applying...");
        try {
            var response = await callHost("olinearrayApply");
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            state.stack = [];
            state.docSymbols = [];
            renderStack();
            setStatus("success", response.message || "Applied.");
            actionHintEl.textContent = "Select 1 path + 2+ items, then press LINEARRAY.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function cancelArray() {
        if (state.busy || !state.active) return;
        state.previewQueued = false;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("olinearrayCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            state.stack = [];
            state.docSymbols = [];
            renderStack();
            setStatus("info", response.message || "Cancelled.");
            actionHintEl.textContent = "Select 1 path + 2+ items, then press LINEARRAY.";
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function bakeArray() {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        setBusy(true);
        setStatus("info", "Baking...");
        try {
            var response = await callHost("olinearrayBake");
            if (!response.ok) throw new Error(response.message || "Bake failed.");
            setStatus("success", response.message || "Baked.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function rerollArray() {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        var cfg = collectConfig();
        setBusy(true);
        setStatus("info", "Re-rolling...");
        try {
            var response = await callHost("olinearrayReroll", cfg);
            if (!response.ok) throw new Error(response.message || "Re-roll failed.");
            setStatus("success", response.message || "Re-rolled.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function qtyAction(action, at) {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        setBusy(true);
        setStatus("info", action === "add" ? "Adding..." : "Removing...");
        try {
            var cfg = collectConfig();
            cfg.qtyAction = action;
            cfg.qtyAt = at;
            var response = await callHost("olinearrayQty", cfg);
            if (!response.ok) throw new Error(response.message || "Quantity action failed.");
            setStatus("success", response.message || "Done.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    // ---------- STACK ----------

    function renderStack() {
        stackListEl.innerHTML = "";
        if (!state.stack.length) {
            var hint = document.createElement("p");
            hint.className = "sub";
            hint.style.margin = "0";
            hint.textContent = "Empty. Press + ADD SLOT.";
            stackListEl.appendChild(hint);
            return;
        }
        for (var i = 0; i < state.stack.length; i++) {
            stackListEl.appendChild(buildStackRow(i, state.stack[i]));
        }
    }

    function buildStackRow(index, slot) {
        var row = document.createElement("div");
        row.className = "stack-row";
        row.setAttribute("draggable", "true");
        row.setAttribute("data-index", String(index));

        var drag = document.createElement("div");
        drag.className = "stack-drag";
        drag.textContent = "⋮⋮"; // double vertical ellipsis
        drag.title = "Drag to reorder";
        row.appendChild(drag);

        var dd = document.createElement("div");
        dd.className = "simple-dropdown stack-symbol-dd";

        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "stack-symbol-toggle ui-dropdown-toggle";
        toggle.setAttribute("aria-haspopup", "listbox");
        toggle.setAttribute("aria-expanded", "false");
        var current = slot && slot.symbolName ? slot.symbolName : "";
        var labelText = document.createElement("span");
        labelText.className = "symbol-text";
        labelText.textContent = current ? current : "— empty —";
        toggle.appendChild(labelText);
        var chev = document.createElement("span");
        chev.className = "dropdown-chevron";
        chev.setAttribute("aria-hidden", "true");
        chev.innerHTML = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 6.5L8 10L11.5 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
        toggle.appendChild(chev);
        if (!current) toggle.classList.add("is-empty");
        dd.appendChild(toggle);

        var list = document.createElement("div");
        list.className = "stack-options ui-dropdown-list";
        list.setAttribute("role", "listbox");

        var staleNeeded = current && state.docSymbols.indexOf(current) === -1;

        var emptyOpt = document.createElement("div");
        emptyOpt.className = "stack-option is-empty" + (current ? "" : " is-selected");
        emptyOpt.setAttribute("data-value", "");
        emptyOpt.textContent = "— empty —";
        list.appendChild(emptyOpt);

        for (var s = 0; s < state.docSymbols.length; s++) {
            var opt = document.createElement("div");
            opt.className = "stack-option" + (state.docSymbols[s] === current ? " is-selected" : "");
            opt.setAttribute("data-value", state.docSymbols[s]);
            opt.textContent = state.docSymbols[s];
            list.appendChild(opt);
        }
        if (staleNeeded) {
            var staleOpt = document.createElement("div");
            staleOpt.className = "stack-option is-stale is-selected";
            staleOpt.setAttribute("data-value", current);
            staleOpt.textContent = current + " (missing)";
            list.appendChild(staleOpt);
        }

        toggle.addEventListener("click", function (event) {
            event.stopPropagation();
            if (toggle.disabled) return;
            if (state.activeDropdown === dd) closeDropdown();
            else openDropdown(dd);
        });
        Array.prototype.forEach.call(list.querySelectorAll(".stack-option"), function (option) {
            option.addEventListener("click", function (event) {
                event.stopPropagation();
                var raw = option.getAttribute("data-value");
                var name = (raw === "" || raw == null) ? null : raw;
                closeDropdown();
                handleAssignSymbol(index, name);
            });
        });
        dd.appendChild(list);
        row.appendChild(dd);

        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "stack-remove";
        remove.title = "Remove slot";
        remove.innerHTML = '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        remove.addEventListener("click", function () {
            handleRemoveSlot(index);
        });
        row.appendChild(remove);

        bindRowDrag(row);
        return row;
    }

    function bindRowDrag(row) {
        row.addEventListener("dragstart", function (e) {
            row.classList.add("is-dragging");
            try { e.dataTransfer.effectAllowed = "move"; } catch (er) {}
            try { e.dataTransfer.setData("text/plain", row.getAttribute("data-index")); } catch (er2) {}
        });
        row.addEventListener("dragend", function () {
            row.classList.remove("is-dragging");
            Array.prototype.forEach.call(stackListEl.querySelectorAll(".stack-row"), function (r) {
                r.classList.remove("drop-before", "drop-after");
            });
        });
        row.addEventListener("dragover", function (e) {
            if (!stackListEl.querySelector(".is-dragging")) return;
            e.preventDefault();
            try { e.dataTransfer.dropEffect = "move"; } catch (er) {}
            var rect = row.getBoundingClientRect();
            var before = (e.clientY - rect.top) < rect.height / 2;
            row.classList.toggle("drop-before", before);
            row.classList.toggle("drop-after", !before);
        });
        row.addEventListener("dragleave", function () {
            row.classList.remove("drop-before", "drop-after");
        });
        row.addEventListener("drop", function (e) {
            e.preventDefault();
            var dragging = stackListEl.querySelector(".stack-row.is-dragging");
            if (!dragging || dragging === row) return;
            var fromIdx = parseInt(dragging.getAttribute("data-index"), 10);
            var toIdx = parseInt(row.getAttribute("data-index"), 10);
            if (isNaN(fromIdx) || isNaN(toIdx)) return;
            var rect = row.getBoundingClientRect();
            var before = (e.clientY - rect.top) < rect.height / 2;
            var insertAt = before ? toIdx : toIdx + 1;
            if (fromIdx < insertAt) insertAt -= 1;
            if (fromIdx === insertAt) return;
            var moved = state.stack.splice(fromIdx, 1)[0];
            state.stack.splice(insertAt, 0, moved);
            renderStack();
            sendStackUpdate();
        });
    }

    async function sendStackUpdate() {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        setBusy(true);
        try {
            var cfg = collectConfig();
            cfg.stack = state.stack;
            var response = await callHost("olinearraySetStack", cfg);
            if (!response.ok) {
                setStatus("error", response.message || "Stack update failed.");
                return;
            }
            if (response.stack) {
                state.stack = response.stack;
                renderStack();
            }
            setStatus("success", response.message || "Stack updated.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    function handleAssignSymbol(index, symbolName) {
        if (!state.stack[index]) return;
        state.stack[index] = { symbolName: symbolName };
        renderStack();
        sendStackUpdate();
    }

    function handleRemoveSlot(index) {
        if (index < 0 || index >= state.stack.length) return;
        state.stack.splice(index, 1);
        renderStack();
        sendStackUpdate();
    }

    function handleAddSlot() {
        state.stack.push({ symbolName: null });
        renderStack();
        sendStackUpdate();
    }

    async function loadStackFromHost() {
        try {
            var resp = await callHost("olinearrayGetStack");
            if (resp.ok) {
                state.stack = resp.stack || [];
                state.docSymbols = resp.docSymbols || [];
                renderStack();
            }
        } catch (e) {}
    }

    async function replacePath() {
        if (state.busy || !state.active) return;
        if (state.previewPending) { try { await state.previewPending; } catch (e) {} }
        setBusy(true);
        setStatus("info", "Replacing path...");
        try {
            var cfg = collectConfig();
            var response = await callHost("olinearrayReplacePath", cfg);
            if (!response.ok) throw new Error(response.message || "Could not replace path.");
            setStatus("success", response.message || "Path replaced.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
            refreshControlStates();
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("olinearrayHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            if (handshake.sessionActive) {
                try { await callHost("olinearrayCancel"); } catch (e) {}
            }
            state.active = false;
            refreshControlStates();
            setStatus("success", handshake.message + " " + handshake.hostName + " " + handshake.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    // ---------- BOILERPLATE ----------

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

    function bindCheckbox(key) {
        fields[key].addEventListener("change", function () {
            if (fields[key].disabled) return;
            saveSettings();
            updateDistributionVisibility();
            if (state.active) schedulePreviewUpdate();
        });
    }

    function bindAnchorDropdown() {
        var wrapper = document.querySelector('.simple-dropdown[data-id="anchor"]');
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

        Array.prototype.forEach.call(wrapper.querySelectorAll(".custom-option"), function (option) {
            option.addEventListener("click", function () {
                handlePickAnchor(option.getAttribute("data-value") || "center");
            });
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest(".simple-dropdown")) closeDropdown();
        });
    }

    function bindScaleModeButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.mode-seg[data-scale]'), function (btn) {
            btn.addEventListener("click", function () {
                state.scaleMode = btn.getAttribute("data-scale") || "stretch";
                fields.scaleMode.value = state.scaleMode;
                refreshScaleModeButtons();
                saveSettings();
                if (state.active) schedulePreviewUpdate();
            });
        });
    }

    function bindResets() {
        buttons.gapReset.addEventListener("click", function () {
            if (buttons.gapReset.disabled) return;
            syncPair("gap", "gapRange", DEFAULTS.gap);
            onParameterChanged();
        });
        buttons.stepReset.addEventListener("click", function () {
            if (buttons.stepReset.disabled) return;
            syncPair("step", "stepRange", DEFAULTS.step);
            onParameterChanged();
        });
        buttons.offsetReset.addEventListener("click", function () {
            if (buttons.offsetReset.disabled) return;
            syncPair("offset", "offsetRange", DEFAULTS.offset);
            onParameterChanged();
        });
        buttons.rndOffsetReset.addEventListener("click", function () {
            if (buttons.rndOffsetReset.disabled) return;
            syncPair("rndOffset", "rndOffsetRange", DEFAULTS.rndOffset);
            onParameterChanged();
        });
    }

    function bindQtyButtons() {
        qtyButtons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                if (btn.disabled) return;
                qtyAction(btn.getAttribute("data-qty-action"), btn.getAttribute("data-qty-at"));
            });
        });
    }

    function bindStackButtons() {
        addSlotBtn.addEventListener("click", function () {
            if (addSlotBtn.disabled) return;
            handleAddSlot();
        });
        replacePathBtn.addEventListener("click", function () {
            if (replacePathBtn.disabled) return;
            replacePath();
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindCheckbox("touch");
    bindCheckbox("fit");
    bindCheckbox("rotate");
    bindAnchorDropdown();
    bindScaleModeButtons();
    bindResets();
    bindQtyButtons();
    bindStackButtons();

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) applyArray();
        else startArray();
    });
    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        cancelArray();
    });
    buttons.bake.addEventListener("click", function () {
        if (buttons.bake.disabled) return;
        bakeArray();
    });
    buttons.reset.addEventListener("click", function () {
        if (buttons.reset.disabled) return;
        rerollArray();
    });

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
