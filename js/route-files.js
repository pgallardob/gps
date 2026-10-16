(function (root) {
    "use strict";

    const MAX_BYTES = 4 * 1024 * 1024;
    const MAX_POINTS = 10000;
    const MAX_WAYPOINTS = 100;

    function cleanName(value) {
        if (typeof value !== "string" || value.length > 80) throw new Error("Invalid waypoint name");
        return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim() || "Punto sin nombre";
    }

    function parseGeoJSON(text) {
        if (typeof text !== "string" || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("File too large");
        const data = JSON.parse(text);
        if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length > MAX_POINTS + MAX_WAYPOINTS) throw new Error("Expected a FeatureCollection");
        const segments = [];
        const waypoints = [];
        let count = 0;
        const coordinate = value => {
            if (!Array.isArray(value) || value.length < 2 || value.length > 3 || !value.every(Number.isFinite) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error("Invalid coordinates");
            return { lat: value[1], lon: value[0] };
        };
        const segment = (values, properties) => {
            if (!Array.isArray(values) || !values.length || values.length > MAX_POINTS - count) throw new Error("Too many points");
            const timestamps = properties.timestamps;
            const accuracies = properties.accuracyMeters;
            if ((timestamps !== undefined && (!Array.isArray(timestamps) || timestamps.length !== values.length)) ||
                (accuracies !== undefined && (!Array.isArray(accuracies) || accuracies.length !== values.length))) throw new Error("Invalid point metadata");
            return values.map((value, index) => {
                count += 1;
                const rawTime = timestamps ? timestamps[index] : null;
                const timestamp = rawTime === null ? null : (typeof rawTime === "string" && /^\d{4}-\d{2}-\d{2}T/.test(rawTime) ? Date.parse(rawTime) : NaN);
                const accuracy = accuracies ? accuracies[index] : null;
                if ((timestamp !== null && !Number.isFinite(timestamp)) ||
                    (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 20000000))) throw new Error("Invalid point metadata");
                return { ...coordinate(value), timestamp, accuracy, speed: null, source: properties.source === "demo" ? "demo" : "import" };
            });
        };
        for (const feature of data.features) {
            if (!feature || feature.type !== "Feature" || !feature.geometry) throw new Error("Invalid feature");
            const geometry = feature.geometry;
            const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
            if (geometry.type === "Point" && properties.kind !== "route" && !Array.isArray(properties.timestamps)) {
                if (waypoints.length >= MAX_WAYPOINTS) throw new Error("Too many waypoints");
                waypoints.push({ ...coordinate(geometry.coordinates), name: cleanName(properties.name === undefined ? `Punto ${waypoints.length + 1}` : properties.name), source: properties.source === "demo" ? "demo" : "import" });
            } else if (geometry.type === "Point") segments.push(segment([geometry.coordinates], properties));
            else if (geometry.type === "LineString") segments.push(segment(geometry.coordinates, properties));
            else if (geometry.type === "MultiLineString") {
                if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length || geometry.coordinates.length > MAX_POINTS) throw new Error("Invalid segments");
                // Per-line timestamps are deliberately unsupported for this external geometry type.
                if (properties.timestamps !== undefined || properties.accuracyMeters !== undefined) throw new Error("Unsupported multiline metadata");
                for (const values of geometry.coordinates) segments.push(segment(values, properties));
            } else throw new Error("Unsupported geometry");
        }
        if (!count && !waypoints.length) throw new Error("Empty file");
        return { segments, waypoints };
    }

    function toGeoJSON(route, waypoints) {
        const data = route.toGeoJSON();
        data.metadata.waypointCount = waypoints.length;
        data.metadata.simulated = route.segments.some(segment => segment.some(point => point.source === "demo")) || waypoints.some(point => point.source === "demo");
        data.features.push(...waypoints.map(point => ({ type: "Feature", properties: { kind: "waypoint", name: point.name, source: point.source },
            geometry: { type: "Point", coordinates: [point.lon, point.lat] } })));
        return data;
    }

    function toGPX(route, waypoints) {
        const escape = text => String(text).replace(/[<>&'\"]/g, value => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[value]);
        const simulated = route.segments.some(segment => segment.some(point => point.source === "demo")) || waypoints.some(point => point.source === "demo");
        const name = simulated ? "Punto - DEMOSTRACIÓN (datos simulados)" : "Punto - recorrido local";
        const pins = waypoints.map(point => `<wpt lat="${point.lat}" lon="${point.lon}"><name>${escape(point.name)}</name></wpt>`).join("");
        const tracks = route.segments.map(segment => `<trkseg>${segment.map(point => `<trkpt lat="${point.lat}" lon="${point.lon}">${point.timestamp === null ? "" : `<time>${new Date(point.timestamp).toISOString()}</time>`}</trkpt>`).join("")}</trkseg>`).join("");
        return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Punto" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escape(name)}</name></metadata>${pins}<trk><name>${escape(name)}</name>${tracks}</trk></gpx>`;
    }

    const api = { MAX_BYTES, MAX_WAYPOINTS, cleanName, parseGeoJSON, toGeoJSON, toGPX };
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.RouteFiles = api;
})(globalThis);
