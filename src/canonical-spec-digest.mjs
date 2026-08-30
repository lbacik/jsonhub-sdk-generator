#!/usr/bin/env node

/**
 * Thin I/O wrapper around canonicalClientSpecDigest() (src/release-decision.mjs):
 * reads a Canonical Client Spec file from disk and prints its digest. Lets
 * scripts/generate-and-decide.sh answer detector 1 (see CONTEXT.md and
 * src/release-decision.mjs) before generation runs, so an unchanged API
 * Contract never reaches the code generator.
 */

import { Command } from "commander";
import { resolve } from "node:path";

import { canonicalClientSpecDigest } from "./release-decision.mjs";
import { readJsonFile, runIfMain } from "./cli-utils.mjs";

async function run(filePath) {
  return canonicalClientSpecDigest(await readJsonFile(filePath));
}

const program = new Command();

program
  .name("jh-canonical-spec-digest")
  .description("Prints the digest of a Canonical Client Spec file.")
  .requiredOption(
    "--canonical-client-spec <file>",
    "Canonical Client Spec file",
    (value) => resolve(process.cwd(), value)
  )
  .action(async (options) => {
    console.log(await run(options.canonicalClientSpec));
  });

runIfMain(import.meta.url, program);

export { run };
