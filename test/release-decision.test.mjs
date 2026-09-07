import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalClientSpecDigest,
  compareCanonicalClientSpecs,
  decideRelease,
  hasSdkSurfaceChanged
} from "../src/release-decision.mjs";

function buildSpec({ paths = {}, schemas = {} } = {}) {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    paths,
    components: { schemas }
  };
}

const BASE_SPEC = buildSpec({
  paths: {
    "/definitions": {
      get: { responses: { 200: { content: { "application/hal+json": {} } } } }
    }
  },
  schemas: {
    Definition: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" }
      },
      required: ["id"]
    }
  }
});

const BASE_SURFACE = {
  "src/apis/DefinitionsApi.ts": "export class DefinitionsApi {}",
  "package.json": '{"name":"sdk","version":"1.0.0"}'
};

const TOOLCHAIN_VERSION = "openapi-generator@7.1.0";

function decide(overrides) {
  return decideRelease({
    previousCanonicalClientSpec: BASE_SPEC,
    currentCanonicalClientSpec: BASE_SPEC,
    previousSdkSurface: BASE_SURFACE,
    currentSdkSurface: BASE_SURFACE,
    previousToolchainVersion: TOOLCHAIN_VERSION,
    currentToolchainVersion: TOOLCHAIN_VERSION,
    versionBearingFilePaths: ["package.json"],
    ...overrides
  });
}

test("canonicalClientSpecDigest is stable regardless of key order", () => {
  const a = { one: 1, two: 2 };
  const b = { two: 2, one: 1 };
  assert.equal(canonicalClientSpecDigest(a), canonicalClientSpecDigest(b));
});

test("canonicalClientSpecDigest changes when the document changes", () => {
  assert.notEqual(
    canonicalClientSpecDigest(BASE_SPEC),
    canonicalClientSpecDigest(buildSpec({ paths: {}, schemas: {} }))
  );
});

test("hasSdkSurfaceChanged ignores version-bearing files", () => {
  const previous = { "package.json": '{"version":"1.0.0"}', "src/index.ts": "export {}" };
  const current = { "package.json": '{"version":"1.0.1"}', "src/index.ts": "export {}" };
  assert.equal(hasSdkSurfaceChanged(previous, current, ["package.json"]), false);
});

test("hasSdkSurfaceChanged still detects changes outside version-bearing files", () => {
  const previous = { "package.json": '{"version":"1.0.0"}', "src/index.ts": "export {}" };
  const current = { "package.json": '{"version":"1.0.0"}', "src/index.ts": "export { x };" };
  assert.equal(hasSdkSurfaceChanged(previous, current, ["package.json"]), true);
});

test("compareCanonicalClientSpecs finds a removed operation and a removed field", () => {
  const current = buildSpec({
    paths: {},
    schemas: {
      Definition: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    }
  });

  const comparison = compareCanonicalClientSpecs(BASE_SPEC, current);
  assert.ok(comparison.breaking.some((change) => change.includes("operation removed")));
  assert.ok(comparison.breaking.some((change) => change.includes("field removed: Definition.name")));
});

test("compareCanonicalClientSpecs finds an added operation and an added optional field", () => {
  const current = buildSpec({
    paths: {
      ...BASE_SPEC.paths,
      "/definitions/{id}": {
        get: { responses: { 200: { content: { "application/hal+json": {} } } } }
      }
    },
    schemas: {
      Definition: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, note: { type: "string" } },
        required: ["id"]
      }
    }
  });

  const comparison = compareCanonicalClientSpecs(BASE_SPEC, current);
  assert.ok(comparison.additive.some((change) => change.includes("operation added")));
  assert.ok(comparison.additive.some((change) => change.includes("optional field added: Definition.note")));
});

test("compareCanonicalClientSpecs treats a removed schema as breaking", () => {
  const current = buildSpec({ paths: BASE_SPEC.paths, schemas: {} });
  const comparison = compareCanonicalClientSpecs(BASE_SPEC, current);
  assert.ok(comparison.breaking.some((change) => change.includes("schema removed: Definition")));
});

