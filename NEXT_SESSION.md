# Resume here: PWA sharing, Android preview and relay health

**Handoff: 2026-11-11.** The owner authorized careful review, GitHub upload and publication. They explicitly requested invitation-free Android personal GPS/map/route recording, with remote sharing separate. They use Windows only and deferred native iOS/macOS/Xcode work. No paid hosting upgrade, signing account or private credential collection is authorized.

## Active repair: restore the original dashboard in Android

The owner rejected **0.2** as visually poor and missing the excellent earlier phone interface/functions. Verified that original `index.html`, CSS and dashboard modules were intact; the new reduced native layout caused the regression. The right-hand pane had incorrectly been left on a bare, tiles-disabled map test. It now shows the complete generated dashboard in a 390 px review viewport.

Branch **`fix/android-dashboard-parity`** contains the **0.3.0-preview candidate**: original dashboard assets, optional native hooks, closed origin/main-frame/page-scoped WebMessage adapter, native GPS/foreground recording, explicit SAF import/export and clipboard writing. Native sharing consent and relay leases are preserved; no owner form is packaged. Review [mobile/android/DASHBOARD.md](mobile/android/DASHBOARD.md). **Run 43059482024 passed compilation/JVM/lint but failed two emulator checks; no corrected APK was published.**

The failed checks were the fixture's attempt to resume a task still behind Home (`ActivityScenario.moveToState` remained STOPPED), and an action-only document monitor that could not match GPX MIME/Openable intents. Repaired the fixture to relaunch the existing singleTask activity via launcher, match MIME/category explicitly, and click the real native confirmation before waiting for its JavaScript callback (confirm suspends JavaScript). Test assertions remain; no production app/relay code changes were needed for these fixes. Re-run the complete emulator gate before distribution.

The anonymous API watcher hit HTTP 403 quota. The replacement **public HTML watcher** correctly reported failure and public annotations; it has completed. Do not interpret the watcher error as the build result or repeatedly retry the exhausted API. Public run page: https://github.com/pgallardob/gps/actions/runs/43059482024. Its only artifact is `android-test-results`, not an installable APK.

Local checks: Node **92 passed, 1 optional skipped**; Python **46 passed, 7 optional skipped**; isolated relay **18 passed**. Real Chromium viewport checks at **320/390/800/1280** show no horizontal overflow. Synthetic browser checks cover demo, favorites, goals, GeoJSON import, GPX/GeoJSON preparation, native-shaped background replay/segments/Stop, clipboard acknowledgement, and no resurrection after clear/forget. These are browser/platform-stand-in results, not Android proof. Windows headless Chrome has a minimum outer width: use measured iframe viewports rather than cropped 320 px screenshots.

One repeat of the unchanged QGIS loopback test encountered Windows `10053` while reading a denied-origin response. Its focused 15-test run and two subsequent full runs passed. Neither the server nor QGIS source/tests changed; the transport cause is not established, and no security check was relaxed to hide it.

The owner could manually push `0ed8d15`, but the agent's noninteractive Git still could not authenticate afterward. Collect and test all changes before requesting another manual push; never request tokens/passwords or read ignored connection notes. `main` is still `ddf6a06`. No local Android SDK/JDK/Gradle is installed. Historical successful [0.2 run 43045975645](https://github.com/pgallardob/gps/actions/runs/43045975645) proved only its narrow GPS checks, not the 0.3 correction or UI parity; do not hand that old APK back as the fix.

## Current architecture

| Area | State and evidence boundary |
| --- | --- |
| Public PWA | https://pgallardob.github.io/gps/ — Pages is already configured |
| Relay | https://gps-lj9l.onrender.com — owner-created Free Render service; public build already contains its URL |
| Secrets | Owner key stays in Render and the owner's runtime browser entry; never in a build variable, native app, chat or private invitation URL |
| Browser publisher | Foreground-only; startup errors identify GPS/accept/upload and allow deliberate GPS retry only before acceptance |
| Android | 0.3 original-dashboard restoration candidate; new Android compilation/emulator/physical-phone checks pending. 0.2 UI rejected |
| iOS | Native background sender is **not implemented**, explicitly deferred by owner; foreground PWA remains available |
| Health checks | [Scheduled/manual workflow](https://github.com/pgallardob/gps/actions/workflows/relay-health.yml), nominal max 14-minute gaps; best-effort, not always-on service |

The previous October checkpoint remains available at Git tag `checkpoint-render-mobile-2026-10-16`. Its statements that the relay is unconfigured or that publication is paused are historical, not current instructions.

## Resume safely

1. Inspect `git status` and the latest CI run before assuming a build or deployment is complete. Do not recreate Pages or Render or ask if an account exists.
2. Only **PUNTO_SHARING_API_URL**, the public API origin, belongs in GitHub repository Variables. Never request or display the real owner key, recipient link, phone number or coordinates in agent tools.
3. Download the Android **live-endpoint preview** only from a successful native workflow. Never distribute the HTTP/synthetic simulation flavor. Debug signing, installation, update limitations and device instructions are in [mobile/README.md](mobile/README.md).
4. Finish exact-revision 0.3 CI before providing another APK. Inspect actual formatting and functions, not only GPS counts. Then test the corrected APK on the owner's phone: personal GPS, screen off, resumed route without duplicates, Stop and file operations. Optional sharing still needs a fresh private invitation and visible PC viewer.
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
