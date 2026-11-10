# Resume here: PWA sharing, Android preview and relay health

**Handoff: 2026-11-10.** The owner authorized careful review, GitHub upload and publication. They use Windows only and explicitly deferred native iOS/macOS/Xcode work, not Android. No paid hosting upgrade, signing account or private credential collection is authorized.

## Current architecture

| Area | State and evidence boundary |
| --- | --- |
| Public PWA | https://pgallardob.github.io/gps/ — Pages is already configured |
| Relay | https://gps-lj9l.onrender.com — owner-created Free Render service; public build already contains its URL |
| Secrets | Owner key stays in Render and the owner's runtime browser entry; never in a build variable, native app, chat or private invitation URL |
| Browser publisher | Foreground-only; startup errors identify GPS/accept/upload and allow deliberate GPS retry only before acceptance |
| Android | Separate Kotlin foreground-location sender; [run 42903931697](https://github.com/pgallardob/gps/actions/runs/42903931697) passed compilation/unit/lint/screen-off emulator/HTTP checks and produced a preview APK; physical-device validation follows |
| iOS | Native background sender is **not implemented**, explicitly deferred by owner; foreground PWA remains available |
| Health checks | [Scheduled/manual workflow](https://github.com/pgallardob/gps/actions/workflows/relay-health.yml), nominal max 14-minute gaps; best-effort, not always-on service |

The previous October checkpoint remains available at Git tag `checkpoint-render-mobile-2026-10-16`. Its statements that the relay is unconfigured or that publication is paused are historical, not current instructions.

## Resume safely

1. Inspect `git status` and the latest CI run before assuming a build or deployment is complete. Do not recreate Pages or Render or ask if an account exists.
2. Only **PUNTO_SHARING_API_URL**, the public API origin, belongs in GitHub repository Variables. Never request or display the real owner key, recipient link, phone number or coordinates in agent tools.
3. Download the Android **live-endpoint preview** only from a successful native workflow. Never distribute the HTTP/synthetic simulation flavor. Debug signing, installation, update limitations and device instructions are in [mobile/README.md](mobile/README.md).
4. Continue the owner's real Android test: create a fresh 15-minute invitation in the visible PC map, transfer only to their consenting phone, verify/accept in the native app, check screen-off updates and then notification Stop/revocation. Successful compilation/emulation does not establish behavior on that phone/OEM battery policy.
5. Keep the browser sharing behavior separate: its page still stops when hidden, and PWA installation alone does not enable background sharing. Export any unsaved route/favorites before closing/reloading PWA windows for an update.
6. Review `MONITORING.md` before claiming the 14-minute job is active or keeps Free compute awake. GitHub may delay/drop jobs, disable inactive public-repo schedules, and Render still enforces shared Free hours/restarts.

## Boundaries that remain deliberate

- Explicit recipient consent and device permission are required. A number is only a local label, not identity verification or GPS lookup.
- Consent is finite (5–60 minutes). The relay remains one worker/replica, RAM-only; no session survives a restart. Positions become stale after 20 seconds; publisher/viewer leases expire after 45/60 seconds. Native background support does not silently remove these limits or promise indefinite tracking.
- Android requires an ongoing notification with Stop and a foreground user-started location service. Force-stop, lost permissions/connectivity/GPS and battery/OS policy can still interrupt it. Do not add boot restart, hidden consent, disk replay queues or owner-key storage.
- Desktop `serve.py` and QGIS stay loopback-only, never in public deployment. Preserve the exact vendored bytes/SRI and `.gitattributes` Leaflet rules.

## Checks

```powershell
node --test
python -B -m unittest discover -s tests
python -B -m unittest discover -s sharing/tests
```

The relay suite needs isolated `sharing/requirements-dev.txt` dependencies. Optional real HTTP fixtures and native build/emulator commands are documented in `postman/README.md`, `MONITORING.md` and `mobile/README.md`. Distinguish skipped optional suites, synthetic HTTP/emulator evidence, observed CI success and the owner's physical-device result; never conflate them.