test("compareCanonicalClientSpecs treats an added schema as additive", () => {
  const current = buildSpec({
    paths: BASE_SPEC.paths,
    schemas: { ...BASE_SPEC.components.schemas, Widget: { type: "object", properties: {} } }
  });
  const comparison = compareCanonicalClientSpecs(BASE_SPEC, current);
  assert.ok(comparison.additive.some((change) => change.includes("schema added: Widget")));
});

test("compareCanonicalClientSpecs treats a field newly made required as breaking", () => {
  const current = buildSpec({
    paths: BASE_SPEC.paths,
    schemas: {
      Definition: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"]
      }
    }
  });

  const comparison = compareCanonicalClientSpecs(BASE_SPEC, current);
  assert.ok(comparison.breaking.some((change) => change.includes("field became required: Definition.name")));
});

const REMOVED_OPERATION_SPEC = buildSpec({ paths: {}, schemas: BASE_SPEC.components.schemas });

const REMOVED_FIELD_SPEC = buildSpec({
  paths: BASE_SPEC.paths,
  schemas: {
    Definition: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
  }
});

const ADDED_OPERATION_SPEC = buildSpec({
  paths: {
    ...BASE_SPEC.paths,
    "/definitions/{id}": {
      get: { responses: { 200: { content: { "application/hal+json": {} } } } }
    }
  },
  schemas: BASE_SPEC.components.schemas
});

const ADDED_OPTIONAL_FIELD_SPEC = buildSpec({
  paths: BASE_SPEC.paths,
  schemas: {
    Definition: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, note: { type: "string" } },
      required: ["id"]
    }
  }
});

const ADDED_REQUIRED_FIELD_SPEC = buildSpec({
  paths: BASE_SPEC.paths,
  schemas: {
    Definition: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, note: { type: "string" } },
      required: ["id", "note"]
    }
  }
});

const CHANGED_SURFACE = { ...BASE_SURFACE, "src/apis/DefinitionsApi.ts": "export class DefinitionsApi { extra() {} }" };

