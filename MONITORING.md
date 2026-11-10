# Check the public relay on a nominal 14-minute cadence

The public PWA is already connected to `https://gps-lj9l.onrender.com`. The checker only sends an unauthenticated `GET /health`; it never creates invitations or sends location data.

## Activate after the reviewed changes are published

`.github/workflows/relay-health.yml` reads the existing **repository variable** `PUNTO_SHARING_API_URL`. Do not supply an owner key or any secret. The Python entry point accepts only this project's public HTTPS origin, refuses redirects, bounds response size, requires exactly `{"ok":true}`, and fails the job when two attempts fail. A socket operation can wait up to 90 seconds; the job has a four-minute hard limit.

The schedule is **03, 17, 31, 45 and 59 minutes of each UTC hour**. Its nominal gaps are 14 minutes, except the four-minute gap across the hour. It avoids the busier beginning of each hour. `workflow_dispatch` also enables a manual **Run workflow** test.

**This is best-effort monitoring/warming, not an always-on guarantee.** GitHub can delay or drop scheduled jobs and disables scheduled workflows after 60 days without repository activity. Render Free can therefore still sleep; its shared workspace-hour allowance and restart/session-loss limitations still apply. Active sharing and native phone execution require their own verification; a green health check does not establish those behaviors. Standard GitHub-hosted Ubuntu runners are free for public repositories; no paid runner or hosting upgrade is configured here.

## Local verification

The ordinary Python suite checks target validation and the workflow configuration. For real HTTP response and retry tests, run the loopback-only stand-in in one terminal:

```powershell
postman simulation run postman/simulations/relay-health.sim.yaml --port 4910 --no-history --output ndjson
```

In another terminal:

```powershell
$env:PUNTO_HEALTH_SIM_URL = 'http://127.0.0.1:4910/health'
python -B -m unittest discover -s tests -p test_relay_health.py
Remove-Item Env:PUNTO_HEALTH_SIM_URL
```

The mock is derived from the local `/health` contract and documented gateway failures. Its alternate paths and reset operation are test-only; unknown paths return 501. No external owner's mock or credentials are needed. Inspect request events, stop the test simulation afterwards, and do not commit runtime logs. Before publication, tests are local evidence only: no scheduled GitHub run has happened yet.
