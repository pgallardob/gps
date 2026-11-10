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
    return text.strip()[:12000]


def emit(text):
    safe = sanitize(text).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title=Android verification::{safe}")


def main(temp_directory=None, build_directory=None):
    count = 0
    temp = Path(temp_directory) if temp_directory is not None else Path(os.environ["RUNNER_TEMP"])
    for name in ("android-build.log", "android-connected.log", "android-trace-check.log", "android-relay.err"):
        file = temp / name
        if not file.exists():
            continue
        lines = file.read_text(encoding="utf-8", errors="replace").splitlines()
        if not lines or name in ("android-build.log", "android-connected.log") and any(re.match(r"^BUILD SUCCESSFUL\b", line) for line in lines):
            continue
        selected = [line for line in lines if re.search(r"(^e:|error:|Unresolved reference|^FAILURE:|^\s*>\s+(?!Task\b)|FAILED|What went wrong|Exception)", line, re.IGNORECASE)]
        # GitHub limits error annotations per step. Group diagnostics instead of spending the budget on normal task lines.
        emit(name + "\n" + "\n".join(selected[-25:] + ["Final build context:"] + lines[-45:]))
        count += 1
    build = Path(build_directory) if build_directory is not None else Path("mobile/android/app/build")
    for file in build.rglob("TEST-*.xml"):
        try:
            root = ET.parse(file).getroot()
        except ET.ParseError:
            continue
        for case in root.iter("testcase"):
            for tag in ("failure", "error"):
                failure = case.find(tag)
                if failure is not None and count < 7:
                    emit(case.attrib.get("name", "test") + ": " + failure.attrib.get("message", "") + "\n" + (failure.text or ""))
                    count += 1
    if not count:
        emit("Verification failed before detailed compiler/test output. Inspect the failed step in Actions.")


if __name__ == "__main__":
    main()
