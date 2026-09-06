#!/usr/bin/env bash
set -euo pipefail

# Fetches the live API Contract, reduces it to a Canonical Client Spec,
# generates the SDK Surface for $TARGET, and decides whether and how much to
# release - the read-only half of the pipeline, kept apart from
# scripts/publish-to-target.sh's git/publish work (see AGENTS.md: "avoid
# mixing spec-fetching logic with package-publishing logic in a single
# module"). Called by scripts/release-ts.sh and scripts/release-python.sh; see
# CONTEXT.md and docs/adr/0001-sdk-versioning.md for the domain vocabulary.
#
# Required environment variables: GENERATOR_DIR, TARGET_DIR (read-only here),
# TARGET (ts | python), API_URL, WORK_DIR.
#
# Writes $WORK_DIR/decision.json always. When it says shouldRelease, also
# writes $WORK_DIR/current-surface/ (generated, not yet metadata-written),
# $WORK_DIR/canonical-client-spec.json, $WORK_DIR/previous-version, and
# $WORK_DIR/current-toolchain-version.

: "${GENERATOR_DIR:?}"
: "${TARGET_DIR:?}"
: "${TARGET:?}"
: "${API_URL:?}"
: "${WORK_DIR:?}"

# shellcheck source=lib.sh
source "$GENERATOR_DIR/scripts/lib.sh"

# The one place this script (and publish-to-target.sh) branches per SDK
# Target: the manifest file each ecosystem's generator writes, the package
# name passed to the generator, and how to read that manifest's version
# field. Add a target here only once src/package-metadata.mjs's
# PACKAGE_NAME_BY_TARGET and manifests/<target>/package.metadata.json also
# know about it.
case "$TARGET" in
  ts)
    MANIFEST_FILE="package.json"
    CLI_PACKAGE_NAME="jsonhub-sdk-ts"
    read_version() { json_field "$1" version; }
    ;;
  python)
    MANIFEST_FILE="pyproject.toml"
    # Poetry's own project name must be a valid Python identifier (no
    # hyphens); write-package-metadata.mjs overwrites [tool.poetry].name to
    # the hyphenated "jsonhub-sdk-python" PyPI distribution name afterwards -
    # see CONTEXT.md and the "Package metadata" section of README.md.
    CLI_PACKAGE_NAME="jsonhub_sdk_python"
    read_version() { toml_field "$1" tool.poetry.version; }
    ;;
  *)
    echo "::error::Unsupported TARGET \"$TARGET\". Expected: ts | python" >&2
    exit 1
    ;;
esac

PREVIOUS_SURFACE="$WORK_DIR/previous-surface"
CURRENT_SURFACE="$WORK_DIR/current-surface"
PREVIOUS_SPEC="$WORK_DIR/previous-canonical-client-spec.json"
DECISION_FILE="$WORK_DIR/decision.json"

echo "== Snapshotting the previously published SDK Surface and Canonical Client Spec =="

# The previous SDK Surface is whatever is already committed in the SDK
# Target's repository. .jsonhub/, CHANGELOG.md and any lockfile a human ran
# (package-lock.json, poetry.lock) are not part of the generated SDK Surface
# (pipeline/hand metadata, not generator output), so they are stripped before
# src/release-decision.mjs compares - left in, they would make an unrelated
# file look like an SDK Surface change.
rm -rf "$PREVIOUS_SURFACE"
mkdir -p "$PREVIOUS_SURFACE"
cp -a "$TARGET_DIR/." "$PREVIOUS_SURFACE/"
rm -rf "$PREVIOUS_SURFACE/.git"
rm -f "$PREVIOUS_SURFACE/CHANGELOG.md" "$PREVIOUS_SURFACE/package-lock.json" "$PREVIOUS_SURFACE/poetry.lock"

if [ -f "$TARGET_DIR/.jsonhub/canonical-client-spec.json" ]; then
  cp "$TARGET_DIR/.jsonhub/canonical-client-spec.json" "$PREVIOUS_SPEC"
else
  echo "{}" > "$PREVIOUS_SPEC"
fi
rm -rf "$PREVIOUS_SURFACE/.jsonhub"

# .jsonhub/toolchain-version (retained by publish-to-target.sh alongside the
# Canonical Client Spec) is the authoritative source once a release has gone
# through it. python has no generator-written version marker to fall back on
# at all (unlike ts's .openapi-generator/VERSION, an openapi-generator-cli
# artifact), so this fallback only ever fires for ts releases tagged before
# .jsonhub/toolchain-version existed.
if [ -f "$TARGET_DIR/.jsonhub/toolchain-version" ]; then
  PREVIOUS_TOOLCHAIN_VERSION="$(cat "$TARGET_DIR/.jsonhub/toolchain-version")"
