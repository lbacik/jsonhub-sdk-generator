#!/usr/bin/env bash
set -euo pipefail

# Writes package metadata, retains the Canonical Client Spec, then commits
# and tags the freshly generated SDK Surface into the SDK Target's own
# repository - the publishing half of the pipeline, kept apart from
# scripts/generate-and-decide.sh's fetch/generate/decide work (see
# AGENTS.md: "avoid mixing spec-fetching logic with package-publishing logic
# in a single module"). Called by scripts/release-ts.sh and
# scripts/release-python.sh, after generate-and-decide.sh has written
# $WORK_DIR/decision.json - a no-op when that verdict says not to release.
#
# Required environment variables: GENERATOR_DIR, TARGET_DIR, TARGET (ts |
# python), WORK_DIR, SOURCE_API_VERSION.
#
# Optional environment variables:
#   TARGET_BRANCH         branch in TARGET_DIR to commit and push to (default: main)
#   GIT_USER_NAME / GIT_USER_EMAIL   committer identity for the commit in TARGET_DIR
#   SKIP_PUSH             when "1", commits/tags TARGET_DIR locally but skips `git push` (used by local dry runs)

: "${GENERATOR_DIR:?}"
: "${TARGET_DIR:?}"
: "${TARGET:?}"
: "${WORK_DIR:?}"
: "${SOURCE_API_VERSION:?}"

TARGET_BRANCH="${TARGET_BRANCH:-main}"
GIT_USER_NAME="${GIT_USER_NAME:-jsonhub-sdk-generator[bot]}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-jsonhub-sdk-generator[bot]@users.noreply.github.com}"

# shellcheck source=lib.sh
source "$GENERATOR_DIR/scripts/lib.sh"

# See scripts/generate-and-decide.sh for what each target config means.
# TARGET_REPO_NAME is the unified jsonhub-sdk-<target> name (src/package-metadata.mjs's
# PACKAGE_NAME_BY_TARGET) used in the release commit message and log line -
# TARGET_DIR itself is just a local checkout path (e.g. "target"), not that name.
case "$TARGET" in
  ts)
    MANIFEST_FILE="package.json"
    TARGET_REPO_NAME="jsonhub-sdk-ts"
    read_version() { json_field "$1" version; }
    ;;
  python)
    MANIFEST_FILE="pyproject.toml"
    TARGET_REPO_NAME="jsonhub-sdk-python"
    read_version() { toml_field "$1" tool.poetry.version; }
    ;;
  *)
    echo "::error::Unsupported TARGET \"$TARGET\". Expected: ts | python" >&2
    exit 1
    ;;
esac

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
  --target "$TARGET" \
  --manifest "$CURRENT_SURFACE/$MANIFEST_FILE" \
  --hand-owned-metadata "$GENERATOR_DIR/manifests/$TARGET/package.metadata.json" \
  --changelog "$CURRENT_SURFACE/CHANGELOG.md" \
  --source-api-version "$SOURCE_API_VERSION" \
  --previous-version "$PREVIOUS_VERSION" \
  --bump "$BUMP"

VERSION="$(read_version "$CURRENT_SURFACE/$MANIFEST_FILE")"

echo "== Retaining the Canonical Client Spec and toolchain version for the next run =="
mkdir -p "$CURRENT_SURFACE/.jsonhub"
cp "$WORK_DIR/canonical-client-spec.json" "$CURRENT_SURFACE/.jsonhub/canonical-client-spec.json"
cp "$WORK_DIR/current-toolchain-version" "$CURRENT_SURFACE/.jsonhub/toolchain-version"

echo "== Committing and tagging $TARGET_REPO_NAME v$VERSION =="
# .github and any lockfile a human ran (package-lock.json, poetry.lock) are
# excluded from the wipe alongside .git: .github holds the hand-maintained
# registry-publish workflow (see README's "Publishing the TypeScript SDK
# Release to npm" / "Publishing the Python SDK Release to PyPI") and a
# lockfile is something a human ran, not something the generator ever emits -
# neither would otherwise survive the wipe below. The unqualified copy below
# is safe only as long as that holds - $CURRENT_SURFACE never containing a
# .github, package-lock.json, or poetry.lock of its own - since cp -a has no
# matching exclusion.
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 \
  ! -name ".git" ! -name ".github" ! -name "package-lock.json" ! -name "poetry.lock" \
  -exec rm -rf {} +
cp -a "$CURRENT_SURFACE/." "$TARGET_DIR/"

(
  cd "$TARGET_DIR"
  git config user.name "$GIT_USER_NAME"
  git config user.email "$GIT_USER_EMAIL"
  git add -A
  git commit -m "Release $TARGET_REPO_NAME v$VERSION (source API $SOURCE_API_VERSION)"
  git tag "v$VERSION"

  if [ "${SKIP_PUSH:-0}" != "1" ]; then
    git push origin "HEAD:$TARGET_BRANCH"
    git push origin "v$VERSION"
  fi
)

echo "Released $TARGET_REPO_NAME v$VERSION from source API $SOURCE_API_VERSION."
