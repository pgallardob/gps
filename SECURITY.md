# Punto security boundary

Run Punto with **`start.bat`** or **`python -I -B serve.py`**, not a general-purpose directory server. This is a local single-user application, not an authenticated internet service. Keep Python, your browser and your OS patched. These changes are defense in depth, not a guarantee of invulnerability or a professional penetration-test certification.

## Findings and fixes

| Finding | Verified behavior before | Protection now |
| --- | --- | --- |
| Local source/directory disclosure | `GET /serve.py` and `/tests/` returned 200 | Explicit public-asset manifest; no directory listings, arbitrary files, hidden files or symlink-resolved targets |
| DNS-rebinding exposure | `Host: attacker.example` was accepted | Exact loopback Host/port allowlist, duplicate-header rejection, Origin and Fetch Metadata validation |
| Missing browser containment | No CSP or framing policy | Self-hosted scripts, no inline scripts/eval, explicit image/connect origins, no framing/objects/forms/base URL overrides, restrictive permissions, nosniff and origin-only cross-site referrers |
| Optional geocoder could be misconfigured | HTTP endpoints, redirects and unbounded JSON were accepted | HTTPS or loopback only, explicit CSP origin, no cookies/redirects, 64 KB streamed cap, 4,096-character address cap, timeout and cancel/version guards |

The previous UI already used `textContent` for addresses: no existing address DOM-XSS was demonstrated. New waypoint names also use `textContent`, including Leaflet popup DOM nodes. Do not replace those sinks with `innerHTML` or pass untrusted strings to `bindPopup`.

## Untrusted files and resource limits

- Only user-selected local GeoJSON is imported, never a URL or GPX/XML document. Files are validated before session replacement: 4 MB UTF-8, 10,000 route points, 100 favorites; only known geometry/metadata fields are copied. Non-finite/out-of-range coordinates, invalid metadata, unsupported geometry and overlong names are rejected. Arbitrary properties are never merged into application objects.
- GeoJSON names remain literal text. GPX output escapes XML metacharacters. Unknown imported accuracy and time are not fabricated.
- Static assets support GET/HEAD only. The HTTP server binds to `127.0.0.1`, caps workers at 16, uses 5-second socket timeouts and reads at most 2 MB per allowlisted asset. Request URLs and headers are not logged. Canceled browser connections do not dump tracebacks. The launcher uses Python's isolated mode.
- No localStorage, IndexedDB, account database or automatic route history is used. The PWA service worker caches a strict public-file allowlist only; Authorization requests, APIs, query URLs and external map tiles are excluded. Explicit exports, clipboard writes, native QGIS and voluntary relay sharing create copies outside page memory. Map tiles reveal viewed areas unless paused; imports pause that layer before fitting their coordinates.

## PWA and optional public sharing boundary

The Pages workflow publishes only `public-files.json` assets. It excludes desktop/relay Python, tests, `.env` files and keys, uses read-only build permissions and pinned Actions, and deploys only a tested static artifact. Relative scope/URLs support GitHub repository paths. Service-worker cleanup only touches this app's scoped cache namespace, never another repository's caches; updates do not force an unsaved page reload. Cache contents are public app code/icons, not a GPS backup, and no background upload/sync queue exists.

The optional FastAPI relay in `sharing/` must be deployed separately over trusted HTTPS, with an exact frontend-origin/Host allowlist and a strong private owner key. It cannot execute native programs and has no connection to QGIS. Owner credentials are entered at runtime and never embedded in public configuration. The only build setting is the relay's public URL. Public/mobile clients never probe native QGIS endpoints or localhost.

Each invitation has separate hashed capabilities for preview/one-time consent, publishing and viewing. A number is neither searched nor verified and never goes to the relay. The recipient must check consent and press a button before GPS acquisition, acceptance or transmission. The fragment capability is removed from the page's URL; viewer/owner/publisher tokens are never put in links. Both parties can stop sharing. The relay stores latest position only, with bounded sessions, rate limits, expiry and independent periodic cleanup. Stale coordinates are hidden after 20 seconds; publisher/viewer leases expire after 45/60 seconds. Network failures cannot guarantee immediate revocation, so the UI fails closed and server leases bound exposure.

