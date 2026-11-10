"use strict";

const http = require("node:http");
const key = "sharing-relay.sessions";
const invite = "t".repeat(43), viewer = "v".repeat(43), publisher = "p".repeat(43);
const seed = () => Object.fromEntries(["r", "p", "h"].map(letter => [letter.repeat(22), {
    state: "pending", point: null, expiresAt: new Date(Date.now() + 900000).toISOString()
}]));

// Models the recipient routes from sharing/app.py and sharing/store.py, with synthetic capabilities only.
http.createServer(async (req, res) => {
    const reply = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    };
    try {
        const path = new URL(req.url, "http://localhost").pathname;
        if (req.method === "POST" && path === "/__reset") {
            await pm.state.set(key, seed());
            return reply(200, { reset: true });
        }
        if (req.headers.origin !== "https://pgallardob.github.io") return reply(403, { error: "origin_denied" });
        const sessions = await pm.state.get(key) || seed();
        const match = /^\/v1\/(invitations|sessions)\/([A-Za-z0-9_-]{22})(\/accept|\/position)?$/.exec(path);
        if (!match) return reply(501, { error: "Endpoint not modeled" });
        const [, group, id, suffix = ""] = match;
        const session = sessions[id];
        if (!session) return reply(404, { error: "not_found" });
        const capability = (req.headers.authorization || "").replace(/^Bearer /, "");
        const body = req.body || {};
        const remainingSeconds = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
        const view = { id, state: session.state, expiresAt: session.expiresAt, remainingSeconds, point: session.point };

        if (group === "invitations") {
            if (capability !== invite) return reply(401, { error: "unauthorized" });
            if (session.state !== "pending") return reply(suffix ? 409 : 410, { error: "invitation_used" });
            if (req.method === "GET" && !suffix) {
                delete view.point;
                return reply(200, view);
            }
            if (req.method === "POST" && suffix === "/accept") {
                if (body.consent !== true) return reply(403, { error: "consent_required" });
                session.state = "active";
                await pm.state.set(key, sessions);
                // Simulate an acceptance that was processed before its response times out.
                if (id.startsWith("h")) await new Promise(resolve => setTimeout(resolve, 13000));
                return reply(200, { publisherToken: publisher, expiresAt: session.expiresAt, remainingSeconds });
            }
        }
        if (group === "sessions" && req.method === "GET" && !suffix) {
            if (capability !== viewer) return reply(401, { error: "unauthorized" });
            return reply(200, view);
        }
        if (group === "sessions" && req.method === "PUT" && suffix === "/position") {
            if (capability !== publisher) return reply(401, { error: "unauthorized" });
            if (session.state !== "active") return reply(410, { error: "closed" });
            if (!["latitude", "longitude", "accuracy"].every(name => typeof body[name] === "number" && Number.isFinite(body[name])) ||
                Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180 || body.accuracy < 0 || body.accuracy > 20000000) {
                return reply(400, { error: "invalid_position" });
            }
            session.point = { ...body, updatedAt: new Date().toISOString() };
            await pm.state.set(key, sessions);
            if (id.startsWith("p")) {
                res.writeHead(500, { "Content-Type": "text/html", "Cache-Control": "no-store" });
                return res.end("<h1>Gateway failure</h1>");
            }
            return reply(200, { accepted: true, remainingSeconds });
        }
        if (group === "sessions" && req.method === "DELETE" && !suffix) {
            if (![invite, viewer, publisher].includes(capability)) return reply(401, { error: "unauthorized" });
            session.state = "stopped";
            session.point = null;
            await pm.state.set(key, sessions);
            return reply(200, { stopped: true });
        }
        return reply(501, { error: "Endpoint not modeled" });
    } catch {
        return reply(500, { error: "Mock failure" });
    }
}).listen(Number(process.env.PORT || 4500), "127.0.0.1");
