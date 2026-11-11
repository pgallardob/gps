"""Verify the emulator exercised the real client and sent nothing after Stop."""

import json
import sys
from pathlib import Path


def verify(path, with_personal=False):
    events = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.startswith("{")]
    if not any(event.get("event") == "listening" for event in events):
        raise ValueError("The local simulation never reported readiness.")
    session = "/v1/sessions/" + "r" * 22
    invitation = "/v1/invitations/" + "r" * 22
    requests = [event for event in events if event.get("event") == "request" and event.get("routeKey") == "relay"]
    if with_personal:
        marker = next((index for index, event in enumerate(requests) if event.get("method") == "POST" and event.get("path") == "/__personal_done" and event.get("statusCode") == 200), None)
        if marker is None:
            raise ValueError("The personal no-invitation test did not finish.")
        if any(event.get("path") != "/__reset" for event in requests[:marker]):
            raise ValueError("Personal mode contacted the sharing relay.")
        requests = requests[marker + 1:]
    for method, route in (("GET", invitation), ("POST", invitation + "/accept"), ("PUT", session + "/position"), ("DELETE", session)):
        if not any(event.get("method") == method and event.get("path") == route and event.get("statusCode") == 200 for event in requests):
            raise ValueError(f"The emulator did not exercise successful {method} on the expected route.")
    stopped = False
    uploads = 0
    for event in requests:
        if event.get("method") == "DELETE" and event.get("path") == session:
            stopped = True
        if event.get("method") == "PUT" and event.get("path") == session + "/position":
            if stopped:
                raise ValueError("A location upload was attempted after Stop.")
            uploads += 1
    if uploads < 2:
        raise ValueError("No repeated background publication was recorded.")
    if with_personal:
        print("Personal mode verified: no relay requests before the harness completion marker.")
    print("Android HTTP trace verified: preview, consent, repeated upload and Stop with no later upload.")


if __name__ == "__main__":
    verify(sys.argv[1], with_personal="--with-personal" in sys.argv[2:])
