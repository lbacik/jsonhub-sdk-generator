/**
 * Splits an SDK Target's package manifest into the fields the pipeline owns
 * (package name, version, Source API Version) and the fields a human owns
 * (author, licence, repository, keywords) - see CONTEXT.md and the Package
 * metadata section of README.md.
 *
 * The unified `jsonhub-sdk-<target>` naming convention is a deliberate,
 * one-time domain decision (see AGENTS.md's exception for this module),
 * mirroring the exception already made for src/normalizer.mjs.
 *
 * This module is a pure transformation: it takes the manifest openapi-generator
 * just wrote plus the hand-owned metadata already on disk, and returns the
 * manifest to write back. No I/O happens here - see src/write-package-metadata.mjs.
 */

// One entry per SDK Target this repository actually generates and maintains
// hand-owned metadata for - see manifests/<target>/. Add a target here only
// once it has a manifests/<target>/package.metadata.json to go with it.
const PACKAGE_NAME_BY_TARGET = {
  ts: "jsonhub-sdk-ts"
};

const HAND_OWNED_FIELDS = Object.freeze(["author", "license", "repository", "keywords"]);

const BUMP_RESET = {
  major: ["minor", "patch"],
  minor: ["patch"],
  patch: []
};

function unifiedPackageName(target) {
  const packageName = PACKAGE_NAME_BY_TARGET[target];

  if (!packageName) {
    throw new Error(
      `No unified package name convention for target "${target}". Available: ${Object.keys(PACKAGE_NAME_BY_TARGET).join(", ")}`
    );
  }

  return packageName;
}

function applyBump(previousVersion, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(previousVersion).trim());

  if (!match) {
    throw new Error(`"${previousVersion}" is not a MAJOR.MINOR.PATCH version.`);
  }

  if (!BUMP_RESET[bump]) {
    throw new Error(`Unknown bump level "${bump}". Expected one of: major, minor, patch.`);
  }

  const version = { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };

  if (bump === "major") {
    version.major += 1;
  } else if (bump === "minor") {
    version.minor += 1;
  } else {
    version.patch += 1;
  }

  for (const resetKey of BUMP_RESET[bump]) {
    version[resetKey] = 0;
  }

  return `${version.major}.${version.minor}.${version.patch}`;
}

function buildPackageManifest({ target, generatedManifest, handOwnedMetadata, version, sourceApiVersion }) {
  for (const field of HAND_OWNED_FIELDS) {
    if (!handOwnedMetadata || !(field in handOwnedMetadata)) {
      throw new Error(
        `Hand-owned metadata for target "${target}" is missing "${field}". ` +
          `Every hand-owned field must be maintained explicitly so no generator placeholder can slip through.`
      );
    }
  }

  return {
    ...generatedManifest,
    name: unifiedPackageName(target),
    version,
    sourceApiVersion,
    ...Object.fromEntries(HAND_OWNED_FIELDS.map((field) => [field, handOwnedMetadata[field]]))
  };
}

export { PACKAGE_NAME_BY_TARGET, HAND_OWNED_FIELDS, unifiedPackageName, applyBump, buildPackageManifest };
