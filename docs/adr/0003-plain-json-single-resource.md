---
status: accepted
---

# Single-resource responses use plain JSON; the API Contract must describe the wire

Every 2xx response carrying one resource is modelled and requested as plain
JSON in the Canonical Client Spec. Only collection reads keep HAL.

## Context

API Platform renders two shapes for the same resource: plain
`application/json` carries relations as direct properties, while
`application/hal+json` moves them under `_links`/`_embedded`. A generated
model built from the direct (non-HAL) schema therefore needs the plain
representation — serving it HAL means `from_dict()` lookups like
`definition` raise `KeyError` (issue #14).

The first fix covered only single-resource GETs, classified by path shape ("a
GET whose path ends in a path parameter"). That left POST 201 and PATCH 200 on
HAL, where they lost the same relations, and it could not classify a `POST
/entities` or a report such as `GET /reports/dashboard` at all.

## Decision

The normalizer's 2xx policy is now shaped by the response, not the path:

- a **collection read** — a GET whose 2xx `application/json` schema, after
  resolving `$ref`, is `type: array` (how API Platform renders plain-JSON
  collections) — resolves to `application/hal+json`, falling back to
  `application/json`, since pagination needs the HAL envelope;
- **every other 2xx with a body** resolves to `application/json`, falling
  back to `application/hal+json`.

Each operation's `Accept` parameter default follows the same choice. The
normalizer does **not** rewrite or compensate for producer HAL schemas: a
Product whose contract misdescribes the wire fixes its own API.

Because the policy change alters generated models, the next `ts` and `python`
SDK Releases under it are majors (see `docs/adr/0001-sdk-versioning.md`).

## Considered options

**Keeping HAL for POST/PATCH and reading `links.<rel>.href`** was rejected:
it trades one generated model for hand-written client-side join logic per
relation, reintroduces exactly the `_links`/`_embedded` coupling plain JSON
removes, and every new relation reopens the question. Fixing the
representation fixes all relations at once.

**A per-Product policy switch** (a flag or config choosing HAL vs JSON per
operation) was rejected: the Canonical Client Spec exists so every SDK Target
shares one policy instead of drifting apart (see `AGENTS.md`). A switch
reintroduces that drift as configuration and moves a contract decision — which
representation carries the resource — out of the contract.

**Rewriting producer HAL schemas in the normalizer** (lifting `_links`
relations into direct properties during reduction) was rejected: the
normalizer would be guessing a Product's domain model from its serialization
envelope, silently diverging from what the API actually serves. A contract
that misdescribes the wire is a Product bug; papering over it here hides the
bug from the party that can fix it.

## Consequences

- POST 201, PATCH 200 and report GETs resolve to `application/json`,
  collection GETs stay on `application/hal+json`.
- The release decision classifies a changed response representation as
  breaking, so the policy change itself ships as a major.
