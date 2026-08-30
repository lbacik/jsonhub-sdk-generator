/**
 * Decides whether a regenerated SDK Target should be released, and how large
 * the change is.
 *
 * Three detectors run in sequence, each answering a different question, and
 * they are allowed to disagree:
 *
 *   1. A digest of the Canonical Client Spec - a cheap filter. Unchanged,
 *      with the toolchain version also unchanged, stops before anything else
 *      is considered.
 *   2. A comparison of the generated SDK Surface, version-bearing files
 *      excluded - decides *whether* to release.
 *   3. A structured comparison of the previous and current Canonical Client
 *      Spec, plus the toolchain version - decides *how much* to bump:
 *
 *        breaking change reported             -> major
 *        additive change reported             -> minor
 *        generator or toolchain version moved -> minor floor
 *        otherwise                            -> patch
 *
 * This module is a pure function of its inputs: no I/O, no network access,
 * no code generation. See docs/adr/0001-sdk-versioning.md for why the bump
 * level is derived this way rather than mirrored from the API version.
 */

import { createHash } from "node:crypto";

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace"
]);

const BUMP_LEVELS = ["patch", "minor", "major"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

function canonicalClientSpecDigest(spec) {
  return createHash("sha256").update(stableStringify(spec ?? null)).digest("hex");
}

function higherBump(a, b) {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return BUMP_LEVELS.indexOf(a) >= BUMP_LEVELS.indexOf(b) ? a : b;
}

function listOperations(spec) {
  const operations = new Map();

  for (const [path, pathItem] of Object.entries(spec?.paths ?? {})) {
    if (!isPlainObject(pathItem)) {
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isPlainObject(operation)) {
        continue;
      }

      operations.set(`${method.toUpperCase()} ${path}`, operation);
    }
  }

  return operations;
}

function compareOperations(previousSpec, currentSpec) {
  const previous = listOperations(previousSpec);
  const current = listOperations(currentSpec);
  const breaking = [];
  const additive = [];

  for (const operationKey of previous.keys()) {
    if (!current.has(operationKey)) {
      breaking.push(`operation removed: ${operationKey}`);
    }
  }

  for (const operationKey of current.keys()) {
    if (!previous.has(operationKey)) {
      additive.push(`operation added: ${operationKey}`);
    }
  }

  return { breaking, additive };
}

function compareSchemas(previousSpec, currentSpec) {
  const previousSchemas = previousSpec?.components?.schemas ?? {};
  const currentSchemas = currentSpec?.components?.schemas ?? {};
  const breaking = [];
  const additive = [];

  for (const schemaName of Object.keys(previousSchemas)) {
    if (!(schemaName in currentSchemas)) {
      breaking.push(`schema removed: ${schemaName}`);
      continue;
    }

    const previousProperties = previousSchemas[schemaName]?.properties ?? {};
    const currentProperties = currentSchemas[schemaName]?.properties ?? {};
    const previousRequired = new Set(previousSchemas[schemaName]?.required ?? []);
    const currentRequired = new Set(currentSchemas[schemaName]?.required ?? []);

    for (const fieldName of Object.keys(previousProperties)) {
      if (!(fieldName in currentProperties)) {
        breaking.push(`field removed: ${schemaName}.${fieldName}`);
      }
    }

    for (const fieldName of Object.keys(currentProperties)) {
      if (fieldName in previousProperties) {
        if (currentRequired.has(fieldName) && !previousRequired.has(fieldName)) {
          breaking.push(`field became required: ${schemaName}.${fieldName}`);
        }
        continue;
      }

      if (currentRequired.has(fieldName)) {
        breaking.push(`required field added: ${schemaName}.${fieldName}`);
      } else {
        additive.push(`optional field added: ${schemaName}.${fieldName}`);
      }
    }
  }

  for (const schemaName of Object.keys(currentSchemas)) {
    if (!(schemaName in previousSchemas)) {
      additive.push(`schema added: ${schemaName}`);
    }
  }

  return { breaking, additive };
}

// Takes the previous and current Canonical Client Spec and returns what
// changed between them. Deliberately not "oasdiff" itself - a small
// structural comparison is enough to classify severity, and keeping it here
// (rather than shelling out) is what keeps the release decision a pure,
// dependency-free function.
function compareCanonicalClientSpecs(previousSpec, currentSpec) {
  const operations = compareOperations(previousSpec, currentSpec);
  const schemas = compareSchemas(previousSpec, currentSpec);

  return {
    breaking: [...operations.breaking, ...schemas.breaking],
    additive: [...operations.additive, ...schemas.additive]
  };
}

function classifyBump(comparison) {
  if (comparison.breaking.length > 0) {
    return "major";
  }

  if (comparison.additive.length > 0) {
    return "minor";
  }

  return "patch";
}

function excludeVersionBearingFiles(sdkSurface, versionBearingFilePaths) {
  const excluded = new Set(versionBearingFilePaths ?? []);

  return Object.fromEntries(
    Object.entries(sdkSurface ?? {}).filter(([filePath]) => !excluded.has(filePath))
  );
}

// Detector 2: decides *whether* to release. Version-bearing files are
// excluded so a version number churning on its own cannot look like a
// change - see docs/adr/0001-sdk-versioning.md.
function hasSdkSurfaceChanged(previousSdkSurface, currentSdkSurface, versionBearingFilePaths) {
  const previous = excludeVersionBearingFiles(previousSdkSurface, versionBearingFilePaths);
  const current = excludeVersionBearingFiles(currentSdkSurface, versionBearingFilePaths);

  return stableStringify(previous) !== stableStringify(current);
}

const NO_RELEASE = Object.freeze({ breaking: [], additive: [] });

function noRelease(reason) {
  return {
    shouldRelease: false,
    bump: null,
    reason,
    breakingChanges: NO_RELEASE.breaking,
    additiveChanges: NO_RELEASE.additive
  };
}

// The release decision. A pure function of the previous and current
// Canonical Client Spec, the previous and current SDK Surface, and the
// toolchain version - see CONTEXT.md for why these three detectors exist and
// are allowed to disagree.
function decideRelease({
  previousCanonicalClientSpec,
  currentCanonicalClientSpec,
  previousSdkSurface,
  currentSdkSurface,
  previousToolchainVersion,
  currentToolchainVersion,
  versionBearingFilePaths = []
}) {
  const canonicalClientSpecChanged =
    canonicalClientSpecDigest(previousCanonicalClientSpec) !==
    canonicalClientSpecDigest(currentCanonicalClientSpec);
  const toolchainVersionMoved = previousToolchainVersion !== currentToolchainVersion;

  if (!canonicalClientSpecChanged && !toolchainVersionMoved) {
    return noRelease("canonical-client-spec-unchanged");
  }

  if (!hasSdkSurfaceChanged(previousSdkSurface, currentSdkSurface, versionBearingFilePaths)) {
    return noRelease("sdk-surface-unchanged");
  }

  const comparison = compareCanonicalClientSpecs(
    previousCanonicalClientSpec,
    currentCanonicalClientSpec
  );
  const bump = toolchainVersionMoved
    ? higherBump(classifyBump(comparison), "minor")
    : classifyBump(comparison);

  return {
    shouldRelease: true,
    bump,
    reason: "sdk-surface-changed",
    breakingChanges: comparison.breaking,
    additiveChanges: comparison.additive
  };
}

export {
  canonicalClientSpecDigest,
  compareCanonicalClientSpecs,
  hasSdkSurfaceChanged,
  decideRelease
};
