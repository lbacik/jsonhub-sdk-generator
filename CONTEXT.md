# SDK Generation

This context covers how client SDKs are derived from a Product's API OpenAPI
contract and released to language package registries. It owns the pipeline,
not the API and not the SDK surfaces themselves. JsonHub is the first Product
released through it; more Products follow by adding a directory, not by
changing the pipeline.

## Language

**Product**:
An API whose SDKs this pipeline releases, with its SDK family: one package
name, the SDK Targets it enables, one repository per SDK Target.
_Avoid_: client, project

**API Release**:
A tagged release of a Product's API, identified by a `v*` tag on the API
repository. An API Release belongs to one Product, and does not imply that any
SDK changes.
_Avoid_: API version, release

**API Contract**:
The OpenAPI document a Product's API serves for a given API Release. It
declares every representation the API supports, including mutually exclusive
ones on the same operation. An API Contract belongs to one Product. It may be
served in several OpenAPI versions, each rendering the same API Contract; the
pipeline reads the one its toolchains accept, as named by the Product's API
Contract URL.
_Avoid_: spec, swagger, openapi.json

**Canonical Client Spec**:
The API Contract reduced to exactly one representation per operation, so that a
code generator can produce a client from it. The reduction is a contract
decision, made once and shared by every SDK Target.
_Avoid_: patched spec, normalized spec, derived spec

**SDK Target**:
One language a client is generated for, together with the generator tool and
package registry that belong to it. `ts` and `python` are SDK Targets; `php` is
not, because its client is hand-written. Each Product enables its own subset
of SDK Targets.
_Avoid_: language, platform, client type

**SDK Surface**:
The generated code an SDK Target exposes to its consumers. A change to the SDK
Surface is the only thing the release decision watches for, and so the only
thing that triggers an SDK Release on its own. It is not the only thing that
can warrant one: the package metadata the pipeline owns (the package name, the
published file allowlist) sits outside the SDK Surface and is applied only once
a release is already happening, so rolling such a change out takes a forced
release - see "Forcing a release" in `README.md`.
_Avoid_: generated code, client API

**SDK Release**:
A published version of one SDK Target of one Product on its registry. SDK
Releases are sparse against API Releases: an API Release that leaves the SDK
Surface unchanged produces none. Each SDK Target versions independently; its
number describes its own compatibility, not the API's.
_Avoid_: SDK version, client release

**Source API Version**:
The API Release an SDK Release was generated from, recorded in the SDK's package
metadata. It is not the SDK Release's own version number.
_Avoid_: api version
