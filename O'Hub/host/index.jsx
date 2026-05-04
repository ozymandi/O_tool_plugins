#target illustrator
#targetengine "OHubCEP"

// Hub-specific host is intentionally minimal — Hub doesn't run any
// Illustrator commands directly, it only opens other extensions.
// The handshake is here so the panel can confirm CEP host is alive.

function ohubHandshake() {
    var payload = '{"ok":true,"message":"Panel connected.","hostName":"' + app.name + '","hostVersion":"' + app.version + '"}';
    return payload;
}
