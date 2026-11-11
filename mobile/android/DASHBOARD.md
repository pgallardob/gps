# Preserve the Punto dashboard in Android

The APK uses the existing `index.html`, `css/styles.css` and tested dashboard modules, packaged locally. The web PWA remains unchanged by default. Android replaces only device integration: native GPS, foreground recording, document selection/export and clipboard writing. Do not rebuild a reduced dashboard alongside it.

## Local boundary

- The page is exactly `https://appassets.androidplatform.net/assets/index.html`.
- `WebViewCompat.addWebMessageListener` accepts messages only from that origin, the main frame, and that exact page. No `JavascriptInterface`, arbitrary URL, remote script, file/content navigation or browser geolocation is enabled.
- Commands are explicitly allowlisted: locate/start/stop, clear route/erase session, pause tiles, choose an import, export a selected format and copy coordinates. Starting GPS requires a resumed, visible activity and the existing native permission checks. Tile loading waits for the native allowlist acknowledgement. Queued privacy-reducing actions such as Stop/erase remain valid when the view becomes hidden. Sharing stays in the separate native consent panel; no owner-key form is packaged.
- Exports/imports are explicit Android document-picker operations, bounded to 4 MB and chunked for transport. No path or HTTP target is accepted from JavaScript. Files remain data, not executable markup.
- The native location service and relay protocol remain unchanged. There is no web timer for background GPS and no relay request in personal mode.

## State and recovery

Native recording remains RAM-only and capped at 10,000 points. Accepted points and segment boundaries are replayed into the existing dashboard after screen-off; never join a gap or append the same point twice. User Stop, clear and demo mode must not leave native recording running. A newly created view can recover the native recorded route without automatically starting a new GPS session.

Native-accepted records use an adapter subclass, not a second wall-clock/movement filter in the unchanged web route model. Raw current fixes update the position but do not append another route point. Large replay frames are chunked and reassembled atomically before display.

The dashboard retains its existing coordinates, map controls, distance/accuracy/speed, route formats, GeoJSON import, goals, favorites, demo and privacy tools. QGIS remains desktop-only. Data is not silently persisted: export before closing the session or process.

## Acceptance

Verify the actual packaged dashboard at 320/390/800/1280 px, not the bare map renderer. Check visible formatting and reachable controls, demo/favorites/goal/import/export, native GPS/permission denial/Stop, screen-off replay without duplicates, and the existing invited-sharing regression. Passing GPS tests alone does not establish UI or feature parity.
