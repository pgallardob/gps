# Publish Punto as an installable PWA

**GitHub Pages serves the public app. A separate HTTPS relay is required for voluntary location sharing.** The Windows/QGIS server must remain local; do not publish it or expose its port.

This repository is `pgallardob/gps`, with workflow-based Pages at **https://pgallardob.github.io/gps/**. Its frontend origin for a future relay allowlist is `https://pgallardob.github.io` (without `/gps/`).

## 1. Publish the PWA

1. Put this project in your GitHub repository. Keep real `.env` files, owner keys, exports and location data out of Git. Publishing occurs only when you explicitly push or dispatch the workflow.
2. In **Settings → Pages**, choose **GitHub Actions** as the publishing source.
3. Push to the `main` branch. The included `.github/workflows/pages.yml` tests the app and relay, builds `dist/`, and publishes only the explicit `public-files.json` allowlist.
4. Open the resulting HTTPS URL, normally `https://ACCOUNT.github.io/REPOSITORY/`.

The manifest, icons, service worker, links and invitation page use relative paths and support repository subdirectories. The build never includes Python services, tests, credentials or `.env` files. Actions are pinned to verified commit SHAs. If your default branch is not `main`, update the workflow branch filter.

For a local public build:

```powershell
python -B scripts/build_site.py
```

The output is `dist/`. The builder refuses to overwrite a directory containing unrelated files. It fingerprints public assets to version service-worker updates. It does not publish anything by itself.

## 2. Install on a phone

| Device | Steps after opening the HTTPS URL |
| --- | --- |
| Android / Chrome | Use **Instalar Punto** when offered, or the browser menu → Install app / Add to Home screen. |
| iPhone / iPad | Open in Safari → Share → Add to Home Screen. |

Installation does not grant location permission. The `localhost` URL on a PC points to that PC; entering it on a phone does not reach the PC. A browser/desktop preview is not a substitute for checking installation on a real phone.

The service worker caches **only public interface files**. It does not cache map tiles, positions, invitations, API responses, owner keys or authorization headers, and has no offline upload queue. The interface can open offline after its first complete visit; map imagery and sharing still require internet. GPS availability depends on the device and OS.

Updates never reload an unsaved route automatically. If an update is waiting, export your data and close all Punto windows before reopening.

## 3. Enable consent-based sharing

Skip this section if you only need your own GPS, routes and exports. Without a relay URL the sharing panel is intentionally disabled; no fake phone lookup is offered.

1. Deploy the independent service described in [sharing/README.md](sharing/README.md) to infrastructure you control, with HTTPS, a strong secret owner key and exact allowed frontend origin/hostnames.
2. Add a **repository variable** named `PUNTO_SHARING_API_URL`, containing only the public base URL, for example `https://relay.YOUR-DOMAIN.example`. Never put the owner key in this variable, frontend JavaScript, invitation URL or GitHub Pages artifact.
3. Run/push the Pages workflow again. It places the public URL in `js/deployment.js` and permits that origin in the pages' CSP.
4. In Punto, enter the private owner key at runtime, type the contact number with country code and choose 5–60 minutes. Create an invitation, then manually copy or share its link with that contact.
5. The contact opens the link, checks the consent box and presses **Aceptar y compartir mi ubicación**. Only then is GPS requested; acceptance and position transmission occur after a successful fix.
6. The owner sees a separate purple marker and can use **Ver en el mapa** or **Revocar**. Shared points do not enter personal route exports automatically.

The number is a local, masked label, **not a verified identity or a source of GPS coordinates**. No SMS, carrier lookup or WhatsApp API is used. Send each private link only to the intended person. Anyone receiving it can offer their own device's position; this is not proof of phone-number ownership or authentic GPS.

## Privacy and limitations

- The sender must keep the sharing screen visible. Hiding/closing it stops local GPS calls and attempts revocation. There is no guaranteed background tracking or lock-screen location feed.
- The relay stores only the latest position in memory. Visibility is cut off after 20 seconds without a fresh update, transmission authorization after 45 seconds without the publisher or 60 seconds without a viewer, with periodic cleanup every 5 seconds. Explicit revocation clears the current point immediately when received. The absolute consent limit is at most 60 minutes.
- The owner page polls while visible. Leaving it, losing connection, restarting the relay or closing the sender can end the session. Reuse requires a new invitation/consent; there is no automatic resumption.
- Coordinates, keys and capabilities are not saved in localStorage or IndexedDB. Reloading may lose the owner key/session controls. Static app caching is not a route backup.
- Revoking cannot erase screenshots, copied coordinates, prior map-provider requests, hosting-provider logs or already exported files. Choose trusted HTTPS infrastructure and prevent request-body/Authorization logging.
- GitHub project sites under the same account share a web origin. Use a dedicated trusted custom domain for sensitive deployments, and do not host untrusted applications under that same origin.
- QGIS opening stays desktop-local and is not probed on public/mobile origins. This is not an emergency, covert tracking, anti-theft or safety-navigation system.

## Verify before real use

```powershell
node --test
python -B -m unittest discover -s tests
python -B -m unittest discover -s sharing/tests
```

The last command requires the relay's isolated dependencies. Tests use synthetic coordinates. Check real Android/iPhone installation and permissions, refusal/revocation, background stopping, expired links and network loss with consenting devices before sharing sensitive locations.
