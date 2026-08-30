# jh-client-generator

A minimal Project B for generating SDKs from OpenAPI, based on a specification fetched from a URL.

Assumptions:

- Project A publishes an OpenAPI specification as `json` or `yaml`,
- Project B runs a single CLI,
- the CLI fetches the specification and saves it locally in `.cache/`,
- it then invokes `openapi-generator` for the selected language.

## Why this architecture

This is the simplest solution that still gives you control:

- the spec-fetching logic is yours,
- the code-generation logic is delegated to the proven `openapi-generator`,
- it's easy to add further targets or custom templates,
- it can run locally, in CI, and from a cron job without rewriting the generator from scratch.

## Supported targets

- `ts` -> `typescript-fetch`
- `js` -> `javascript`
- `python` -> `python`
- `php` -> `php`

## Installation

```bash
npm install
```

Required Node.js: `>=20.10.0`

## Usage

### TypeScript

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --package-name my-api-sdk
```

If you don't provide `--output`, the client goes to `generated/<target>` by default.
If you provide `--output`, that path is treated as the final output directory:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --output ../jh-client
```

In this example the SDK will be generated into `../jh-client`, without appending `/ts`.

For JSON specifications with multiple response formats, the CLI always reduces the
fetched specification to a **Canonical Client Spec** before generation — a document with
exactly one representation per operation, following one shared policy (see the section
below) — so the generator only builds models for the chosen representation in
`requestBody` and `responses`. This document is written as a separate file to
`.cache/canonical-client-spec.json`, so you can open and inspect it independently of
what `openapi-generator` produced.

If, after generation, `generated/ts/src/models` still has models that aren't reachable
from the generated API classes, you can run additional pruning:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --package-name my-api-sdk \
  --prune-unused-models
```

### JavaScript

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target js \
  --package-name my-api-sdk-js
```

### Python

```bash
npm run generate -- \
  --url https://example.com/openapi.yaml \
  --target python \
  --package-name my_api_sdk
```

### PHP

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target php \
  --package-name MyCompanyApiSdk \
  --composer-name my-company/api-sdk
```

## Headers for fetching the specification

If the specification is protected, you can pass HTTP headers:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --header "Authorization: Bearer TOKEN" \
  --header "X-Tenant: demo"
```

## Additional generator parameters

You can add your own `additionalProperties`:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --property supportsES6=true \
  --property npmVersion=2.0.0
```

## Canonical Client Spec

If the specification exposes several `content` variants for the same operation, the CLI
reduces it before generation to exactly one representation per operation, following one
shared policy — instead of the single global `--prefer-media-type` flag (removed):

```
response 2xx      -> application/hal+json, falling back to application/json
response 4xx/5xx  -> application/problem+json
request body      -> application/json
  PATCH           -> application/merge-patch+json
  OAuth forms     -> application/x-www-form-urlencoded
