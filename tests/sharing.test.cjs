"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharing = require("../js/sharing-client.js");
const Publisher = require("../js/share-publisher.js");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const token = "t".repeat(43), viewer = "v".repeat(43), stream = "p".repeat(43), id = "i".repeat(22);
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const view = { id, state: "pending", point: null, remainingSeconds: 900, expiresAt: "2026-10-16T20:00:00Z" };

test("invitation URLs work under a repository prefix and contain no viewer capability or phone", () => {
    const link = sharing.invitationLink("https://example.github.io/my-gps/index.html", id, token);
    const url = new URL(link);
    assert.equal(url.pathname, "/my-gps/share.html");
    assert.equal(url.search, "");
    assert.deepEqual(sharing.parseInvitation(url.hash), { id, token });
    assert.equal(sharing.parseInvitation("#invite=https://evil.invalid"), null);
    assert.ok(!link.includes(viewer));
});

test("phone numbers are normalized locally, not sent to a location lookup", () => {
    assert.equal(sharing.phoneNumber("+54 (911) 2345-6789"), "+5491123456789");
    for (const input of ["123", "+0123456789", "javascript:1", "+123abc4567"]) assert.throws(() => sharing.phoneNumber(input));
});

test("relay endpoint requires HTTPS except explicit loopback development", () => {
    assert.equal(sharing.apiBase("http://api.example.test", { hostname: "127.0.0.1" }), null);
    assert.equal(sharing.apiBase("http://127.0.0.1:8001", { hostname: "example.github.io" }), null);
    assert.equal(sharing.apiBase("https://user:pass@api.example.test"), null);
    assert.equal(sharing.apiBase("https://api.example.test/?key=x"), null);
    assert.equal(sharing.apiBase("https://api.example.test/#secret"), null);
    assert.equal(sharing.apiBase("http://127.0.0.1:8001", { hostname: "127.0.0.1" }).origin, "http://127.0.0.1:8001");
});

test("relay client uses bearer headers, excludes cookies and never places keys in URLs", async () => {
    const calls = [];
    const client = new sharing.Client("https://api.example.test/punto", async (url, options) => {
        calls.push({ url, options });
        return response({ ...view, inviteToken: token, viewerToken: viewer });
    });
    await client.create(token, 15);
    assert.equal(calls[0].url, "https://api.example.test/punto/v1/sessions");
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
    assert.equal(calls[0].options.credentials, "omit");
    assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.cache, "no-store");
    assert.deepEqual(JSON.parse(calls[0].options.body), { minutes: 15 });
});

test("relay client rejects malformed positions and bounded response bodies", async () => {
    const client = new sharing.Client("https://api.example.test", async () => response({ ...view, large: "x".repeat(17000) }));
    await assert.rejects(client.view(id, viewer), /invalid_response/);
    await assert.rejects(client.publish(id, stream, { latitude: Infinity, longitude: 0, accuracy: 5 }), /invalid_position/);
    assert.equal(sharing.validView({ ...view, id: [id] }), false);
    assert.equal(sharing.validView({ ...view, state: "active", point: { latitude: 91, longitude: 0, accuracy: 5, updatedAt: view.expiresAt } }), false);
});

function fixture(overrides = {}) {
    const calls = [];
    const fixes = [];
    const states = [];
    const timers = [];
    const client = {
        preview: async () => ({ ...view }),
        accept: async () => { calls.push("accept"); return { publisherToken: stream, remainingSeconds: 900 }; },
        publish: async () => { calls.push("publish"); return { accepted: true }; },
        revoke: async () => { calls.push("revoke"); return { stopped: true }; }
    };
    const publisher = new Publisher({ client, geolocation: { getCurrentPosition(success, error) { fixes.push({ success, error }); } },
        onState: state => states.push(state), setTimer: callback => { timers.push(callback); return timers.length; }, clearTimer: () => {}, now: () => 0, ...overrides });
    return { publisher, client, calls, fixes, states, timers };
}
const gps = { coords: { latitude: 40, longitude: -3, accuracy: 10 } };

