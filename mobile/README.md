# Native Android sender; iOS deferred

The existing PWA remains the map/viewer and still deliberately stops its web publisher when hidden. This separate Android companion can publish the latest consented position from a **location foreground service** while its activity is hidden or its screen is off. It does not use a WebView, run a phone-number lookup, or contain the owner's private key.

## Install and use the preview

1. Open the latest successful **Verify Android background sharing** run in GitHub Actions and download **punto-android-preview**. Extract its APK and install it on your own consenting Android 8+ device. Installation from that download source is a manual system choice.
2. This is a **debug-signed test build**, not a Play Store release. Its ephemeral CI signing key is not stored or published; a later build might require uninstalling the previous preview before reinstalling. No saved routes or credentials are kept by the native companion.
3. In the PC PWA, create a private invitation. Copy it only to the intended phone; open **Punto Android** and paste the original link, or use the phone's text-sharing menu to send it to Punto Android. Never paste the owner key.
4. Tap **Verificar invitación**, check the explicit consent, then **Aceptar y compartir**. Allow location and notifications if requested, then tap the start button again. Android 13+ notification permission is required so Stop remains visible.
5. Leave the owner's map visible and connected. After the first point arrives, the sender can turn its screen off. Use **Detener** in the persistent notification or the app to stop locally immediately and attempt remote revocation.

The app accepts only this project's HTTPS invitation origin/path and uses a fixed HTTPS relay. Capabilities and at most one recent point exist only in process memory. No history, disk queue, automatic boot start, sticky service restart, owner key, phone identity or analytics is implemented. It checks 20-second point freshness before starting each upload; there is no offline replay queue.

## Boundaries that still apply

- Consent remains **5–60 minutes**. A user can stop earlier; the native client does not silently renew authorization. The current server also requires a recent viewer, fresh sender updates and RAM session state. Render restarts invalidate invitations.
- Force-stop, revoked permissions, disabled location, no connectivity, battery/OEM restrictions and Android scheduling can stop the session. Background support is not a guarantee of uninterrupted tracking. The optional battery-settings button only opens system settings; it changes nothing automatically.
- Session stop closes local GPS and attempts to cancel in-flight transport before waiting for revocation. A request already processed cannot be retracted. If remote revocation cannot be confirmed, server freshness/expiry still applies. It cannot erase previous screenshots or copied coordinates.
- This is not an emergency, anti-theft, covert-tracking or location-attestation system. Public GitHub Pages projects share an origin; use a dedicated trusted domain for sensitive deployments.

## Verification and build

The workflow pins Java 17, Gradle 8.13, AGP 8.12.0 and Kotlin 2.3.0. It uses standard public Ubuntu 24.04 runners, basic GitHub caching, no paid Gradle service, no signing account and no real GPS or secrets. The Android SDK is installed only on the disposable runner, not the owner's Windows PC. Compiler/test failures publish bounded, redacted annotations so diagnosis does not require collecting credentials or exposing environment dumps.

JVM tests exercise link/target validation, monotonic expiry/cancellation, bounded responses, real HTTP, headers/consent bodies, redirects and timeouts. The emulator uses a separate `simulation` application ID, loopback-only HTTP endpoint and synthetic location providers. It backgrounds the activity, verifies the screen is off, checks repeated uploads, invokes the actual notification Stop action and checks the HTTP trace for uploads after Stop.

Only the `liveDebug` APK is uploaded for manual device testing **after** the unit/lint/emulator checks pass. The HTTP-enabled simulation build is never a user artifact. CI success is not a claim that a specific physical phone, OEM battery policy or cellular network has been verified; the next step is the owner's real-device test.

For an existing Android SDK/JDK development environment, run from the repository root:

```text
gradle -p mobile/android testLiveDebugUnitTest lintLiveDebug assembleLiveDebug
```

There is no checked-in signing key, local SDK path, wrapper binary or native dependency in the public Pages allowlist.

## iOS

Native iOS background location is **not implemented**. The owner uses Windows only and explicitly deferred the macOS/Xcode-dependent work. iPhone users can still use the existing foreground web invitation flow; it must not be advertised as locked-screen iOS tracking.
