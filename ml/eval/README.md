# Model evaluation sets (placeholder for feature 006)

No data lives here yet. This file fixes the layout and the results format so that
feature 006 (bird capture verification thresholds) and feature 010 (on-device
plant hints) can drop evaluation sets in without renegotiating the structure.
Every clip and image added here needs a licence row in `docs/licences.md`
(Constitution III) — only CC0 / CC BY / CC BY-SA material is admitted, with
per-item credit kept in the metadata CSV.

## Layout

```
ml/eval/
  README.md                     # this file
  birds/
    manifest.csv                # one row per clip (see columns below)
    clips/<xc-id>.flac          # git-lfs; 3–10 s mono, original sample rate
    splits/{dev,test}.txt       # clip ids per split; test is frozen once published
  plants/
    manifest.csv                # one row per image
    images/<gbif-key>.jpg       # git-lfs; long edge ≤ 1024 px
    splits/{dev,test}.txt
  results/
    <model-name>/<YYYY-MM-DD>-<git-sha>.json   # one file per run, never edited
```

## Bird set (feature 006)

- Scope: the ~250 species seeded for region `lt` (Geomodel over a Lithuania grid
  plus the eBird checklist), 10–30 clips per species, plus a "none of the above"
  bucket (wind, traffic, speech, dogs) for false-positive measurement.
- Sources: Xeno-canto (CC BY / CC BY-SA clips only, recordist credited per row),
  own field recordings by the team (CC0).
- `birds/manifest.csv` columns: `clip_id, source, source_url, licence, credit,
  species_scientific, species_gbif_key, recorded_lat, recorded_lon, recorded_week,
  quality (A–C), split, notes`.
- Every clip is scored at the model's native sample rate (32 kHz for BirdNET+ V3
  and Perch v2, 48 kHz for BirdNET V2.4) with the window/hop from
  `ml/models/manifest.json`; the Geomodel mask is applied with the clip's
  `recorded_*` metadata, exactly as the API worker does.

## Plant set (feature 010)

- Scope: ~300 common Lithuanian taxa; 20–50 images per taxon with organ tags
  (`leaf`, `flower`, `fruit`, `bark`, `habit`), drawn from GBIF occurrences
  filtered to CC0 / CC BY.
- `plants/manifest.csv` columns: `image_id, gbif_occurrence_key, gbif_taxon_key,
  species_scientific, organ, licence, credit, source_url, split, notes`.
- The Pl@ntNet API (cloud verifier) is scored against the same set so the
  on-device hint model can be compared to the verifier it feeds.

## Results format

One JSON document per run under `results/<model-name>/`:

```json
{
  "model": "birdnet-plus-v3-global-10k-pruned-fp16",
  "model_sha256": "306e74f3…",
  "eval_set": "birds",
  "split": "test",
  "git_sha": "abc1234",
  "run_at": "2026-11-02T10:15:00Z",
  "runtime": "onnxruntime 1.19 (CoreML EP)",
  "thresholds": { "verified": 0.5, "confirm_min": 0.3 },
  "metrics": {
    "top1_accuracy": 0.0,
    "top3_accuracy": 0.0,
    "macro_f1": 0.0,
    "false_positive_rate_none": 0.0,
    "per_species": { "Parus major": { "n": 25, "top1": 0.0, "top3": 0.0 } }
  },
  "latency_ms": { "p50": 0, "p95": 0, "device": "iPhone 13" }
}
```

`model_sha256` must equal the manifest hash so a result can always be tied to
the exact weights; feature 006 turns the metrics block into the acceptance gate
for changing the verification thresholds in `docs/architecture.md` §7.
