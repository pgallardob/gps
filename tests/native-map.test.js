"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function renderer() {
    const callbacks = {}, controls = {}, layers = new Set(), lines = [];
    const map = {
        setView() { return this; }, on(name, callback) { callbacks[name] = callback; },
        hasLayer(layer) { return layers.has(layer); }, removeLayer(layer) { layers.delete(layer); },
        getZoom() { return 16; }, invalidateSize() {}, fitBounds() {}
    };
    const layer = () => ({
        addTo() { layers.add(this); return this; }, clearLayers() { lines.length = 0; },
        setLatLng() { return this; }, setRadius() { return this; }, setStyle() { return this; }
    });
    const window = { addEventListener(name, callback) { callbacks[name] = callback; } };
    const context = vm.createContext({
        window, document: { getElementById(id) { return { addEventListener(name, callback) { controls[id] = callback; } }; } },
        L: { map: () => map, tileLayer: layer, layerGroup: layer, circleMarker: layer, circle: layer,
            polyline(points) { lines.push(points); return layer(); }, latLngBounds: points => points }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../mobile/android/app/src/main/assets/map.js"), "utf8"), context);
    return { window, lines, layers, controls, send: state => callbacks.message({ data: JSON.stringify(state) }) };
}

test("native map renders a point and segmented route without browser GPS or a native command bridge", () => {
    const view = renderer();
    view.send({ type: "state", point: { latitude: 0, longitude: 0, accuracy: 10 }, fresh: true,
        segments: [[[0, 0], [0.001, 0]], [[1, 1], [1.001, 1]]], tiles: false });
    assert.equal(view.window.PuntoMapState.hasPosition, true);
    assert.equal(view.window.PuntoMapState.routePoints, 4);
    assert.equal(view.lines.length, 2);
    view.controls.center();
    view.controls.route();
});

test("native map ignores malformed and oversized route messages", () => {
    const view = renderer();
    for (const segments of [null, [null], [["not a coordinate"]], [[[91, 0]]], [Array(10001).fill([0, 0])]]) {
        assert.doesNotThrow(() => view.send({ type: "state", segments }));
        assert.equal(view.window.PuntoMapState.routePoints, 0);
    }
    view.send({ type: "other", segments: [[[0, 0]]] });
    assert.equal(view.window.PuntoMapState.hasPosition, false);
});

test("native map removes the external layer when tiles are paused", () => {
    const view = renderer();
    const before = view.layers.size;
    view.send({ type: "state", segments: [], tiles: true });
    assert.equal(view.layers.size, before + 1);
    view.send({ type: "state", segments: [], tiles: false });
    assert.equal(view.layers.size, before);
});
