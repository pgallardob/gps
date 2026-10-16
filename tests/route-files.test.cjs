"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Route } = require("../js/geo.js");
const files = require("../js/route-files.js");
const feature = (type, coordinates, properties = {}) => ({ type: "Feature", properties, geometry: { type, coordinates } });
const text = features => JSON.stringify({ type: "FeatureCollection", features });
const point = (lon, timestamp) => ({ lat: 40, lon, accuracy: 10, timestamp, source: "gps" });

test("round-trips route segments and waypoints without merging paused sections", () => {
    const route = new Route();
    route.add(point(-3, 1000));
    route.add(point(-3.001, 2000));
    route.startSegment();
    route.add(point(-3.1, 3000));
    const document = files.toGeoJSON(route, [{ lat: 40, lon: -3, name: "Start", source: "gps" }]);
    const parsed = files.parseGeoJSON(JSON.stringify(document));
    const imported = new Route();
    imported.replace(parsed.segments);
    assert.equal(imported.pointCount, 3);
    assert.equal(imported.segments.length, 2);
    assert.ok(Math.abs(imported.distance - route.distance) < .001);
    assert.equal(parsed.waypoints[0].name, "Start");
    assert.equal(document.metadata.waypointCount, 1);
});

test("imports external multiline geometry and keeps unknown accuracy/time unknown", () => {
    const parsed = files.parseGeoJSON(text([feature("MultiLineString", [[[0, 0], [1, 0]], [[5, 5], [6, 5]]])]));
    assert.equal(parsed.segments.length, 2);
    assert.equal(parsed.segments[0][0].accuracy, null);
    assert.equal(parsed.segments[0][0].timestamp, null);
    const route = new Route();
    route.replace(parsed.segments);
    assert.equal(route.toGeoJSON().features[0].properties.timestamps[0], null);
    assert.doesNotMatch(files.toGPX(route, []), /<time>/);
});

test("rejects malformed, non-finite, out-of-range, and unsupported geometry", () => {
    for (const input of ["null", "{}", "not JSON", text([]), text([feature("Polygon", [])]),
        text([feature("LineString", [[0, 91], [0, 0]])]), text([feature("Point", [181, 0])]),
        text([feature("Point", ["0", 0])]), text([feature("Point", [null, 0])]),
        text([feature("Point", [0, 0, 0, 0])]), text([feature("LineString", [])])]) {
        assert.throws(() => files.parseGeoJSON(input));
    }
});

test("limits file bytes, route points and waypoint counts", () => {
    assert.throws(() => files.parseGeoJSON(" ".repeat(files.MAX_BYTES + 1)), /large/);
    assert.throws(() => files.parseGeoJSON("😊".repeat(files.MAX_BYTES / 4 + 1)), /large/);
    assert.throws(() => files.parseGeoJSON(text([feature("LineString", Array.from({ length: 10001 }, () => [0, 0]))])), /points/);
    assert.throws(() => files.parseGeoJSON(text(Array.from({ length: 101 }, () => feature("Point", [0, 0])))), /waypoints/);
});

test("rejects invalid timestamps and metadata instead of creating bogus dates", () => {
    for (const properties of [{ timestamps: ["bad"] }, { timestamps: [] }, { accuracyMeters: [-1] }, { accuracyMeters: ["5"] }]) {
        assert.throws(() => files.parseGeoJSON(text([feature("Point", [0, 0], { kind: "route", ...properties })])));
    }
});

test("treats hostile names as data and strips invisible control/bidi characters", () => {
    const name = '<img src=x onerror="alert(1)">';
    const parsed = files.parseGeoJSON(text([feature("Point", [0, 0], { name })]));
    assert.equal(parsed.waypoints[0].name, name);
    assert.equal(files.cleanName("A\u202eB\u0000"), "AB");
    assert.throws(() => files.cleanName("x".repeat(81)));
    const xml = files.toGPX(new Route(), parsed.waypoints);
    assert.match(xml, /&lt;img/);
    assert.doesNotMatch(xml, /<img/);
});

test("ignores arbitrary GeoJSON properties without prototype pollution", () => {
    const input = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"__proto__":{"polluted":true},"name":"safe","popupContent":"<script>alert(1)</script>"},"geometry":{"type":"Point","coordinates":[0,0]}}]}';
    const parsed = files.parseGeoJSON(input);
    assert.equal({}.polluted, undefined);
    assert.equal(parsed.waypoints[0].popupContent, undefined);
});

test("flags demonstration data in both export formats, including waypoint-only sessions", () => {
    const route = new Route();
    route.add({ ...point(0, 1000), source: "demo" });
    assert.equal(files.toGeoJSON(route, []).metadata.simulated, true);
    assert.match(files.toGPX(route, []), /DEMOSTRACIÓN/);
    assert.equal(files.toGeoJSON(new Route(), [{ lat: 0, lon: 0, name: "demo", source: "demo" }]).metadata.simulated, true);
});

test("route replacement validates atomically and never destroys the previous route on error", () => {
    const route = new Route();
    route.add(point(0, 1000));
    assert.throws(() => route.replace([[{ ...point(1, 2000), lat: Infinity }]]));
    assert.equal(route.pointCount, 1);
    assert.equal(route.segments[0][0].lon, 0);
    assert.equal(route.add({ ...point(0, 3000), lat: NaN }), "invalid");
});
