"""Schema and licence-policy tests for ``ml/models/manifest.json``.

Run with ``python3 -m unittest discover -s ml/tests -v`` (no third-party
dependencies). The rules come from ``specs/001-repo-foundations/data-model.md``
§3 and Constitution Principle III v1.1.0 (Licence Before Ship, ADR 0011): a model
whose licence is non-commercial may never carry a ``primary-*`` role and may
never be allowed in App Store builds (``allowed_builds`` without ``appstore``).
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ML_DIR / "models" / "manifest.json"
MODELS_DIR = ML_DIR / "models"

NAME_RE = re.compile(r"^[a-z0-9.-]+$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
NON_COMMERCIAL_RE = re.compile(r"(?<![A-Z])NC(?![A-Z])|NON[- ]?COMMERCIAL", re.IGNORECASE)

KINDS = {"bird-audio-classifier", "species-presence", "plant-image-classifier"}
FORMATS = {"onnx", "tflite", "mlmodel"}
ROLES = {
    "primary-on-device",
    "primary-server",
    "evaluated-fallback",
    "prototype-fallback",
    "evaluation-only",
}
AUDIO_KINDS = {"bird-audio-classifier"}
BUILDS = {"debug", "testflight", "appstore"}
REQUIRED_KEYS = {
    "name",
    "kind",
    "version",
    "format",
    "source",
    "license",
    "attribution",
    "sha256",
    "role",
    "allowed_builds",
    "notes",
    "files",
}
REQUIRED_FILE_KEYS = {"path", "url", "sha256", "bytes"}


def load_manifest(path: Path = MANIFEST_PATH) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def is_non_commercial(license_text: str) -> bool:
    """True when a licence string contains ``NC`` or ``NON-COMMERCIAL``."""
    return bool(NON_COMMERCIAL_RE.search(license_text))


def licence_violations(manifest: dict) -> list[str]:
    """Constitution III (v1.1.0, ADR 0011): a non-commercial licence never carries a
    ``primary-*`` role and never lists ``appstore`` in ``allowed_builds``."""
    problems = []
    for model in manifest.get("models", []):
        role = model.get("role", "")
        if not is_non_commercial(model.get("license", "")):
            continue
        if role.startswith("primary-"):
            problems.append(f"{model.get('name')}: role {role} with non-commercial licence {model.get('license')!r}")
        if "appstore" in (model.get("allowed_builds") or []):
            problems.append(f"{model.get('name')}: non-commercial licence {model.get('license')!r} allowed in appstore builds")
    return problems


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ManifestSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = load_manifest()
        cls.models = cls.manifest["models"]

    def test_manifest_lists_the_expected_models(self) -> None:
        names = {m["name"] for m in self.models}
        self.assertTrue({"birdnet-plus-v3-global-10k-pruned-fp16", "birdnet-geomodel", "perch-v2"} <= names)

    def test_required_keys_present(self) -> None:
        for model in self.models:
            missing = REQUIRED_KEYS - set(model)
            self.assertFalse(missing, f"{model.get('name')}: missing keys {sorted(missing)}")

    def test_names_are_unique_and_well_formed(self) -> None:
        names = [m["name"] for m in self.models]
        self.assertEqual(len(names), len(set(names)), "duplicate model names")
        for name in names:
            self.assertRegex(name, NAME_RE)

    def test_enums(self) -> None:
        for model in self.models:
            with self.subTest(model=model["name"]):
                self.assertIn(model["kind"], KINDS)
                self.assertIn(model["format"], FORMATS)
                self.assertIn(model["role"], ROLES)

    def test_allowed_builds_is_a_non_empty_subset_of_known_builds(self) -> None:
        for model in self.models:
            with self.subTest(model=model["name"]):
                builds = model.get("allowed_builds")
                self.assertIsInstance(builds, list)
                self.assertTrue(builds, "allowed_builds must not be empty")
                self.assertEqual(len(builds), len(set(builds)), "duplicate build types")
                self.assertTrue(set(builds) <= BUILDS, f"unknown build types {sorted(set(builds) - BUILDS)}")

    def test_primary_models_are_allowed_in_every_build(self) -> None:
        """The primary model must exist in every build so removing a fallback never changes the product."""
        for model in self.models:
            if model["role"].startswith("primary-"):
                with self.subTest(model=model["name"]):
                    self.assertEqual(set(model["allowed_builds"]), BUILDS)

    def test_audio_models_declare_sample_rate_and_window(self) -> None:
        for model in self.models:
            if model["kind"] in AUDIO_KINDS:
                with self.subTest(model=model["name"]):
                    self.assertIsInstance(model.get("sample_rate_hz"), int)
                    self.assertGreater(model["sample_rate_hz"], 0)
                    self.assertIsInstance(model.get("window_seconds"), (int, float))
                    self.assertGreater(model["window_seconds"], 0)
                    if "hop_seconds" in model:
                        self.assertGreater(model["hop_seconds"], 0)
                        self.assertLessEqual(model["hop_seconds"], model["window_seconds"])

    def test_source_is_a_url(self) -> None:
        for model in self.models:
            self.assertTrue(model["source"].startswith("https://"), model["name"])

    def test_files_have_required_keys_and_valid_hashes(self) -> None:
        for model in self.models:
            for entry in model["files"]:
                with self.subTest(model=model["name"], path=entry.get("path")):
                    missing = REQUIRED_FILE_KEYS - set(entry)
                    self.assertFalse(missing, f"missing {sorted(missing)}")
                    self.assertFalse(Path(entry["path"]).is_absolute())
                    self.assertNotIn("..", Path(entry["path"]).parts)
                    self.assertTrue(entry["url"].startswith("https://"))
                    if entry["sha256"] is not None:
                        self.assertRegex(entry["sha256"], SHA256_RE)
                    if entry["bytes"] is not None:
                        self.assertIsInstance(entry["bytes"], int)
                        self.assertGreater(entry["bytes"], 0)

    def test_exactly_one_primary_file_whose_hash_matches_model(self) -> None:
        for model in self.models:
            with self.subTest(model=model["name"]):
                primaries = [f for f in model["files"] if f.get("primary")]
                self.assertEqual(len(primaries), 1, "exactly one files[].primary=true per model")
                primary = primaries[0]
                self.assertEqual(primary["sha256"], model["sha256"], "model sha256 must equal the primary file's sha256")
                if model["sha256"] is not None:
                    self.assertRegex(model["sha256"], SHA256_RE)
                if model.get("bytes") is not None and primary.get("bytes") is not None:
                    self.assertEqual(model["bytes"], primary["bytes"])
                suffix = Path(primary["path"]).suffix.lstrip(".")
                if suffix in FORMATS:
                    self.assertEqual(suffix, model["format"], "primary file extension must match format")

    def test_labels_file_is_listed_in_files_and_committed_copy_matches(self) -> None:
        for model in self.models:
            labels = model.get("labels_file")
            if not labels:
                continue
            with self.subTest(model=model["name"]):
                entries = [f for f in model["files"] if f["path"] == labels]
                self.assertEqual(len(entries), 1, f"labels_file {labels} must appear once in files[]")
                committed = MODELS_DIR / labels
                self.assertTrue(committed.exists(), f"{committed} is missing (T041 commits the labels)")
                self.assertGreater(committed.stat().st_size, 0)
                if entries[0]["sha256"] is not None:
                    self.assertEqual(sha256_of(committed), entries[0]["sha256"], f"{committed} differs from the manifest hash")

    def test_primary_models_are_pinned(self) -> None:
        """Primary roles must carry a sha256 or a dated blocker note (T041)."""
        for model in self.models:
            if model["role"].startswith("primary-"):
                with self.subTest(model=model["name"]):
                    if model["sha256"] is None:
                        self.assertRegex(model["notes"], r"\d{4}-\d{2}-\d{2}", "unpinned primary model needs a dated blocker in notes")


class LicencePolicyTests(unittest.TestCase):
    """Constitution III — Licence Before Ship."""

    def setUp(self) -> None:
        self.manifest = load_manifest()

    def test_no_primary_role_has_a_non_commercial_licence(self) -> None:
        self.assertEqual(licence_violations(self.manifest), [])

    def test_guard_rejects_non_commercial_primary_model(self) -> None:
        edited = copy.deepcopy(self.manifest)
        primary = next(m for m in edited["models"] if m["role"] == "primary-on-device")
        primary["allowed_builds"] = ["debug", "testflight"]
        primary["license"] = "CC-BY-NC-SA-4.0"
        self.assertTrue(licence_violations(edited))
        primary["license"] = "Apache-2.0 (non-commercial evaluation build)"
        self.assertTrue(licence_violations(edited))

    def test_guard_rejects_non_commercial_model_in_appstore_builds(self) -> None:
        edited = copy.deepcopy(self.manifest)
        fallback = next(m for m in edited["models"] if m["role"] == "prototype-fallback")
        self.assertTrue(is_non_commercial(fallback["license"]))
        fallback["allowed_builds"] = ["debug", "testflight", "appstore"]
        self.assertEqual(len(licence_violations(edited)), 1)

    def test_non_commercial_models_are_never_allowed_in_appstore_builds(self) -> None:
        for model in self.manifest["models"]:
            if is_non_commercial(model["license"]):
                with self.subTest(model=model["name"]):
                    self.assertNotIn("appstore", model["allowed_builds"])
                    self.assertFalse(model["role"].startswith("primary-"))

    def test_guard_accepts_permissive_strings(self) -> None:
        for text in ("Apache-2.0", "MIT", "BSD-2-Clause", "Apache-2.0 (bundled weights, per BirdNET Live README)"):
            self.assertFalse(is_non_commercial(text), text)

    def test_non_commercial_models_carry_prototype_or_evaluation_roles(self) -> None:
        for model in self.manifest["models"]:
            if is_non_commercial(model["license"]):
                with self.subTest(model=model["name"]):
                    self.assertIn(model["role"], {"prototype-fallback", "evaluation-only"})
                    self.assertTrue(model["files"][0].get("manual"), "non-commercial weights are never auto-downloaded")
                    self.assertIn("non-commercial", model["notes"].lower())

    def test_every_model_names_its_attribution(self) -> None:
        for model in self.manifest["models"]:
            self.assertTrue(model["attribution"].strip(), model["name"])


if __name__ == "__main__":
    unittest.main()
