"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { create } = require("../mobile/android/app/src/main/assets/native-adapter.js");
const { dashboard, build } = require("../scripts/build_android_assets.js");

function fixture(hooks = {}) {
    const commands = [];
    const api = create({ postMessage: text => commands.push(JSON.parse(text)) });
    api.bind(hooks);
    api.receive({ type: "state", segments: [], active: false, visible: true, tiles: true });
    return { api, commands };
}
const a = [0, 0, 10, 1000, null, 100];
const b = [0.001, 0, 10, 6000, null, 600];

test("packaging retains the original dashboard styles and tools without the owner form or web installer", () => {
    const root = path.resolve(__dirname, "..");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "punto-dashboard-test-"));
    try {
        build(root, directory);
        const html = fs.readFileSync(path.join(directory, "index.html"), "utf8");
        for (const id of ["locate-btn", "copy-btn", "point-count", "speed", "goal-km", "waypoint-list", "import-btn", "export-format", "demo-btn", "forget-btn"]) assert.ok(html.includes(`id="${id}"`), id);
        assert.ok(!html.includes('id="sharing-owner-key"'));
        assert.ok(!html.includes('id="pwa-install-btn"'));
        assert.ok(!html.includes("start.bat"));
        assert.ok(html.includes("connect-src 'none'"));
        for (const match of html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)) assert.ok(fs.existsSync(path.join(directory, match[1])), match[1]);
        assert.deepEqual(fs.readFileSync(path.join(directory, "css/styles.css")), fs.readFileSync(path.join(root, "css/styles.css")));
        assert.deepEqual(fs.readFileSync(path.join(directory, "vendor/leaflet/leaflet.js")), fs.readFileSync(path.join(root, "vendor/leaflet/leaflet.js")));
        assert.throws(() => dashboard("<html>unexpected structure</html>"), /review Android packaging/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("native start is explicit and replayed route points are not duplicated", () => {
    const points = [], segments = [];
    const { api, commands } = fixture({ segment: () => segments.push(true) });
    assert.deepEqual(commands.map(item => item.type), ["ready"]);
    const id = api.geolocation.watchPosition(point => points.push(point), () => assert.fail("Unexpected GPS failure"));
    const frame = { type: "state", segments: [[a, b]], point: b, active: true, watchId: id };
    api.receive(frame);
    assert.equal(points.length, 2);
    const count = points.length;
    api.receive(frame);
    assert.equal(points.length, count);
    assert.equal(segments.length, 1);
    api.geolocation.clearWatch(id);
    api.receive({ ...frame, segments: [[a, b], [[1, 1, 10, 12000]]] });
    assert.equal(points.length, count);
    assert.equal(commands.at(-1).type, "stop");
});

test("one-shot location never starts a foreground route and late results are canceled", () => {
    let received = 0;
    const { api, commands } = fixture();
    api.geolocation.getCurrentPosition(() => received++, assert.fail);
    const id = commands.at(-1).id;
    api.receive({ type: "position", id, point: a });
    api.receive({ type: "position", id, point: a });
    assert.equal(received, 1);
    assert.ok(!commands.some(item => item.type === "start"));
    api.geolocation.getCurrentPosition(() => received++, assert.fail);
    const canceled = commands.at(-1).id;
    api.cancelLocate();
    api.receive({ type: "position", id: canceled, point: b });
    assert.equal(received, 1);
});

test("native route clear ignores queued pre-clear frames until acknowledgement", () => {
    const points = [];
    const { api } = fixture();
    const id = api.geolocation.watchPosition(point => points.push(point), assert.fail);
    api.clearRoute();
    api.receive({ type: "state", segments: [[a, b]], active: true, watchId: id });
    assert.equal(points.length, 0);
    api.receive({ type: "cleared" });
    api.receive({ type: "state", segments: [[b]], active: true, watchId: id });
    assert.equal(points.length, 1);
});

test("exports are format-allowlisted, bounded and chunked without filesystem paths", () => {
    const { api, commands } = fixture();
    const body = "a".repeat(17000);
    api.exportFile(body, "geojson");
    assert.deepEqual(commands.slice(1).map(item => item.type), ["exportBegin", "exportPart", "exportPart", "exportPart", "exportFinish"]);
    assert.equal(commands.filter(item => item.type === "exportPart").map(item => item.text).join(""), body);
    assert.ok(commands.every(item => JSON.stringify(item).length <= 65536));
    assert.throws(() => api.exportFile(body, "html"));
    assert.throws(() => api.exportFile("x".repeat(4 * 1024 * 1024 + 1), "gpx"));
});

test("chunked state frames replay atomically and malformed positions are ignored", () => {
    const points = [];
    const { api } = fixture();
    const id = api.geolocation.watchPosition(point => points.push(point), assert.fail);
    const text = JSON.stringify({ type: "state", segments: [[a, b]], active: true, watchId: id });
    api.receive({ type: "frameBegin" });
    api.receive({ type: "framePart", text: text.slice(0, 10) });
    assert.equal(points.length, 0);
    api.receive({ type: "framePart", text: text.slice(10) });
    api.receive({ type: "frameFinish" });
    assert.equal(points.length, 2);
    assert.doesNotThrow(() => api.receive({ type: "state", segments: [null], active: true }));
    api.receive({ type: "state", segments: [[[100, 0, 10, 20000]]], active: true });
    assert.equal(points.length, 2);
});

test("oversized imports cannot recover by sending a valid-looking suffix", () => {
    let imports = 0;
    const { api } = fixture({ importFile: () => imports++ });
    api.receive({ type: "importBegin" });
    api.receive({ type: "importPart", text: "x".repeat(4 * 1024 * 1024 + 1) });
    api.receive({ type: "importPart", text: "{}" });
    api.receive({ type: "importFinish" });
    assert.equal(imports, 0);
});

test("native accepted replay uses elapsed ordering even if the wall clock moves backwards", () => {
    const core = require("../js/geo.js");
    const { api } = fixture();
    const route = api.createRoute(core, { maxPoints: 2 });
    const point = { lat: 0, lon: 0, accuracy: 10, timestamp: 6000, speed: null, nativeRecorded: true };
    assert.equal(route.add(point), "added");
    assert.equal(route.add({ ...point, lat: 0.000001, timestamp: 1000 }), "added");
    assert.equal(route.pointCount, 2);
    assert.equal(route.add({ ...point, lat: 1, timestamp: 12000 }), "limit");
    route.clear();
    assert.equal(route.add({ ...point, nativeRecorded: false }), "added");
    assert.equal(route.add({ ...point, timestamp: 1000, nativeRecorded: false }), "stale");
});

test("copy reports success only after the native acknowledgement", async () => {
    const { api, commands } = fixture();
    const denied = api.copy("0.000000, 0.000000");
    api.receive({ type: "copied", id: commands.at(-1).id, ok: false });
    await assert.rejects(denied, /unavailable/);
    const accepted = api.copy("0.000000, 0.000000");
    api.receive({ type: "copied", id: commands.at(-1).id, ok: true });
    await assert.doesNotReject(accepted);
});
