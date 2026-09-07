#!/usr/bin/env python3
"""Download and verify the ML models listed in ``ml/models/manifest.json``.

Standard library only (``urllib``, ``hashlib``, ``json``, ``argparse``) so the
``ml/`` tree stays dependency-free until feature 006 adds the eval harness.

Behaviour (research.md R10, data-model.md §3):

* every ``files[]`` entry of every model is downloaded to
  ``ml/models/cache/<model>/<path>`` (gitignored), resuming a partial ``.part``
  file with an HTTP ``Range`` request when the server supports it;
* the streamed sha256 is compared with the manifest — a mismatch is reported
  and the run exits with code 2;
* ``--record`` writes the computed sha256 and byte size into the manifest
  **only where the manifest still says ``null``** (a pinned hash is never
  overwritten — edit the manifest by hand if a model is intentionally bumped);
* ``--skip-download`` (alias ``--verify-only``) verifies what is already in the
  cache without touching the network;
* ``--only NAME`` (alias ``--model NAME``) limits the run to one model;
* ``--dest DIR`` copies every verified file to ``DIR/<path>`` (for example
  ``apps/ios/Resources/Models`` before the git-lfs commit);
* files flagged ``"manual": true`` (Perch v2, BirdNET V2.4) are skipped unless
  ``--include-manual`` is given, and any file larger than ``--max-bytes``
  (default 500 MB) is skipped and reported.

Exit codes: 0 everything verified, 2 at least one sha256 mismatch,
3 at least one download failure / missing file (mismatch wins over failure).

Output is one line per file: ``OK``, ``RECORDED``, ``UNPINNED``, ``MISMATCH``,
``MISSING``, ``FAILED`` or ``SKIP`` followed by the model name, the file path
and (where known) the sha256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

EXIT_OK = 0
EXIT_MISMATCH = 2
EXIT_DOWNLOAD = 3

ML_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ML_DIR / "models" / "manifest.json"
DEFAULT_CACHE = ML_DIR / "models" / "cache"
DEFAULT_MAX_BYTES = 500 * 1024 * 1024
CHUNK = 1 << 20
USER_AGENT = "nature-explorer-download-models/1.0 (+https://github.com/tadasz/hexagon-territories)"


class DownloadError(Exception):
    """Raised when a file cannot be fetched after all retries."""


class TooLargeError(DownloadError):
    """Raised when the remote file exceeds ``--max-bytes``."""


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_manifest(path: Path, manifest: dict) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def _fmt_mb(n: int | None) -> str:
    return "?" if n is None else f"{n / (1024 * 1024):.1f} MB"


def _progress(label: str, done: int, total: int | None, last: list) -> None:
    """Print a progress line; on a TTY continuously, otherwise every 10 %."""
    if sys.stderr.isatty():
        pct = f" {100 * done / total:5.1f}%" if total else ""
        sys.stderr.write(f"\r  {label}: {_fmt_mb(done)} / {_fmt_mb(total)}{pct}")
        sys.stderr.flush()
        return
    if total:
        step = int(10 * done / total)
        if step > last[0]:
            last[0] = step
            sys.stderr.write(f"  {label}: {step * 10}% ({_fmt_mb(done)} / {_fmt_mb(total)})\n")


def _content_length(resp) -> int | None:
    value = resp.headers.get("Content-Length")
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def _content_range_total(resp) -> int | None:
    value = resp.headers.get("Content-Range")  # e.g. "bytes 100-999/1000"
    if value and "/" in value:
        try:
            return int(value.rsplit("/", 1)[1])
        except ValueError:
            return None
    return None


def download(
    url: str,
    dest: Path,
    *,
    retries: int = 3,
    timeout: float = 60.0,
    max_bytes: int = DEFAULT_MAX_BYTES,
    label: str = "",
) -> int:
    """Fetch ``url`` into ``dest`` (resumable). Returns the final byte size."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    last_error: Exception | None = None

    for attempt in range(1, max(1, retries) + 1):
        have = part.stat().st_size if part.exists() else 0
        headers = {"User-Agent": USER_AGENT}
        if have:
            headers["Range"] = f"bytes={have}-"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = getattr(resp, "status", 200)
                if status == 206 and have:
                    total = _content_range_total(resp)
                    mode = "ab"
                else:  # server ignored Range (or fresh download): start over
                    total = _content_length(resp)
                    have = 0
                    mode = "wb"
                if max_bytes and total and total > max_bytes:
                    raise TooLargeError(
                        f"{url} is {_fmt_mb(total)} which exceeds --max-bytes {_fmt_mb(max_bytes)}"
                    )
                progress_state = [-1]
                with part.open(mode) as out:
                    done = have
                    while True:
                        chunk = resp.read(CHUNK)
                        if not chunk:
                            break
                        out.write(chunk)
                        done += len(chunk)
                        if max_bytes and done > max_bytes:
                            raise TooLargeError(f"{url} exceeded --max-bytes {_fmt_mb(max_bytes)}")
                        _progress(label or dest.name, done, total, progress_state)
                if sys.stderr.isatty():
                    sys.stderr.write("\n")
            if total is not None and part.stat().st_size != total:
                raise DownloadError(f"short read: got {part.stat().st_size} of {total} bytes")
            os.replace(part, dest)
            return dest.stat().st_size
        except urllib.error.HTTPError as exc:
            if exc.code == 416 and have:  # range not satisfiable: the .part is complete
                os.replace(part, dest)
                return dest.stat().st_size
            last_error = exc
            if 400 <= exc.code < 500 and exc.code not in (408, 429):
                break  # no point retrying a 403/404
        except TooLargeError:
            part.unlink(missing_ok=True)
            raise
        except (urllib.error.URLError, OSError, ValueError) as exc:  # includes timeouts
            last_error = exc
        if attempt < retries:
            time.sleep(min(2.0 * attempt, 10.0))
    raise DownloadError(f"{url}: {last_error}")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="download_models.py",
        description="Download and verify the models in ml/models/manifest.json.",
    )
    p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="manifest path")
    p.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="download cache directory")
    p.add_argument("--only", "--model", dest="only", metavar="NAME", help="limit to one model")
    p.add_argument("--record", action="store_true", help="fill null sha256/bytes in the manifest")
    p.add_argument(
        "--skip-download",
        "--verify-only",
        dest="skip_download",
        action="store_true",
        help="verify cached files only; never touch the network",
    )
    p.add_argument("--dest", type=Path, help="copy verified files to DEST/<path>")
    p.add_argument("--include-manual", action="store_true", help="also fetch files flagged manual")
    p.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES, help="skip larger files (0 = no limit)")
    p.add_argument("--retries", type=int, default=3)
    p.add_argument("--timeout", type=float, default=60.0)
    return p


