---
status: accepted
---

# SDK Releases use independent semver, not the API version

Each SDK Target versions itself independently and records the API Release it was
generated from as Source API Version in package metadata and the changelog. The
SDK's own number describes only its own compatibility.

## Considered Options

Mirroring the API Release outright, and mirroring `major.minor` with an
independent patch, were both considered and rejected. The rejection is worth
recording because mirroring is the obvious choice for a generated client — it is
what `client-go` and the Elastic clients do — and someone will propose it again.

Three conflicts specific to JsonHub decided it:

- **The API's tag format is not npm-compatible.** Of 41 `v*` tags, 10 cannot be
  published to npm: eight two-component tags (`v0.2` … `v0.10`) and two
  four-component ones (`v0.7.2.1`, `v0.8.14.1`). npm requires exactly
  `MAJOR.MINOR.PATCH`. `v0.8.14.1` has no clean npm home at all: `0.8.15`
  collides with a future real tag, `0.8.14-1` is a prerelease and sorts *before*
  `0.8.14`, and `0.8.14+1` is build metadata npm ignores for precedence. PyPI
  would accept it under PEP 440, so mirroring would also make the npm and PyPI
  numbers diverge — defeating its own purpose.
- **SDK Releases are sparse.** An API Release that leaves the SDK Surface
  unchanged produces no SDK Release, so a mirrored mapping is partial. Making it
  total requires publishing no-op releases, which is precisely what the pipeline
  exists to avoid.
- **SDK Targets diverge.** TypeScript and Python go through different generators,
  so their surfaces move independently. One number cannot be true for both.

Underneath all three: version ranges are machine-consumed. An API patch that
renames a response field is a *breaking* SDK change; mirrored, it would ship as
a patch and every consumer on `^x.y.z` would upgrade into a broken build.

## Consequences

Independent semver only pays for itself if the bump level is classified rather
than guessed, so the pipeline derives it from an `oasdiff` comparison of the
previous and current Canonical Client Spec: breaking → major, additive → minor,
otherwise patch — with a minor floor whenever the generator or toolchain version
changes, since a generator upgrade can restructure the SDK Surface with no spec
change at all.

Because no line number ties an SDK back to its API, Source API Version is the
only such link, and the changelog carries a generated compatibility table.
