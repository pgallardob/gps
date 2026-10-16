(function (root) {
    "use strict";

    class SessionClock {
        constructor(now = () => performance.now()) { this.now = now; this.reset(); }
        reset() { this.total = 0; this.started = null; }
        start() { if (this.started === null) this.started = this.now(); }
        pause() { if (this.started !== null) { this.total += Math.max(0, this.now() - this.started); this.started = null; } }
        get elapsed() { return this.total + (this.started === null ? 0 : Math.max(0, this.now() - this.started)); }
    }

    function formatDuration(milliseconds) {
        const seconds = Math.max(0, Math.floor(milliseconds / 1000));
        return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
    }

    function demoPosition(index, timestamp = Date.now()) {
        if (!Number.isInteger(index) || index < 0 || index >= 48) return null;
        const angle = index / 47 * Math.PI * 2;
        return { coords: { latitude: 40.4168 + Math.sin(angle) * .001, longitude: -3.7038 + Math.cos(angle) * .0014, accuracy: 5, speed: null }, timestamp };
    }

    const api = { SessionClock, formatDuration, demoPosition };
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.GPSSession = api;
})(globalThis);
