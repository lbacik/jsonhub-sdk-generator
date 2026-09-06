#!/usr/bin/env node

/**
 * Prints one dotted field of a TOML file, e.g.
 * `node toml-field.mjs pyproject.toml tool.poetry.version` - the TOML
 * counterpart to scripts/lib.sh's json_field, used where a release script
 * needs a value out of a Poetry manifest.
 */

import { readFileSync } from "node:fs";
import { parse } from "smol-toml";

const [, , filePath, dottedPath] = process.argv;

if (!filePath || !dottedPath) {
  console.error("Usage: toml-field.mjs <file> <dotted.path>");
  process.exit(1);
}

const document = parse(readFileSync(filePath, "utf8"));
const value = dottedPath.split(".").reduce((node, key) => node?.[key], document);

console.log(value);
