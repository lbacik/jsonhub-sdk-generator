import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalizeFetchedSpec } from "../src/cli.mjs";

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
