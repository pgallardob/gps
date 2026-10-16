# Punto: a private, local GPS dashboard

The map opens immediately, without requesting location permission. Locate yourself once or start tracking to see your accuracy, speed, distance, and route. No build step, account, database, or browser storage is required.

GitHub Pages URL: **https://pgallardob.github.io/gps/**. The Pages workflow publishes the public PWA; optional cross-device sharing still requires its separate HTTPS relay configuration.

**Continue development:** [NEXT_SESSION.md](NEXT_SESSION.md) records the Render/mobile checkpoint, confirmed account availability, pending approvals and next steps.

## Open the app

On Windows, double-click **`start.bat`**. Python 3 must be installed. Keep the terminal open while using the app.

Or run from this folder:

```powershell
python -I -B serve.py
```

Open **http://127.0.0.1:8080**. If that port is occupied, use `python -I -B serve.py --port 8081`. Only localhost is exposed. **Do not use `python -m http.server`**: it bypasses this app's file allowlist and security headers. To deploy elsewhere, use a production HTTPS server with equivalent policies; this local Python launcher is not an internet-facing production server. Opening `index.html` with `file://` is not supported.

## Phone installation and invited locations

Punto includes an Android/iPhone PWA manifest, icons, installation guidance and a static-only offline shell. See **[DEPLOYMENT.md](DEPLOYMENT.md)** for GitHub Pages setup and phone installation. Publishing is controlled by the repository's explicitly triggered Pages workflow.

The **Ubicación por invitación** panel is optional and disabled until a separate HTTPS relay URL is configured. A number is only a local label: create and manually share a private link, then the recipient must explicitly approve GPS sharing. It is not a phone-number lookup or silent tracker. The relay retains only a short-lived latest point; shared markers remain separate from personal route exports. See [sharing/README.md](sharing/README.md) for the independently deployed service and owner-key setup.

## Try it without GPS

1. Click **Probar demo sin GPS**. The amber banner identifies all positions as synthetic.
2. Click **Detener**, then **Avanzar demo** to move one simulated point at a time. **Iniciar rastreo** resumes automatic playback. No geolocation API is called in demo mode.
3. Save a favorite, change the distance goal, and export as GeoJSON or GPX. Demo files are labeled in their names and metadata. Leaving demo mode clears its data after confirmation; real and simulated GPS sessions are not mixed.

## Exploration tools

| Tool | Behavior |
| --- | --- |
| Favorites | Name up to 100 points using your current position or **Elegir en el mapa**. Select a saved name to center it. All favorites are included in exports. |
| Distance goal | Set a target from 0.05 to 1,000 km. Progress and a local completion message need no notification permission. |
| Session statistics | Active tracking time excludes pauses. The GPS average uses only distance recorded in this session, not imported distance; it is not shown for the accelerated demo. |
| Import | Local GeoJSON FeatureCollection, maximum 4 MB / 10,000 route points / 100 favorites. Points, LineStrings and MultiLineStrings only. Invalid files leave the session unchanged. |
| Export | GeoJSON or GPX, with separate paused segments and favorite points. Unknown imported accuracy/time stays unknown. GPX import is not supported. |

Imports **automatically pause external map tiles before displaying imported areas**. The file is never uploaded. Re-enable the external map only when you accept sharing the viewed area with the tile provider. Unknown properties, HTML popups, links and executable content in imported files are ignored; names are displayed as literal text.

## Open with QGIS

