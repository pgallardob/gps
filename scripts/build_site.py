"""Build only allowlisted public PWA assets; never publish the desktop bridge or secrets."""

import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent


def relay_url(value, allow_local=False):
    if not value:
        return ""
    parts = urlsplit(value)
    local = allow_local and parts.hostname in ("127.0.0.1", "localhost")
    if (not parts.hostname or parts.username or parts.password or parts.query or parts.fragment or
        not value.isascii() or any(char in value for char in " ;'\"\\<>%*") or
        parts.scheme != "https" and not (local and parts.scheme == "http") or ".." in parts.path.split("/")):
        raise ValueError("Use a public HTTPS relay base URL without credentials, query or fragment.")
    _ = parts.port
    return value.rstrip("/")


def build(output, sharing_api="", allow_local=False):
    sharing_api = relay_url(sharing_api, allow_local)
    output = Path(output).resolve()
    if output == ROOT or ROOT.is_relative_to(output):
        raise ValueError("Choose a dedicated output directory, not the source tree or its parent.")
    files = json.loads((ROOT / "public-files.json").read_text(encoding="utf-8"))
    expected = set(files) | {".nojekyll", ".punto-build"}
    if output.exists():
        present = {str(path.relative_to(output)).replace("\\", "/") for path in output.rglob("*") if path.is_file()}
        if present and (".punto-build" not in present or not present <= expected):
            raise ValueError("Refusing to overwrite a directory containing non-build files.")
    output.mkdir(parents=True, exist_ok=True)
    for filename in files:
        source = ROOT / filename
        if source.resolve() != source or not source.is_file():
            raise ValueError(f"Missing or linked public asset: {filename}")
        target = output / filename
        if target.is_symlink() or target.parent.resolve() != target.parent:
            raise ValueError("Refusing a symlink in the output directory.")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    deployment = '"use strict";\nwindow.PUNTO_DEPLOYMENT = Object.freeze(' + json.dumps({"sharingApiUrl": sharing_api}) + ');\n'
    (output / "js/deployment.js").write_text(deployment, encoding="utf-8")
    if sharing_api:
        origin = urlsplit(sharing_api)
        origin = f"{origin.scheme}://{origin.netloc}"
        for page in ("index.html", "share.html"):
            path = output / page
            text = path.read_text(encoding="utf-8").replace("connect-src 'self'", f"connect-src 'self' {origin}")
            path.write_text(text, encoding="utf-8")
    fingerprint = hashlib.sha256()
    # Hash source worker bytes before substituting VERSION; logic-only changes also rotate the cache.
    for filename in sorted(set(files)):
        fingerprint.update(filename.encode())
        fingerprint.update((output / filename).read_bytes())
    worker = (output / "sw.js").read_text(encoding="utf-8")
    worker = re.sub(r'const VERSION = "[^"]+";', f'const VERSION = "{fingerprint.hexdigest()[:20]}";', worker, count=1)
    assets = ["./"] + [name for name in files if name != "sw.js"]
    worker = re.sub(r"// APP_ASSETS_START.*?// APP_ASSETS_END", "// APP_ASSETS_START\nconst APP_ASSETS = " + json.dumps(assets) + ";\n// APP_ASSETS_END", worker, flags=re.S)
    (output / "sw.js").write_text(worker, encoding="utf-8")
    (output / ".nojekyll").write_text("", encoding="utf-8")
    (output / ".punto-build").write_text("Generated public assets only.\n", encoding="utf-8")
    return fingerprint.hexdigest()[:20]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="dist")
    parser.add_argument("--sharing-api", default=os.environ.get("PUNTO_SHARING_API_URL", ""))
    parser.add_argument("--allow-local-relay", action="store_true", help="Local integration tests only; never use for a public build.")
    args = parser.parse_args()
    print("Public PWA built:", build(args.output, args.sharing_api, args.allow_local_relay))
