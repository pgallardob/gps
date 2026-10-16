"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const NativeQgisClient = require("../js/qgis.js");
class QgisClient extends NativeQgisClient {
    constructor(fetcher) { super(fetcher, { hostname: "127.0.0.1", protocol: "http:" }); }
}
const token = "a".repeat(43);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("QGIS detection uses a same-origin GET without sending route data", async () => {
    const calls = [];
    const client = new QgisClient(async (path, options) => {
        calls.push({ path, options });
        return json({ available: false, reason: "not_installed", token });
    });
    assert.deepEqual(await client.check(), { available: false, reason: "not_installed" });
    assert.equal(calls[0].path, "/api/qgis/status");
    assert.equal(calls[0].options.body, undefined);
    assert.equal(calls[0].options.mode, "same-origin");
    assert.equal(calls[0].options.credentials, "omit");
    await assert.rejects(client.open({}, "geojson"), /not_installed/);
    assert.equal(calls.length, 1);
});

test("QGIS opens only an explicitly requested snapshot using the server token", async () => {
    const calls = [];
    const client = new QgisClient(async (path, options) => {
        calls.push({ path, options });
        return path.endsWith("status") ? json({ available: true, token }) : json({ opened: true, format: "gpx" }, 202);
    });
    await client.check();
    assert.equal(calls.length, 1);
    const snapshot = { type: "FeatureCollection", features: [] };
    await client.open(snapshot, "gpx");
    assert.equal(calls[1].options.method, "POST");
    assert.equal(calls[1].options.headers["X-Punto-Token"], token);
    assert.equal(calls[1].options.redirect, "error");
    assert.deepEqual(JSON.parse(calls[1].options.body), { data: snapshot, format: "gpx" });
});

test("QGIS rejects invalid capabilities and bounds status responses", async () => {
    for (const body of [{ available: true, token: "bad" }, { available: "true", token }, { available: true, token, extra: "x".repeat(5000) }]) {
        const client = new QgisClient(async () => json(body));
        await assert.rejects(client.check(), /local_server/);
        assert.equal(client.available, false);
    }
    const client = new QgisClient(async () => new Response("<html>Not this server</html>", { headers: { "Content-Type": "text/html" } }));
    await assert.rejects(client.check(), /local_server/);
});

test("QGIS does not automatically retry a rejected native launch", async () => {
    let posts = 0;
    const client = new QgisClient(async path => {
        if (path.endsWith("status")) return json({ available: true, token });
        posts++;
        return json({ error: "forbidden" }, 403);
    });
    await client.check();
    await assert.rejects(client.open({}, "geojson"), /forbidden/);
    assert.equal(posts, 1);
});

test("QGIS client rejects arbitrary file formats and oversized payloads before POST", async () => {
    let calls = 0;
    const client = new QgisClient(async () => { calls++; return json({ available: true, token }); });
    await client.check();
    await assert.rejects(client.open({}, "qgs"), /invalid_data/);
    await assert.rejects(client.open({ value: "x".repeat(4 * 1024 * 1024) }, "geojson"), /too_large/);
    assert.equal(calls, 1);
});

test("public and mobile deployments never probe the native API or localhost", async () => {
    let calls = 0;
    const client = new NativeQgisClient(async () => { calls++; }, { hostname: "example.github.io", protocol: "https:" });
    assert.deepEqual(await client.check(), { available: false, reason: "desktop_only" });
    assert.equal(calls, 0);
});
