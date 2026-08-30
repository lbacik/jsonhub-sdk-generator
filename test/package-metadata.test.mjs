import assert from "node:assert/strict";
import { test } from "node:test";

import {
  unifiedPackageName,
  applyBump,
  buildPackageManifest,
  HAND_OWNED_FIELDS
} from "../src/package-metadata.mjs";

const handOwnedMetadata = {
  author: "Łukasz Bacik <mail@luka.sh>",
  license: "MIT",
  repository: {
    type: "git",
    url: "https://github.com/lbacik/jsonhub-sdk-ts.git"
  },
  keywords: ["jsonhub", "sdk", "openapi", "typescript", "api-client"]
};

const generatedManifest = {
  name: "jsonhub-api-sdk",
  version: "0.0.0",
  description: "OpenAPI client for jsonhub-api-sdk",
  author: "OpenAPI-Generator",
  repository: {
    type: "git",
    url: "https://github.com/GIT_USER_ID/GIT_REPO_ID.git"
  },
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  scripts: { build: "tsc", prepare: "npm run build" },
  devDependencies: { typescript: "^4.0 || ^5.0" }
};

test("unifiedPackageName follows the jsonhub-sdk-<target> convention", () => {
  assert.equal(unifiedPackageName("ts"), "jsonhub-sdk-ts");
});

test("unifiedPackageName rejects a target with no naming convention yet", () => {
  assert.throws(() => unifiedPackageName("python"), /python/);
});

test("applyBump bumps patch without touching major/minor", () => {
  assert.equal(applyBump("1.2.3", "patch"), "1.2.4");
});

test("applyBump bumps minor and resets patch", () => {
  assert.equal(applyBump("1.2.3", "minor"), "1.3.0");
});

test("applyBump bumps major and resets minor and patch", () => {
  assert.equal(applyBump("1.2.3", "major"), "2.0.0");
});

test("applyBump rejects an invalid previous version", () => {
  assert.throws(() => applyBump("not-a-version", "patch"), /not-a-version/);
});

test("applyBump rejects an unknown bump level", () => {
  assert.throws(() => applyBump("1.2.3", "epic"), /epic/);
});

test("buildPackageManifest writes the pipeline-owned fields", () => {
  const manifest = buildPackageManifest({
    target: "ts",
    generatedManifest,
    handOwnedMetadata,
    version: "1.3.0",
    sourceApiVersion: "v0.9.3"
  });

  assert.equal(manifest.name, "jsonhub-sdk-ts");
  assert.equal(manifest.version, "1.3.0");
  assert.equal(manifest.sourceApiVersion, "v0.9.3");
});

test("buildPackageManifest overwrites hand-owned fields with the maintained values, replacing generator placeholders", () => {
  const manifest = buildPackageManifest({
    target: "ts",
    generatedManifest,
    handOwnedMetadata,
    version: "1.3.0",
    sourceApiVersion: "v0.9.3"
  });

  assert.equal(manifest.author, handOwnedMetadata.author);
  assert.equal(manifest.license, handOwnedMetadata.license);
  assert.deepEqual(manifest.repository, handOwnedMetadata.repository);
  assert.deepEqual(manifest.keywords, handOwnedMetadata.keywords);
  assert.notEqual(manifest.author, "OpenAPI-Generator");
  assert.notEqual(manifest.repository.url, "https://github.com/GIT_USER_ID/GIT_REPO_ID.git");
});

test("buildPackageManifest leaves generator-owned fields untouched", () => {
  const manifest = buildPackageManifest({
    target: "ts",
    generatedManifest,
    handOwnedMetadata,
    version: "1.3.0",
    sourceApiVersion: "v0.9.3"
  });

  assert.equal(manifest.main, generatedManifest.main);
  assert.equal(manifest.types, generatedManifest.types);
  assert.deepEqual(manifest.scripts, generatedManifest.scripts);
  assert.deepEqual(manifest.devDependencies, generatedManifest.devDependencies);
});

test("buildPackageManifest rejects hand-owned metadata missing a required field", () => {
  for (const missingField of HAND_OWNED_FIELDS) {
    const incomplete = { ...handOwnedMetadata };
    delete incomplete[missingField];

    assert.throws(
      () =>
        buildPackageManifest({
          target: "ts",
          generatedManifest,
          handOwnedMetadata: incomplete,
          version: "1.3.0",
          sourceApiVersion: "v0.9.3"
        }),
      new RegExp(missingField)
    );
  }
});

test("buildPackageManifest is idempotent: regenerating twice with unchanged inputs is byte-identical", () => {
  const first = buildPackageManifest({
    target: "ts",
    generatedManifest,
    handOwnedMetadata,
    version: "1.3.0",
    sourceApiVersion: "v0.9.3"
  });

  // A second regeneration re-runs openapi-generator (which always re-emits the
  // same placeholders) and re-reads the same hand-owned metadata file.
  const second = buildPackageManifest({
    target: "ts",
    generatedManifest: { ...generatedManifest },
    handOwnedMetadata,
    version: "1.3.0",
    sourceApiVersion: "v0.9.3"
  });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
});
