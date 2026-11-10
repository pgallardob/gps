"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Client } = require("../js/sharing-client.js");
const base = process.env.PUNTO_SHARING_SIM_URL;
const token = "t".repeat(43), viewer = "v".repeat(43);
const syntheticPoint = { coords: { latitude: 0, longitude: 0, accuracy: 10 } };
// Node does not add the browser's automatic Origin header; keep the actual HTTP client.
const browserFetch = (url, options = {}) => fetch(url, {
    ...options, headers: { ...options.headers, Origin: "https://pgallardob.github.io" }
});

async function receiver(id, geolocation) {
    let resolveReady, rejectReady, resolveStopped;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const stopped = new Promise(resolve => { resolveStopped = resolve; });
    const elements = Object.fromEntries(["share-start-btn", "share-stop-btn", "share-consent", "publisher-status",
        "publisher-last-update", "relay-origin", "share-duration"].map(name => [name, {
        disabled: true, checked: false, textContent: "", events: {},
        addEventListener(type, listener) { this.events[type] = listener; }
    }]));
    let status = "", loaded = false, tick;
    Object.defineProperty(elements["publisher-status"], "textContent", {
        get: () => status,
        set(value) {
            status = value;
            if (value.startsWith("Invitación válida.")) { loaded = true; resolveReady(); }
            else if (!loaded) rejectReady(new Error(value));
            if (value.includes("El servicio confirmó la revocación.")) resolveStopped();
        }
    });
    const context = vm.createContext({
        URL, AbortController, TextDecoder, performance, setTimeout, clearTimeout, fetch: browserFetch,
        setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {},
        navigator: { geolocation }, isSecureContext: true, GPS_CONFIG: { sharingApiUrl: base },
        location: { hostname: "127.0.0.1", pathname: "/share.html", search: "", hash: `#invite=${id}.${token}` },
        history: { replaceState() {} }, addEventListener() {},
        document: { hidden: false, body: { dataset: {} }, addEventListener() {}, getElementById: name => elements[name] }
    });
    context.self = context.top = context;
    for (const name of ["sharing-client.js", "share-publisher.js"]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "../js", name), "utf8"), context);
    }
    await ready;
    return {
        elements, status: () => status,
        consent(value) { elements["share-consent"].checked = value; elements["share-consent"].events.change(); },
        start: () => elements["share-start-btn"].events.click(),
        tick: () => tick(),
        stop() { elements["share-stop-btn"].events.click(); return stopped; }
    };
}

test("publisher DOM and real HTTP client against the local relay simulation", { skip: !base, timeout: 30000 }, async t => {
    const url = new URL(base);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/relay");
    const reset = await fetch(`${base}/__reset`, { method: "POST" });
    assert.equal(reset.status, 200);
    const client = new Client(base, browserFetch, { hostname: "127.0.0.1" });

    await t.test("GPS retry stays consent-gated, then sends a synthetic point and revokes it", async () => {
        const id = "r".repeat(22);
        let fixes = 0;
        const ui = await receiver(id, { getCurrentPosition(success, error, options) {
            fixes += 1;
            if (fixes === 1) error({ code: 3 });
            else { assert.ok(options.timeout >= 20000); success(syntheticPoint); }
        } });
        assert.equal(fixes, 0);
        assert.equal(ui.elements["share-start-btn"].disabled, true);
        ui.consent(true);
        await ui.start();
        assert.match(ui.status(), /GPS tardó demasiado.*Etapa: obtener ubicación/);
        assert.equal(ui.elements["share-start-btn"].disabled, false);
        assert.equal((await client.view(id, viewer)).state, "pending");
        ui.consent(false);
        assert.equal(ui.elements["share-start-btn"].disabled, true);
        ui.consent(true);
        await ui.start();
        assert.match(ui.status(), /Estás compartiendo/);
        const active = await client.view(id, viewer);
        assert.equal(active.state, "active");
        assert.equal(active.point.latitude, 0);
        await ui.stop();
        const stopped = await client.view(id, viewer);
        assert.equal(stopped.state, "stopped");
        assert.equal(stopped.point, null);
        assert.equal(ui.elements["share-start-btn"].disabled, true);
    });

    await t.test("HTML upload failures name the upload stage and clear even an already written point", async () => {
        const id = "p".repeat(22);
        const ui = await receiver(id, { getCurrentPosition: success => success(syntheticPoint) });
        ui.consent(true);
        await ui.start();
        assert.match(ui.status(), /respuesta no válida.*Etapa: enviar posición/);
        assert.match(ui.status(), /confirmó la revocación/);
        assert.equal(ui.elements["share-start-btn"].disabled, true);
        const stopped = await client.view(id, viewer);
        assert.equal(stopped.state, "stopped");
        assert.equal(stopped.point, null);
    });

    await t.test("GPS permission loss after acceptance cannot re-enable a consumed invitation", async () => {
        assert.equal((await fetch(`${base}/__reset`, { method: "POST" })).status, 200);
        const id = "r".repeat(22);
        let fixes = 0;
        const ui = await receiver(id, { getCurrentPosition(success, error) {
            if (++fixes === 1) success(syntheticPoint);
            else error({ code: 1 });
        } });
        ui.consent(true);
        await ui.start();
        await ui.tick();
        assert.match(ui.status(), /no tiene permiso.*Solicita una invitación nueva/);
        assert.equal(ui.elements["share-start-btn"].disabled, true);
        assert.equal((await client.view(id, viewer)).point, null);
    });

    await t.test("a real HTTP acceptance timeout names its stage and revokes the uncertain acceptance", async () => {
        const id = "h".repeat(22);
        const ui = await receiver(id, { getCurrentPosition: success => success(syntheticPoint) });
        ui.consent(true);
        await ui.start();
        assert.match(ui.status(), /no respondió a tiempo.*Etapa: aceptar invitación/);
        assert.match(ui.status(), /confirmó la revocación/);
        assert.equal(ui.elements["share-start-btn"].disabled, true);
        assert.equal((await client.view(id, viewer)).state, "stopped");
    });
});
