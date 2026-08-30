# shellcheck shell=bash
#
# Shared helpers for scripts/generate-and-decide.sh and
# scripts/publish-to-target.sh. Sourced, not executed.

# Prints one field of a JSON file, e.g. `json_field package.json version`.
json_field() {
  node -p "require('$1').$2"
}
