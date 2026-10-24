---
status: accepted
---

# One generator serves several Products

The pipeline releases SDKs for more than one API. JsonHub is the first
Product; the next one arrives without forking the pipeline.

## Considered Options

Three shapes were on the table:

1. **Fork per Product** - copy the whole generator repository for each new API
   and maintain the copies side by side.
2. **Re-implement in each API's CI** - move the release logic into every API
   repository's own workflows, tuned to that API.
3. **Generalize with a Product dimension** - keep one generator and resolve
   everything Product-specific (package name, SDK repositories, hand-owned
   metadata, API Contract URL) from `products/<product>/` at run time.

Option 3 was chosen. The pipeline's hard parts - the Canonical Client Spec
reduction, the three-detector release decision, the per-ecosystem manifest
merge - are identical for every API; forking them (1) would turn each policy
fix into N coordinated commits, and re-implementing them per API (2) would
drift the SDK Targets apart, which is exactly what the shared reduction in
`src/normalizer.mjs` exists to prevent. A Product dimension keeps one copy of
each decision: adding a Product means adding a directory, and no script or
workflow changes.

## Consequences

`products/<product>/product.json` owns the package name, the API Contract URL,
and the enabled SDK Targets; `src/product.mjs` is the only code that reads
it. The release scripts and workflows are Product-agnostic and take `PRODUCT`
beside `TARGET`.

The repository name and the bot identity (`jsonhub-sdk-generator[bot]`) are now
misnomers - they name the first Product, not what the repository does. They
stay as they are: renaming them is a separate decision, tracked apart from
this one.
