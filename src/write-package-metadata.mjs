#!/usr/bin/env node

/**
 * Thin I/O wrapper around src/package-metadata.mjs and src/changelog.mjs:
 * reads a regenerated SDK Target's package manifest and its hand-owned
 * metadata file from disk, writes the merged manifest back, and updates the
 * SDK Release -> API Release compatibility table in its changelog. Run once
 * per SDK Target after generation and after src/decide-release.mjs has
 * decided a release should happen - see CONTEXT.md and README.md.
 */

import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { applyBump, buildPackageManifest, buildPoetryManifest } from "./package-metadata.mjs";
import { upsertCompatibilityTable } from "./changelog.mjs";
import { readJsonFile, runIfMain } from "./cli-utils.mjs";

// The manifest format is read from --manifest's own extension rather than a
// second target->format map: pyproject.toml (python) is TOML, every other
// manifest this pipeline writes (package.json for ts/js) is JSON.
function isTomlManifest(manifestPath) {
  return extname(manifestPath) === ".toml";
}

async function readChangelog(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "# Changelog\n";
    }

    throw error;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function run(options) {
  const toml = isTomlManifest(options.manifest);
  const [generatedManifest, handOwnedMetadata, changelogContent] = await Promise.all([
    toml ? parseToml(await readFile(options.manifest, "utf8")) : readJsonFile(options.manifest),
    readJsonFile(options.handOwnedMetadata),
    readChangelog(options.changelog)
  ]);

  const version = options.version ?? applyBump(options.previousVersion, options.bump);
  const build = toml ? buildPoetryManifest : buildPackageManifest;

  const manifest = build({
    target: options.target,
    generatedManifest,
    handOwnedMetadata,
    version,
    sourceApiVersion: options.sourceApiVersion
  });

  const nextChangelog = upsertCompatibilityTable(changelogContent, {
    sdkVersion: version,
    sourceApiVersion: options.sourceApiVersion,
    date: options.date ?? today()
  });

  const serializedManifest = toml ? stringifyToml(manifest) : `${JSON.stringify(manifest, null, 2)}\n`;

  await writeFile(options.manifest, serializedManifest, "utf8");
  await writeFile(options.changelog, nextChangelog, "utf8");

  return { manifest, version, changelogPath: options.changelog };
}

const program = new Command();

program
  .name("jh-write-package-metadata")
  .description(
    "Writes the pipeline-owned package metadata (name, version, Source API Version) into a " +
      "regenerated SDK Target's manifest, preserves its hand-owned fields (author, licence, " +
      "repository, keywords), and updates its changelog's compatibility table."
  )
  .requiredOption("--target <target>", "SDK Target, e.g. ts")
  .requiredOption(
    "--manifest <file>",
    "Regenerated package manifest to update in place, e.g. generated/ts/package.json",
    (value) => resolve(process.cwd(), value)
  )
  .requiredOption(
    "--hand-owned-metadata <file>",
    "JSON file with the hand-owned fields (author, license, repository, keywords)",
    (value) => resolve(process.cwd(), value)
  )
  .requiredOption(
    "--changelog <file>",
    "SDK Target's CHANGELOG.md; created if missing",
    (value) => resolve(process.cwd(), value)
  )
  .requiredOption(
    "--source-api-version <tag>",
    "API Release this SDK Release was generated from, e.g. v0.9.3"
  )
  .option("--version <semver>", "Explicit SDK Release version, overriding --previous-version/--bump")
  .option("--previous-version <semver>", "Previous SDK Release version, e.g. from the last publish")
  .option("--bump <level>", "Bump level from `decide-release`'s verdict: major | minor | patch")
  .option("--date <YYYY-MM-DD>", "Compatibility table date; defaults to today")
  .action(async (options) => {
    if (!options.version && (!options.previousVersion || !options.bump)) {
      throw new Error("Provide either --version, or both --previous-version and --bump.");
    }

    const result = await run(options);
    console.log(`Wrote ${options.manifest} (version ${result.version}).`);
    console.log(`Updated the compatibility table in ${result.changelogPath}.`);
  });

runIfMain(import.meta.url, program);

export { run };