Sharing is foreground-only. Hiding/closing the sender stops GPS and attempts revocation; PWA installation does not create background-tracking permission. The relay is one-worker/one-replica, volatile and single-owner, not a multi-tenant service. No phone ownership, requester identity or GPS authenticity is attested. A recipient may forward a link; a viewer may copy coordinates. A trusted deployment/proxy must not log bodies or Authorization, and a dedicated frontend origin is recommended instead of mixing sensitive admin access with other GitHub account project sites. The GitHub Pages meta-CSP cannot supply every HTTP response header; sharing controls reject embedding and deployments needing stronger guarantees should configure equivalent headers on a dedicated host.

## Explicit native QGIS capability

`GET /api/qgis/status` exposes availability and a random per-server capability token, **not** filesystem paths. The only POST action, `/api/qgis/open`, requires the exact Host-matching Origin, the capability header, same-origin Fetch Metadata when present, a single bounded Content-Length and JSON content type. No transfer/content encoding, duplicate JSON keys or extra envelope fields are accepted. Other paths and methods cannot execute programs or write files. The token is CSRF protection, not authentication against same-user malware.

The server independently rebuilds a 4 MB / 10,000-route-point / 100-waypoint snapshot from known Point/LineString fields. It accepts neither native projects/macros nor local paths, programs, data-source URLs or shell arguments from the page. GPX is generated internally, never parsed from an XML request. QGIS is discovered from standard installations or an explicitly trusted owner CLI path; basenames are restricted but are **not a vendor-signature verification**. Local executables, their environment files, OS and installed QGIS are trusted parts of this boundary.

Launching uses a fixed argument list, `shell=False`, a file-argument delimiter, the installation folder as working directory, disabled plugins/version checks and a separate temporary profile. Python startup overrides are removed from the inherited environment. Launch attempts are spaced 5 seconds apart and capped at 3 active processes. `--disable-qgis` removes this capability. No application is installed automatically.

The browser requests this only on a confirmed click. A successful response acknowledges starting the process, **not** proof that QGIS rendered the layer. Timeout/cancellation cannot retract a launch already sent; POST is not automatically retried. Copies are private local temporary files, not encrypted backups. Cleanup is best-effort when QGIS exits while Punto still runs; early server exit or locks may leave data in system temp. Purging page state cannot erase active copies or third-party history. QGIS itself is external software, not sandboxed by browser CSP.

## Dependency check

Leaflet is the only browser runtime library. The vendored JS/CSS matched official **1.9.4** bytes on **2026-10-16**; HTML pins tested SHA-384 integrity values, and its license is included in the public artifact. The optional relay uses separately constrained FastAPI/Uvicorn dependencies. Point-in-time OSV queries returned no advisory for checked Leaflet, FastAPI, Starlette, Pydantic, Uvicorn, h11 and HTTPX versions; this is not a complete dependency/runtime audit or proof of no vulnerabilities. Recheck before publishing/updating.

## Verification

```powershell
node --test
python -B -m unittest discover -s tests
# With the optional relay environment installed:
python -B -m unittest discover -s sharing/tests
```

HTTP regression tests exercise private paths, traversal/Windows encodings, malicious/duplicate Host headers, foreign Origins, cross-site subresources, forbidden methods, security headers and CSP-origin validation. Native tests cover capability/Origin checks, payload limits, command/path rejection, canonicalization, fixed no-shell arguments, rate/active limits, failure cleanup and process-exit cleanup using mock processes. The symlink test skips on Windows without the required privilege. Real QGIS GUI startup requires a separate manual check on an installed system.

## Limitations

The launcher is not designed for public exposure or adversarial high-volume traffic. An attacker who can edit local code, control the browser/OS, or run same-user processes is outside this boundary. Removing application references is not secure memory wiping; browsers may retain caches or back/forward state. Purging a session cannot retract requests, downloaded files, clipboard contents or OS/browser history. Geolocation accuracy and availability are device-dependent, and this is not a safety-navigation tool. An alternative static/production host must supply equivalent headers itself; HTTP headers cannot be guaranteed by double-clicking an HTML file.
