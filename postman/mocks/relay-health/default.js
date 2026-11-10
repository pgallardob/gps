"use strict";

const http = require("node:http");

// Only synthetic health response shapes; these fixture paths are not production endpoints.
http.createServer(async (req, res) => {
    const reply = (status, body, type = "application/json", extra = {}) => {
        res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    try {
        if (req.headers.authorization || req.headers.cookie) return reply(401, { error: "Unexpected credentials" });
        if (req.method === "POST" && req.url === "/reset") {
            await pm.state.set("relay-health.attempts", 0);
            return reply(200, { reset: true });
        }
        if (req.method !== "GET") return reply(501, { error: "Not modeled" });
        switch (req.url) {
            case "/health": return reply(200, { ok: true });
            case "/bad-json": return reply(200, "{invalid");
            case "/wrong-shape": return reply(200, { ok: 1 });
            case "/large": return reply(200, { ok: true, padding: "x".repeat(8192) });
            case "/html-ok": return reply(200, "<h1>Application Loading</h1>", "text/html");
            case "/html": return reply(503, "<h1>Application Loading</h1>", "text/html");
            case "/redirect": return reply(302, {}, "application/json", { Location: "/health/health" });
            case "/slow":
                await new Promise(resolve => setTimeout(resolve, 500));
                return reply(200, { ok: true });
            case "/transient": {
                const attempts = (await pm.state.get("relay-health.attempts") || 0) + 1;
                await pm.state.set("relay-health.attempts", attempts);
                return attempts === 1 ? reply(503, { error: "Starting" }) : reply(200, { ok: true });
            }
            default: return reply(501, { error: "Not modeled" });
        }
    } catch {
        return reply(500, { error: "Fixture failure" });
    }
}).listen(Number(process.env.PORT || 4510), "127.0.0.1");
