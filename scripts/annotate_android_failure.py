"""Publish bounded, redacted compiler/test diagnostics, never environment dumps."""

import os
from pathlib import Path
import re
import xml.etree.ElementTree as ET


def sanitize(text):
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    text = re.sub(r"(?i)Bearer\s+\S+", "Bearer [redacted]", text)
    text = re.sub(r"#invite=[A-Za-z0-9_.-]+", "#invite=[redacted]", text)
    text = re.sub(r'''(?i)(["']?\w*(?:password|secret|authorization|capability|token|key)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)''', r'\1"[redacted]"', text)
    text = re.sub(r"\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+\b", "[redacted]", text)
    return text.strip()[:1200]


def emit(text):
    safe = sanitize(text).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title=Android verification::{safe}")


def main():
    count = 0
    for name in ("android-build.log", "android-connected.log"):
        file = Path(os.environ["RUNNER_TEMP"]) / name
        if not file.exists():
            continue
        lines = file.read_text(encoding="utf-8", errors="replace").splitlines()
        selected = [line for line in lines if re.search(r"(^e:|error:|Unresolved reference|^FAILURE:|^\s*>|FAILED|What went wrong)", line)]
        for line in selected[:20]:
            emit(line)
            count += 1
    for file in Path("mobile/android/app/build").rglob("TEST-*.xml"):
        try:
            root = ET.parse(file).getroot()
        except ET.ParseError:
            continue
        for case in root.iter("testcase"):
            for tag in ("failure", "error"):
                failure = case.find(tag)
                if failure is not None and count < 35:
                    emit(case.attrib.get("name", "test") + ": " + failure.attrib.get("message", "") + "\n" + (failure.text or ""))
                    count += 1
    if not count:
        emit("Verification failed before detailed compiler/test output. Inspect the failed step in Actions.")


if __name__ == "__main__":
    main()