const cases = [
  {
    name: "unchanged spec, unchanged surface, unchanged toolchain: stops before code generation",
    overrides: {},
    expected: { shouldRelease: false, bump: null, reason: "canonical-client-spec-unchanged" }
  },
  {
    name: "changed spec that leaves the SDK Surface unchanged releases nothing",
    overrides: { currentCanonicalClientSpec: ADDED_OPTIONAL_FIELD_SPEC },
    expected: { shouldRelease: false, bump: null, reason: "sdk-surface-unchanged" }
  },
  {
    name: "removed operation yields a major bump",
    overrides: { currentCanonicalClientSpec: REMOVED_OPERATION_SPEC, currentSdkSurface: CHANGED_SURFACE },
    expected: { shouldRelease: true, bump: "major" }
  },
  {
    name: "removed field yields a major bump",
    overrides: { currentCanonicalClientSpec: REMOVED_FIELD_SPEC, currentSdkSurface: CHANGED_SURFACE },
    expected: { shouldRelease: true, bump: "major" }
  },
  {
    name: "added operation yields a minor bump",
    overrides: { currentCanonicalClientSpec: ADDED_OPERATION_SPEC, currentSdkSurface: CHANGED_SURFACE },
    expected: { shouldRelease: true, bump: "minor" }
  },
  {
    name: "added optional field yields a minor bump",
    overrides: { currentCanonicalClientSpec: ADDED_OPTIONAL_FIELD_SPEC, currentSdkSurface: CHANGED_SURFACE },
    expected: { shouldRelease: true, bump: "minor" }
  },
  {
    name: "added required field is a breaking change and yields a major bump",
    overrides: { currentCanonicalClientSpec: ADDED_REQUIRED_FIELD_SPEC, currentSdkSurface: CHANGED_SURFACE },
    expected: { shouldRelease: true, bump: "major" }
  },
  {
    name: "unchanged spec with a moved toolchain version yields at least a minor bump",
    overrides: { currentToolchainVersion: "openapi-generator@7.2.0", currentSdkSurface: CHANGED_SURFACE },
    expected: { shouldRelease: true, bump: "minor" }
  },
  {
    name: "a moved toolchain version does not downgrade a major bump to minor",
    overrides: {
      currentCanonicalClientSpec: REMOVED_OPERATION_SPEC,
      currentToolchainVersion: "openapi-generator@7.2.0",
      currentSdkSurface: CHANGED_SURFACE
    },
    expected: { shouldRelease: true, bump: "major" }
  },
  {
    name: "a non-structural spec change with no toolchain move yields a patch",
    overrides: {
      currentCanonicalClientSpec: buildSpec({
        paths: { "/definitions": { ...BASE_SPEC.paths["/definitions"], description: "updated docs" } },
        schemas: BASE_SPEC.components.schemas
      }),
      currentSdkSurface: CHANGED_SURFACE
    },
    expected: { shouldRelease: true, bump: "patch" }
  },
  {
    name: "version-bearing files are excluded from the SDK Surface comparison",
    overrides: {
      currentCanonicalClientSpec: ADDED_OPTIONAL_FIELD_SPEC,
      currentSdkSurface: { ...BASE_SURFACE, "package.json": '{"name":"sdk","version":"1.0.1"}' }
    },
    expected: { shouldRelease: false, bump: null, reason: "sdk-surface-unchanged" }
  },
  // force exists because none of the three detectors can see a change
  // confined to src/package-metadata.mjs or manifests/<target>/ - those are
  // applied by src/write-package-metadata.mjs, after this verdict.
  {
    name: "force releases an otherwise unchanged SDK Target as a patch",
    overrides: { force: true },
    expected: { shouldRelease: true, bump: "patch", reason: "forced" }
  },
  {
    name: "force releases a changed spec that left the SDK Surface unchanged",
    overrides: { force: true, currentCanonicalClientSpec: ADDED_OPTIONAL_FIELD_SPEC },
    expected: { shouldRelease: true, bump: "minor", reason: "forced" }
  },
  // force overrides the no-release verdicts, not the bump classification.
  {
    name: "force does not soften a breaking change to a patch",
    overrides: {
      force: true,
      currentCanonicalClientSpec: REMOVED_OPERATION_SPEC,
      currentSdkSurface: CHANGED_SURFACE
    },
    expected: { shouldRelease: true, bump: "major", reason: "sdk-surface-changed" }
  },
  {
    name: "force still respects the toolchain version's minor floor",
    overrides: { force: true, currentToolchainVersion: "openapi-generator@7.2.0" },
    expected: { shouldRelease: true, bump: "minor", reason: "forced" }
  },
  // A forced run that coincides with a real API change is not "forced": the
  // detectors would have released it anyway, and the reason should say so.
  {
    name: "force leaves the reason alone when the detectors would have released regardless",
    overrides: {
      force: true,
      currentCanonicalClientSpec: ADDED_OPERATION_SPEC,
      currentSdkSurface: CHANGED_SURFACE
    },
    expected: { shouldRelease: true, bump: "minor", reason: "sdk-surface-changed" }
  },
  {
    name: "force defaults to off, so an unchanged SDK Target still releases nothing",
    overrides: { force: undefined },
    expected: { shouldRelease: false, bump: null, reason: "canonical-client-spec-unchanged" }
  }
];

for (const { name, overrides, expected } of cases) {
  test(name, () => {
    const verdict = decide(overrides);
    assert.equal(verdict.shouldRelease, expected.shouldRelease);
    assert.equal(verdict.bump, expected.bump);

    if (expected.reason) {
      assert.equal(verdict.reason, expected.reason);
    }
  });
}

// A forced run reports no changes because there genuinely are none - the
// verdict must not invent entries to justify itself.
test("a forced release with nothing changed reports no breaking or additive changes", () => {
  const verdict = decide({ force: true });

  assert.equal(verdict.shouldRelease, true);
  assert.deepEqual(verdict.breakingChanges, []);
  assert.deepEqual(verdict.additiveChanges, []);
});

test("decideRelease is a pure function - repeated calls with the same input return the same verdict", () => {
  const input = {
    previousCanonicalClientSpec: BASE_SPEC,
    currentCanonicalClientSpec: REMOVED_OPERATION_SPEC,
    previousSdkSurface: BASE_SURFACE,
    currentSdkSurface: CHANGED_SURFACE,
    previousToolchainVersion: TOOLCHAIN_VERSION,
    currentToolchainVersion: TOOLCHAIN_VERSION,
    versionBearingFilePaths: ["package.json"]
  };

  assert.deepEqual(decideRelease(input), decideRelease(structuredClone(input)));
});