def _select_models(manifest: dict, only: str | None) -> list[dict]:
    models = manifest.get("models", [])
    if only is None:
        return models
    chosen = [m for m in models if m.get("name") == only]
    if not chosen:
        names = ", ".join(m.get("name", "?") for m in models)
        raise SystemExit(f"error: no model named {only!r} (known: {names})")
    return chosen


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.manifest.exists():
        print(f"error: manifest not found: {args.manifest}", file=sys.stderr)
        return EXIT_DOWNLOAD
    manifest = load_manifest(args.manifest)
    models = _select_models(manifest, args.only)

    mismatches = 0
    failures = 0
    manifest_changed = False

    for model in models:
        name = model.get("name", "?")
        files = model.get("files") or []
        if not files:
            print(f"SKIP {name} (no files[] entries)")
            continue
        for entry in files:
            rel = entry["path"]
            url = entry.get("url")
            expected = entry.get("sha256")
            target = args.cache / name / rel

            if entry.get("manual") and not args.include_manual:
                print(f"SKIP {name} {rel} (manual download; pass --include-manual) {url}")
                continue

            # 1. make sure the file is in the cache
            if not args.skip_download:
                already_good = target.exists() and (
                    (expected and sha256_of(target) == expected)
                    or (not expected and entry.get("bytes") and target.stat().st_size == entry["bytes"])
                )
                if not already_good:
                    if not url:
                        print(f"FAILED {name} {rel} (no url in manifest)")
                        failures += 1
                        continue
                    try:
                        download(
                            url,
                            target,
                            retries=args.retries,
                            timeout=args.timeout,
                            max_bytes=args.max_bytes,
                            label=f"{name}/{rel}",
                        )
                    except TooLargeError as exc:
                        print(f"SKIP {name} {rel} (too large: {exc})")
                        failures += 1
                        continue
                    except DownloadError as exc:
                        print(f"FAILED {name} {rel} {exc}")
                        failures += 1
                        continue
            if not target.exists():
                print(f"MISSING {name} {rel} (not in cache: {target})")
                failures += 1
                continue

            # 2. hash and compare
            digest = sha256_of(target)
            size = target.stat().st_size
            if expected is None:
                if args.record:
                    entry["sha256"] = digest
                    if entry.get("bytes") is None:
                        entry["bytes"] = size
                    if entry.get("primary") and model.get("sha256") is None:
                        model["sha256"] = digest
                    if entry.get("primary") and model.get("bytes") is None:
                        model["bytes"] = size
                    manifest_changed = True
                    print(f"RECORDED {name} {rel} {digest} {size}")
                else:
                    print(f"UNPINNED {name} {rel} {digest} {size} (run with --record to pin)")
            elif digest != expected:
                print(f"MISMATCH {name} {rel} expected {expected} got {digest}")
                mismatches += 1
                continue
            else:
                print(f"OK {name} {rel} {digest}")

            if entry.get("bytes") is not None and entry["bytes"] != size:
                print(f"MISMATCH {name} {rel} expected {entry['bytes']} bytes got {size}")
                mismatches += 1
                continue

            # 3. optional copy of the verified file
            if args.dest:
                out = args.dest / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(target, out)
                print(f"COPIED {name} {rel} -> {out}")

    if args.record and manifest_changed:
        save_manifest(args.manifest, manifest)
        print(f"manifest updated: {args.manifest}")

    if mismatches:
        return EXIT_MISMATCH
    if failures:
        return EXIT_DOWNLOAD
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
