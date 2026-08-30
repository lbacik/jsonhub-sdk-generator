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
