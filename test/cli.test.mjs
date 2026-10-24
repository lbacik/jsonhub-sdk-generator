import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalizeFetchedSpec,
  requireCanonicalClientSpecForTarget,
  validateOpenApiVersionForTarget,
  validateOptionsForTarget
} from "../src/cli.mjs";

test("canonicalizeFetchedSpec reduces a JSON spec to its Canonical Client Spec", () => {
  const spec = {
    extension: "json",
    body: JSON.stringify({
      openapi: "3.1.0",
      paths: {
        "/definitions": {
          post: {
            requestBody: {
              content: {
                "application/ld+json": { schema: { $ref: "#/components/schemas/Definition.jsonld" } },
                "application/json": { schema: { $ref: "#/components/schemas/Definition" } }
              }
            },
            responses: {
              201: {
                content: {
                  "application/hal+json": { schema: { $ref: "#/components/schemas/Definition.jsonhal" } },
                  "application/ld+json": { schema: { $ref: "#/components/schemas/Definition.jsonld" } }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          "Definition.jsonld": { type: "object" },
          Definition: { type: "object" },
          "Definition.jsonhal": { type: "object" }
        }
      }
    })
  };

  const canonical = canonicalizeFetchedSpec(spec);

  const operation = canonical.paths["/definitions"].post;
  assert.deepEqual(Object.keys(operation.requestBody.content), ["application/json"]);
  assert.deepEqual(Object.keys(operation.responses[201].content), ["application/hal+json"]);
  assert.deepEqual(Object.keys(canonical.components.schemas).sort(), [
    "Definition",
    "Definition.jsonhal"
  ]);
});

test("canonicalizeFetchedSpec skips YAML specs", () => {
  assert.equal(canonicalizeFetchedSpec({ extension: "yaml", body: "openapi: 3.1.0" }), null);
});

const PYTHON_TARGET_CONFIG = { runner: "openapi-python-client", extension: "json", packageVersion: "0.1.0", supportedOpenApiVersions: ["3.0", "3.1"] };
const TS_TARGET_CONFIG = { runner: "openapi-generator", generator: "typescript-fetch", extension: "json", supportedOpenApiVersions: ["3.0", "3.1"] };

test("validateOptionsForTarget allows the ts target to use --property, --skip-validate-spec, and --prune-unused-models", () => {
  assert.doesNotThrow(() =>
    validateOptionsForTarget(
      { target: "ts", property: [["npmVersion", "2.0.0"]], skipValidateSpec: true, pruneUnusedModels: true },
      TS_TARGET_CONFIG
    )
  );
});

test("validateOptionsForTarget rejects --property for the python target", () => {
  assert.throws(
    () => validateOptionsForTarget({ property: [["foo", "bar"]] }, PYTHON_TARGET_CONFIG),
    /--property is not supported for the python target/
  );
});

test("validateOptionsForTarget rejects --skip-validate-spec for the python target", () => {
  assert.throws(
    () => validateOptionsForTarget({ property: [], skipValidateSpec: true }, PYTHON_TARGET_CONFIG),
    /--skip-validate-spec is not supported for the python target/
  );
});

test("validateOptionsForTarget rejects --prune-unused-models for the python target", () => {
  assert.throws(
    () =>
      validateOptionsForTarget(
        { property: [], skipValidateSpec: false, pruneUnusedModels: true },
        PYTHON_TARGET_CONFIG
      ),
    /--prune-unused-models is currently only supported for the ts target/
  );
});

test("validateOptionsForTarget allows the python target when no incompatible flags are set", () => {
  assert.doesNotThrow(() =>
    validateOptionsForTarget(
      { property: [], skipValidateSpec: false, pruneUnusedModels: false },
      PYTHON_TARGET_CONFIG
    )
  );
});

test("requireCanonicalClientSpecForTarget rejects a YAML (non-canonicalized) specification for the python target", () => {
  assert.throws(
    () => requireCanonicalClientSpecForTarget(PYTHON_TARGET_CONFIG, null),
    /python target requires a JSON specification/
  );
});

test("requireCanonicalClientSpecForTarget allows a YAML specification for openapi-generator targets", () => {
  assert.doesNotThrow(() => requireCanonicalClientSpecForTarget(TS_TARGET_CONFIG, null));
});

test("requireCanonicalClientSpecForTarget never rejects once a Canonical Client Spec was produced", () => {
  assert.doesNotThrow(() => requireCanonicalClientSpecForTarget(PYTHON_TARGET_CONFIG, { paths: {} }));
});

test("validateOpenApiVersionForTarget accepts 3.0.x contracts for the ts target", () => {
  assert.doesNotThrow(() =>
    validateOpenApiVersionForTarget({ openapi: "3.0.4" }, TS_TARGET_CONFIG)
  );
});

test("validateOpenApiVersionForTarget accepts 3.1.x contracts for the ts target", () => {
  assert.doesNotThrow(() =>
    validateOpenApiVersionForTarget({ openapi: "3.1.0" }, TS_TARGET_CONFIG)
  );
});

test("validateOpenApiVersionForTarget accepts 3.0.x contracts for the python target", () => {
  assert.doesNotThrow(() =>
    validateOpenApiVersionForTarget({ openapi: "3.0.4" }, PYTHON_TARGET_CONFIG)
  );
});

test("validateOpenApiVersionForTarget accepts 3.1.x contracts for the python target", () => {
  assert.doesNotThrow(() =>
    validateOpenApiVersionForTarget({ openapi: "3.1.0" }, PYTHON_TARGET_CONFIG)
  );
});

test("validateOpenApiVersionForTarget rejects a 3.2.0 contract with one actionable line", () => {
  assert.throws(
    () => validateOpenApiVersionForTarget({ openapi: "3.2.0" }, TS_TARGET_CONFIG),
    (error) => {
      assert.match(error.message, /Unsupported OpenAPI version "3\.2\.0"/);
      assert.match(error.message, /supported versions are 3\.0, 3\.1/);
      assert.match(error.message, /apiContractUrl/);
      assert.match(error.message, /--url/);
      assert.equal(error.message.includes("\n"), false);
      return true;
    }
  );
});

test("validateOpenApiVersionForTarget rejects a 2.0 contract", () => {
  assert.throws(
    () => validateOpenApiVersionForTarget({ openapi: "2.0" }, TS_TARGET_CONFIG),
    /Unsupported OpenAPI version "2\.0".*supported versions are 3\.0, 3\.1.*apiContractUrl.*--url/
  );
});

test("validateOpenApiVersionForTarget rejects a Swagger-style 2.0 contract for the python target", () => {
  assert.throws(
    () => validateOpenApiVersionForTarget({ swagger: "2.0" }, PYTHON_TARGET_CONFIG),
    /Unsupported OpenAPI version "2\.0"/
  );
});
