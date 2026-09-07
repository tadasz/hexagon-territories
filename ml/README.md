# `ml/` — models, evaluation and licensing

Everything about machine-learning models for Nature Explorer that is not
application code: the pinned model manifest, the download/verify script, the
evaluation-set layout and the licence inquiry drafts. Standard-library Python
only (3.11+); no virtualenv needed until feature 006 adds the eval harness.

## Layout

```
ml/
  models/
    manifest.json        # every model: version, source, licence, sha256, files[] (data-model.md §3)
    README.md            # per-model download status, blockers and how to add a model
    labels/              # committed label files (text, not LFS), verified against the manifest
    cache/               # downloaded weights (gitignored) — ml/scripts/download_models.py writes here
  scripts/
    download_models.py   # download, resume, hash, verify, --record, --dest
  tests/
    test_manifest.py         # manifest schema + Constitution III licence guard
    test_download_models.py  # offline tests of the script against a local http.server
  eval/
    README.md            # planned bird/plant eval sets and results format (feature 006 / 010)
  licensing/
    birdnet-v24-inquiry.md   # draft e-mail to Cornell (optional until monetisation)
    plantnet-pro-inquiry.md  # draft e-mail to Pl@ntNet (before public TestFlight)
```

## Commands

```bash
python3 -m unittest discover -s ml/tests -v                      # schema, licence policy, script tests (offline)
python3 ml/scripts/download_models.py                            # fetch + verify every non-manual file into ml/models/cache/
python3 ml/scripts/download_models.py --only birdnet-geomodel    # one model (alias: --model)
python3 ml/scripts/download_models.py --skip-download            # verify the cache only (alias: --verify-only); "OK <model> <path> <sha256>" per file
python3 ml/scripts/download_models.py --record                   # fill sha256/bytes that are still null (never overwrites a pinned hash)
python3 ml/scripts/download_models.py --dest apps/ios/Resources/Models   # copy verified files for the git-lfs commit (Stream E, T047)
python3 ml/scripts/download_models.py --include-manual           # also fetch files flagged manual (Perch v2 bundle, BirdNET V2.4 zip)
```

Exit codes: `0` all verified, `2` sha256 mismatch, `3` download failure or missing
cache file. Files larger than `--max-bytes` (default 500 MB) are skipped and
reported. Downloads resume from a `.part` file when the server honours `Range`.

## Rules

- **Constitution III — Licence Before Ship.** A model is added to
  `models/manifest.json` (with licence and attribution) *before* any code
  references it. `test_manifest.py` fails if a `primary-*` model's licence
  string contains `NC` or `NON-COMMERCIAL`. BirdNET V2.4 (CC BY-NC-SA) carries
  role `prototype-fallback` and is allowed only while the app is non-commercial
  (ADR 0006 addendum); it is never auto-downloaded.
- **Weights are git-lfs, labels are text.** `.gitattributes` routes `*.onnx`,
  `*.tflite`, `*.mlmodelc/**` and `*.mlpackage/**` through LFS. Run
  `git lfs install` once per clone before committing weights. Label files are
  committed under `models/labels/` and must hash-match the manifest.
- **Pin by hash.** A model update changes `version`, `files[].url`, `sha256` and
  `bytes` together, goes through the eval set (`ml/eval/`), and is recorded in
  `docs/licences.md` if the licence or attribution changed.
- **Agents do not send e-mail.** The drafts in `licensing/` are sent by the
  owner, who records the sent date in the inquiry log of `docs/licences.md`.
