# JsonHub SDK Generation

This context covers how JsonHub client SDKs are derived from the JsonHub API's
OpenAPI contract and released to language package registries. It owns the
pipeline, not the API and not the SDK surfaces themselves.

## Language

**API Release**:
A tagged release of the JsonHub API, identified by a `v*` git tag on the API
repository. An API Release does not imply that any SDK changes.
_Avoid_: API version, release

**API Contract**:
The OpenAPI document the JsonHub API serves for a given API Release. It declares
every representation the API supports, including mutually exclusive ones on the
same operation.
_Avoid_: spec, swagger, openapi.json

**Canonical Client Spec**:
The API Contract reduced to exactly one representation per operation, so that a
code generator can produce a client from it. The reduction is a contract
decision, made once and shared by every SDK Target.
_Avoid_: patched spec, normalized spec, derived spec

**SDK Target**:
One language a client is generated for, together with the generator tool and
package registry that belong to it. `ts` and `python` are SDK Targets; `php` is
not, because its client is hand-written.
_Avoid_: language, platform, client type

**SDK Surface**:
The generated code an SDK Target exposes to its consumers. A change to the SDK
Surface is the only thing that requires publishing a new SDK Release.
_Avoid_: generated code, client API

**SDK Release**:
A published version of one SDK Target on its registry. SDK Releases are sparse
against API Releases: an API Release that leaves the SDK Surface unchanged
produces none. Each SDK Target versions independently; its number describes its
own compatibility, not the API's.
_Avoid_: SDK version, client release

**Source API Version**:
The API Release an SDK Release was generated from, recorded in the SDK's package
metadata. It is not the SDK Release's own version number.
_Avoid_: api version

