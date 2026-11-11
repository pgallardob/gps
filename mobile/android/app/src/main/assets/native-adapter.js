(function (root) {
    "use strict";

    function create(host) {
        let serial = 0, watch = null, once = null, hooks = {}, first = true, cursor = 0, count = 0;
        let importText = "";
        let importValid = false, frameText = "", frameValid = false;
        let lastCurrent = null, clearing = false;
        let copying = null;
        const send = data => {
            if (!host || typeof host.postMessage !== "function") throw new Error("Native adapter unavailable");
            host.postMessage(JSON.stringify(data));
        };
        const position = (point, nativeRecorded = false) => ({ nativeRecorded, timestamp: point[3], coords: { latitude: point[0], longitude: point[1], accuracy: point[2], speed: point[4] ?? null } });
        const api = {
            ready: false,
            createRoute(core, options) {
                return new (class extends core.Route {
                    add(point) {
                        if (!point.nativeRecorded) return super.add(point);
                        if (!core.validPoint(point) || point.accuracy > this.maxAccuracy) return "invalid";
                        if (this.pointCount >= this.maxPoints) return "limit";
                        // Native elapsed-time ordering and filtering are authoritative. Do not filter replay twice.
                        const segment = this.segments[this.segments.length - 1];
                        const previous = !this.pendingSegment && segment ? segment[segment.length - 1] : null;
                        const movement = previous ? core.distanceMeters(previous, point) : 0;
                        if (this.pendingSegment) { this.segments.push([]); this.pendingSegment = false; }
                        this.segments[this.segments.length - 1].push({ lat: point.lat, lon: point.lon, accuracy: point.accuracy,
                            timestamp: point.timestamp, speed: point.speed, source: "gps" });
                        this.distance += movement; this.pointCount++; this.lastTimestamp = point.timestamp;
                        return "added";
                    }
                })(options);
            },
            geolocation: {
                getCurrentPosition(success, error) {
                    once = { id: ++serial, success, error };
                    try { send({ type: "locate", id: once.id }); } catch { const pending = once; once = null; pending.error({ code: 2 }); }
                },
                watchPosition(success, error) {
                    watch = { id: ++serial, success, error };
                    cursor = count;
                    try { send({ type: "start", id: watch.id }); } catch { const pending = watch; watch = null; pending.error({ code: 2 }); }
                    return serial;
                },
                clearWatch(id) { if (watch?.id === id) { watch = null; send({ type: "stop" }); } }
            },
            bind(value) { hooks = value; api.ready = true; send({ type: "ready" }); },
            cancelLocate() { once = null; send({ type: "cancelLocate" }); },
            forget() { watch = once = null; cursor = count = 0; send({ type: "forget" }); },
            clearRoute() { clearing = true; send({ type: "clear" }); },
            tiles(enabled) { send({ type: "tiles", enabled }); },
            chooseFile() { send({ type: "import" }); },
            copy(text) {
                return new Promise((resolve, reject) => {
                    copying?.reject(new Error("Copy superseded"));
                    copying = { id: ++serial, resolve, reject };
                    try { send({ type: "copy", id: copying.id, text }); }
                    catch (error) { copying = null; reject(error); }
                });
            },
            exportFile(body, format) {
                if (typeof body !== "string" || body.length > 4 * 1024 * 1024 || !["geojson", "gpx"].includes(format)) throw new Error("Invalid export");
                send({ type: "exportBegin", format });
                for (let index = 0; index < body.length; index += 8000) send({ type: "exportPart", text: body.slice(index, index + 8000) });
                send({ type: "exportFinish" });
            },
            receive(data) {
                if (!data || typeof data !== "object") return;
                if (data.type === "copied" && copying?.id === data.id) {
                    const pending = copying; copying = null;
                    if (data.ok === true) pending.resolve(); else pending.reject(new Error("Copy unavailable"));
                    return;
                }
                if (data.type === "frameBegin") { frameText = ""; frameValid = true; return; }
                if (data.type === "framePart") {
                    if (frameValid && typeof data.text === "string" && frameText.length + data.text.length <= 4 * 1024 * 1024) frameText += data.text;
                    else frameValid = false;
                    return;
                }
                if (data.type === "frameFinish") {
                    const text = frameText, valid = frameValid; frameText = ""; frameValid = false;
                    if (valid) { try { api.receive(JSON.parse(text)); } catch { /* Invalid transport frames are ignored. */ } }
                    return;
                }
                if (data.type === "cleared") { cursor = count = 0; clearing = false; return; }
                if (data.type === "visibility") { hooks.visibility?.(data.visible); return; }
                if (data.type === "tileAccess") { hooks.tileAccess?.(data.enabled); return; }
                if (data.type === "notice") { hooks.notice?.(data.text); return; }
                if (data.type === "importBegin") { importText = ""; importValid = true; return; }
                if (data.type === "importPart") {
                    if (importValid && typeof data.text === "string" && importText.length + data.text.length <= 4 * 1024 * 1024) importText += data.text;
                    else importValid = false;
                    return;
                }
                if (data.type === "importFinish") { const text = importText, valid = importValid; importText = ""; importValid = false; if (valid) hooks.importFile?.(text); return; }
                if (data.type === "error") {
                    const pending = once?.id === data.id ? once : watch?.id === data.id ? watch : null;
                    if (pending === once) once = null;
                    if (pending === watch) watch = null;
                    pending?.error({ code: data.code });
                    return;
                }
                if (data.type === "position" && once?.id === data.id) {
                    const pending = once; once = null; pending.success(position(data.point)); return;
                }
                if (data.type !== "state" || !Array.isArray(data.segments) || clearing) return;
                const validPoint = value => Array.isArray(value) && value.length >= 4 && value.slice(0, 4).every(Number.isFinite) && Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180 && value[2] >= 0 && value[2] <= 20000000 && Math.abs(value[3]) <= 8640000000000000;
                if (data.segments.length > 10000 || !data.segments.every(segment => Array.isArray(segment) && segment.length > 0 && segment.every(validPoint)) || data.point && !validPoint(data.point)) return;
                count = data.segments.reduce((sum, segment) => sum + segment.length, 0);
                if (count > 10000) return;
                if (first) {
                    first = false; cursor = count;
                    lastCurrent = data.point?.[5] ?? data.point?.[3];
                    hooks.restore?.(data.segments, data.point, data.active, data.tiles);
                } else if (watch) {
                    if (count < cursor) cursor = 0;
                    let offset = 0;
                    for (const segment of data.segments) {
                        for (let index = 0; index < segment.length; index++, offset++) {
                            if (offset < cursor || !watch) continue;
                            if (index === 0) hooks.segment?.();
                            watch.success(position(segment[index], true));
                            lastCurrent = segment[index][5] ?? segment[index][3];
                        }
                    }
                    cursor = count;
                    const key = data.point?.[5] ?? data.point?.[3];
                    if (data.point && watch && key !== lastCurrent) { lastCurrent = key; watch.success(position(data.point)); }
                }
                hooks.visibility?.(data.visible);
                hooks.status?.(data);
                if (watch && data.watchId === watch.id && !data.active && !data.pending) hooks.stopped?.(data.message);
            }
        };
        return api;
    }
    if (typeof module === "object" && module.exports) module.exports = { create };
    else if (root.PuntoHost) {
        root.PuntoNative = create(root.PuntoHost);
        root.addEventListener("message", event => {
            if (event.source && event.source !== root) return;
            try { root.PuntoNative.receive(JSON.parse(event.data)); } catch { /* Ignore malformed local transport data. */ }
        });
    }
})(globalThis);
