# shellcheck shell=bash
#
# Shared helpers for scripts/generate-and-decide.sh and
# scripts/publish-to-target.sh. Sourced, not executed.

# Prints one field of a JSON file, e.g. `json_field package.json version`.
json_field() {
  node -p "require('$1').$2"
}

# Resolves a Product/SDK Target through src/product.mjs and writes the
# resolution JSON to the file given as $1. Both pipeline halves call this once
# and read what they need with json_field, so no Product name, repository, or
# metadata path stays hardcoded in them. Requires PRODUCT, TARGET and
# GENERATOR_DIR from the calling script.
resolve_product() {
  node "$GENERATOR_DIR/src/resolve-product.mjs" \
    --products-dir "$GENERATOR_DIR/products" \
    --product "$PRODUCT" \
    --target "$TARGET" > "$1"
}

# Prints one dotted field of a TOML file, e.g.
# `toml_field pyproject.toml tool.poetry.version` - the pyproject.toml
# counterpart to json_field, for the python SDK Target's Poetry manifest.
# Requires GENERATOR_DIR (its scripts/toml-field.mjs resolves the smol-toml
# dependency from this repository's own node_modules).
toml_field() {
  node "$GENERATOR_DIR/scripts/toml-field.mjs" "$1" "$2"
}
