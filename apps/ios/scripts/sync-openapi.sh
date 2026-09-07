#!/usr/bin/env bash
# Copies the committed OpenAPI snapshot (packages/api-schema/openapi.json, written by
# `pnpm --filter @nature/api-schema snapshot`) into the APIClient package, where the swift-openapi-generator plugin
# reads it at build time (research.md R11; plan.md Deviations: a copy, not a symlink). Run it after every snapshot;
# the equality test in @nature/api-schema fails while the two files differ.
#
#   apps/ios/scripts/sync-openapi.sh                  # copy packages/api-schema/openapi.json
#   apps/ios/scripts/sync-openapi.sh --from-contract  # fallback before the snapshot exists: convert
#                                                     # specs/002-auth-and-factions/contracts/openapi.yaml (needs PyYAML)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
snapshot="$root/packages/api-schema/openapi.json"
contract="$root/specs/002-auth-and-factions/contracts/openapi.yaml"
dst="$root/apps/ios/Packages/APIClient/Sources/APIClient/openapi.json"

if [[ "${1:-}" == "--from-contract" ]]; then
  [[ -f "$contract" ]] || { echo "sync-openapi: $contract not found" >&2; exit 1; }
  python3 - "$contract" "$dst" <<'PY'
import json, sys
import yaml  # PyYAML
doc = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
doc["info"]["x-source"] = (
    "TEMPORARY copy converted from specs/002-auth-and-factions/contracts/openapi.yaml; "
    "replace with packages/api-schema/openapi.json via apps/ios/scripts/sync-openapi.sh"
)
with open(sys.argv[2], "w", encoding="utf-8") as out:
    json.dump(doc, out, indent=2, ensure_ascii=False)
    out.write("\n")
PY
  echo "sync-openapi: wrote a TEMPORARY document from the contract to ${dst#"$root"/} (replace it once the snapshot exists)"
  exit 0
fi

[[ -f "$snapshot" ]] || {
  echo "sync-openapi: $snapshot not found — run 'pnpm --filter @nature/api-schema snapshot' first (or use --from-contract)" >&2
  exit 1
}
python3 -c 'import json, sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$snapshot"
cp "$snapshot" "$dst"
echo "sync-openapi: copied $(wc -c <"$snapshot" | tr -d ' ') bytes to ${dst#"$root"/}"
