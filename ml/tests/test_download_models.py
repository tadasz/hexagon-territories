"""Offline unit tests for ``ml/scripts/download_models.py``.

A local ``http.server`` serves a temporary directory, so the tests exercise
the real download, hashing, ``--record``, verification and exit-code paths
without touching the network. Run with
``python3 -m unittest discover -s ml/tests -v``.
"""

from __future__ import annotations

import contextlib
import functools
import hashlib
import http.server
import io
import json
import os
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR / "scripts"))

import download_models as dm  # noqa: E402  (import after sys.path tweak)


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:  # silence request logging
        pass


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class DownloadModelsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.served = cls.root / "served"
        cls.served.mkdir()
        cls.weights = os.urandom(3 * 1024 * 1024 + 123)  # a few MB, not chunk aligned
        (cls.served / "model.onnx").write_bytes(cls.weights)
        (cls.served / "labels.txt").write_text("Parus major\nErithacus rubecula\n", encoding="utf-8")
        cls.weights_sha = hashlib.sha256(cls.weights).hexdigest()
        cls.labels_sha = hashlib.sha256((cls.served / "labels.txt").read_bytes()).hexdigest()

        handler = functools.partial(_QuietHandler, directory=str(cls.served))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    # ------------------------------------------------------------------ helpers

    def _manifest(self, *, sha=None, labels_sha=None, url_base=None, role="primary-on-device", license_text="Apache-2.0"):
        base = url_base or self.base
        return {
            "models": [
                {
                    "name": "test-model",
                    "kind": "bird-audio-classifier",
                    "version": "1",
                    "format": "onnx",
                    "source": "https://example.invalid",
                    "license": license_text,
                    "attribution": "Test",
                    "sample_rate_hz": 32000,
                    "window_seconds": 3.0,
                    "labels_file": "labels/labels.txt",
                    "sha256": sha,
                    "role": role,
                    "notes": "fixture",
                    "files": [
                        {"path": "model.onnx", "url": f"{base}/model.onnx", "sha256": sha, "bytes": None, "primary": True},
                        {"path": "labels/labels.txt", "url": f"{base}/labels.txt", "sha256": labels_sha, "bytes": None},
                    ],
                }
            ]
        }

    def _run(self, manifest: dict, *args: str, cache: Path | None = None):
        case_dir = Path(tempfile.mkdtemp(dir=self.root))
        manifest_path = case_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        cache = cache or case_dir / "cache"
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = dm.main(["--manifest", str(manifest_path), "--cache", str(cache), "--retries", "1", "--timeout", "5", *args])
        return code, out.getvalue(), manifest_path, cache

    # -------------------------------------------------------------------- tests

    def test_record_fills_null_hashes_and_bytes(self) -> None:
        code, out, manifest_path, cache = self._run(self._manifest(), "--record")
        self.assertEqual(code, dm.EXIT_OK, out)
        self.assertIn("RECORDED test-model model.onnx", out)
        self.assertIn("manifest updated", out)
        saved = json.loads(manifest_path.read_text())
        model = saved["models"][0]
        self.assertEqual(model["sha256"], self.weights_sha)
        self.assertEqual(model["bytes"], len(self.weights))
        self.assertEqual(model["files"][0]["sha256"], self.weights_sha)
        self.assertEqual(model["files"][1]["sha256"], self.labels_sha)
        self.assertTrue((cache / "test-model" / "model.onnx").exists())
        self.assertTrue((cache / "test-model" / "labels" / "labels.txt").exists())
        self.assertFalse(list(cache.rglob("*.part")), "no partial files left behind")

    def test_record_never_overwrites_a_pinned_hash(self) -> None:
        bogus = "0" * 64
        code, out, manifest_path, _ = self._run(self._manifest(sha=bogus, labels_sha=self.labels_sha), "--record")
        self.assertEqual(code, dm.EXIT_MISMATCH)
        self.assertEqual(json.loads(manifest_path.read_text())["models"][0]["sha256"], bogus)

    def test_verify_ok_exits_zero_with_ok_lines(self) -> None:
        manifest = self._manifest(sha=self.weights_sha, labels_sha=self.labels_sha)
        code, out, _, cache = self._run(manifest)
        self.assertEqual(code, dm.EXIT_OK, out)
        self.assertEqual(out.count("OK test-model"), 2, out)
        # second pass: --skip-download verifies the cache without the network
        code2, out2, _, _ = self._run(manifest, "--skip-download", cache=cache)
        self.assertEqual(code2, dm.EXIT_OK, out2)
        self.assertEqual(out2.count("OK test-model"), 2, out2)

    def test_verify_mismatch_exits_2(self) -> None:
        manifest = self._manifest(sha="f" * 64, labels_sha=self.labels_sha)
        code, out, _, _ = self._run(manifest)
        self.assertEqual(code, dm.EXIT_MISMATCH)
        self.assertIn("MISMATCH test-model model.onnx", out)

    def test_unreachable_server_exits_3(self) -> None:
        dead = f"http://127.0.0.1:{_free_port()}"
        code, out, _, _ = self._run(self._manifest(url_base=dead))
        self.assertEqual(code, dm.EXIT_DOWNLOAD)
        self.assertIn("FAILED test-model model.onnx", out)

    def test_http_404_exits_3(self) -> None:
        manifest = self._manifest()
        manifest["models"][0]["files"][0]["url"] = f"{self.base}/does-not-exist.onnx"
        code, out, _, _ = self._run(manifest)
        self.assertEqual(code, dm.EXIT_DOWNLOAD)
        self.assertIn("FAILED", out)
        self.assertIn("404", out)

    def test_skip_download_reports_missing_cache_as_failure(self) -> None:
        code, out, _, _ = self._run(self._manifest(sha=self.weights_sha), "--skip-download")
        self.assertEqual(code, dm.EXIT_DOWNLOAD)
        self.assertIn("MISSING test-model model.onnx", out)

    def test_manual_files_are_skipped_unless_requested(self) -> None:
        manifest = self._manifest(sha=self.weights_sha, labels_sha=self.labels_sha)
        manifest["models"][0]["files"][0]["manual"] = True
        code, out, _, cache = self._run(manifest)
        self.assertEqual(code, dm.EXIT_OK)
        self.assertIn("SKIP test-model model.onnx (manual download", out)
        self.assertFalse((cache / "test-model" / "model.onnx").exists())
        code2, out2, _, _ = self._run(manifest, "--include-manual")
        self.assertEqual(code2, dm.EXIT_OK, out2)
        self.assertIn("OK test-model model.onnx", out2)

    def test_max_bytes_guard_skips_large_files(self) -> None:
        code, out, _, _ = self._run(self._manifest(), "--max-bytes", "1024")
        self.assertEqual(code, dm.EXIT_DOWNLOAD)
        self.assertIn("too large", out)

    def test_dest_copies_verified_files(self) -> None:
        dest = self.root / "dest"
        manifest = self._manifest(sha=self.weights_sha, labels_sha=self.labels_sha)
        code, out, _, _ = self._run(manifest, "--dest", str(dest))
        self.assertEqual(code, dm.EXIT_OK, out)
        self.assertEqual((dest / "model.onnx").read_bytes(), self.weights)
        self.assertTrue((dest / "labels" / "labels.txt").exists())

    def test_only_unknown_model_is_an_error(self) -> None:
        with self.assertRaises(SystemExit):
            self._run(self._manifest(), "--only", "nope")

    def test_partial_file_is_resumed_or_restarted_and_verified(self) -> None:
        # SimpleHTTPRequestHandler ignores Range, so the script must fall back to a
        # full restart; the result still has to verify.
        manifest = self._manifest(sha=self.weights_sha, labels_sha=self.labels_sha)
        cache = Path(tempfile.mkdtemp(dir=self.root)) / "cache"
        part = cache / "test-model" / "model.onnx.part"
        part.parent.mkdir(parents=True)
        part.write_bytes(self.weights[: len(self.weights) // 2])
        code, out, _, _ = self._run(manifest, cache=cache)
        self.assertEqual(code, dm.EXIT_OK, out)
        self.assertFalse(part.exists())
        self.assertEqual(dm.sha256_of(cache / "test-model" / "model.onnx"), self.weights_sha)


if __name__ == "__main__":
    unittest.main()
