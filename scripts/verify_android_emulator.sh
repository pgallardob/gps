#!/usr/bin/env bash
set -euo pipefail

# The emulator action invokes each input command through sh; keep state and pipefail in one explicit Bash process.
setsid postman simulation run postman/simulations/sharing-start.sim.yaml --port 4915 --no-history --output ndjson > "$RUNNER_TEMP/android-relay.ndjson" 2> "$RUNNER_TEMP/android-relay.err" &
simulation_pid=$!
trap 'kill -TERM -- -"$simulation_pid" 2>/dev/null || true' EXIT

ready=false
for attempt in $(seq 1 30); do
    if curl --fail --silent -X POST http://127.0.0.1:4915/relay/__reset >/dev/null; then
        ready=true
        break
    fi
    sleep 1
done
test "$ready" = true

gradle -p mobile/android --no-daemon --console=plain connectedSimulationDebugAndroidTest 2>&1 | tee "$RUNNER_TEMP/android-connected.log"
python scripts/check_android_trace.py "$RUNNER_TEMP/android-relay.ndjson" --with-personal 2>&1 | tee "$RUNNER_TEMP/android-trace-check.log"
