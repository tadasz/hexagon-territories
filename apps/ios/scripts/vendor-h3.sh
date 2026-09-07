#!/usr/bin/env bash
# Convenience entry point: vendors the Uber H3 C core into Packages/H3Kit/Sources/CH3.
# The real script lives next to the package (Packages/H3Kit/scripts/vendor-h3.sh).
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/Packages/H3Kit/scripts/vendor-h3.sh" "$@"
