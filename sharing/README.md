# Optional private location relay

This ASGI service relays **only the latest consented position** between a visible sender and viewer. It cannot locate a phone number. It is independent of GitHub Pages and has no native QGIS/program-execution code.

**Deployment is pending.** The owner confirmed a Render account; service access, plan/cost approval, HTTPS/proxy configuration and the frontend connection are the next session's work. Resume from [NEXT_SESSION.md](../NEXT_SESSION.md); do not deploy or remove the current session limits as part of saving this checkpoint.

## Required configuration

| Environment variable | Value |
| --- | --- |
| `PUNTO_OWNER_KEY` | A unique random secret: `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Keep it out of Git and build variables. |
| `PUNTO_FRONTEND_ORIGINS` | Exact comma-separated HTTPS origins, e.g. `https://ACCOUNT.github.io`. No repository path, trailing slash or wildcard. |
| `PUNTO_ALLOWED_HOSTS` | Exact API hostnames without scheme/port, e.g. `relay.YOUR-DOMAIN.example`. |
| `PUNTO_ALLOW_LOCAL_HTTP` | Leave `false` in production. `true` permits HTTP only on a loopback host **and** loopback connection for local tests. |

`.env.example` is documentation, not an automatically loaded or usable default. Set real values in the process/hosting environment. The frontend's public API URL is separate; the owner key is entered into the browser only when creating invitations and stays in page memory.

## Run in an isolated environment

From the repository root, install `sharing/requirements.txt` into your chosen virtual environment. Development tests additionally use `sharing/requirements-dev.txt`. Versions are constrained to the tested dependency set.

```powershell
python -m pip install -r sharing/requirements.txt
python -m uvicorn sharing.app:create_app --factory --host 127.0.0.1 --port 8001 --workers 1 --no-access-log --proxy-headers --forwarded-allow-ips 127.0.0.1 --limit-concurrency 32 --h11-max-incomplete-event-size 8192
```

Put a trusted HTTPS reverse proxy in front of that loopback process. Trust forwarded headers **only from the actual proxy address**; do not use `*` on a directly reachable service. A container/PaaS needs its appropriate private bind address and trusted proxy configuration. The service refuses data requests it does not recognize as HTTPS. Choose/configure hosting explicitly; no provider account, public tunnel, TLS certificate or paid resource is created by this project.

**Run exactly one worker and one replica.** Sessions are bounded and memory-only; multiple independent workers require a different shared-state design. A restart invalidates all sessions and capabilities. Use infrastructure request limits and keep Python/dependencies patched before public use. This is a personal, single-owner service, not a multi-tenant tracking platform.

## Protocol and privacy boundary

| Operation | Required capability |
| --- | --- |
| Create session | Private owner key; 5, 15, 30 or 60-minute duration only |
| Preview invitation | Invitation token; no position returned |
| Accept once | Invitation token and explicit boolean consent; viewer must be present |
| Publish position | Newly issued publisher token; cannot view through this token |
| Read latest position | Private viewer token or owner key; invitation token cannot read it |
| Stop | Sender, viewer, owner or original invitation can revoke; stopping never grants read/publish access |

Invitations carry an unpredictable ID and invitation capability in a URL **fragment**, not a query. The recipient page removes the fragment from its current history entry. Viewer/owner/publisher secrets never enter links. API capabilities use Authorization headers, never cookies, query parameters or storage. All responses are `no-store`; exact CORS origins, Host/TLS checks, JSON/body limits, strict numeric validation, duplicate-key rejection and rate bounds apply. No OpenAPI/docs endpoints or phone lookup endpoint are exposed.

Only the last position exists; no phone number, track/history, project file or contact identity is sent to this service. IP rate counters have a 60-second window and are removed by requests or the 5-second cleanup task. Idle positions are hidden after 20 seconds, publisher leases close after 45 seconds and viewer leases after 60 seconds, checked on requests and by that same task. Revocation clears coordinates immediately. Ended capability hashes are purged after a short cleanup grace period. No data is written to disk by this application. Memory clearing is not forensic erasure; hosting/proxy/crash-log policies remain your responsibility.

An invitation is a bearer capability, **not identity verification**. Sending it to the wrong person can show that person's location under the local label. Positions are browser-reported and can be spoofed; this is not authenticated GPS attestation or a security/emergency system.

## Test

```powershell
python -m pip install -r sharing/requirements-dev.txt
python -B -m unittest discover -s sharing/tests
```

No actual GPS or cloud service is used. The pinned upstream TestClient currently supports HTTPX with a deprecation notice; this does not affect relay runtime. For a real local browser test, explicitly allow only the loopback frontend origin and API host, enable local HTTP, and build the site with `--allow-local-relay`. Never publish that local-test build.
