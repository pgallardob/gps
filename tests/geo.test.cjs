"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { distanceMeters, toPoint, Route } = require("../js/geo.js");
const point = (lon, timestamp, accuracy = 10) => ({ lat: 0, lon, accuracy, speed: null, timestamp });

test("normalizes coordinates, speed in km/h, and zero values", () => {
    const position = { coords: { latitude: 0, longitude: 0, accuracy: 0, speed: 2 }, timestamp: 1000 };
    assert.deepEqual(toPoint(position), { lat: 0, lon: 0, accuracy: 0, speed: 7.2, timestamp: 1000 });
    position.coords.speed = 0;
    assert.equal(toPoint(position).speed, 0);
    position.coords.speed = null;
    assert.equal(toPoint(position).speed, null);
    position.coords.speed = -1;
    assert.equal(toPoint(position).speed, null);
});

test("rejects invalid GPS coordinates instead of plotting bogus data", () => {
    for (const coords of [null, {}, { latitude: 91, longitude: 0, accuracy: 5 },
        { latitude: 0, longitude: 181, accuracy: 5 }, { latitude: NaN, longitude: 0, accuracy: 5 },
        { latitude: "0", longitude: 0, accuracy: 5 }, { latitude: 0, longitude: 0, accuracy: -1 }]) {
        assert.throws(() => toPoint({ coords }), /Invalid geolocation/);
    }
});

test("calculates great-circle distance, including antimeridian and antipodes", () => {
    assert.equal(distanceMeters(point(0), point(0)), 0);
    assert.ok(Math.abs(distanceMeters(point(0), point(1)) - 111194.93) < 1);
    assert.ok(Math.abs(distanceMeters(point(179), point(-179)) - 222389.85) < 1);
    assert.ok(Number.isFinite(distanceMeters({ lat: 90, lon: 0 }, { lat: -90, lon: 180 })));
});

test("rejects timestamps outside the JavaScript date range", () => {
    assert.throws(() => toPoint({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: 1e20 }), /Invalid geolocation/);
});

test("bounds absurd GPS accuracy and speed before rendering map geometry", () => {
    assert.throws(() => toPoint({ coords: { latitude: 0, longitude: 0, accuracy: 1e308 }, timestamp: 1000 }));
    assert.equal(toPoint({ coords: { latitude: 0, longitude: 0, accuracy: 10, speed: 1e308 }, timestamp: 1000 }).speed, null);
});

test("filters inaccurate, stationary, and out-of-order points", () => {
    const route = new Route();
    assert.equal(route.add(point(0, 1000, 101)), "inaccurate");
    assert.equal(route.add(point(0, 1000)), "added");
    assert.equal(route.add(point(0.000001, 2000)), "stationary");
    assert.equal(route.add(point(0.001, 999)), "stale");
    assert.equal(route.add(point(0.001, 1000)), "stale");
    assert.equal(route.add(point(0.001, 3000)), "added");
    assert.equal(route.pointCount, 2);
    assert.ok(Math.abs(route.distance - 111.195) < 0.01);
});

test("does not connect or count the distance traveled while tracking is paused", () => {
    const route = new Route();
    route.add(point(0, 1000));
    route.add(point(0.001, 2000));
    const firstDistance = route.distance;
    route.startSegment();
    route.startSegment();
    route.add(point(20, 3000));
    assert.equal(route.distance, firstDistance);
    route.add(point(20.001, 4000));
    assert.equal(route.segments.length, 2);
    assert.equal(route.pointCount, 4);
    assert.ok(Math.abs(route.distance - 2 * firstDistance) < 0.001);
});

test("exports valid GeoJSON with longitude first and independent paused segments", () => {
    const route = new Route();
    route.add({ ...point(-58.4, 1000), lat: -34.6 });
    route.add({ ...point(-58.401, 2000), lat: -34.6 });
    route.startSegment();
    route.add({ ...point(-58.5, 3000), lat: -34.7 });
    const data = route.toGeoJSON();
    assert.equal(data.type, "FeatureCollection");
    assert.equal(data.features.length, 2);
    assert.deepEqual(data.features[0].geometry, { type: "LineString", coordinates: [[-58.4, -34.6], [-58.401, -34.6]] });
    assert.deepEqual(data.features[1].geometry, { type: "Point", coordinates: [-58.5, -34.7] });
    assert.equal(data.features[1].properties.timestamps[0], new Date(3000).toISOString());
    assert.equal(data.metadata.pointCount, 3);
});

test("protects accepted points from later mutation and honors route limits", () => {
    const route = new Route({ maxPoints: 1 });
    const input = point(1, 1000);
    route.add(input);
    input.lon = 50;
    assert.equal(route.segments[0][0].lon, 1);
    assert.equal(route.add(point(2, 2000)), "limit");
    assert.equal(route.pointCount, 1);
});

test("clear resets points, segments, distance, and timestamp filtering", () => {
    const route = new Route();
    route.add(point(0, 5000));
    route.add(point(1, 6000));
    route.clear();
    assert.equal(route.distance, 0);
    assert.equal(route.pointCount, 0);
    assert.deepEqual(route.toGeoJSON().features, []);
    assert.equal(route.add(point(0, 1000)), "added");
    assert.equal(route.segments.length, 1);
});
