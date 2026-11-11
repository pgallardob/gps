"use strict";

const map = L.map("map", { minZoom: 2, maxZoom: 19 }).setView([20, 0], 2);
const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
const routeLayer = L.layerGroup().addTo(map);
let marker = null, accuracy = null, point = null, segments = [], follow = true;
// Only non-sensitive readiness/count flags are exposed for emulator verification.
window.PuntoMapState = { ready: true, hasPosition: false, routePoints: 0 };
map.on("dragstart", () => { follow = false; });

function validPair(pair) {
    return Array.isArray(pair) && pair.length === 2 && Number.isFinite(pair[0]) && Math.abs(pair[0]) <= 90 && Number.isFinite(pair[1]) && Math.abs(pair[1]) <= 180;
}
window.addEventListener("message", event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (!data || data.type !== "state" || !Array.isArray(data.segments) || data.segments.length > 10000) return;
    const count = data.segments.reduce((sum, segment) => sum + (Array.isArray(segment) ? segment.length : 10001), 0);
    if (count > 10000 || !data.segments.every(segment => segment.every(validPair))) return;
    if (data.tiles === true && !map.hasLayer(tiles)) tiles.addTo(map);
    if (data.tiles !== true && map.hasLayer(tiles)) map.removeLayer(tiles);
    segments = data.segments;
    routeLayer.clearLayers();
    segments.forEach(segment => { if (segment.length > 1) L.polyline(segment, { color: "#087f73", weight: 4 }).addTo(routeLayer); });
    const next = data.point;
    if (next && validPair([next.latitude, next.longitude]) && Number.isFinite(next.accuracy) && next.accuracy >= 0) {
        point = [next.latitude, next.longitude];
        if (!marker) {
            marker = L.circleMarker(point, { radius: 7, color: "white", weight: 2, fillColor: "#087f73", fillOpacity: 1 }).addTo(map);
            accuracy = L.circle(point, { color: "#087f73", weight: 1, fillOpacity: 0.12 }).addTo(map);
        }
        marker.setLatLng(point);
        marker.setStyle({ fillColor: data.fresh === true ? "#087f73" : "#666666" });
        accuracy.setLatLng(point).setRadius(Math.min(next.accuracy, 100000));
        if (data.center === true) follow = true;
        if (follow) map.setView(point, Math.max(map.getZoom(), 16), { animate: false });
        window.PuntoMapState.hasPosition = true;
    }
    window.PuntoMapState.routePoints = count;
    map.invalidateSize({ pan: false });
});
document.getElementById("center").addEventListener("click", () => {
    follow = true;
    if (point) map.setView(point, 16, { animate: false });
});
document.getElementById("route").addEventListener("click", () => {
    const points = [];
    segments.forEach(segment => segment.forEach(pair => points.push(pair)));
    if (points.length) { follow = false; map.fitBounds(L.latLngBounds(points), { padding: [20, 20], maxZoom: 17 }); }
});
