#!/usr/bin/env node

/**
 * Thin I/O wrapper around decideRelease() (src/release-decision.mjs): reads
 * the previous/current Canonical Client Spec files and SDK Surface
 * directories from disk, then prints the verdict as JSON. Invoked on demand,
 * it never performs a release itself - see CONTEXT.md and
 * docs/adr/0001-sdk-versioning.md for what the verdict means.
 */

import { Command } from "commander";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { decideRelease } from "./release-decision.mjs";
import { collect, readJsonFile, runIfMain } from "./cli-utils.mjs";

async function readSdkSurface(dir) {
  const relativePaths = await readdir(dir, { recursive: true });
  const surface = {};

  for (const relativePath of relativePaths) {
    const absolutePath = join(dir, relativePath);

    if (!(await stat(absolutePath)).isFile()) {
      continue;
    }

    surface[relativePath.split(sep).join("/")] = await readFile(absolutePath, "utf8");
  }

  return surface;
}

async function run(options) {
  const [
    previousCanonicalClientSpec,
    currentCanonicalClientSpec,
    previousSdkSurface,
    currentSdkSurface
  ] = await Promise.all([
    readJsonFile(options.previousCanonicalClientSpec),
    readJsonFile(options.currentCanonicalClientSpec),
    readSdkSurface(options.previousSurface),
    readSdkSurface(options.currentSurface)
  ]);

  return decideRelease({
    previousCanonicalClientSpec,
    currentCanonicalClientSpec,
    previousSdkSurface,
    currentSdkSurface,
    previousToolchainVersion: options.previousToolchainVersion,
    currentToolchainVersion: options.currentToolchainVersion,
    versionBearingFilePaths: options.versionBearingFile,
    force: Boolean(options.force)
  });
}

const program = new Command();

program
  .name("jh-decide-release")
  .description(
    "Prints the release verdict for a regenerated SDK Target, without releasing anything."
  )
  .requiredOption(
    "--previous-canonical-client-spec <file>",
    "Previous Canonical Client Spec file",
    (value) => resolve(process.cwd(), value)
  )
  .requiredOption(
    "--current-canonical-client-spec <file>",
    "Current Canonical Client Spec file",
    (value) => resolve(process.cwd(), value)
  )
  .requiredOption("--previous-surface <dir>", "Previous SDK Surface directory", (value) =>
    resolve(process.cwd(), value)
  )
  .requiredOption("--current-surface <dir>", "Current SDK Surface directory", (value) =>
    resolve(process.cwd(), value)
  )
  .requiredOption(
    "--previous-toolchain-version <version>",
    "Generator/toolchain version the previous SDK Surface was built with"
  )
  .requiredOption(
    "--current-toolchain-version <version>",
    "Generator/toolchain version the current SDK Surface was built with"
  )
  .option(
    "--version-bearing-file <path>",
    "SDK Surface file (relative to --previous-surface/--current-surface) to exclude from comparison, e.g. package.json. Repeatable.",
    collect,
    []
  )
  .option(
    "--force",
    "Release even when the Canonical Client Spec and the SDK Surface are unchanged, for rolling out a generator-side metadata change the detectors cannot see. Does not choose the bump level - that is still classified from the spec comparison."
  )
  .action(async (options) => {
    const verdict = await run(options);
    console.log(JSON.stringify(verdict, null, 2));
  });

runIfMain(import.meta.url, program);

export { readSdkSurface };