elif [ -f "$PREVIOUS_SURFACE/.openapi-generator/VERSION" ]; then
  PREVIOUS_TOOLCHAIN_VERSION="$(cat "$PREVIOUS_SURFACE/.openapi-generator/VERSION")"
else
  PREVIOUS_TOOLCHAIN_VERSION="none"
fi

if [ -f "$TARGET_DIR/$MANIFEST_FILE" ]; then
  read_version "$TARGET_DIR/$MANIFEST_FILE" > "$WORK_DIR/previous-version"
else
  echo "0.0.0" > "$WORK_DIR/previous-version"
fi

# Known ahead of generation, from this repository's own pinned toolchain -
# unlike the SDK Surface's own copy of it, it costs nothing to read.
case "$TARGET" in
  ts)
    CURRENT_TOOLCHAIN_VERSION="$(node -p "require('$GENERATOR_DIR/openapitools.json')['generator-cli'].version")"
    ;;
  python)
    CURRENT_TOOLCHAIN_VERSION="$(toml_field "$GENERATOR_DIR/python-adapter/pyproject.toml" tool.poetry.dependencies.openapi-python-client)"
    ;;
esac
echo "$CURRENT_TOOLCHAIN_VERSION" > "$WORK_DIR/current-toolchain-version"

echo "== Fetching the API Contract and reducing it to a Canonical Client Spec =="
(
  cd "$GENERATOR_DIR"
  node ./src/cli.mjs --url "$API_URL" --target "$TARGET" --skip-generation
)

# Detector 1: a cheap digest of the Canonical Client Spec. Unchanged, with the
# toolchain version also unchanged, stops here - before the (Java- or
# Python-based) generator ever runs - so an unchanged API Contract costs
# almost nothing to process. This mirrors src/release-decision.mjs's own
# early exit; see CONTEXT.md for why there are three detectors and not one:
#   1. this digest, a cheap filter, run here before generation;
#   2/3. a generated SDK Surface comparison and a structured Canonical Client
#        Spec comparison, both run together below by decide-release.mjs once
#        generation has actually happened.
PREVIOUS_DIGEST="$(node "$GENERATOR_DIR/src/canonical-spec-digest.mjs" --canonical-client-spec "$PREVIOUS_SPEC")"
CURRENT_DIGEST="$(node "$GENERATOR_DIR/src/canonical-spec-digest.mjs" --canonical-client-spec "$GENERATOR_DIR/.cache/canonical-client-spec.json")"

if [ "$PREVIOUS_DIGEST" = "$CURRENT_DIGEST" ] && [ "$PREVIOUS_TOOLCHAIN_VERSION" = "$CURRENT_TOOLCHAIN_VERSION" ]; then
  cat > "$DECISION_FILE" <<JSON
{
  "shouldRelease": false,
  "bump": null,
  "reason": "canonical-client-spec-unchanged",
  "breakingChanges": [],
  "additiveChanges": []
}
JSON
  cat "$DECISION_FILE"
  echo "== No SDK Surface change: skipped generation =="
  exit 0
fi

echo "== Generating the $TARGET SDK Surface =="
rm -rf "$CURRENT_SURFACE"
(
  cd "$GENERATOR_DIR"
  node ./src/cli.mjs \
    --url "$API_URL" \
    --target "$TARGET" \
    --package-name "$CLI_PACKAGE_NAME" \
    --output "$CURRENT_SURFACE"
)

echo "== Deciding whether and how much to release =="
node "$GENERATOR_DIR/src/decide-release.mjs" \
  --previous-canonical-client-spec "$PREVIOUS_SPEC" \
  --current-canonical-client-spec "$GENERATOR_DIR/.cache/canonical-client-spec.json" \
  --previous-surface "$PREVIOUS_SURFACE" \
  --current-surface "$CURRENT_SURFACE" \
  --previous-toolchain-version "$PREVIOUS_TOOLCHAIN_VERSION" \
  --current-toolchain-version "$CURRENT_TOOLCHAIN_VERSION" \
  --version-bearing-file "$MANIFEST_FILE" \
  | tee "$DECISION_FILE"

if [ "$(json_field "$DECISION_FILE" shouldRelease)" = "true" ]; then
  cp "$GENERATOR_DIR/.cache/canonical-client-spec.json" "$WORK_DIR/canonical-client-spec.json"
fi
