#!/usr/bin/env bash
# Xcode Cloud post-clone hook (ADR 0009): install XcodeGen and git-lfs, pull LFS model weights, generate the project.
# Xcode Cloud runs this script from apps/ios/ci_scripts with CI_PRIMARY_REPOSITORY_PATH set to the checkout root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "${IOS_DIR}/../.." && pwd)}"

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_ENV_HINTS=1

echo "==> Installing XcodeGen and git-lfs"
brew install xcodegen git-lfs

echo "==> Pulling git-lfs objects (model weights under apps/ios/Resources/Models)"
cd "${REPO_ROOT}"
git lfs install --local
git lfs pull || { echo "git-lfs pull failed" >&2; exit 1; }

echo "==> Generating NatureExplorer.xcodeproj"
cd "${IOS_DIR}"
xcodegen generate --spec project.yml --use-cache
echo "==> Done"
