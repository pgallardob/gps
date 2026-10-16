(function (root) {
    "use strict";

    class GPSMap {
        constructor(config, { onTileState, onUserMove, onPick = () => {} }) {
            if (!root.L) throw new Error("Leaflet is unavailable");
            this.config = config;
            this.map = L.map("map", { zoomControl: false }).setView(config.initialCenter, config.initialZoom);
            L.control.zoom({ position: "bottomright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" }).addTo(this.map);
            L.control.scale({ imperial: false, position: "bottomleft" }).addTo(this.map);
            this.tiles = L.tileLayer(config.tileUrl, {
                attribution: config.tileAttribution, maxZoom: 19, minZoom: 2
            });
            this.tilesEnabled = true;
            let failed = false;
            this.tiles.on("loading", () => { if (this.tilesEnabled) { failed = false; onTileState("loading"); } });
            this.tiles.on("tileerror", () => { if (this.tilesEnabled) { failed = true; onTileState("error"); } });
            this.tiles.on("load", () => { if (this.tilesEnabled) onTileState(failed ? "error" : "ready"); });
            this.tiles.addTo(this.map);
            this.route = L.polyline([], { color: "#087f73", weight: 4, opacity: .85 }).addTo(this.map);
            this.marker = null;
            this.accuracy = null;
            this.waypoints = L.layerGroup().addTo(this.map);
            this.sharedLocations = L.layerGroup().addTo(this.map);
            this.map.on("dragstart", onUserMove);
            this.map.on("click", event => onPick({ lat: event.latlng.lat, lon: ((event.latlng.lng + 180) % 360 + 360) % 360 - 180 }));
            this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
            this.resizeObserver.observe(document.getElementById("map"));
        }

        updatePosition(point, center) {
            const location = [point.lat, point.lon];
            const firstPosition = !this.marker;
            if (!this.marker) {
                this.accuracy = L.circle(location, {
                    radius: point.accuracy, color: "#087f73", weight: 1,
                    opacity: .3, fillColor: "#087f73", fillOpacity: .1, interactive: false
                }).addTo(this.map);
                this.marker = L.circleMarker(location, {
                    radius: 8, color: "white", weight: 3, fillColor: "#087f73", fillOpacity: 1
                }).addTo(this.map).bindPopup("Tu ubicación actual");
            } else {
                this.marker.setLatLng(location);
                this.accuracy.setLatLng(location).setRadius(point.accuracy);
            }
            if (center) this.map.setView(location, firstPosition ? this.config.locationZoom : this.map.getZoom(), { animate: false });
        }

        center(point) {
            this.map.setView([point.lat, point.lon], Math.max(this.map.getZoom(), this.config.locationZoom), { animate: false });
        }

        drawRoute(segments) {
            this.route.setLatLngs(segments.map(segment => segment.map(point => [point.lat, point.lon])));
        }

        fitRoute(segments) {
            const points = segments.flat().map(point => [point.lat, point.lon]);
            if (points.length) this.map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16, animate: false });
        }

        drawWaypoints(points) {
            this.waypoints.clearLayers();
            for (const point of points) {
                const label = document.createElement("span");
                label.textContent = point.name;
                L.circleMarker([point.lat, point.lon], { radius: 7, color: "white", weight: 2, fillColor: "#b76c24", fillOpacity: 1 })
                    .bindPopup(label).addTo(this.waypoints);
            }
        }

        setTilesEnabled(enabled) {
            this.tilesEnabled = enabled;
            if (enabled) this.tiles.addTo(this.map);
            else this.tiles.remove();
        }

        drawSharedLocations(entries) {
            this.sharedLocations.clearLayers();
            for (const entry of entries) {
                const point = entry.point;
                if (!point || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
                    !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 || !Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 20000000) continue;
                const label = document.createElement("span");
                label.textContent = `${entry.label} · compartido con permiso · precisión ±${Math.round(point.accuracy)} m`;
                L.circle([point.latitude, point.longitude], { radius: point.accuracy, color: "#6854a2", weight: 1, fillOpacity: .08, interactive: false }).addTo(this.sharedLocations);
                L.circleMarker([point.latitude, point.longitude], { radius: 9, color: "white", weight: 3, fillColor: "#6854a2", fillOpacity: 1 })
                    .bindPopup(label).addTo(this.sharedLocations);
            }
        }

        reset() {
            if (this.marker) this.marker.remove();
            if (this.accuracy) this.accuracy.remove();
            this.marker = this.accuracy = null;
            this.route.setLatLngs([]);
            this.waypoints.clearLayers();
            this.map.setView(this.config.initialCenter, this.config.initialZoom, { animate: false });
        }

        retry() { if (this.tilesEnabled) this.tiles.redraw(); }
    }

    root.GPSMap = GPSMap;
})(window);
