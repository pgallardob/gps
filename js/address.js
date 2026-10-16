(function (root) {
    "use strict";

    function validEndpoint(endpoint) {
        try {
            const url = new URL(endpoint);
            const host = url.hostname.toLowerCase().replace(/\.$/, "");
            return !url.username && !url.password && !url.hash && host !== "nominatim.openstreetmap.org" &&
                (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(host)));
        } catch { return false; }
    }

    async function boundedJSON(response) {
        const limit = 65536;
        if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get("content-type") || "")) throw new Error("content-type");
        if (Number(response.headers.get("content-length")) > limit || !response.body) throw new Error("response-size");
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > limit) { await reader.cancel(); throw new Error("response-size"); }
                chunks.push(value);
            }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }

    class AddressLookup {
        constructor({ endpoint = "", minInterval = 1500, fetcher = (...args) => root.fetch(...args), now = () => root.performance.now() } = {}) {
            this.endpoint = endpoint;
            this.minInterval = Number.isFinite(minInterval) ? Math.max(1000, minInterval) : 1500;
            this.fetcher = fetcher;
            this.now = now;
            this.cache = new Map();
            this.lastRequest = -Infinity;
            this.busy = false;
            this.version = 0;
            this.controller = null;
        }

        get enabled() { return validEndpoint(this.endpoint); }

        clear() {
            this.version += 1;
            if (this.controller) this.controller.abort();
            this.controller = null;
            this.busy = false;
            this.cache.clear();
        }

        async lookup(point) {
            if (!this.enabled) throw new Error("unconfigured");
            if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180) throw new Error("coordinates");
            const key = `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
            if (this.cache.has(key)) return this.cache.get(key);
            if (this.busy) throw new Error("busy");
            if (this.now() - this.lastRequest < this.minInterval) throw new Error("rate-limit");
            const url = new URL(this.endpoint);
            url.searchParams.set("format", "jsonv2");
            url.searchParams.set("lat", point.lat);
            url.searchParams.set("lon", point.lon);
            url.searchParams.set("accept-language", "es");
            const token = ++this.version;
            const controller = new AbortController();
            this.controller = controller;
            const timeout = setTimeout(() => controller.abort(), 8000);
            this.lastRequest = this.now();
            this.busy = true;
            try {
                const response = await this.fetcher(url.toString(), {
                    headers: { Accept: "application/json" }, signal: controller.signal,
                    credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "strict-origin-when-cross-origin"
                });
                if (!response.ok || response.redirected) throw new Error(`http-${response.status}`);
                const data = await boundedJSON(response);
                if (token !== this.version || controller.signal.aborted) throw new Error("canceled");
                if (!data || typeof data.display_name !== "string" || data.display_name.length > 4096 || !data.display_name.trim()) throw new Error("not-found");
                const address = data.display_name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
                if (!address) throw new Error("not-found");
                if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value);
                this.cache.set(key, address);
                return address;
            } finally {
                clearTimeout(timeout);
                if (token === this.version) { this.busy = false; this.controller = null; }
            }
        }
    }

    if (typeof module === "object" && module.exports) module.exports = AddressLookup;
    else root.AddressLookup = AddressLookup;
})(globalThis);
