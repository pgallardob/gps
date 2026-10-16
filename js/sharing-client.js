(function (root) {
    "use strict";

    const ID = /^[A-Za-z0-9_-]{22}$/;
    const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
    const STATES = ["pending", "active", "stopped", "expired", "disconnected"];

    function apiBase(value, location = root.location) {
        if (!value) return null;
        try {
            const url = new URL(value);
            const local = ["localhost", "127.0.0.1"].includes(url.hostname) && location && ["localhost", "127.0.0.1"].includes(location.hostname);
            if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
            return new URL(url.href.replace(/\/+$/, "") + "/");
        } catch { return null; }
    }

    function phoneNumber(value) {
        if (typeof value !== "string" || value.length > 40) throw new Error("invalid_phone");
        const number = value.replace(/[ ()-]/g, "");
        if (!/^\+[1-9][0-9]{6,14}$/.test(number)) throw new Error("invalid_phone");
        return number;
    }

    function invitationLink(base, id, token) {
        if (typeof id !== "string" || typeof token !== "string" || !ID.test(id) || !TOKEN.test(token) || token.length !== 43) throw new Error("invalid_response");
        const url = new URL("share.html", base);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error("invalid_response");
        url.hash = `invite=${id}.${token}`;
        return url.href;
    }

    function parseInvitation(hash) {
        const match = /^#invite=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(hash);
        return match ? { id: match[1], token: match[2] } : null;
    }

    function validPosition(point) {
        return point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
            Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 &&
            Number.isFinite(point.accuracy) && point.accuracy >= 0 && point.accuracy <= 20000000;
    }

    function validView(data) {
        return data && typeof data.id === "string" && ID.test(data.id) && STATES.includes(data.state) && typeof data.expiresAt === "string" && Number.isFinite(Date.parse(data.expiresAt)) &&
            Number.isInteger(data.remainingSeconds) && data.remainingSeconds >= 0 && data.remainingSeconds <= 3600 &&
            (data.point === null || data.state === "active" && validPosition(data.point) && Number.isFinite(Date.parse(data.point.updatedAt)));
    }

    class Client {
        constructor(base, fetcher = (...args) => root.fetch(...args), location = root.location) {
            this.base = apiBase(base, location);
            this.fetcher = fetcher;
        }

        get enabled() { return this.base !== null; }

        async request(path, token, method = "GET", body, keepalive = false) {
            if (!this.enabled) throw new Error("not_configured");
            if (typeof token !== "string" || !TOKEN.test(token)) throw new Error("unauthorized");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const response = await this.fetcher(new URL(path, this.base).href, {
                    method, mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
                    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                    body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, keepalive
                });
                if (!/^application\/json\b/i.test(response.headers.get("content-type") || "") || !response.body || Number(response.headers.get("content-length")) > 16384) throw new Error("invalid_response");
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8", { fatal: true });
                let bytes = 0;
                let text = "";
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        bytes += value.byteLength;
                        if (bytes > 16384) { await reader.cancel(); throw new Error("invalid_response"); }
                        text += decoder.decode(value, { stream: true });
                    }
                    text += decoder.decode();
                } finally { reader.releaseLock(); }
                const data = JSON.parse(text);
                if (!response.ok) {
                    const allowed = ["unauthorized", "not_found", "closed", "expired", "disconnected", "invitation_used", "viewer_offline", "rate_limit", "consent_required", "invalid_position"];
                    throw new Error(allowed.includes(data.error) ? data.error : "request_failed");
                }
                return data;
            } finally { clearTimeout(timer); }
        }

        path(id, suffix = "") {
            if (!ID.test(id)) throw new Error("invalid_response");
            return `v1/sessions/${id}${suffix}`;
        }

        async create(owner, minutes) {
            if (![5, 15, 30, 60].includes(minutes)) throw new Error("invalid_duration");
            const data = await this.request("v1/sessions", owner, "POST", { minutes });
            if (!validView(data) || typeof data.inviteToken !== "string" || typeof data.viewerToken !== "string" || !TOKEN.test(data.inviteToken) || !TOKEN.test(data.viewerToken) || data.inviteToken.length !== 43) throw new Error("invalid_response");
            return data;
        }

        async view(id, viewer) {
            const data = await this.request(this.path(id), viewer);
            if (!validView(data) || data.id !== id) throw new Error("invalid_response");
            return data;
        }

        async preview(id, invite) {
            this.path(id);
            const data = await this.request(`v1/invitations/${id}`, invite);
            if (!validView({ ...data, point: null }) || data.id !== id || data.state !== "pending") throw new Error("invalid_response");
            return data;
        }

        async accept(id, invite) {
            this.path(id);
            const data = await this.request(`v1/invitations/${id}/accept`, invite, "POST", { consent: true });
            if (typeof data.publisherToken !== "string" || !TOKEN.test(data.publisherToken) || !Number.isInteger(data.remainingSeconds) || data.remainingSeconds < 1 || data.remainingSeconds > 3600) throw new Error("invalid_response");
            return data;
        }

        async publish(id, publisher, point) {
            if (!validPosition(point)) throw new Error("invalid_position");
            const data = await this.request(this.path(id, "/position"), publisher, "PUT", {
                latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy
            });
            if (data.accepted !== true) throw new Error("invalid_response");
            return data;
        }

        revoke(id, token, keepalive = false) { return this.request(this.path(id), token, "DELETE", undefined, keepalive); }
    }

    const api = { Client, apiBase, phoneNumber, invitationLink, parseInvitation, validPosition, validView };
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.PuntoSharing = api;
})(globalThis);