test("loading an invitation never requests GPS; consent must be explicitly true", async () => {
    const f = fixture();
    await f.publisher.load({ id, token });
    await f.publisher.start(false);
    assert.equal(f.fixes.length, 0);
    assert.deepEqual(f.calls, []);
    assert.equal(f.states.at(-1), "consent_required");
});

test("publisher obtains user-authorized GPS before accepting and transmitting", async () => {
    const f = fixture();
    await f.publisher.load({ id, token });
    const pending = f.publisher.start(true);
    assert.deepEqual(f.calls, []);
    f.fixes[0].success(gps);
    await pending;
    assert.deepEqual(f.calls, ["accept", "publish"]);
    assert.equal(f.publisher.running, true);
    await f.publisher.stop();
    assert.equal(f.publisher.running, false);
    assert.equal(f.calls.at(-1), "revoke");
});

test("canceling a pending GPS fix cannot later accept or publish", async () => {
    const f = fixture();
    await f.publisher.load({ id, token });
    const pending = f.publisher.start(true);
    await f.publisher.stop();
    f.fixes[0].success(gps);
    await pending;
    assert.deepEqual(f.calls, ["revoke"]);
});

test("a late accepted capability is revoked when sharing was canceled", async () => {
    const f = fixture();
    let finish;
    f.client.accept = () => new Promise(resolve => { f.calls.push("accept"); finish = resolve; });
    await f.publisher.load({ id, token });
    const pending = f.publisher.start(true);
    f.fixes[0].success(gps);
    await Promise.resolve();
    await f.publisher.stop();
    finish({ publisherToken: stream, remainingSeconds: 900 });
    await pending;
    assert.equal(f.calls.filter(value => value === "publish").length, 0);
    assert.ok(f.calls.filter(value => value === "revoke").length >= 1);
});

test("denied GPS permission sends nothing and permits a deliberate retry", async () => {
    const f = fixture();
    await f.publisher.load({ id, token });
    const pending = f.publisher.start(true);
    f.fixes[0].error({ code: 1 });
    await pending;
    assert.deepEqual(f.calls, []);
    assert.equal(f.publisher.busy, false);
    assert.equal(f.states.at(-1), "permission");
});

test("hidden screens stop publishing instead of maintaining a background location feed", async () => {
    let hidden = false;
    const f = fixture({ hidden: () => hidden });
    await f.publisher.load({ id, token });
    const start = f.publisher.start(true);
    f.fixes[0].success(gps);
    await start;
    hidden = true;
    await f.publisher.tick();
    assert.equal(f.publisher.running, false);
    assert.equal(f.fixes.length, 1);
    assert.equal(f.calls.at(-1), "revoke");
});

test("default timer wrappers retain the native global receiver", () => {
    const originalSet = globalThis.setInterval;
    const originalClear = globalThis.clearInterval;
    try {
        globalThis.setInterval = function () { assert.equal(this, globalThis); return 7; };
        globalThis.clearInterval = function (timer) { assert.equal(this, globalThis); assert.equal(timer, 7); };
        const publisher = new Publisher({ client: {}, geolocation: null });
        const timer = publisher.setTimer(() => {}, 10000);
        publisher.clearTimer(timer);
    } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});

test("timer cleanup failure cannot keep transmission enabled or prevent revocation", async () => {
    const f = fixture({ clearTimer: () => { throw new Error("cleanup failure"); } });
    await f.publisher.load({ id, token });
    const start = f.publisher.start(true);
    f.fixes[0].success(gps);
    await start;
    await f.publisher.stop();
    assert.equal(f.publisher.running, false);
    assert.equal(f.calls.at(-1), "revoke");
});

test("a pending viewer read cannot resurrect a point after revocation starts", async () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/sharing.js"), "utf8"), { window, document: { hidden: false } });
    let finish;
    const entry = { id, token: viewer, state: "active", point: null, stopRequested: false };
    const state = { generation: 0, polling: false, entries: [entry],
        client: { view: () => new Promise(resolve => { finish = resolve; }) }, renderEntry: () => {}, renderLocations: () => {} };
    const pending = window.SharingPanel.prototype.poll.call(state);
    entry.stopRequested = true;
    finish({ ...view, state: "active", point: { latitude: 40, longitude: -3, accuracy: 5 } });
    await pending;
    assert.equal(entry.point, null);
});
