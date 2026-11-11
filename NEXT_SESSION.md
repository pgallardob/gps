# Resume here: PWA sharing, Android preview and relay health

**Handoff: 2026-11-11.** The owner authorized careful review, GitHub upload and publication. They explicitly requested invitation-free Android personal GPS/map/route recording, with remote sharing separate. They use Windows only and deferred native iOS/macOS/Xcode work. No paid hosting upgrade, signing account or private credential collection is authorized.

## Verified restored dashboard: physical-phone validation next

The owner rejected **0.2** as visually poor and missing the excellent earlier phone interface/functions. Verified that original `index.html`, CSS and dashboard modules were intact; the new reduced native layout caused the regression. The right-hand pane had incorrectly been left on a bare, tiles-disabled map test. It now shows the complete generated dashboard in a 390 px review viewport.

Branch **`fix/android-dashboard-parity`** contains **0.3.0-preview**, verified at application source `9e200dc`. [Run 43062899721](https://github.com/pgallardob/gps/actions/runs/43062899721) passed compilation/JVM/lint and all three emulator scenarios. [Direct public APK download](https://github.com/pgallardob/gps/releases/download/v0.3.0-preview/punto-android-0.3.0-preview.apk) requires no GitHub login or ZIP extraction. Official prerelease `v0.3.0-preview` targets `9e200dc`, not `main`. Main remains unchanged until further publication/phone feedback.

The downloaded APK was checked against reviewed CSS/app JS/native adapter/Leaflet bytes, version 0.3, live package (not simulation), and no test platform stand-in. Anonymous public download matched APK SHA-256 `6ade0ae10fd821be95dc1c36e3de62f552e7f44e6f5231d52861daa3aac6ad33`. Its CI ZIP artifact is `13873869293`; test evidence is `13875575457`; release ID `441979248`, APK asset `736263921`. Physical-phone/OEM behavior and every real document provider remain unverified.

Historical failed run `43059482024` at `5094e52` exposed fixture mistakes: resume requested while the task stayed behind Home, and action-only monitors missing document MIME/Openable matching. Commit `9e200dc` relaunches the existing singleTask activity, matches MIME/category, and confirms the real native dialog before awaiting suspended JavaScript. All checks then passed without removing assertions or modifying production application/relay code for these fixture fixes.

Authentication is resolved using per-command `-c credential.username=pgallardob -c credential.interactive=never`; do not change global config or request tokens. The authenticated CI helper obtains the existing Git credential only in process memory, restricts requests to this repository and never logs it. Anonymous API monitoring had hit a quota; the public HTML watcher reported the failed run and the authenticated watcher verified the successful run. All watchers have finished.

Local checks: Node **92 passed, 1 optional skipped**; Python **46 passed, 7 optional skipped**; isolated relay **18 passed**. Real Chromium viewport checks at **320/390/800/1280** show no horizontal overflow. Synthetic browser checks cover demo, favorites, goals, GeoJSON import, GPX/GeoJSON preparation, native-shaped background replay/segments/Stop, clipboard acknowledgement, and no resurrection after clear/forget. These are browser/platform-stand-in results, not Android proof. Windows headless Chrome has a minimum outer width: use measured iframe viewports rather than cropped 320 px screenshots.

One repeat of the unchanged QGIS loopback test encountered Windows `10053` while reading a denied-origin response. Its focused 15-test run and two subsequent full runs passed. Neither the server nor QGIS source/tests changed; the transport cause is not established, and no security check was relaxed to hide it.

Never request tokens/passwords or read ignored connection notes. `main` is still `ddf6a06`; no local Android SDK/JDK/Gradle is installed. Do not hand the rejected 0.2 artifact back as the fix. Use the verified direct 0.3 prerelease link above; draft-upload `untagged-*` URLs are temporary and must not be shared after publication.

## Current architecture

| Area | State and evidence boundary |
| --- | --- |
| Public PWA | https://pgallardob.github.io/gps/ — Pages is already configured |
| Relay | https://gps-lj9l.onrender.com — owner-created Free Render service; public build already contains its URL |
| Secrets | Owner key stays in Render and the owner's runtime browser entry; never in a build variable, native app, chat or private invitation URL |
| Browser publisher | Foreground-only; startup errors identify GPS/accept/upload and allow deliberate GPS retry only before acceptance |
| Android | 0.3 restored dashboard verified in run `43062899721`; public prerelease APK ready for physical-phone validation. 0.2 UI rejected |
| iOS | Native background sender is **not implemented**, explicitly deferred by owner; foreground PWA remains available |
| Health checks | [Scheduled/manual workflow](https://github.com/pgallardob/gps/actions/workflows/relay-health.yml), nominal max 14-minute gaps; best-effort, not always-on service |

The previous October checkpoint remains available at Git tag `checkpoint-render-mobile-2026-10-16`. Its statements that the relay is unconfigured or that publication is paused are historical, not current instructions.

## Resume safely

1. Inspect `git status` and the latest CI run before assuming a build or deployment is complete. Do not recreate Pages or Render or ask if an account exists.
2. Only **PUNTO_SHARING_API_URL**, the public API origin, belongs in GitHub repository Variables. Never request or display the real owner key, recipient link, phone number or coordinates in agent tools.
3. Download the Android **live-endpoint preview** only from a successful native workflow. Never distribute the HTTP/synthetic simulation flavor. Debug signing, installation, update limitations and device instructions are in [mobile/README.md](mobile/README.md).
4. Owner tests the verified 0.3 APK on the phone: actual formatting/tools, personal GPS, screen off, resumed route without duplicates, Stop and real file operations. Never request coordinates/map screenshots. Optional sharing still needs a private invitation and visible PC viewer. Stop/export before uninstalling an incompatible debug preview.
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
