#!/usr/bin/env bash
set -euo pipefail

# The end-to-end SDK pipeline run for the python SDK Target: fetch the API
# Contract, reduce+generate the SDK Surface, decide whether and how much to
# release, then commit and tag into the SDK Target's own repository
# (jsonhub-sdk-python). Mirrors scripts/release-ts.sh - the two SDK Targets
# differ only in their code generator and their registry (see CONTEXT.md and
# AGENTS.md's per-SDK-Target toolchain policy), so this delegates to the same
# two single-purpose scripts, kept apart per AGENTS.md ("avoid mixing
# spec-fetching logic with package-publishing logic in a single module"):
#   scripts/generate-and-decide.sh - fetch, generate, decide (read-only)
#   scripts/publish-to-target.sh   - write metadata, commit, tag, push
# Called by .github/workflows/release-python.yml; see CONTEXT.md and
# docs/adr/0001-sdk-versioning.md for the domain vocabulary.
#
# Required environment variables:
#   GENERATOR_DIR        checkout of this repository
#   TARGET_DIR            checkout of the jsonhub-sdk-python repository, pushable
#   API_URL               URL of the live API Contract (OpenAPI JSON)
#   SOURCE_API_VERSION    API Release this run generates the SDK Surface from, e.g. v0.9.3
#
# Optional environment variables:
#   WORK_DIR              scratch directory for surfaces/specs (default: a fresh mktemp dir)
#   TARGET_BRANCH         branch in TARGET_DIR to commit and push to (default: main)
#   GIT_USER_NAME / GIT_USER_EMAIL   committer identity for the commit in TARGET_DIR
#   SKIP_PUSH             when "1", commits/tags TARGET_DIR locally but skips `git push` (used by local dry runs)

: "${GENERATOR_DIR:?}"
: "${TARGET_DIR:?}"
: "${API_URL:?}"
: "${SOURCE_API_VERSION:?}"

export TARGET="python"
export WORK_DIR="${WORK_DIR:-$(mktemp -d)}"

"$GENERATOR_DIR/scripts/generate-and-decide.sh"
"$GENERATOR_DIR/scripts/publish-to-target.sh"
