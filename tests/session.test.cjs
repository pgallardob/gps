"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SessionClock, formatDuration, demoPosition } = require("../js/session.js");
const { toPoint } = require("../js/geo.js");

test("session clock counts active time only, including a zero start timestamp", () => {
    let now = 0;
    const clock = new SessionClock(() => now);
    clock.start();
    now = 2000;
    clock.start();
    clock.pause();
    now = 10000;
    assert.equal(clock.elapsed, 2000);
    clock.start();
    now = 12000;
    assert.equal(clock.elapsed, 4000);
    clock.pause();
    clock.reset();
    assert.equal(clock.elapsed, 0);
});

test("duration formatting is stable at hour boundaries", () => {
    assert.equal(formatDuration(0), "00:00:00");
    assert.equal(formatDuration(3661000), "01:01:01");
    assert.equal(formatDuration(-1000), "00:00:00");
});

test("demo positions are deterministic, valid, finite and bounded to 48 points", () => {
    assert.deepEqual(demoPosition(0, 1000), demoPosition(0, 1000));
    for (let index = 0; index < 48; index++) assert.ok(Number.isFinite(toPoint(demoPosition(index, 1000)).lat));
    for (const index of [-1, 48, NaN, 1.5]) assert.equal(demoPosition(index), null);
});
