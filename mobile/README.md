# Punto Android: personal GPS and optional sharing

Punto opens **Mi mapa** without an invitation. It locates the phone and records a personal route using Android's native GPS and a visible **location foreground service**, including while the screen is off. **Compartir (opcional)** is separate: only that mode uses a verified invitation and sends consented positions to the relay. The existing PWA still provides invitation creation and the remote viewer; its web publisher remains foreground-only.

**Verified preview: [download the Android 0.3 APK directly](https://github.com/pgallardob/gps/releases/download/v0.3.0-preview/punto-android-0.3.0-preview.apk).** No ZIP extraction or GitHub sign-in is needed. Version 0.3 packages the original Punto dashboard and its tools instead of 0.2's rejected reduced UI. This remains a debug-signed prerelease for physical-phone validation, not a Play Store release. See [the adapter boundary](android/DASHBOARD.md).

## Install and use the preview

1. Download the [verified 0.3 APK](https://github.com/pgallardob/gps/releases/download/v0.3.0-preview/punto-android-0.3.0-preview.apk) and install it on your own consenting Android 8+ device with a current Android System WebView. If an old preview's signature prevents updating, stop tracking and export first, then uninstall that preview before installing this one. Do not disable Play Protect or substitute the old 0.2 APK.
2. In **Mi mapa**, tap **Obtener mi ubicación** for a single fix, or **Iniciar rastreo** to record. Allow precise location and notifications when requested, then tap Start again. Starting GPS always requires your action.
3. While recording, you may turn the screen off. Use **Detener** in the app or ongoing notification to stop. **Exportar recorrido** uses the selected **GeoJSON/GPX** format through Android's document picker. GeoJSON import, goals, favorites, coordinates, metrics and demo reuse the original dashboard. Export before closing or uninstalling because session data otherwise exists only in RAM.

This is a **debug-signed preview**, not a Play Store release. CI signing keys are ephemeral; installing a later preview may require uninstalling the old one. Stop any active session and export anything you need first. No signing key is checked in.

## Personal-mode privacy and limits

- No invitation, owner key, PC viewer, relay availability or WhatsApp is needed. Personal mode makes no relay requests. It does not automatically share or silently switch to sharing.
- The original dashboard and Leaflet are bundled locally in a restricted WebView. GPS/recording and document selection remain native. A closed WebMessage adapter checks origin, main frame and exact packaged page before accepting allowlisted device operations; it exposes no arbitrary URLs, paths or native methods. `JavascriptInterface`, browser geolocation, file/content navigation, cookies, DOM storage and remote-page navigation are disabled.
- External **OpenStreetMap** tiles need internet; the provider can infer the area being viewed. **Pausar mapa externo** disables further tile requests while keeping the point/route overlay. Hiding the map or turning the screen off also pauses new tile requests. Already in-flight requests cannot be withdrawn. No offline tile download or prefetch is provided.
- Routes are bounded to **10,000 points**, accept accuracy of at most **100 m**, and filter movement below **5 m**. GPS gaps over 30 seconds and separate Start/Stop sessions form separate segments, never a straight line across missing travel. These filters do not guarantee surveyed distance or location authenticity.
- A point older than **20 seconds** is marked as a previous location, not a fresh fix. Personal recording has no relay consent deadline, but still depends on device power, permissions, GPS and Android/OEM policy. Export before the process is killed; no automatic disk history or recovery is implemented.

## Optional remote sharing

1. Create a private invitation in the visible PC PWA. Paste the original link into **Compartir (opcional)** on the intended phone. Android's text-sharing menu can prefill this field, but is not required.
2. Tap **Verificar invitación**, check consent, then **Aceptar y compartir**. Allow location and notifications if requested, then tap Start again. Never paste the owner key.
3. Keep the owner's map visible and connected. After the first point arrives, the phone's screen may be turned off. **Detener** stops locally immediately and attempts remote revocation.

Recording and invitation sharing are mutually exclusive. Sharing accepts only this project's HTTPS invitation origin/path and fixed HTTPS relay. Capabilities and the latest shared point are RAM-only; shared points are not appended to the personal route. No disk queue, automatic boot start, sticky restart, owner key, phone identity or analytics is implemented. Uploads require a point at most 20 seconds old; there is no offline replay queue.

## Boundaries that still apply

- Consent remains **5–60 minutes**. A user can stop earlier; the native client does not silently renew authorization. The current server also requires a recent viewer, fresh sender updates and RAM session state. Render restarts invalidate invitations.
- Force-stop, revoked permissions, disabled location, no connectivity, battery/OEM restrictions and Android scheduling can stop the session. Background support is not a guarantee of uninterrupted tracking. The optional battery-settings button only opens system settings; it changes nothing automatically.
- Session stop closes local GPS and attempts to cancel in-flight transport before waiting for revocation. A request already processed cannot be retracted. If remote revocation cannot be confirmed, server freshness/expiry still applies. It cannot erase previous screenshots or copied coordinates.
- This is not an emergency, anti-theft, covert-tracking or location-attestation system. Public GitHub Pages projects share an origin; use a dedicated trusted domain for sensitive deployments.

## Verification and build

Only a successful workflow for the **current source revision** establishes compilation, JVM tests, lint and emulator verification. Earlier successful 0.1 runs verify the sender-only preview, not this personal-map feature. Physical-device confirmation remains a separate step.

[Run 43045975645](https://github.com/pgallardob/gps/actions/runs/43045975645) passed the **0.2 GPS tests** at `0ed8d15`, but did not establish visual or feature parity; the owner rejected that UI. It is historical evidence, not verification of the 0.3 correction. The new adapter and dashboard require a fresh Android run.

The 0.3 candidate has local Node/Python checks plus real Chromium reviews of the generated dashboard at 320/390/800/1280 px. Synthetic browser scenarios cover demo, favorites, goals, import, GPX/GeoJSON preparation, native-shaped screen-off replay without duplicates and clear/forget behavior. These are not native Android or physical-phone results.

**[Run 43062899721](https://github.com/pgallardob/gps/actions/runs/43062899721) passed** compilation, JVM tests, lint and all three emulator scenarios at `9e200dc`: personal GPS/screen-off/replay/Stop, invited sharing, and dashboard/demo/favorites/clipboard/picker/confirmation checks. The downloaded live APK's original CSS, app JS, native adapter and Leaflet bytes were compared with reviewed source; version 0.3 and absence of simulation fixtures were checked. The public prerelease download was then fetched without authentication and its SHA-256 verified: `6ade0ae10fd821be95dc1c36e3de62f552e7f44e6f5231d52861daa3aac6ad33`. Physical-phone/OEM behavior remains to be confirmed.

[Run 43059482024](https://github.com/pgallardob/gps/actions/runs/43059482024) at `5094e52` passed compilation/JVM/lint and reached the emulator, but failed its resume and document-picker checks; **no preview APK was published**. The fixture requested lifecycle resume without reopening the background task, and its document monitors omitted the MIME type/Openable category required by the actual picker intents. The corrected fixture reopens Punto through its launcher intent, matches typed document requests, and dismisses the native confirmation before waiting for suspended JavaScript. A new successful run is still required; production application code is unchanged by these fixture fixes.

The workflow pins Java 17, Gradle 8.13, AGP 8.12.0 and Kotlin 2.3.0. It uses standard public Ubuntu 24.04 runners, basic GitHub caching, no paid Gradle service, no signing account and no real GPS or secrets. The Android SDK is installed only on the disposable runner, not the owner's Windows PC. Compiler/test failures publish bounded, redacted annotations so diagnosis does not require collecting credentials or exposing environment dumps.

JVM tests exercise route filtering/segments/limits/GeoJSON plus link validation, monotonic expiry/cancellation, real HTTP, headers, redirects and timeouts. The API 35 emulator uses a separate `simulation` application ID, loopback relay stand-in and synthetic GPS. Its passing scenarios cover one-shot location, the actual dashboard, screen-off recording/replay, notification Stop, zero personal relay requests, demo/favorites/document-picker cancellation and invited-sharing regression. External tiles are disabled in simulation. Picker cancellation does not establish successful saving through every physical-device document provider.

Only the `liveDebug` APK is uploaded for manual device testing **after** the unit/lint/emulator checks pass. The HTTP-enabled simulation build is never a user artifact. CI success is not a claim that a specific physical phone, OEM battery policy or cellular network has been verified; the next step is the owner's real-device test.

For an existing Android SDK/JDK and Node.js development environment, run from the repository root:

```text
gradle -p mobile/android testLiveDebugUnitTest lintLiveDebug assembleLiveDebug
```

There is no checked-in signing key, local SDK path, wrapper binary or native dependency in the public Pages allowlist.

## iOS

Native iOS background location is **not implemented**. The owner uses Windows only and explicitly deferred the macOS/Xcode-dependent work. iPhone users can still use the existing foreground web invitation flow; it must not be advertised as locked-screen iOS tracking.
