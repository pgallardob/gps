(function (root) {
    "use strict";

    class QgisClient {
        constructor(fetcher = (...args) => root.fetch(...args), location = root.location) {
            this.fetcher = fetcher;
            this.local = !!location && ["127.0.0.1", "localhost"].includes(location.hostname) && ["http:", "https:"].includes(location.protocol);
            this.token = null;
            this.available = false;
        }

        async request(path, options = {}) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await this.fetcher(path, {
                    credentials: "omit", mode: "same-origin", cache: "no-store", redirect: "error",
                    ...options, signal: controller.signal
                });
                if (!/^application\/json\b/i.test(response.headers.get("content-type") || "")) throw new Error("local_server");
                if (!response.body || Number(response.headers.get("content-length")) > 4096) throw new Error("local_server");
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8", { fatal: true });
                let text = "";
                let bytes = 0;
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        bytes += value.byteLength;
                        if (bytes > 4096) { await reader.cancel(); throw new Error("local_server"); }
                        text += decoder.decode(value, { stream: true });
                    }
                    text += decoder.decode();
                } finally { reader.releaseLock(); }
                const data = JSON.parse(text);
                if (!response.ok) throw new Error(["not_installed", "disabled", "rate_limit", "busy", "invalid_data", "forbidden", "too_large", "launch_failed"].includes(data.error) ? data.error : "local_server");
                return data;
            } finally { clearTimeout(timer); }
        }

        async check() {
            this.available = false;
            this.token = null;
            if (!this.local) return { available: false, reason: "desktop_only" };
            const data = await this.request("/api/qgis/status", { headers: { Accept: "application/json" } });
            if (typeof data.available !== "boolean" || typeof data.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Error("local_server");
            this.token = data.token;
            this.available = data.available;
            return { available: this.available, reason: data.reason };
        }

        async open(data, format) {
            if (!this.available || !this.token) throw new Error("not_installed");
            if (!["geojson", "gpx"].includes(format)) throw new Error("invalid_data");
            const body = JSON.stringify({ data, format });
            if (new TextEncoder().encode(body).length > 4 * 1024 * 1024) throw new Error("too_large");
            const result = await this.request("/api/qgis/open", {
                method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Punto-Token": this.token }, body
            });
            if (result.opened !== true || result.format !== format) throw new Error("local_server");
            return result;
        }
    }

    if (typeof module === "object" && module.exports) module.exports = QgisClient;
    else root.QgisClient = QgisClient;
})(globalThis);
