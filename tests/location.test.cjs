"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const LocationTracker = require("../js/location.js");

function fixture(overrides = {}) {
    const watches = [];
    const singles = [];
    const cleared = [];
    const states = [];
    const positions = [];
    const geolocation = {
        watchPosition(success, error, options) { watches.push({ success, error, options }); return watches.length - 1; },
        clearWatch(id) { cleared.push(id); },
        getCurrentPosition(success, error) { singles.push({ success, error }); }
    };
    const tracker = new LocationTracker({
        geolocation, options: { enableHighAccuracy: true },
        onPosition: value => positions.push(value), onState: (state, reason) => states.push({ state, reason }),
        ...overrides
    });
    return { tracker, watches, singles, cleared, states, positions, geolocation };
}

test("does not request GPS until explicitly started", () => {
    const f = fixture();
    assert.equal(f.tracker.state, "idle");
    assert.equal(f.watches.length + f.singles.length, 0);
});

test("prevents duplicate watches and clears a watch with ID zero", () => {
    const f = fixture();
    f.tracker.start();
    f.tracker.start();
    f.tracker.locate();
    assert.equal(f.watches.length, 1);
    assert.equal(f.singles.length, 0);
    assert.deepEqual(f.watches[0].options, { enableHighAccuracy: true });
    f.tracker.stop();
    assert.deepEqual(f.cleared, [0]);
    assert.equal(f.tracker.state, "paused");
});

test("ignores callbacks from stopped and superseded watches", () => {
    const f = fixture();
    f.tracker.start();
    f.tracker.stop();
    f.tracker.start();
    f.watches[0].success("old position");
    f.watches[0].error({ code: 1 });
    f.watches[1].success("new position");
    assert.deepEqual(f.positions, ["new position"]);
    assert.equal(f.tracker.state, "tracking");
});

test("one-shot location finishes without starting a route watch", () => {
    const f = fixture();
    f.tracker.locate();
    f.tracker.locate();
    f.tracker.start();
    assert.equal(f.singles.length, 1);
    assert.equal(f.watches.length, 0);
    f.singles[0].success("position");
    assert.deepEqual(f.positions, ["position"]);
    assert.equal(f.tracker.state, "ready");
    f.singles[0].success("duplicate");
    assert.deepEqual(f.positions, ["position"]);
});

test("canceled one-shot requests cannot overwrite a newer session", () => {
    const f = fixture();
    f.tracker.locate();
    f.tracker.stop();
    f.singles[0].success("late position");
    f.singles[0].error({ code: 1 });
    assert.deepEqual(f.positions, []);
    assert.equal(f.tracker.state, "paused");
});

for (const [code, reason] of [[1, "permission"], [2, "unavailable"], [3, "timeout"], [999, "unknown"]]) {
    test(`GPS error ${code} clears tracking and preserves the ${reason} error state`, () => {
        const f = fixture();
        f.tracker.start();
        f.watches[0].error({ code });
        assert.deepEqual(f.cleared, [0]);
        assert.deepEqual(f.states.at(-1), { state: "error", reason });
        assert.equal(f.tracker.watchId, null);
        f.watches[0].success("late");
        assert.deepEqual(f.positions, []);
    });
}

test("reports insecure origins and unsupported browsers without requesting GPS", () => {
    const insecure = fixture({ secure: false });
    insecure.tracker.start();
    assert.deepEqual(insecure.states.at(-1), { state: "error", reason: "insecure" });
    assert.equal(insecure.watches.length, 0);
    const unsupported = fixture({ geolocation: null });
    unsupported.tracker.locate();
    assert.deepEqual(unsupported.states.at(-1), { state: "error", reason: "unsupported" });
});

test("recovers from synchronous browser exceptions and can retry", () => {
    const f = fixture();
    const original = f.geolocation.watchPosition;
    f.geolocation.watchPosition = () => { throw new Error("Browser error"); };
    f.tracker.start();
    assert.equal(f.tracker.state, "error");
    f.geolocation.watchPosition = original;
    f.tracker.start();
    assert.equal(f.tracker.state, "tracking");
    assert.equal(f.watches.length, 1);
});

test("invalid positions stay errors instead of being overwritten by a ready state", () => {
    const f = fixture({ onPosition: () => false });
    f.tracker.locate();
    f.singles[0].success("invalid");
    assert.deepEqual(f.states.at(-1), { state: "error", reason: "invalid" });
    f.tracker.start();
    f.watches[0].success("invalid");
    assert.deepEqual(f.states.at(-1), { state: "error", reason: "invalid" });
    assert.deepEqual(f.cleared, [0]);
});

test("even synchronous mock callbacks cannot leave an orphaned watch", () => {
    const f = fixture();
    f.geolocation.watchPosition = (success, error) => { error({ code: 1 }); return 42; };
    f.tracker.start();
    assert.equal(f.tracker.state, "error");
    assert.equal(f.tracker.watchId, null);
    assert.deepEqual(f.cleared, [42]);
});