```

The choice for `responses` is based on the status code, and for `requestBody` on the
HTTP method and the presence of `application/x-www-form-urlencoded` in the content
(OAuth forms). If none of the preferred types is present in `content`, the CLI keeps the
first available type, so every operation always ends up with exactly one representation.

The reduction is a pure document transformation (no network access, no code generation)
and currently works for specifications in JSON format. The result is written as a
separate, inspectable file to `.cache/canonical-client-spec.json`, and it — not the raw
fetched specification — is the input for `openapi-generator`.

## Pruning unused models

The `--prune-unused-models` flag currently works for the `ts` target.

This is not a native `openapi-generator` option. The CLI first generates the full
`typescript-fetch` client, then removes from `src/models` and `docs/` the models that
aren't reachable from `src/apis/*` or from the dependencies of models used by the API.

In practice this helps with specifications that contain many alternative
representations or redundant helper schemas, but the most effective way to reduce the
number of models usually remains the reduction to the Canonical Client Spec described
above.

## Fetching without generating

`--skip-generation` fetches the specification and writes the Canonical Client Spec (for JSON
input) without invoking `openapi-generator`:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --skip-generation
```

This is how the release pipeline (below) answers its cheap "did the API Contract change at
all?" check before paying for a full generation run.

## Deciding whether and how much to release

Once an SDK Target is regenerated, a separate command decides whether the change is worth
publishing and how large it is — without publishing anything itself:

```bash
npm run decide-release -- \
  --previous-canonical-client-spec .cache/previous/canonical-client-spec.json \
  --current-canonical-client-spec .cache/canonical-client-spec.json \
  --previous-surface generated/previous/ts \
  --current-surface generated/ts \
  --previous-toolchain-version openapi-generator@7.1.0 \
  --current-toolchain-version openapi-generator@7.1.0 \
  --version-bearing-file package.json
```

It prints its verdict as JSON, for example:

```json
{
  "shouldRelease": true,
  "bump": "minor",
  "reason": "sdk-surface-changed",
  "breakingChanges": [],
  "additiveChanges": ["operation added: GET /definitions/{id}"]
}
```

Three detectors run in sequence, and they are allowed to disagree — see `CONTEXT.md` for why
there are three and not one:

1. A digest of the Canonical Client Spec, as a cheap filter — unchanged (with the toolchain
   version also unchanged) stops before anything else runs.
2. A comparison of the generated SDK Surface, excluding any `--version-bearing-file` (repeat
   the flag for more than one), which decides *whether* to release.
3. A structured comparison of the previous and current Canonical Client Spec, plus the
   toolchain version, which decides *how much* to bump:

```
breaking change reported             -> major
additive change reported             -> minor
generator or toolchain version moved -> minor floor
otherwise                            -> patch
```

The decision itself (`decideRelease` in `src/release-decision.mjs`) is a pure function of the
previous/current Canonical Client Spec, the previous/current SDK Surface, and the toolchain
version — it performs no I/O and never releases anything on its own. Per this repository's
[SDK versioning ADR](docs/adr/0001-sdk-versioning.md), each SDK Target versions independently,
so the bump level is always about that target's own compatibility, never the API's.

## Package metadata and changelog

Once `decide-release` says an SDK Target should be released, a separate command writes the
final package metadata and updates the changelog's compatibility table — see `CONTEXT.md` on
Source API Version and `docs/adr/0001-sdk-versioning.md` on why SDK Releases version
independently of API Releases.

Package manifest fields are split in two:

- **pipeline-owned** — package name, version, and Source API Version. Written every run,
  regardless of what `openapi-generator` put there.
- **hand-owned** — author, licence, repository, and keywords. Read from
  `manifests/<target>/package.metadata.json` (tracked in this repository, outside `generated/`,
  so `openapi-generator` never touches it) and written back untouched, replacing whatever
  placeholder `openapi-generator` emitted.

```bash
npm run write-package-metadata -- \
  --target ts \
  --manifest generated/ts/package.json \
  --hand-owned-metadata manifests/ts/package.metadata.json \
  --changelog generated/ts/CHANGELOG.md \
  --source-api-version v0.9.3 \
  --previous-version 1.2.0 \
  --bump minor
```

`--previous-version`/`--bump` (typically `decide-release`'s verdict) derive the next version;
pass `--version` directly instead if the version is already known. The package name follows one
convention across every SDK Target, `jsonhub-sdk-<target>` (e.g. `jsonhub-sdk-ts`), so the SDK
Targets stay a recognisable family across registries. Source API Version is written as a plain
`sourceApiVersion` field in the manifest, so it can be read programmatically without consulting
the changelog.

The same command appends a row to the generated compatibility table in `--changelog` (creating
the file if it doesn't exist yet), between `<!-- compatibility-table:start -->` and
`<!-- compatibility-table:end -->` markers so any hand-written changelog content around it is
left alone. Regenerating with the same SDK Release version replaces that row instead of
duplicating it.

The unified naming convention and the pipeline/hand-owned split are implemented in
`src/package-metadata.mjs`, and the compatibility table in `src/changelog.mjs` — both are pure
functions, tested independently of file I/O; `src/write-package-metadata.mjs` is the thin CLI
wrapper that reads and writes the actual files.

This currently covers only the `ts` target: `src/cli.mjs` can generate `js`/`python`/`php`
output too, but `PACKAGE_NAME_BY_TARGET` in `src/package-metadata.mjs` and
`manifests/ts/package.metadata.json` exist only for `ts`, since it's the only SDK Target this
repository holds hand-owned metadata for today. Adding a target here means adding its entry to
`PACKAGE_NAME_BY_TARGET` and a matching `manifests/<target>/package.metadata.json` — `php` stays
excluded, since it isn't an SDK Target (see `CONTEXT.md`).

## Releasing the TypeScript SDK Target

`.github/workflows/release-ts.yml` runs the full path end to end, triggered by hand
(`workflow_dispatch`): it fetches the API Contract from the live API, generates the `ts` SDK
Surface, decides whether and how much to release, writes the package metadata, and — only if
the SDK Surface actually changed — commits and tags the result into the
[`jsonhub-sdk-ts`](https://github.com/lbacik/jsonhub-sdk-ts) repository. Nothing is published to
npm yet; that is a later step. Run it twice against an unchanged API and the second run makes no
commit and no tag — that is the behaviour the whole pipeline exists to produce.

The workflow itself only checks out the two repositories and installs dependencies; the pipeline
steps run in `scripts/release-ts.sh`, which you can also run locally:

```bash
GENERATOR_DIR=$(pwd) \
TARGET_DIR=/path/to/a/checkout/of/jsonhub-sdk-ts \
API_URL=https://example.com/openapi.json \
SOURCE_API_VERSION=v0.9.3 \
  ./scripts/release-ts.sh
```

Set `SKIP_PUSH=1` to commit and tag `TARGET_DIR` locally without pushing — useful for a dry run
against a scratch clone.

`release-ts.sh` is a thin wrapper over two single-purpose scripts, kept apart per this
repository's own rule against mixing spec-fetching logic with package-publishing logic in one
module (see `AGENTS.md`):

- **`scripts/generate-and-decide.sh`** (read-only against `TARGET_DIR`) snapshots what is already
  committed in `jsonhub-sdk-ts` — its SDK Surface and, from `.jsonhub/canonical-client-spec.json`,
  the Canonical Client Spec that produced it — fetches the live API Contract with
  `--skip-generation` (above), and checks its digest against the previous one. Three change
  detectors are involved in total, and are allowed to disagree — see `CONTEXT.md` and
  `src/release-decision.mjs` for why there are three and not one:

  1. that digest, a cheap filter that stops the run **before generation** once the API and the
     toolchain are both unchanged — the API Contract is fetched, but `openapi-generator` never
     runs;
  2. a comparison of the generated SDK Surface, deciding *whether* to release — run by
     `decide-release` once the digest says something did change;
  3. a structured comparison of the previous and current Canonical Client Spec, deciding *how
     much* to bump — run by `decide-release` alongside detector 2.

- **`scripts/publish-to-target.sh`** reads that verdict and, only when it says to release, writes
  the package metadata (as above), writes `.jsonhub/canonical-client-spec.json` into the freshly
  generated output so the *next* run has something to compare against, then replaces the contents
  of `TARGET_DIR` with it, commits, and tags `v<version>` — the same version `decide-release` and
  `write-package-metadata` just derived. Otherwise it does nothing.

Two prerequisites are operational, not code, and gate every real run:

- a `JSONHUB_SDK_TS_TOKEN` repository secret: a PAT with push access to `jsonhub-sdk-ts`, used to
  check it out and to push the release commit and tag;
- a live API Contract URL, passed as the `api_url` workflow input or set once as the
  `JSONHUB_API_URL` repository variable.

## Example next steps

What's usually worth adding next:

1. a `clients.config.json` configuration file listing the clients to generate,
2. separate per-language presets instead of a single map in the code,
3. custom Mustache templates for `openapi-generator`,
4. spec validation before generation,
5. publishing packages to npm / PyPI / Packagist in CI.

## Example of the next step

If you want to generate multiple SDKs with a single command, the project could be
extended with a configuration in this style:

```json
{
  "specUrl": "https://example.com/openapi.json",
  "targets": [
    {
      "name": "frontend-ts",
      "target": "ts",
      "packageName": "@acme/api-sdk"
    },
    {
      "name": "backend-python",
      "target": "python",
      "packageName": "acme_api_sdk"
    },
    {
      "name": "legacy-php",
      "target": "php",
      "packageName": "AcmeApiSdk",
      "composerName": "acme/api-sdk"
    }
  ]
}
```

Then, instead of a single `--target`, the CLI would read the configuration and generate
all clients in one run.
