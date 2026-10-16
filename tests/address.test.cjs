"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const AddressLookup = require("../js/address.js");
const point = { lat: -34.6, lon: -58.4 };
const endpoint = "https://geocoding.example.test/reverse";
const response = value => new Response(JSON.stringify({ display_name: value }), { headers: { "Content-Type": "application/json" } });

test("address lookup is opt-in and never calls an unconfigured service", async () => {
    let calls = 0;
    const service = new AddressLookup({ fetcher: () => { calls++; } });
    assert.equal(service.enabled, false);
    await assert.rejects(service.lookup(point), /unconfigured/);
    assert.equal(calls, 0);
});

test("builds a correct reverse request and caches responses", async () => {
    const requests = [];
    const service = new AddressLookup({ endpoint, fetcher: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return response("Test address");
    } });
    assert.equal(await service.lookup(point), "Test address");
    assert.equal(await service.lookup(point), "Test address");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.searchParams.get("lat"), "-34.6");
    assert.equal(requests[0].url.searchParams.get("lon"), "-58.4");
    assert.equal(requests[0].url.searchParams.get("format"), "jsonv2");
    assert.equal(requests[0].options.headers.Accept, "application/json");
    assert.equal(requests[0].options.credentials, "omit");
    assert.equal(requests[0].options.redirect, "error");
    assert.ok(requests[0].options.signal instanceof AbortSignal);
    assert.equal(service.busy, false);
});

test("rate-limits different coordinates without blocking cached results", async () => {
    let now = 0;
    let calls = 0;
    const service = new AddressLookup({ endpoint, now: () => now, fetcher: async () => {
        calls++;
        return response("Address");
    } });
    await service.lookup(point);
    await assert.rejects(service.lookup({ lat: 1, lon: 1 }), /rate-limit/);
    assert.equal(await service.lookup(point), "Address");
    assert.equal(calls, 1);
    now = 1500;
    await service.lookup({ lat: 1, lon: 1 });
    assert.equal(calls, 2);
});

test("serializes requests instead of making overlapping service calls", async () => {
    let finish;
    const service = new AddressLookup({ endpoint, fetcher: () => new Promise(resolve => { finish = resolve; }) });
    const pending = service.lookup(point);
    assert.equal(service.busy, true);
    await assert.rejects(service.lookup({ lat: 1, lon: 1 }), /busy/);
    finish(response("Address"));
    await pending;
    assert.equal(service.busy, false);
});

test("HTTP and malformed responses do not get cached or leave the service busy", async () => {
    for (const result of [new Response(null, { status: 429 }), new Response("{}", { headers: { "Content-Type": "application/json" } }), response(" ")]) {
        const service = new AddressLookup({ endpoint, fetcher: async () => result });
        await assert.rejects(service.lookup(point));
        assert.equal(service.busy, false);
        assert.equal(service.cache.size, 0);
    }
});

test("rejects insecure, credentialed and prohibited public geocoder endpoints", () => {
    for (const value of ["http://example.test/reverse", "https://u:p@example.test/reverse", "javascript:alert(1)",
        "https://nominatim.openstreetmap.org/reverse", "https://nominatim.openstreetmap.org./reverse", "https://example.test/#secret"]) {
        assert.equal(new AddressLookup({ endpoint: value }).enabled, false, value);
    }
    assert.equal(new AddressLookup({ endpoint: "http://127.0.0.1:9090/reverse" }).enabled, true);
});

test("validates coordinates before sending any location data", async () => {
    let calls = 0;
    const service = new AddressLookup({ endpoint, fetcher: async () => { calls++; return response("Address"); } });
    for (const value of [null, { lat: NaN, lon: 0 }, { lat: 91, lon: 0 }, { lat: 0, lon: "0" }]) {
        await assert.rejects(service.lookup(value), /coordinates/);
    }
    assert.equal(calls, 0);
});

test("bounds streamed response size even when Content-Length is absent or false", async () => {
    const service = new AddressLookup({ endpoint, fetcher: async () => new Response(JSON.stringify({ display_name: "x".repeat(70000) }),
        { headers: { "Content-Type": "application/json", "Content-Length": "1" } }) });
    await assert.rejects(service.lookup(point), /response-size/);
    assert.equal(service.busy, false);
    assert.equal(service.cache.size, 0);
});

test("rejects HTML responses and overlong address strings", async () => {
    for (const result of [new Response("<html>bad</html>", { headers: { "Content-Type": "text/html" } }), response("x".repeat(5000))]) {
        const service = new AddressLookup({ endpoint, fetcher: async () => result });
        await assert.rejects(service.lookup(point));
        assert.equal(service.cache.size, 0);
    }
});

test("clearing aborts pending requests and prevents late responses from restoring private data", async () => {
    let finish;
    let signal;
    const service = new AddressLookup({ endpoint, fetcher: (url, options) => {
        signal = options.signal;
        return new Promise(resolve => { finish = resolve; });
    } });
    const pending = service.lookup(point);
    service.clear();
    assert.equal(signal.aborted, true);
    finish(response("Late private address"));
    await assert.rejects(pending, /canceled/);
    assert.equal(service.cache.size, 0);
    assert.equal(service.busy, false);
});
