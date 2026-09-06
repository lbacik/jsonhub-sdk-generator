# shellcheck shell=bash
#
# Shared helpers for scripts/generate-and-decide.sh and
# scripts/publish-to-target.sh. Sourced, not executed.

# Prints one field of a JSON file, e.g. `json_field package.json version`.
json_field() {
  node -p "require('$1').$2"
}

# Prints one dotted field of a TOML file, e.g.
# `toml_field pyproject.toml tool.poetry.version` - the pyproject.toml
# counterpart to json_field, for the python SDK Target's Poetry manifest.
# Requires GENERATOR_DIR (its scripts/toml-field.mjs resolves the smol-toml
# dependency from this repository's own node_modules).
toml_field() {
  node "$GENERATOR_DIR/scripts/toml-field.mjs" "$1" "$2"
}
