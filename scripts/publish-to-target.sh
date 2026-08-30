#!/usr/bin/env bash
set -euo pipefail

# Writes package metadata, retains the Canonical Client Spec, then commits
# and tags the freshly generated SDK Surface into the SDK Target's own
# repository (jsonhub-sdk-ts) - the publishing half of the pipeline, kept
# apart from scripts/generate-and-decide.sh's fetch/generate/decide work (see
# AGENTS.md: "avoid mixing spec-fetching logic with package-publishing logic
# in a single module"). Called by scripts/release-ts.sh, after
# generate-and-decide.sh has written $WORK_DIR/decision.json - a no-op when
# that verdict says not to release.
#
# Required environment variables: GENERATOR_DIR, TARGET_DIR, WORK_DIR,
# SOURCE_API_VERSION.
#
# Optional environment variables:
#   TARGET_BRANCH         branch in TARGET_DIR to commit and push to (default: main)
#   GIT_USER_NAME / GIT_USER_EMAIL   committer identity for the commit in TARGET_DIR
#   SKIP_PUSH             when "1", commits/tags TARGET_DIR locally but skips `git push` (used by local dry runs)

: "${GENERATOR_DIR:?}"
: "${TARGET_DIR:?}"
: "${WORK_DIR:?}"
: "${SOURCE_API_VERSION:?}"

TARGET_BRANCH="${TARGET_BRANCH:-main}"
GIT_USER_NAME="${GIT_USER_NAME:-jsonhub-sdk-generator[bot]}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-jsonhub-sdk-generator[bot]@users.noreply.github.com}"

# shellcheck source=lib.sh
source "$GENERATOR_DIR/scripts/lib.sh"

DECISION_FILE="$WORK_DIR/decision.json"
CURRENT_SURFACE="$WORK_DIR/current-surface"

if [ "$(json_field "$DECISION_FILE" shouldRelease)" != "true" ]; then
  echo "== No SDK Surface change: nothing to commit or tag =="
  exit 0
fi

BUMP="$(json_field "$DECISION_FILE" bump)"
PREVIOUS_VERSION="$(cat "$WORK_DIR/previous-version")"

echo "== Writing package metadata and the changelog =="
node "$GENERATOR_DIR/src/write-package-metadata.mjs" \
  --target ts \
  --manifest "$CURRENT_SURFACE/package.json" \
  --hand-owned-metadata "$GENERATOR_DIR/manifests/ts/package.metadata.json" \
  --changelog "$CURRENT_SURFACE/CHANGELOG.md" \
  --source-api-version "$SOURCE_API_VERSION" \
  --previous-version "$PREVIOUS_VERSION" \
  --bump "$BUMP"

VERSION="$(json_field "$CURRENT_SURFACE/package.json" version)"

echo "== Retaining the Canonical Client Spec for the next run =="
mkdir -p "$CURRENT_SURFACE/.jsonhub"
cp "$WORK_DIR/canonical-client-spec.json" "$CURRENT_SURFACE/.jsonhub/canonical-client-spec.json"

echo "== Committing and tagging jsonhub-sdk-ts v$VERSION =="
# .github is excluded from the wipe alongside .git: it holds the hand-maintained
# npm publish workflow (see README's "Publishing the TypeScript SDK Release to
# npm"), not something openapi-generator ever emits, so it would otherwise be
# deleted by every release. The unqualified copy below is safe only as long as
# that holds - $CURRENT_SURFACE never containing a .github of its own - since
# cp -a has no matching exclusion.
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 ! -name ".git" ! -name ".github" -exec rm -rf {} +
cp -a "$CURRENT_SURFACE/." "$TARGET_DIR/"

(
  cd "$TARGET_DIR"
  git config user.name "$GIT_USER_NAME"
  git config user.email "$GIT_USER_EMAIL"
  git add -A
  git commit -m "Release jsonhub-sdk-ts v$VERSION (source API $SOURCE_API_VERSION)"
  git tag "v$VERSION"

  if [ "${SKIP_PUSH:-0}" != "1" ]; then
    git push origin "HEAD:$TARGET_BRANCH"
    git push origin "v$VERSION"
  fi
)

echo "Released jsonhub-sdk-ts v$VERSION from source API $SOURCE_API_VERSION."
