# Model manifest — status as of 2026-09-07

`manifest.json` is the single source of truth for every model used on device or
on the server (Constitution III). This page records where each artefact comes
from, whether it has been pinned, and what still needs a human.

| Model | Role | Allowed builds | Licence | Primary file | Pinned |
|---|---|---|---|---|---|
| `birdnet-plus-v3-global-10k-pruned-fp16` (BirdNET+ V3.0-preview3.1) | primary-on-device | debug, testflight, appstore | Apache-2.0 (weights, BirdNET Live `MODEL_LICENSE`) | 66,991,322 B ONNX, sha256 `306e74f3edc5b95acc6e87ea7f3f1c701fdc0b18ec868b7615208cd6fc2f9457` | yes — downloaded and verified; hash equals the upstream git-lfs pointer |
| `birdnet-geomodel` (3.0.4, Global 10K-pruned FP16) | primary-on-device | debug, testflight, appstore | Apache-2.0 (weights, geomodel `LICENSE-MODELS.md`) | 13,608,653 B ONNX, sha256 `198adb7bcb3cf03341ffa51fbfa7b2d295e5cd900ba09183dcfdbf6d12b5c63b` | yes — downloaded and verified; hash equals the upstream git-lfs pointer |
| `perch-v2` (Google Perch v2) | evaluated-fallback | debug, testflight, appstore | Apache-2.0 | 379,632,720 B Kaggle bundle (`.tar.gz`), sha256 `c04211da33038176efd299519c398b9486d64a2c1e63fafa4df331600552e556` | yes — downloaded and hashed 2026-09-07 (T055); evaluation in feature 006 |
| `birdnet-v2.4` | prototype-fallback | debug, testflight (never appstore) | CC BY-NC-SA 4.0 (non-commercial) | 53,025,528 B Zenodo zip (`BirdNET_v2.4_tflite_fp16.zip`) | no — manual download / non-commercial phase only (ADR 0011) |

Committed label files (text, hash-checked by `ml/tests/test_manifest.py`):

- `labels/birdnet-plus-v3-global-10k-pruned.csv` — 9,789 rows, `;`-delimited, header `idx;id;sci_name;com_name;class;order`
- `labels/birdnet-plus-v3-global-10k-pruned-score-blacklist.json` — label indices BirdNET Live suppresses
- `labels/birdnet-geomodel-3.0.4-global-10k-pruned.txt` — 9,789 rows, tab-separated `id`, scientific name, common name (same order as the classifier)

## Sources and URLs

**BirdNET+ V3 and Geomodel** are taken from the `assets/models/` directory of
[`birdnet-team/birdnet-live-app`](https://github.com/birdnet-team/birdnet-live-app)
(MIT code; weights Apache 2.0 per its `MODEL_LICENSE`). The `.onnx` files are
git-lfs objects, so the manifest points at the LFS media endpoint
(`https://media.githubusercontent.com/media/birdnet-team/birdnet-live-app/<commit>/assets/models/...`)
and the label/blacklist files at `raw.githubusercontent.com`, both pinned to
commit `8efbd7d5ac7895f37f10e7527e8341df13d9e4c6`. The LFS pointer files in that
commit carry the same sha256 and sizes the script computed, which is an
independent check on the download. `model_config.json` in the same directory
documents the tensor names (`input`, `predictions`, `embeddings_out`,
`probabilities`), the 32 kHz sample rate and the 0.03 Geomodel threshold that the
manifest `notes` repeat.

The Geomodel's own repository, [`birdnet-team/geomodel`](https://github.com/birdnet-team/geomodel)
(tag `v3.0.4`, weights Apache 2.0 per `LICENSE-MODELS.md`), ships an *unpruned*
14,082-species FP16 export at `docs/demo/geomodel_fp16.onnx` with a different
label order. We use the 10K-pruned export because its 9,789 labels line up
one-to-one with the classifier. The releases page of that repository could not
be listed from the agent container (github.com HTML and the releases API are
blocked by the proxy); if the owner prefers a release asset over the live-app
copy, swap `files[].url`, re-run `--record` on a fresh entry and re-run the tests.

**Perch v2**: `https://www.kaggle.com/api/v1/models/google/bird-vocalization-classifier/tensorFlow2/perch_v2/2/download`
(redirects to a signed Google Cloud Storage URL; served without a login on
2026-09-07, but accept the model terms on the Kaggle page first). The Hugging Face
mirror `google/bird-vocalization-classifier` answered 401 through the proxy.
Fetched and hashed on 2026-09-07 with `--include-manual --only perch-v2` (T055); the cached bundle was deleted afterwards and the hash in the manifest is verified on every re-download.

**BirdNET V2.4**: Zenodo record [15050749](https://zenodo.org/records/15050749),
file `BirdNET_v2.4_tflite_fp16.zip` (md5 `4cd35da63e442d974faf2121700192b5`).
The Zenodo metadata says CC BY-NC 4.0, the BirdNET-Analyzer README says
CC BY-NC-SA 4.0; both are non-commercial, the manifest records the stricter one.
The repository no longer contains checkpoints in-tree. Never fetched by default.

## What still needs a human

1. **Stream E, T047** — on a machine with git-lfs:
   `git lfs install`, then
   `python3 ml/scripts/download_models.py --dest apps/ios/Resources/Models`
   and commit the two `.onnx` files as LFS pointers (`git lfs ls-files` lists them).
   `.gitattributes` is already in place; the root `.gitignore` ignores raw
   `*.onnx`/`*.tflite`, so `git add -f` is not needed once LFS is installed —
   LFS tracking takes precedence.
2. **Owner** — send the drafts in `ml/licensing/` and record the sent dates in
   `docs/licences.md` (Cornell: optional until monetisation; Pl@ntNet: before the
   public TestFlight).
3. **Feature 006** — evaluate Perch v2 (already pinned; re-download with
   `--include-manual --only perch-v2`, the hash is verified) against
   `ml/eval/birds`.

## Adding or bumping a model

1. Add the licence row to `docs/licences.md` (or update it) — before any code.
2. Add/edit the manifest entry: `name` (`^[a-z0-9.-]+$`), `kind`, `version`,
   `format`, `source`, `license`, `attribution`, `sample_rate_hz` +
   `window_seconds` for audio models, `labels_file`, `role`, `notes`, and
   `files[]` with exactly one `"primary": true` entry. Leave `sha256: null`.
3. `python3 ml/scripts/download_models.py --only <name> --record` fills the hashes.
4. Copy label files from `cache/<name>/labels/` to `labels/` and run
   `python3 -m unittest discover -s ml/tests -v`.
5. Set `allowed_builds` — a non-empty subset of `debug`, `testflight`, `appstore`
   — to the build types that may bundle the model.
6. Non-commercial weights (licence contains `NC` / `NonCommercial`): role
   `prototype-fallback` or `evaluation-only`, `allowed_builds` without `appstore`
   (Debug/TestFlight only while the product is non-commercial, ADR 0011),
   `"manual": true` on every file, and the word "non-commercial" in `notes`.
