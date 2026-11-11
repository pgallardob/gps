# Resume here: PWA sharing, Android preview and relay health

**Handoff: 2026-11-11.** The owner authorized careful review, GitHub upload and publication. They explicitly requested invitation-free Android personal GPS/map/route recording, with remote sharing separate. They use Windows only and deferred native iOS/macOS/Xcode work. No paid hosting upgrade, signing account or private credential collection is authorized.

## Personal-map update in progress

Branch `feat/android-personal-map` contains version 0.2.0-preview: default personal map, native one-shot GPS, screen-off foreground route recording, explicit GeoJSON export and optional invitation sharing. This is not yet a verified APK; do not direct the owner to an older sender-only artifact as if it contains the map. Run the current Android workflow and inspect its exact revision before publishing. The old 0.1 APK was installed on the owner's phone, but physical-phone background operation remains unconfirmed.

The owner manually pushed `0ed8d15`; Android [run 43045975645](https://github.com/pgallardob/gps/actions/runs/43045975645) started at that exact revision. A background run watcher is active; await its completion notification instead of polling its output. The agent still cannot authenticate a noninteractive push, even after the owner's terminal succeeded. Local commit `5352fb4` adds one-shot-GPS instrumentation and trace-marker tests but is not yet pushed. `main` is unchanged. Do not request a password/token or read the ignored connection notes to bypass sign-in. No Android SDK/JDK/Gradle is installed locally.

Local checks: Node **83 passed, 1 optional skipped**; Python **44 passed, 7 optional skipped**; isolated relay **18 passed**. New Android JVM/instrumentation tests are written but have not run. Keep this distinct from a compiled or working APK.

The exact packaged map assets and vendored Leaflet also rendered synthetic points/segments successfully in Chromium under the packaged CSP, with external tiles disabled. This is browser-renderer evidence only, not proof of Android background behavior.

## Current architecture

| Area | State and evidence boundary |
| --- | --- |
| Public PWA | https://pgallardob.github.io/gps/ — Pages is already configured |
| Relay | https://gps-lj9l.onrender.com — owner-created Free Render service; public build already contains its URL |
| Secrets | Owner key stays in Render and the owner's runtime browser entry; never in a build variable, native app, chat or private invitation URL |
| Browser publisher | Foreground-only; startup errors identify GPS/accept/upload and allow deliberate GPS retry only before acceptance |
| Android | 0.2 adds personal GPS and optional sharing; current-source build/emulator verification is pending. Previous successful 0.1 sender-only runs do not verify the new map |
| iOS | Native background sender is **not implemented**, explicitly deferred by owner; foreground PWA remains available |
| Health checks | [Scheduled/manual workflow](https://github.com/pgallardob/gps/actions/workflows/relay-health.yml), nominal max 14-minute gaps; best-effort, not always-on service |

The previous October checkpoint remains available at Git tag `checkpoint-render-mobile-2026-10-16`. Its statements that the relay is unconfigured or that publication is paused are historical, not current instructions.

## Resume safely

1. Inspect `git status` and the latest CI run before assuming a build or deployment is complete. Do not recreate Pages or Render or ask if an account exists.
2. Only **PUNTO_SHARING_API_URL**, the public API origin, belongs in GitHub repository Variables. Never request or display the real owner key, recipient link, phone number or coordinates in agent tools.
3. Download the Android **live-endpoint preview** only from a successful native workflow. Never distribute the HTTP/synthetic simulation flavor. Debug signing, installation, update limitations and device instructions are in [mobile/README.md](mobile/README.md).
4. Test the verified 0.2 APK on the owner's Android phone: open **Mi mapa**, locate/start without an invitation, turn the screen off, then use notification Stop and export. For optional remote sharing, use a fresh private invitation and a visible PC viewer. Successful compilation/emulation does not establish behavior on that phone/OEM battery policy.
5. Keep the browser sharing behavior separate: its page still stops when hidden, and PWA installation alone does not enable background sharing. Export any unsaved route/favorites before closing/reloading PWA windows for an update.
6. Review `MONITORING.md` before claiming the 14-minute job is active or keeps Free compute awake. GitHub may delay/drop jobs, disable inactive public-repo schedules, and Render still enforces shared Free hours/restarts.

## Boundaries that remain deliberate

- Explicit recipient consent and device permission are required. A number is only a local label, not identity verification or GPS lookup.
- Consent is finite (5–60 minutes). The relay remains one worker/replica, RAM-only; no session survives a restart. Positions become stale after 20 seconds; publisher/viewer leases expire after 45/60 seconds. Native background support does not silently remove these limits or promise indefinite tracking.
- Android requires an ongoing notification with Stop and a foreground user-started location service. Force-stop, lost permissions/connectivity/GPS and battery/OS policy can still interrupt it. Do not add boot restart, hidden consent, disk replay queues or owner-key storage.
- Personal routes are bounded to 10,000 RAM-only points and require explicit export to persist. They never contact the relay. External OSM tiles reveal the viewed area to the provider; they can be paused and stop being requested when the map is hidden. Personal recording and sharing are mutually exclusive; do not remove consent guards to enable personal GPS.
- Desktop `serve.py` and QGIS stay loopback-only, never in public deployment. Preserve the exact vendored bytes/SRI and `.gitattributes` Leaflet rules.

## Checks

```powershell
node --test
python -B -m unittest discover -s tests
python -B -m unittest discover -s sharing/tests
```

The relay suite needs isolated `sharing/requirements-dev.txt` dependencies. Optional real HTTP fixtures and native build/emulator commands are documented in `postman/README.md`, `MONITORING.md` and `mobile/README.md`. Distinguish skipped optional suites, synthetic HTTP/emulator evidence, observed CI success and the owner's physical-device result; never conflate them.
