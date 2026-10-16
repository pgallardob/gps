(function (root) {
    "use strict";

    function distanceMeters(a, b) {
        const radians = Math.PI / 180;
        const dLat = (b.lat - a.lat) * radians;
        const dLon = (b.lon - a.lon) * radians;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
        return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
    }

    function toPoint(position) {
        const coords = position && position.coords;
        if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) ||
            Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180 ||
            !Number.isFinite(coords.accuracy) || coords.accuracy < 0 || coords.accuracy > 20000000 ||
            (Number.isFinite(position.timestamp) && Math.abs(position.timestamp) > 8640000000000000)) {
            throw new Error("Invalid geolocation coordinates");
        }
        return {
            lat: coords.latitude,
            lon: coords.longitude,
            accuracy: coords.accuracy,
            speed: Number.isFinite(coords.speed) && coords.speed >= 0 && coords.speed <= 1000 ? coords.speed * 3.6 : null,
            timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now()
        };
    }

    function validPoint(point, optional = false) {
        return !!point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
            Number.isFinite(point.lon) && Math.abs(point.lon) <= 180 &&
            ((optional && point.accuracy === null) || (Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 20000000)) &&
            ((optional && point.timestamp === null) || (Number.isFinite(point.timestamp) && Math.abs(point.timestamp) <= 8640000000000000));
    }

    function copyPoint(point) {
        return { lat: point.lat, lon: point.lon, accuracy: point.accuracy, timestamp: point.timestamp,
            speed: Number.isFinite(point.speed) && point.speed >= 0 && point.speed <= 3600 ? point.speed : null,
            source: ["gps", "demo", "import"].includes(point.source) ? point.source : "gps" };
    }

    class Route {
        constructor({ minDistance = 5, maxAccuracy = 100, maxPoints = 10000 } = {}) {
            if (!Number.isFinite(minDistance) || minDistance < 0 || !Number.isFinite(maxAccuracy) || maxAccuracy < 0 ||
                !Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 10000) throw new Error("Invalid route limits");
            this.minDistance = minDistance;
            this.maxAccuracy = maxAccuracy;
            this.maxPoints = maxPoints;
            this.clear();
        }

        clear() {
            this.segments = [];
            this.distance = 0;
            this.pointCount = 0;
            this.pendingSegment = true;
            this.lastTimestamp = -Infinity;
        }

        startSegment() {
            this.pendingSegment = true;
        }

        add(point) {
            if (!validPoint(point)) return "invalid";
            if (point.accuracy > this.maxAccuracy) return "inaccurate";
            if (point.timestamp <= this.lastTimestamp) return "stale";
            if (this.pointCount >= this.maxPoints) return "limit";

            const segment = this.segments[this.segments.length - 1];
            const previous = !this.pendingSegment && segment ? segment[segment.length - 1] : null;
            const distance = previous ? distanceMeters(previous, point) : 0;
            if (previous && distance < this.minDistance) return "stationary";

            if (this.pendingSegment) {
                this.segments.push([]);
                this.pendingSegment = false;
            }
            this.segments[this.segments.length - 1].push(copyPoint(point));
            this.distance += distance;
            this.pointCount += 1;
            this.lastTimestamp = point.timestamp;
            return "added";
        }

        replace(segments) {
            if (!Array.isArray(segments) || segments.length > this.maxPoints) throw new Error("Invalid route");
            let count = 0;
            let distance = 0;
            const copy = segments.map(segment => {
                if (!Array.isArray(segment) || !segment.length || segment.length > this.maxPoints) throw new Error("Invalid segment");
                return segment.map((point, index) => {
                    if (++count > this.maxPoints || !validPoint(point, true)) throw new Error("Invalid route point");
                    if (index) distance += distanceMeters(segment[index - 1], point);
                    return copyPoint(point);
                });
            });
            this.clear();
            this.segments = copy;
            this.pointCount = count;
            this.distance = distance;
        }

        toGeoJSON() {
            return {
                type: "FeatureCollection",
                metadata: { distanceMeters: Math.round(this.distance), pointCount: this.pointCount },
                features: this.segments.map((segment, index) => ({
                    type: "Feature",
                    properties: {
                        kind: "route",
                        segment: index + 1,
                        source: segment[0].source || "gps",
                        timestamps: segment.map(point => point.timestamp === null ? null : new Date(point.timestamp).toISOString()),
                        accuracyMeters: segment.map(point => point.accuracy)
                    },
                    geometry: segment.length === 1
                        ? { type: "Point", coordinates: [segment[0].lon, segment[0].lat] }
                        : { type: "LineString", coordinates: segment.map(point => [point.lon, point.lat]) }
                }))
            };
        }
    }

    const api = { distanceMeters, toPoint, validPoint, Route };
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.GPSCore = api;
})(globalThis);
