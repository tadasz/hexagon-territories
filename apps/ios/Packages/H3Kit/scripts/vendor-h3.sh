#!/usr/bin/env bash
# Vendors the Uber H3 C core into the SPM C target `CH3` (apps/ios/Packages/H3Kit/Sources/CH3).
#
# Usage: scripts/vendor-h3.sh [H3_TAG]        (default: the pinned tag below)
#
# What it does:
#   1. Fetches the tagged H3 release (tarball via curl; falls back to a shallow `git clone --branch <tag>`
#      when the archive host is unreachable, e.g. behind an egress proxy).
#   2. Copies src/h3lib/lib/*.c              -> Sources/CH3/lib/
#             src/h3lib/include/*.h          -> Sources/CH3/internal/   (private headers)
#      generates src/h3lib/include/h3api.h.in -> Sources/CH3/include/h3api.h  (public header, version macros substituted)
#   3. Writes Sources/CH3/VERSION (the tag without the leading "v") and Sources/CH3/LICENSE (Apache 2.0).
#
# The generated files are committed so `swift build` needs no network (research.md R2).
# Build notes: H3 4.2.x's library code uses neither VLA nor alloca, so no H3_HAVE_VLA / H3_HAVE_ALLOCA
# definitions are required; H3_PREFIX is left undefined so symbols keep their plain names (latLngToCell, ...).
set -euo pipefail

H3_TAG="${1:-v4.2.1}"
H3_VERSION="${H3_TAG#v}"
IFS='.' read -r H3_MAJOR H3_MINOR H3_PATCH <<<"${H3_VERSION}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST="${PKG_DIR}/Sources/CH3"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "Vendoring H3 ${H3_TAG} into ${DEST}"

SRC=""
TARBALL_URL="https://github.com/uber/h3/archive/refs/tags/${H3_TAG}.tar.gz"
if curl -fsSL --max-time 120 -o "${WORK}/h3.tar.gz" "${TARBALL_URL}"; then
  tar -xzf "${WORK}/h3.tar.gz" -C "${WORK}"
  SRC="${WORK}/h3-${H3_VERSION}"
else
  echo "Tarball download failed (${TARBALL_URL}); falling back to git clone" >&2
  git clone --quiet --depth 1 --branch "${H3_TAG}" https://github.com/uber/h3.git "${WORK}/h3-git"
  SRC="${WORK}/h3-git"
fi

if [[ ! -f "${SRC}/src/h3lib/include/h3api.h.in" ]]; then
  echo "error: ${SRC} does not look like an H3 checkout (missing src/h3lib/include/h3api.h.in)" >&2
  exit 1
fi

UPSTREAM_VERSION="$(head -n1 "${SRC}/VERSION" | tr -d '[:space:]')"
if [[ "${UPSTREAM_VERSION}" != "${H3_VERSION}" ]]; then
  echo "error: upstream VERSION file says ${UPSTREAM_VERSION}, expected ${H3_VERSION}" >&2
  exit 1
fi

rm -rf "${DEST}/lib" "${DEST}/internal" "${DEST}/include/h3api.h"
mkdir -p "${DEST}/lib" "${DEST}/internal" "${DEST}/include"

cp "${SRC}"/src/h3lib/lib/*.c "${DEST}/lib/"
for header in "${SRC}"/src/h3lib/include/*.h; do
  cp "${header}" "${DEST}/internal/"
done

sed -e "s/@H3_VERSION_MAJOR@/${H3_MAJOR}/" \
    -e "s/@H3_VERSION_MINOR@/${H3_MINOR}/" \
    -e "s/@H3_VERSION_PATCH@/${H3_PATCH}/" \
    "${SRC}/src/h3lib/include/h3api.h.in" > "${DEST}/include/h3api.h"

if grep -q '@H3_VERSION' "${DEST}/include/h3api.h"; then
  echo "error: unsubstituted version placeholders remain in h3api.h" >&2
  exit 1
fi

printf '%s\n' "${H3_VERSION}" > "${DEST}/VERSION"
cp "${SRC}/LICENSE" "${DEST}/LICENSE"

echo "Vendored H3 ${H3_VERSION}: $(ls "${DEST}/lib" | wc -l | tr -d ' ') C files, $(ls "${DEST}/internal" | wc -l | tr -d ' ') private headers, include/h3api.h"
