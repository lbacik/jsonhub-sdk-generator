# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one `CONTEXT.md` and one `docs/adr/` at the root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary for SDK generation and release.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Currently `0001`, on SDK versioning.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a ticket, a test name), use the term as defined in `CONTEXT.md`. In particular keep **API Release**, **API Contract**, **Canonical Client Spec**, **SDK Target**, **SDK Surface**, **SDK Release**, and **Source API Version** distinct — the whole design depends on not collapsing them into "version" and "spec".
