# Local sharing-start regression

This test runs the real recipient scripts, DOM event bindings and HTTP client with synthetic GPS against a loopback Postman simulation. No account, real owner key, phone number or location is needed. Nothing is deployed.

The mock models the recipient routes from `sharing/app.py` and `sharing/store.py`, not the complete production security/lease implementation. Its reset route and three pre-seeded invitations are test-only. It covers a first GPS timeout followed by a deliberate retry, permission loss after acceptance, an HTML gateway error after a point was written, and an acceptance processed before its response times out. Unknown endpoints return 501. No external owner's mock was needed for this repository-owned API.

With Postman CLI 1.70+ installed, start the simulation in one terminal from the repository root:

```powershell
postman simulation run postman/simulations/sharing-start.sim.yaml --port 4905 --no-history --output ndjson
```

In another terminal:

```powershell
$env:PUNTO_SHARING_SIM_URL = 'http://127.0.0.1:4905/relay'
node --test tests/sharing-http.test.cjs
Remove-Item Env:PUNTO_SHARING_SIM_URL
```

Check the simulation's request events as well as the test result. Without this environment variable, the HTTP test is skipped by the ordinary offline suite. Stop the simulation afterwards; do not commit runtime logs. Passing this test does not establish live Render reliability or actual Android/iOS GPS behavior.
