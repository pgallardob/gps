"""Verify the emulator exercised the real client and sent nothing after Stop."""

import json
import sys
from pathlib import Path


def verify(path):
    events = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.startswith("{")]
    if not any(event.get("event") == "listening" for event in events):
        raise ValueError("The local simulation never reported readiness.")
    session = "/v1/sessions/" + "r" * 22
    invitation = "/v1/invitations/" + "r" * 22
    requests = [event for event in events if event.get("event") == "request" and event.get("routeKey") == "relay"]
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
    print("Android HTTP trace verified: preview, consent, repeated upload and Stop with no later upload.")


if __name__ == "__main__":
    verify(sys.argv[1])
