# Resume here: Render relay and native background GPS

**Checkpoint: 2026-10-16.** Work is paused at the owner's request. Next: authorize/review Render deployment, then plan native Android/iOS background location. Do not provision or charge for hosting from this checkpoint alone.

Git tag: `checkpoint-render-mobile-2026-10-16`.

## Current state

| Area | Verified state |
| --- | --- |
| Repository | https://github.com/pgallardob/gps — `main`, application baseline `463c986` |
| Public PWA | https://pgallardob.github.io/gps/ — HTTPS and workflow Pages enabled |
| Deployment | [Build, relay tests and deployment succeeded](https://github.com/pgallardob/gps/actions/runs/38963125884) |
| Sharing implementation | Consent-based relay and browser flow implemented/tested locally; public relay URL remains unconfigured |
| Render account | Owner confirmed an existing account. Login/access, existing project services, plan and billing approval have **not** been checked |
| Mobile targets | Owner's phone is **Android**; **both Android and iOS** must be considered |
| Background tracking | No native client implemented. Current PWA cannot guarantee GPS while hidden/locked |
| Secrets | No Render/relay credentials in this repository. No paid plan or Render resource created by this work |

The latest full local verification passed **123 tests**, with **one Windows symlink-permission skip**: 75 Node, 30 desktop/build Python and 18 relay tests. Browser checks covered explicit consent, synthetic periodic GPS, revocation, separate map markers, scoped caching and offline shell loading. Real phone installation and native background behavior remain unverified.

This checkpoint changes documentation only; it does not change application behavior or deploy the relay. Its commit includes `[skip render]` to avoid triggering a connected Render auto-deploy.

## Start the next session here

1. Check `git status` and read this file. The published PWA and GitHub Pages setup are already done; do not recreate them or ask whether a Render account exists again.
2. Use normal Render login/OAuth with the owner's participation. Check for an existing service for this project before creating another. Never request passwords or tokens in chat.
3. Confirm the hosting plan and explicit approval for any cost. Render free web instances idle-spin-down after 15 minutes; paid compute avoids idle spin-down, but no price/plan has been approved.
4. Configure the independent relay from `sharing/`, not `serve.py` or the QGIS bridge. Keep one worker/replica, validate Render's trusted HTTPS/proxy setup, and configure the private owner key plus exact frontend origin `https://pgallardob.github.io` and the assigned API hostname. Keep local HTTP disabled publicly.
5. Set **only the public HTTPS API URL** as the GitHub repository variable `PUNTO_SHARING_API_URL`, rebuild Pages, and verify health, authentication, denied origins/hosts, invitation consent, revocation, expiry and network loss. Do not put owner credentials in frontend code, URLs or build variables.
6. Choose a native implementation supporting both systems, validating Android first. Check SDK/tooling/signing availability before installing anything: Android needs a foreground location service with an ongoing notification and Stop action; iOS needs Core Location background capabilities/authorization and an active indicator. iOS builds/signing require appropriate Apple tooling.
7. Revisit relay session durability and authorization semantics before claiming "until the user stops." Current sessions are RAM-only, limited to 5–60 minutes, and end after 45 seconds without the publisher or 60 seconds without the viewer. Do not simply remove visibility/expiry checks or weaken consent. Keep stale points hidden and revocation effective.

## Non-negotiable boundaries

- A phone number is a local label, not GPS lookup or identity verification. Sharing requires the device user's explicit consent and location permission.
- PWA service workers/background sync cannot guarantee a continuous GPS feed. Even native operation remains subject to OS force-stop, permissions, battery, connectivity and GPS availability.
- No Render deployment, paid resource, public tunnel, native installation or signing-account setup is authorized for this closing session.
- Preserve exact vendored bytes and HTML SRI: `.gitattributes` deliberately uses `vendor/leaflet/** -text`.
- Do not cache location/API/token responses, queue old positions for later upload or expose the desktop native API publicly.

## Relevant paths

| Path | Purpose |
| --- | --- |
| `DEPLOYMENT.md` | Existing Pages/PWA and relay connection guide |
| `sharing/README.md`, `sharing/app.py`, `sharing/store.py` | Relay deployment, authentication, volatile state and leases |
| `js/deployment.js`, `scripts/build_site.py` | Public API URL and allowlisted static build |
| `js/share-publisher.js`, `js/sharing.js` | Current foreground-only sender and owner/viewer lifecycle |
| `.github/workflows/pages.yml` | Tested public Pages pipeline |
| `SECURITY.md` | Privacy boundary and remaining limitations |

## Verification when runtime work resumes

```powershell
node --test
python -B -m unittest discover -s tests
python -B -m unittest discover -s sharing/tests
```

The last command needs the optional isolated dependencies in `sharing/requirements-dev.txt`. Do not use or publish local loopback test builds as production artifacts. The pinned upstream TestClient currently emits a documented HTTPX deprecation warning; tests pass.
