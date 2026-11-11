# Punto Android: personal GPS and optional sharing

Punto opens **Mi mapa** without an invitation. It locates the phone and records a personal route using Android's native GPS and a visible **location foreground service**, including while the screen is off. **Compartir (opcional)** is separate: only that mode uses a verified invitation and sends consented positions to the relay. The existing PWA still provides invitation creation and the remote viewer; its web publisher remains foreground-only.

## Install and use the preview

1. Open the latest successful [Android verification run](https://github.com/pgallardob/gps/actions/workflows/android.yml) and download **punto-android-preview**. Extract its APK and install it on your own consenting Android 8+ device. Version **0.2.0-preview** adds the personal map; the old 0.1 preview is invitation-only.
2. In **Mi mapa**, tap **Obtener mi ubicación** for a single fix, or **Iniciar recorrido** to record. Allow precise location and notifications when requested, then tap Start again. Starting GPS always requires your action.
3. While recording, you may turn the screen off. Use **Detener** in the app or ongoing notification to stop. **Exportar GeoJSON** saves a snapshot through Android's document picker; export before closing or uninstalling because routes otherwise exist only in RAM.

This is a **debug-signed preview**, not a Play Store release. CI signing keys are ephemeral; installing a later preview may require uninstalling the old one. Stop any active session and export anything you need first. No signing key is checked in.

## Personal-mode privacy and limits

- No invitation, owner key, PC viewer, relay availability or WhatsApp is needed. Personal mode makes no relay requests. It does not automatically share or silently switch to sharing.
- Leaflet is bundled locally in a restricted WebView, used only as a renderer. GPS and recording are native, not browser geolocation. No JavaScript-to-native command bridge, file/content access, cookies, DOM storage or arbitrary remote-page navigation is enabled.
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

The workflow pins Java 17, Gradle 8.13, AGP 8.12.0 and Kotlin 2.3.0. It uses standard public Ubuntu 24.04 runners, basic GitHub caching, no paid Gradle service, no signing account and no real GPS or secrets. The Android SDK is installed only on the disposable runner, not the owner's Windows PC. Compiler/test failures publish bounded, redacted annotations so diagnosis does not require collecting credentials or exposing environment dumps.

JVM tests exercise route filtering/segments/limits/GeoJSON plus link validation, monotonic expiry/cancellation, real HTTP, headers, redirects and timeouts. The API 35 emulator uses a separate `simulation` application ID, loopback relay stand-in and synthetic GPS. It verifies the packaged map renders native points, personal recording advances with the screen off, notification Stop halts recording, and no relay request occurs in personal mode. A separate scenario verifies invited sharing, screen-off uploads and revocation with no later upload. External tiles are disabled in simulation.

Only the `liveDebug` APK is uploaded for manual device testing **after** the unit/lint/emulator checks pass. The HTTP-enabled simulation build is never a user artifact. CI success is not a claim that a specific physical phone, OEM battery policy or cellular network has been verified; the next step is the owner's real-device test.

For an existing Android SDK/JDK development environment, run from the repository root:

```text
gradle -p mobile/android testLiveDebugUnitTest lintLiveDebug assembleLiveDebug
```

There is no checked-in signing key, local SDK path, wrapper binary or native dependency in the public Pages allowlist.

## iOS

Native iOS background location is **not implemented**. The owner uses Windows only and explicitly deferred the macOS/Xcode-dependent work. iPhone users can still use the existing foreground web invitation flow; it must not be advertised as locked-screen iOS tracking.
