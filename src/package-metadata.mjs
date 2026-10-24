/**
 * Splits an SDK Target's package manifest into the fields the pipeline owns
 * (package name, version, Source API Version) and the fields a human owns
 * (author, licence, repository, keywords, and - npm only - homepage) - see
 * CONTEXT.md and the Package metadata section of README.md.
 *
 * The package name is Product data, not a constant: it comes from
 * `products/<product>/product.json` via src/product.mjs, so adding a Product
 * never touches this module. What stays hardcoded policy (see AGENTS.md) is
 * the naming convention itself - one package name per Product across
 * registries, with the language suffix on the repository name
 * (`jsonhub-sdk-ts`, `jsonhub-sdk-python`) and not on the package name: a
 * GitHub organisation is one flat, language-agnostic namespace and needs the
 * suffix to tell the repositories apart, whereas a registry is already the
 * namespace for its own language, so `-ts` on npm or PyPI would only repeat
 * what the registry already says. The npm tarball's `files` allowlist below
 * is hardcoded for the same reason: a published npm version can't be cleanly
 * unpublished, so confining the tarball has to hold on every run.
 *
 * This module is a pure transformation: it takes the manifest openapi-generator
 * just wrote plus the hand-owned metadata already on disk, and returns the
 * manifest to write back. No I/O happens here - see src/write-package-metadata.mjs.
 *
 * Two manifest shapes exist, one per package-manifest format: buildPackageManifest
 * for the npm-style JSON manifest (`ts`/`js`), and buildPoetryManifest for the
 * Poetry-style `[tool.poetry]` table in pyproject.toml (`python`) - the two
 * ecosystems don't even agree on field names (`author` vs `authors`,
 * `repository` as an object vs a plain URL string), so one merge shape can't
 * serve both.
 */

// What the npm tarball is allowed to ship - pipeline-owned, like the package
// name's convention, and for the same reason: it is a policy that must hold
// every run, not a per-invocation preference. openapi-generator emits neither
// a `files` field nor a .npmignore, and npm's default is "pack everything not
// ignored", so without this a publish ships the whole repository: the SDK
// Surface, but also .github/ (hand-maintained CI, see README.md), the
// .sdk-pipeline/ pipeline artifacts, docs/, and whatever an editor left behind
// (.idea/workspace.xml). A published npm version cannot be cleanly
// unpublished, so leaking there is permanent.
//
// `dist` alone is the whole published package: `main` and `types` both point
// into it, and the generator emits no sourcemaps, so shipping the TypeScript
// sources would buy consumers nothing; npm force-includes package.json,
// README and LICENSE whatever this list says.
//
// npm-only, like sourceApiVersion: a Poetry build's contents come from
// [tool.poetry].packages, which openapi-python-client already scopes to the
// generated module, so buildPoetryManifest needs no counterpart.
const NPM_PUBLISHED_FILES = Object.freeze(["dist"]);

const HAND_OWNED_FIELDS = Object.freeze(["author", "license", "repository", "keywords"]);

// `homepage` is hand-owned too, but optional: written when the Product's
// hand-owned metadata provides it, omitted otherwise - unlike the four fields
// above, whose absence means a generator placeholder slipped through and must
// fail loudly. npm-only: Poetry's `[tool.poetry]` schema is validated strictly
// (`poetry check` hard-fails on keys it doesn't recognise), so the python
// manifest gains no optional passthrough here.
const OPTIONAL_HAND_OWNED_FIELDS = Object.freeze(["homepage"]);

// Poetry's own field names for the same four hand-owned facts: authors is a
// list (poetry has no singular form), and repository is a plain URL string,
// not the {type, url} object npm's package.json expects.
const POETRY_HAND_OWNED_FIELDS = Object.freeze(["authors", "license", "repository", "keywords"]);

const BUMP_RESET = {
  major: ["minor", "patch"],
  minor: ["patch"],
  patch: []
};

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

function requireHandOwnedFields({ target, handOwnedMetadata, requiredFields }) {
  for (const field of requiredFields) {
    if (!handOwnedMetadata || !(field in handOwnedMetadata)) {
      throw new Error(
        `Hand-owned metadata for target "${target}" is missing "${field}". ` +
          `Every hand-owned field must be maintained explicitly so no generator placeholder can slip through.`
      );
    }
  }
}

function buildPackageManifest({ target, packageName, generatedManifest, handOwnedMetadata, version, sourceApiVersion }) {
  if (!packageName) {
    throw new Error(
      `No package name for target "${target}". ` +
        `The package name is Product data - resolve it through src/product.mjs.`
    );
  }

  requireHandOwnedFields({ target, handOwnedMetadata, requiredFields: HAND_OWNED_FIELDS });

  const optionalFields = Object.fromEntries(
    OPTIONAL_HAND_OWNED_FIELDS.filter((field) => field in handOwnedMetadata).map((field) => [
      field,
      handOwnedMetadata[field]
    ])
  );

  return {
    ...generatedManifest,
    name: packageName,
    version,
    sourceApiVersion,
    // A fresh array per call: NPM_PUBLISHED_FILES itself is frozen, and the
    // manifest this returns is about to be serialised and written out.
    files: [...NPM_PUBLISHED_FILES],
    ...Object.fromEntries(HAND_OWNED_FIELDS.map((field) => [field, handOwnedMetadata[field]])),
    ...optionalFields
  };
}

// generatedManifest here is a parsed pyproject.toml document (a plain object
// with a `tool.poetry` table), not a package.json - see
// src/write-package-metadata.mjs for where the TOML parsing happens.
function buildPoetryManifest({ target, packageName, generatedManifest, handOwnedMetadata, version, sourceApiVersion }) {
  if (!packageName) {
    throw new Error(
      `No package name for target "${target}". ` +
        `The package name is Product data - resolve it through src/product.mjs.`
    );
  }

  requireHandOwnedFields({ target, handOwnedMetadata, requiredFields: POETRY_HAND_OWNED_FIELDS });

  const poetry = generatedManifest?.tool?.poetry;

  if (!poetry) {
    throw new Error(`Generated manifest for target "${target}" has no [tool.poetry] table.`);
  }

  return {
    ...generatedManifest,
    tool: {
      ...generatedManifest.tool,
      poetry: {
        ...poetry,
        name: packageName,
        version,
        ...Object.fromEntries(POETRY_HAND_OWNED_FIELDS.map((field) => [field, handOwnedMetadata[field]]))
      },
      // Poetry validates [tool.poetry] against its own schema and rejects any
      // unrecognised key (`poetry check`/`poetry build` hard-fail on it), so
      // Source API Version - a custom field with no Poetry equivalent - lives
      // in its own [tool.jsonhub] table instead, the namespace pyproject.toml
      // reserves for exactly this. Same fact package.json's sourceApiVersion
      // records for `ts`, just parked somewhere Poetry won't reject it.
      jsonhub: {
        ...generatedManifest.tool?.jsonhub,
        source_api_version: sourceApiVersion
      }
    }
  };
}

export {
  NPM_PUBLISHED_FILES,
  HAND_OWNED_FIELDS,
  OPTIONAL_HAND_OWNED_FIELDS,
  POETRY_HAND_OWNED_FIELDS,
  applyBump,
  buildPackageManifest,
  buildPoetryManifest
};
