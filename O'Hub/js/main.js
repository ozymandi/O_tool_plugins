(function () {
    var STORAGE_KEY = "ohub.panel.settings.v1";

    // ---------- PLUGIN CATALOG ----------

    var PLUGINS = [
        // GEOMETRY
        { id: "com.otool.obend.panel",       name: "O'Bend",        tagline: "Bezier path bender with curve preview",            cat: "geometry",   icon: "BN" },
        { id: "com.otool.obevel.panel",      name: "O'Bevel",       tagline: "Round corners with bezier handles",                 cat: "geometry",   icon: "BV" },
        { id: "com.otool.ocone.panel",       name: "O'Cone",        tagline: "Build cones from selected paths",                   cat: "geometry",   icon: "CN" },
        { id: "com.otool.ospiral.panel",     name: "O'Spiral",      tagline: "Generate logarithmic spirals",                      cat: "geometry",   icon: "SP" },
        { id: "com.otool.oatractor.panel",   name: "O'Atractor",    tagline: "Pull / swirl points toward attractor",              cat: "geometry",   icon: "AT" },
        { id: "com.otool.ofit.panel",        name: "O'Fit",         tagline: "Fit objects to bounds",                             cat: "geometry",   icon: "FT" },
        { id: "com.otool.otrim.panel",       name: "O'Trim",        tagline: "Split into a grid with clipping",                   cat: "geometry",   icon: "TR" },
        { id: "com.otool.osplit.panel",      name: "O'Split",       tagline: "Slice paths into segments",                         cat: "geometry",   icon: "SL" },
        { id: "com.otool.ogridscale.panel",  name: "O'GridScale",   tagline: "Scale objects across a grid",                       cat: "geometry",   icon: "GS" },
        { id: "com.otool.obakeui.panel",     name: "O'BakeUI",      tagline: "Bake handles, anchors, bbox as vectors",            cat: "geometry",   icon: "BU" },

        // DISTRIBUTE
        { id: "com.otool.oline.panel",       name: "O'Line",        tagline: "Connect anchors with topology rules",               cat: "distribute", icon: "LN" },
        { id: "com.otool.olinearray.panel",  name: "O'Linearray",   tagline: "Distribute symbols along a path",                   cat: "distribute", icon: "LA" },
        { id: "com.otool.oconnect.panel",    name: "O'Connect",     tagline: "Hub-and-spoke bezier connections",                  cat: "distribute", icon: "CT" },
        { id: "com.otool.oscatter.panel",    name: "O'Scatter",     tagline: "Scatter clipboard symbols on anchors",              cat: "distribute", icon: "SC" },
        { id: "com.otool.overtex.panel",     name: "O'Vertex",      tagline: "Extract anchors as single-point paths",             cat: "distribute", icon: "VX" },
        { id: "com.otool.oalign.panel",      name: "O'Align",       tagline: "Smart alignment helpers",                           cat: "distribute", icon: "AL" },

        // COLOR
        { id: "com.otool.ocolor.panel",      name: "O'Color",       tagline: "Recolor selected objects",                          cat: "color",      icon: "CL" },
        { id: "com.otool.ofill.panel",       name: "O'Fill",        tagline: "Fill with stack of swatches",                       cat: "color",      icon: "FL" },
        { id: "com.otool.oreplace.panel",    name: "O'Replace",     tagline: "Replace shape, inherit color (Color / Light)",      cat: "color",      icon: "RP" },
        { id: "com.otool.olumegradient.panel", name: "O'LumeGradient", tagline: "Solid → gradient by luminance",                  cat: "color",      icon: "LG" },
        { id: "com.otool.onebular.panel",    name: "O'Nebula",      tagline: "Random width / opacity per path",                   cat: "color",      icon: "NB" },

        // GENERATE
        { id: "com.otool.ofractal.panel",    name: "O'Fractal",     tagline: "Generative fractal trees with children",            cat: "generate",   icon: "FR" },
        { id: "com.otool.ovoron.panel",      name: "O'Voron",       tagline: "Voronoi shatter with presets",                      cat: "generate",   icon: "VR" },
        { id: "com.otool.oautoshape.panel",  name: "O'Autoshape",   tagline: "Detect shapes from sketches",                       cat: "generate",   icon: "AS" },
        { id: "com.otool.omath.panel",       name: "O'Math",        tagline: "Parametric 3D surfaces (17 types)",                 cat: "generate",   icon: "MT" },
        { id: "com.otool.osymbol.panel",     name: "O'Symbol",      tagline: "Convert objects to symbols",                        cat: "generate",   icon: "SY" },

        // UTILITY
        { id: "com.otool.oselect.panel",     name: "O'Select",      tagline: "Smart selection helpers",                           cat: "utility",    icon: "SE" },
        { id: "com.otool.odeselect.panel",   name: "O'Deselect",    tagline: "Refined deselection",                               cat: "utility",    icon: "DS" },
        { id: "com.otool.otext.panel",       name: "O'Text",        tagline: "Smart text alignment without shifting",             cat: "utility",    icon: "TX" },

        // REFERENCE
        { id: "com.otool.ozometrix.panel",   name: "O'Zometrix",    tagline: "Isometric projections + extrude",                   cat: "reference",  icon: "ZX" },
        { id: "com.otool.ogridgen.panel",    name: "O'GridGen",     tagline: "Procedural grid generation",                        cat: "reference",  icon: "GG" }
    ];

    var CATEGORIES = [
        { id: "all",        label: "All" },
        { id: "geometry",   label: "Geometry" },
        { id: "distribute", label: "Distribute" },
        { id: "color",      label: "Color" },
        { id: "generate",   label: "Generate" },
        { id: "utility",    label: "Utility" },
        { id: "reference",  label: "Reference" }
    ];

    var state = {
        currentCat: "all",
        searchQuery: "",
        installed: {}   // id -> bool, populated lazily on click attempts
    };

    var statusEl = document.getElementById("status");
    var statusDotEl = document.getElementById("statusDot");
    var gridEl = document.getElementById("pluginGrid");
    var emptyEl = document.getElementById("emptyState");
    var searchEl = document.getElementById("searchInput");
    var stripEl = document.getElementById("categoryStrip");
    var countEl = document.getElementById("hubCount");

    function safeStorageGet() { try { return window.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } }
    function safeStorageSet(v) { try { window.localStorage.setItem(STORAGE_KEY, v); } catch (e) {} }

    function setStatus(kind, message) {
        statusEl.textContent = message;
        statusEl.title = message;
        statusDotEl.className = "status-indicator status-indicator--" + kind;
    }

    function getCepApi() {
        return window.__adobe_cep__;
    }

    function evalHost(script) {
        return new Promise(function (resolve, reject) {
            var cep = getCepApi();
            if (!cep || typeof cep.evalScript !== "function") {
                reject(new Error("CEP host bridge is not available."));
                return;
            }
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

    // ---------- LAUNCHING ----------

    function launchExtension(extensionId) {
        var cep = getCepApi();
        if (!cep) {
            setStatus("error", "CEP bridge unavailable.");
            return;
        }
        try {
            // requestOpenExtension is the canonical way to open another extension
            // from a CEP panel. It either opens (if installed) or fails silently.
            cep.requestOpenExtension(extensionId, "");
            setStatus("success", "Opening " + extensionId.split(".")[2] + "...");
        } catch (err) {
            setStatus("error", "Could not open: " + err.message);
        }
    }

    // ---------- CATEGORY STRIP ----------

    function getFilteredPlugins() {
        var q = state.searchQuery.toLowerCase();
        return PLUGINS.filter(function (p) {
            if (state.currentCat !== "all" && p.cat !== state.currentCat) return false;
            if (q) {
                var hay = (p.name + " " + p.tagline).toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    function renderCategoryStrip() {
        stripEl.innerHTML = "";
        for (var i = 0; i < CATEGORIES.length; i++) {
            var cat = CATEGORIES[i];
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cat-pill";
            if (cat.id === state.currentCat) btn.classList.add("is-active");
            btn.setAttribute("data-cat", cat.id);
            var count = (cat.id === "all") ? PLUGINS.length : PLUGINS.filter(function (p) { return p.cat === cat.id; }).length;
            btn.innerHTML = cat.label + '<span class="cat-count">' + count + '</span>';
            (function (id) {
                btn.addEventListener("click", function () {
                    state.currentCat = id;
                    saveSettings();
                    renderCategoryStrip();
                    renderGrid();
                });
            })(cat.id);
            stripEl.appendChild(btn);
        }
    }

    function renderGrid() {
        var list = getFilteredPlugins();
        gridEl.innerHTML = "";
        emptyEl.hidden = list.length > 0;
        countEl.textContent = list.length + " of " + PLUGINS.length + " plugin(s)";
        for (var i = 0; i < list.length; i++) {
            gridEl.appendChild(buildCard(list[i]));
        }
    }

    function buildCard(plugin) {
        var card = document.createElement("button");
        card.type = "button";
        card.className = "plugin-card";
        card.title = plugin.name + " — " + plugin.tagline;

        var icon = document.createElement("div");
        icon.className = "plugin-icon";
        icon.setAttribute("data-cat", plugin.cat);
        icon.textContent = plugin.icon;
        card.appendChild(icon);

        var info = document.createElement("div");
        info.className = "plugin-info";
        var name = document.createElement("div");
        name.className = "plugin-name";
        name.textContent = plugin.name;
        info.appendChild(name);
        var tagline = document.createElement("div");
        tagline.className = "plugin-tagline";
        tagline.textContent = plugin.tagline;
        info.appendChild(tagline);
        card.appendChild(info);

        card.addEventListener("click", function () {
            launchExtension(plugin.id);
        });
        return card;
    }

    // ---------- STORAGE ----------

    function getSnapshot() {
        return { currentCat: state.currentCat };
    }
    function saveSettings() { safeStorageSet(JSON.stringify(getSnapshot())); }
    function restoreSettings() {
        var raw = safeStorageGet();
        if (!raw) return;
        try {
            var parsed = JSON.parse(raw);
            if (parsed.currentCat) state.currentCat = parsed.currentCat;
        } catch (e) {}
    }

    // ---------- SEARCH ----------

    searchEl.addEventListener("input", function () {
        state.searchQuery = searchEl.value || "";
        renderGrid();
    });

    // ---------- INIT ----------

    async function initializePanel() {
        try {
            var resp = parseHostResponse(await evalHost("ohubHandshake()"));
            if (!resp.ok) throw new Error(resp.message || "Connect failed.");
            setStatus("success", "Connected. " + resp.hostName + " " + resp.hostVersion);
        } catch (error) {
            setStatus("error", error.message);
        }
    }

    restoreSettings();
    renderCategoryStrip();
    renderGrid();
    initializePanel();
})();
