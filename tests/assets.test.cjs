"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("all app scripts and styles are local, present, and separate from HTML", () => {
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"([^>]*)>/g)];
    const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)];
    assert.equal(scripts.length, 14);
    assert.equal(styles.length, 2);
    for (const [, source, attributes] of scripts) {
        assert.equal(source.startsWith("http"), false);
        assert.ok(fs.existsSync(path.join(root, source)), source);
        assert.match(attributes, /defer/);
    }
    for (const [, source] of styles) assert.ok(fs.existsSync(path.join(root, source)), source);
    assert.doesNotMatch(html, /<style[\s>]|<script>/);
    assert.ok(fs.existsSync(path.join(root, "vendor/leaflet/LICENSE")));
});

test("vendored Leaflet JS and CSS match their pinned SHA-384 integrity values", () => {
    for (const file of ["leaflet.js", "leaflet.css"]) {
        const bytes = fs.readFileSync(path.join(root, "vendor/leaflet", file));
        const integrity = "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
        assert.ok(html.includes(`integrity="${integrity}"`), file);
    }
});

test("HTML IDs are unique and every app control exists", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const id of ["map", "locate-btn", "start-btn", "stop-btn", "copy-btn", "export-btn", "clear-btn", "status", "address-btn"]) {
        assert.ok(ids.includes(id), id);
    }
    assert.match(html, /<html lang="es">/);
});

test("exploration cards share the map workspace instead of waiting below the entire sidebar", () => {
    const workspace = html.slice(html.indexOf('<div class="workspace">'), html.indexOf('<div class="feedback-bar"'));
    assert.match(workspace, /<\/aside>\s*<section class="adventure-grid"/);
    assert.match(workspace, /<\/section>\s*<\/div>\s*$/);
    for (const title of ["goal-title", "waypoint-title", "privacy-title"]) {
        assert.match(workspace, new RegExp(`aria-labelledby="${title}"`));
    }
});
