# AGENTS.md

## Repository purpose

This repository contains Project B: a CLI tool for generating SDKs from an OpenAPI
specification fetched from a URL.

Scope:

- fetching a `json` or `yaml` specification,
- generating a client for the selected target,
- keeping a simple entry point for running locally and in CI.

Currently supported targets:

- `ts`
- `js`
- `python`
- `php`

## Architecture

The main logic lives in:

- `src/cli.mjs`

Architectural assumption:

- the Node.js layer is responsible for orchestration,
- the actual code generation is performed by `@openapitools/openapi-generator-cli`,
- generated artifacts go to `generated/`,
- the temporarily fetched specification goes to `.cache/`.

Don't add your own SDK generator from scratch if the problem can be solved through:

- `openapi-generator` configuration,
- extra `additionalProperties`,
- custom generator templates,
- a post-processing layer after generation.

## Running

Install:

```bash
npm install
```

Help:

```bash
npm run help
```

Example:

```bash
npm run generate -- \
  --url https://example.com/openapi.json \
  --target ts \
  --package-name my-api-sdk
```

## Change principles

Priorities:

1. CLI simplicity,
2. predictable generation,
3. ease of use in CI,
4. ease of adding new targets and presets.

When making changes:

- keep one main CLI entry point unless separating responsibilities is already clearly needed,
- don't hardcode data specific to a single Project A,
- add new targets through the target map configuration and a minimal set of per-language rules,
- prefer parametrization through CLI flags or a config file over branching code,
- document new flags and scenarios in `README.md`.

## Implementation conventions

- Use ESM and Node.js `>=20`.
- Keep option-parsing, spec-fetching, and generator-invocation logic functionally separated.
- Error messages should be short and actionable.
- If you add new generator parameters, expose them through the CLI only when they have real value for the user.
- If more complex configuration is needed, the preferred direction is a `clients.config.json`-style file.

## Expected future development

Natural next steps:

- support for multiple clients from a single configuration file,
- per-language presets,
- support for custom Mustache templates,
- spec validation before generation,
- package publishing automation.

## What to avoid

- mixing spec-fetching logic with package-publishing logic in a single module,
- hidden dependencies on a specific URL or a specific response format,
- hand-editing generated code in `generated/` as a permanent solution,
- growing the CLI with features unrelated to SDK generation.

Exception: `src/normalizer.mjs` deliberately hardcodes the media type selection policy
(the Canonical Client Spec, see `CONTEXT.md`). This is a deliberate domain decision — one
shared policy instead of a configurable flag, so the SDK Targets can no longer drift apart
— not an abandonment of the rule above.
