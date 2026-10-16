"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { installed } = require("../js/pwa.js");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
const assets = JSON.parse(fs.readFileSync(path.join(root, "public-files.json"), "utf8"));
const workerSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");

test("manifest URLs and identities stay inside any GitHub repository prefix", () => {
    const base = "https://account.github.io/my-gps/manifest.webmanifest";
    for (const property of ["id", "start_url", "scope"]) assert.equal(new URL(manifest[property], base).pathname, "/my-gps/");
    assert.equal(manifest.display, "standalone");
    for (const icon of manifest.icons) assert.ok(new URL(icon.src, base).pathname.startsWith("/my-gps/assets/"));
});

test("home-screen icons exist with valid PNG sizes and all public assets are present", () => {
    for (const size of [180, 192, 512]) {
        const png = fs.readFileSync(path.join(root, `assets/icon-${size}.png`));
        assert.equal(png.subarray(1, 4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), size);
        assert.equal(png.readUInt32BE(20), size);
    }
    for (const file of assets) {
        assert.ok(fs.existsSync(path.join(root, file)), file);
        assert.ok(!file.startsWith("/") && !file.split("/").includes(".."));
        assert.doesNotMatch(file, /\.py$|\.env|sharing\/|tests\//);
    }
});

test("installed state supports both standalone media mode and iOS home-screen mode", () => {
    assert.equal(installed({ standalone: true }, () => ({ matches: false })), true);
    assert.equal(installed({}, () => ({ matches: true })), true);
    assert.equal(installed({}, () => ({ matches: false })), false);
});

function worker(fetcher = async () => { throw new Error("offline"); }) {
    const handlers = {};
    const deleted = [];
    let cachedAssets = [];
    const cache = { addAll: async urls => { cachedAssets = urls; }, put: async () => {}, match: async () => new Response("cached shell") };
    const self = { registration: { scope: "https://site.example/repo/" }, location: { origin: "https://site.example" },
        clients: { claim: async () => {} }, addEventListener: (name, callback) => { handlers[name] = callback; } };
    vm.runInNewContext(workerSource, { self, URL, Set, Response,
        caches: { open: async () => cache, keys: async () => ["another-app-v1", "punto-shell:/repo/:old", "punto-shell:/different/:v1"], delete: async key => { deleted.push(key); } },
        fetch: fetcher });
    return { handlers, deleted, assets: () => cachedAssets };
}

test("service worker caches exactly the public shell, never APIs, tokens or OSM tiles", async () => {
    const w = worker();
    let install;
    w.handlers.install({ waitUntil: value => { install = value; } });
    await install;
    const expected = ["./", ...assets.filter(name => name !== "sw.js")].map(name => new URL(name, "https://site.example/repo/").href);
    assert.deepEqual([...w.assets()].sort(), expected.sort());
    for (const [url, method, headers] of [
        ["https://site.example/api/qgis/status", "GET", {}], ["https://relay.example/v1/sessions/id", "GET", {}],
        ["https://tile.openstreetmap.org/2/1/1.png", "GET", {}], ["https://site.example/repo/index.html?token=secret", "GET", {}],
        ["https://site.example/repo/index.html", "POST", {}], ["https://site.example/repo/index.html", "GET", { Authorization: "Bearer secret" }]
    ]) {
        let intercepted = false;
        w.handlers.fetch({ request: { url, method, headers: new Headers(headers) }, respondWith: () => { intercepted = true; } });
        assert.equal(intercepted, false, url);
    }
});

test("offline shell works under a prefix and cleanup never deletes another app's caches", async () => {
    const w = worker();
    let response;
    w.handlers.fetch({ request: { method: "GET", url: "https://site.example/repo/index.html", headers: new Headers() }, respondWith: promise => { response = promise; } });
    assert.equal(await (await response).text(), "cached shell");
    let activated;
    w.handlers.activate({ waitUntil: value => { activated = value; } });
    await activated;
    assert.deepEqual(w.deleted, ["punto-shell:/repo/:old"]);
});

test("gateway HTTP failures fall back to the public shell without caching the error page", async () => {
    const w = worker(async () => new Response("Gateway unavailable", { status: 502 }));
    let response;
    w.handlers.fetch({ request: { method: "GET", url: "https://site.example/repo/index.html", headers: new Headers() }, respondWith: promise => { response = promise; } });
    assert.equal(await (await response).text(), "cached shell");
});
