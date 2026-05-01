(function () {
    var STORAGE_KEY = "ofill.panel.settings.v1";

    var state = {
        active: false,
        busy: false,
        hasPreview: false,
        stack: []
    };

    var fields = {
        percent: document.getElementById("percent"),
        percentRange: document.getElementById("percentRange"),
        gap: document.getElementById("gap"),
        gapRange: document.getElementById("gapRange"),
        attempts: document.getElementById("attempts"),
        attemptsRange: document.getElementById("attemptsRange"),
        minScale: document.getElementById("minScale"),
        maxScale: document.getElementById("maxScale"),
        origin: document.getElementById("origin"),
        mix: document.getElementById("mix"),
        rotate: document.getElementById("rotate"),
        mask: document.getElementById("mask")
    };

    var buttons = {
        primary: document.getElementById("primaryBtn"),
        apply: document.getElementById("applyBtn"),
        cancel: document.getElementById("cancelBtn"),
        reset: document.getElementById("resetBtn"),
        changeShape: document.getElementById("changeShapeBtn"),
        addToStack: document.getElementById("addToStackBtn"),
        percentReset: document.getElementById("percentResetBtn"),
        gapReset: document.getElementById("gapResetBtn"),
        attemptsReset: document.getElementById("attemptsResetBtn")
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var actionHintEl = document.getElementById("actionHint");
    var shapeNameEl = document.getElementById("shapeName");
    var stackListEl = document.getElementById("stackList");

    var DEFAULTS = {
        percent: 100,
        gap: 0,
        attempts: 30,
        minScale: 20,
        maxScale: 120,
        origin: "bottom-up",
        mix: false,
        rotate: true,
        mask: true
    };

    var SLIDER_PAIRS = [
        ["percent", "percentRange"],
        ["gap", "gapRange"],
        ["attempts", "attemptsRange"]
    ];

    function getDefaultConfig() { return JSON.parse(JSON.stringify(DEFAULTS)); }

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

    function setActionHint(text) { actionHintEl.textContent = text; }

    function refreshControlStates() {
        var idle = !state.active;
        var busy = state.busy;
        var locked = idle || busy;

        var lockableInputs = document.querySelectorAll('.panel[data-lockable] input, .panel[data-lockable] button');
        Array.prototype.forEach.call(lockableInputs, function (el) {
            el.disabled = locked;
        });

        // Container row should always be enabled in active (Change link)
        if (state.active && !busy) {
            buttons.changeShape.disabled = false;
            buttons.addToStack.disabled = false;
        }

        // Primary button morphs:
        // IDLE: SELECT SHAPE (always enabled unless busy)
        // ACTIVE: GENERATE (enabled if stack has items and not busy)
        if (state.active) {
            buttons.primary.textContent = "GENERATE";
            buttons.primary.disabled = busy || state.stack.length === 0;
        } else {
            buttons.primary.textContent = "SELECT SHAPE";
            buttons.primary.disabled = busy;
        }

        // APPLY only when preview exists in active mode
        buttons.apply.disabled = busy || !state.active || !state.hasPreview;
        // CANCEL only in active mode (whether preview exists or not)
        buttons.cancel.disabled = busy || !state.active;
        // RESET PARAMETERS only in active mode
        buttons.reset.disabled = locked;

        document.body.classList.toggle("is-idle", idle);
        document.body.classList.toggle("is-active", !idle);
    }

    function setBusy(isBusy) {
        state.busy = isBusy;
        refreshControlStates();
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

    function updateOriginButtons() {
        var current = String(fields.origin.value || "bottom-up");
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-origin]"), function (button) {
            var active = button.getAttribute("data-origin") === current;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function getSnapshot() {
        return {
            percent: fields.percent.value,
            gap: fields.gap.value,
            attempts: fields.attempts.value,
            minScale: fields.minScale.value,
            maxScale: fields.maxScale.value,
            origin: fields.origin.value,
            mix: !!fields.mix.checked,
            rotate: !!fields.rotate.checked,
            mask: !!fields.mask.checked
        };
    }

    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }

    function applySnapshot(snapshot) {
        fields.minScale.value = String(snapshot.minScale);
        fields.maxScale.value = String(snapshot.maxScale);
        fields.origin.value = String(snapshot.origin || "bottom-up");
        fields.mix.checked = !!snapshot.mix;
        fields.rotate.checked = !!snapshot.rotate;
        fields.mask.checked = !!snapshot.mask;
        SLIDER_PAIRS.forEach(function (pair) {
            syncPair(pair[0], pair[1], snapshot[pair[0]]);
        });
        updateOriginButtons();
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
        var config = {
            percent: parseFloat(fields.percent.value),
            gap: parseFloat(fields.gap.value),
            attempts: parseFloat(fields.attempts.value),
            minScale: parseFloat(fields.minScale.value),
            maxScale: parseFloat(fields.maxScale.value),
            origin: String(fields.origin.value || "bottom-up"),
            mix: !!fields.mix.checked,
            rotate: !!fields.rotate.checked,
            mask: !!fields.mask.checked
        };
        if (!Number.isFinite(config.percent) || config.percent < 1) config.percent = 1;
        if (config.percent > 100) config.percent = 100;
        if (!Number.isFinite(config.gap) || config.gap < 0) config.gap = 0;
        if (!Number.isFinite(config.attempts) || config.attempts < 1) config.attempts = 1;
        if (!Number.isFinite(config.minScale) || config.minScale < 1) config.minScale = 1;
        if (!Number.isFinite(config.maxScale) || config.maxScale < 1) config.maxScale = 1;
        if (config.maxScale < config.minScale) config.maxScale = config.minScale;
        return config;
    }

    // ---------- STACK RENDER + DND ----------

    var dragSrcIdx = null;

    function renderStack() {
        stackListEl.innerHTML = "";
        if (state.stack.length === 0) {
            var empty = document.createElement("div");
            empty.className = "stack-empty";
            empty.textContent = "Stack is empty. Select donor objects on the artboard, then press + ADD TO STACK.";
            stackListEl.appendChild(empty);
            return;
        }

        state.stack.forEach(function (item, idx) {
            var row = document.createElement("div");
            row.className = "stack-row";
            row.draggable = true;
            row.dataset.idx = String(idx);

            var handle = document.createElement("span");
            handle.className = "drag-handle";
            handle.textContent = "☰";
            handle.title = "Drag to reorder";

            var name = document.createElement("span");
            name.className = "stack-name";
            var label = item.name && item.name !== "" ? item.name : "(unnamed)";
            name.textContent = label;
            var typeSpan = document.createElement("span");
            typeSpan.className = "stack-type";
            typeSpan.textContent = item.typename || "";
            name.appendChild(typeSpan);

            var del = document.createElement("button");
            del.type = "button";
            del.className = "stack-delete";
            del.title = "Remove from stack";
            del.textContent = "✕";
            del.addEventListener("click", function (e) {
                e.stopPropagation();
                removeFromStack(idx);
            });

            row.appendChild(handle);
            row.appendChild(name);
            row.appendChild(del);

            row.addEventListener("dragstart", onDragStart);
            row.addEventListener("dragenter", onDragEnter);
            row.addEventListener("dragover", onDragOver);
            row.addEventListener("dragleave", onDragLeave);
            row.addEventListener("drop", onDrop);
            row.addEventListener("dragend", onDragEnd);

            stackListEl.appendChild(row);
        });
    }

    function onDragStart(e) {
        dragSrcIdx = parseInt(this.dataset.idx, 10);
        this.classList.add("is-dragging");
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", String(dragSrcIdx)); } catch (err) {}
        }
    }

    function onDragEnter(e) {
        if (dragSrcIdx === null) return;
        e.preventDefault();
        this.classList.add("is-drop-target");
    }

    function onDragOver(e) {
        if (dragSrcIdx === null) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        this.classList.add("is-drop-target");
    }

    function onDragLeave() {
        this.classList.remove("is-drop-target");
    }

    function onDrop(e) {
        if (dragSrcIdx === null) return;
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove("is-drop-target");
        var dropIdx = parseInt(this.dataset.idx, 10);
        if (Number.isFinite(dragSrcIdx) && Number.isFinite(dropIdx) && dragSrcIdx !== dropIdx) {
            reorderStack(dragSrcIdx, dropIdx);
        }
    }

    function onDragEnd() {
        this.classList.remove("is-dragging");
        Array.prototype.forEach.call(document.querySelectorAll(".stack-row"), function (r) {
            r.classList.remove("is-drop-target");
        });
        dragSrcIdx = null;
    }

    // ---------- HOST CALLS ----------

    async function handleSelectShape() {
        if (state.busy) return;
        setBusy(true);
        setStatus("info", "Capturing shape...");
        try {
            var response = await callHost("ofillSelectShape");
            if (!response.ok) throw new Error(response.message || "Could not capture shape.");
            state.active = true;
            shapeNameEl.textContent = response.shape ? (response.shape.name || response.shape.typename) : "—";
            state.stack = response.stack || [];
            state.hasPreview = false;
            renderStack();
            setActionHint("Select donor objects on the artboard and press + ADD TO STACK. Press GENERATE when ready.");
            setStatus("success", response.message || "Shape captured.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function handleAddToStack() {
        if (state.busy || !state.active) return;
        setBusy(true);
        setStatus("info", "Adding donors...");
        try {
            var response = await callHost("ofillAddToStack");
            if (!response.ok) throw new Error(response.message || "Could not add donors.");
            state.stack = response.stack || [];
            renderStack();
            setStatus("success", response.message || "Added.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function reorderStack(fromIdx, toIdx) {
        if (state.busy || !state.active) return;
        setBusy(true);
        try {
            var response = await callHost("ofillReorderStack", { from: fromIdx, to: toIdx });
            if (!response.ok) throw new Error(response.message || "Could not reorder.");
            state.stack = response.stack || [];
            renderStack();
            setStatus("info", "Stack reordered.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function removeFromStack(idx) {
        if (state.busy || !state.active) return;
        setBusy(true);
        try {
            var response = await callHost("ofillRemoveFromStack", { index: idx });
            if (!response.ok) throw new Error(response.message || "Could not remove.");
            state.stack = response.stack || [];
            renderStack();
            setStatus("info", "Removed from stack.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function handleGenerate() {
        if (state.busy || !state.active) return;
        if (state.stack.length === 0) {
            setStatus("error", "Stack is empty. Add donors first.");
            return;
        }
        var config = collectConfig();
        saveSettings();
        setBusy(true);
        setStatus("info", "Generating preview...");
        try {
            var response = await callHost("ofillGenerate", config);
            if (!response.ok) throw new Error(response.message || "Generate failed.");
            state.hasPreview = true;
            setStatus("success", response.message || "Preview ready.");
            setActionHint("Adjust parameters or stack and GENERATE again. APPLY commits, CANCEL discards.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function handleApply() {
        if (state.busy || !state.active || !state.hasPreview) return;
        var config = collectConfig();
        setBusy(true);
        setStatus("info", "Applying...");
        try {
            var response = await callHost("ofillApply", config);
            if (!response.ok) throw new Error(response.message || "Apply failed.");
            state.active = false;
            state.hasPreview = false;
            state.stack = [];
            shapeNameEl.textContent = "—";
            renderStack();
            setActionHint("Select a shape on the artboard and press SELECT SHAPE to start.");
            setStatus("success", response.message || "Applied.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function handleCancel() {
        if (state.busy || !state.active) return;
        setBusy(true);
        setStatus("info", "Cancelling...");
        try {
            var response = await callHost("ofillCancel");
            if (!response.ok) throw new Error(response.message || "Cancel failed.");
            state.active = false;
            state.hasPreview = false;
            state.stack = [];
            shapeNameEl.textContent = "—";
            renderStack();
            setActionHint("Select a shape on the artboard and press SELECT SHAPE to start.");
            setStatus("info", response.message || "Cancelled.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function handleChangeShape() {
        if (state.busy || !state.active) return;
        setBusy(true);
        setStatus("info", "Capturing new shape...");
        try {
            var response = await callHost("ofillSelectShape");
            if (!response.ok) throw new Error(response.message || "Could not capture shape.");
            shapeNameEl.textContent = response.shape ? (response.shape.name || response.shape.typename) : "—";
            // Container changed: drop any stale preview
            state.hasPreview = false;
            setStatus("success", "Shape replaced. GENERATE to refresh the preview.");
        } catch (error) {
            setStatus("error", error.message);
        } finally {
            setBusy(false);
        }
    }

    async function initializePanel() {
        try {
            var handshake = await callHost("ofillHandshake");
            if (!handshake.ok) throw new Error(handshake.message || "Could not connect to Illustrator.");
            // Always start clean: cancel any stale session
            if (handshake.sessionActive) {
                try { await callHost("ofillCancel"); } catch (e) {}
            }
            state.active = false;
            state.hasPreview = false;
            state.stack = [];
            shapeNameEl.textContent = "—";
            renderStack();
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

    function bindSliderPair(numKey, rangeKey) {
        var numField = fields[numKey];
        var rangeField = fields[rangeKey];
        if (rangeField) {
            rangeField.addEventListener("input", function () {
                if (rangeField.disabled) return;
                syncPair(numKey, rangeKey, rangeField.value);
                saveSettings();
            });
        }
        if (numField) {
            numField.addEventListener("input", function () {
                if (numField.disabled) return;
                syncPair(numKey, rangeKey, numField.value);
                saveSettings();
            });
        }
    }

    function bindOriginButtons() {
        Array.prototype.forEach.call(document.querySelectorAll(".seg[data-origin]"), function (button) {
            button.addEventListener("click", function () {
                if (button.disabled) return;
                fields.origin.value = button.getAttribute("data-origin") || "bottom-up";
                updateOriginButtons();
                saveSettings();
            });
        });
    }

    function bindCheckboxes() {
        ["mix", "rotate", "mask"].forEach(function (key) {
            fields[key].addEventListener("change", function () {
                if (fields[key].disabled) return;
                saveSettings();
            });
        });
    }

    function bindNumberInputs() {
        ["minScale", "maxScale"].forEach(function (key) {
            fields[key].addEventListener("input", function () {
                if (fields[key].disabled) return;
                saveSettings();
            });
        });
    }

    SLIDER_PAIRS.forEach(function (pair) { bindSliderPair(pair[0], pair[1]); });
    bindOriginButtons();
    bindCheckboxes();
    bindNumberInputs();

    buttons.percentReset.addEventListener("click", function () {
        if (buttons.percentReset.disabled) return;
        syncPair("percent", "percentRange", DEFAULTS.percent);
        saveSettings();
    });
    buttons.gapReset.addEventListener("click", function () {
        if (buttons.gapReset.disabled) return;
        syncPair("gap", "gapRange", DEFAULTS.gap);
        saveSettings();
    });
    buttons.attemptsReset.addEventListener("click", function () {
        if (buttons.attemptsReset.disabled) return;
        syncPair("attempts", "attemptsRange", DEFAULTS.attempts);
        saveSettings();
    });

    buttons.changeShape.addEventListener("click", function () {
        if (buttons.changeShape.disabled) return;
        handleChangeShape();
    });
    buttons.addToStack.addEventListener("click", function () {
        if (buttons.addToStack.disabled) return;
        handleAddToStack();
    });

    buttons.primary.addEventListener("click", function () {
        if (buttons.primary.disabled) return;
        if (state.active) handleGenerate();
        else handleSelectShape();
    });

    buttons.apply.addEventListener("click", function () {
        if (buttons.apply.disabled) return;
        handleApply();
    });

    buttons.cancel.addEventListener("click", function () {
        if (buttons.cancel.disabled) return;
        handleCancel();
    });

    buttons.reset.addEventListener("click", function () {
        if (buttons.reset.disabled) return;
        applySnapshot(getDefaultConfig());
        saveSettings();
        setStatus("info", "Parameters reset to defaults. Press GENERATE to refresh preview.");
    });

    restoreSettings();
    bindNumberWheel();
    bindNumericScrubbers();
    refreshControlStates();
    initializePanel();
})();
