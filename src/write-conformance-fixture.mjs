#!/usr/bin/env node

/**
 * Regenerates the Python SDK Target's conformance fixture
 * (`python-adapter/tests/fixtures/canonical-client-spec.sample.json`) by
 * reducing the sample API Contract committed beside it through the same
 * src/normalizer.mjs the pipeline uses.
 *
 * The conformance suite asserts on a Canonical Client Spec it cannot produce
 * itself - the reduction lives in this repository's Node layer, not on the
 * Python side. Deriving the sample instead of maintaining it by hand is what
 * keeps the two in step; see AGENTS.md for what went wrong when it was
 * hand-maintained.
 */

import { Command } from "commander";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

import { reduceToCanonicalClientSpec } from "./normalizer.mjs";
import { readJsonFile, runIfMain } from "./cli-utils.mjs";

const FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "python-adapter",
  "tests",
  "fixtures"
);

const API_CONTRACT_SAMPLE_PATH = resolve(FIXTURES_DIR, "api-contract.sample.json");
const CANONICAL_CLIENT_SPEC_SAMPLE_PATH = resolve(
  FIXTURES_DIR,
  "canonical-client-spec.sample.json"
);

async function buildConformanceFixture() {
  return reduceToCanonicalClientSpec(await readJsonFile(API_CONTRACT_SAMPLE_PATH));
}

function serializeConformanceFixture(canonicalClientSpec) {
  return `${JSON.stringify(canonicalClientSpec, null, 2)}\n`;
}

const program = new Command();

program
  .name("jh-write-conformance-fixture")
  .description(
    "Regenerates the Python SDK Target's conformance fixture from its sample API Contract."
  )
  .action(async () => {
    await writeFile(
      CANONICAL_CLIENT_SPEC_SAMPLE_PATH,
      serializeConformanceFixture(await buildConformanceFixture()),
      "utf8"
    );

    console.log(`Wrote ${CANONICAL_CLIENT_SPEC_SAMPLE_PATH}`);
  });

runIfMain(import.meta.url, program);

export {
  API_CONTRACT_SAMPLE_PATH,
  CANONICAL_CLIENT_SPEC_SAMPLE_PATH,
  buildConformanceFixture,
  serializeConformanceFixture
};