1. Install [QGIS Desktop for Windows](https://qgis.org/download/) yourself if needed. Punto does not install or download programs automatically.
2. Start Punto with `start.bat`. In **Tu recorrido**, use **Volver a comprobar** after installing QGIS.
3. Record/import a route or save a favorite, select **GeoJSON** or **GPX**, and press **QGIS** under **Abrir con:**. Confirm the temporary local copy.

The button opens the current route and favorites as a **snapshot**, not a live feed. It does not replace **Exportar recorrido**, and does not remove the unsaved-data warning. GPX import into Punto is still unsupported; opening a generated GPX in QGIS is a separate action.

Standard Windows standalone/OSGeo4W installation folders are detected. For an installation elsewhere, specify its genuine executable at server startup, for example:

```powershell
python -I -B serve.py --qgis-path "C:\Program Files\QGIS 3.44.0\bin\qgis-ltr-bin.exe"
```

Replace the example with your actual path. Only `qgis-bin.exe`, `qgis-ltr-bin.exe`, or `qgis.exe` launchers are supported, not `.bat` files. Keep the QGIS installation and its vendor environment files intact. Use `--disable-qgis` to disable native opening completely. A static/remote web host cannot launch desktop programs; export/open manually there.

**Privacy:** only after confirmation, the browser sends this snapshot to Punto's loopback server on **your own computer**, not a remote service. Punto rebuilds the allowed data and writes a private temporary GeoJSON/GPX plus a separate QGIS profile. Plugins and version checks are disabled for that launch; no project files, commands, data-source URLs or executable paths are accepted from the browser. QGIS is external software and has its own behavior and policies.

Keep the Punto terminal running until you close QGIS. Temporary files are removed on a best-effort basis when that process exits. If the server stops first, the computer crashes, or files remain locked, a `punto-qgis-*` folder may remain in your system temp directory. Session purge does not delete active QGIS copies, exports, QGIS-saved projects or third-party history. These copies are not encrypted or a backup.

## Use the GPS

- **Obtener mi ubicación** requests one position. **Iniciar rastreo** records a route until you stop it. Allow the browser's location permission when prompted.
- The teal circle shows the browser's estimated accuracy, not an exact position. Desktop devices may have much less accurate location than phones.
- Dragging the map disables camera following. Re-enable **Seguir mi ubicación** or use the recenter control. The expand control fits the entire route.
- The **Formato** selector supports GeoJSON and GPX. Paused sections stay separate; isolated route points are valid GeoJSON Point features.
- By default, hiding the tab pauses tracking; it does not resume automatically. Disable **Pausar rastreo al ocultar la pestaña** if you deliberately want background tracking. Browsers and mobile operating systems may still suspend GPS. Navigating away always stops tracking.

Points with accuracy worse than 100 m or movement below 5 m are excluded from the route. These configurable filters reduce noise, but do not make this a survey-grade or safety-navigation tool. At 10,000 points recording stops; export and clear to continue.

## Files

| Path | Responsibility |
| --- | --- |
| `index.html`, `css/styles.css`, `assets/` | Spanish interface, responsive styles, local icon |
| `js/config.js` | Map provider, initial view, GPS options, route filters |
| `js/geo.js` | Coordinates, distance calculations, segmented routes, GeoJSON |
| `js/location.js` | Browser GPS lifecycle and permission/error handling |
| `js/map.js` | Leaflet map, position marker, accuracy circle, route |
| `js/address.js` | Optional, cached, user-triggered address lookup |
| `js/route-files.js`, `js/session.js` | Bounded file validation/export, demo positions, active-session clock |
| `js/app.js` | UI events and application coordination |
| `manifest.webmanifest`, `sw.js`, `js/pwa.js`, `js/deployment.js` | Scoped installable shell and public deployment settings; no private-data caching |
| `js/sharing*.js`, `js/share-publisher.js`, `share.html` | Private invitation/viewer UI and foreground-only consent publisher |
| `sharing/` | Optional HTTPS relay, isolated from the desktop bridge |
| `public-files.json`, `scripts/build_site.py`, `.github/workflows/pages.yml` | Public-only deployment artifact and tested GitHub Pages workflow |
| `js/qgis.js`, `qgis_bridge.py` | Protected same-origin client and narrow native QGIS handoff |
| `vendor/leaflet/` | Unmodified Leaflet 1.9.4 distribution and BSD license |

## Privacy and online services

By default, routes and coordinates live only in page memory. Reloading or closing the page discards them; export first. Explicit export, clipboard and **Abrir con QGIS** actions create copies outside that memory. A browser unload warning helps protect unexported routes, but mobile browsers may not show it. Exported files and temporary QGIS copies remain on your device and contain sensitive coordinates.

The PWA caches only public application files, not routes, API responses, tokens or OSM tiles. Invitation sharing is a separate, explicit exception that transfers the latest point to your configured relay while consent is active. The sender stops when its screen is hidden; it is not guaranteed background tracking. Purging the owner page attempts revocation but cannot guarantee immediate network delivery when offline; service leases/expiry still apply.

**Pausar el mapa externo** removes the tile layer and disables address queries while preserving local GPS, route and favorite overlays. It does not erase earlier requests or the browser's HTTP cache; the explicitly confirmed local QGIS handoff remains available. **Borrar toda la sesión** clears in-page data and stops GPS/demo, but cannot retract a QGIS launch already sent, erase active QGIS files, downloads, clipboard, browser permissions or OS history, or guarantee forensic memory erasure.

The map requires internet. OpenStreetMap receives tile requests and can infer viewed areas; opening the external OSM link shares the selected point. Tiles use the browser's normal HTTP cache, with visible attribution and no offline downloads or prefetching. Read the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) before production deployment; the public service has no availability guarantee. Switch `tileUrl` and `tileAttribution` in `js/config.js` if needed.

### Optional postal addresses

Address lookup is **disabled by default**. To enable it, set `reverseGeocodingUrl` in `js/config.js` to an **authorized, CORS-enabled Nominatim-compatible `/reverse` endpoint**, then explicitly allow its origin in the server's CSP:

```powershell
python -I -B serve.py --connect-origin https://your-authorized-provider.example
```

Use HTTPS; plain HTTP is accepted only for loopback providers. Userinfo credentials, URL fragments, redirects and the public Nominatim host are rejected. The app requires JSON with a `display_name` field, caps streamed responses at 64 KB, and caps names at 4,096 characters. The button sends coordinates only when clicked; requests omit cookies, use an 8-second timeout, are serialized/rate-limited, and cached only in memory. Use a backend proxy for private API keys; never put secrets in frontend files. Changing tile providers also requires `--tile-origin https://your-tile-origin.example` as well as the frontend provider configuration.

**Do not point this tracking app at the public `nominatim.openstreetmap.org` service.** Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) restricts generated generic geocoding integrations, tracking services, and personal/confidential data. A client-side rate limit is also not an application-wide limit. Choose a provider whose privacy and usage terms permit your use case.

## Verify

With Node.js 18 or later:

```powershell
node --test
python -m unittest discover -s tests
```

Manual checks: open the page without GPS permission (map visible), allow and deny location, start/stop/resume, drag/recenter, export a route, test a narrow screen, and disconnect/reconnect the network. For QGIS, check missing/install detection, cancellation of the confirmation, both formats, real desktop startup and closing/cleanup. Automated native tests use a mock launcher, never a real desktop process or location.

See [SECURITY.md](SECURITY.md) for the security boundary, regression checks and remaining limitations.
