import assert from "node:assert/strict";
import { test } from "node:test";

import {
  preferContentMediaType,
  preferFirstAvailableContentMediaType,
  preprocessSpec,
  responseMediaTypePreference
} from "../src/cli.mjs";

test("preferContentMediaType keeps content unchanged when requested media type is missing", () => {
  const content = {
    "application/json": {
      schema: {
        type: "object"
      }
    }
  };

  const result = preferContentMediaType(content, "application/hal+json");

  assert.equal(result.content, content);
  assert.equal(result.changed, false);
});

test("preferFirstAvailableContentMediaType chooses the first available fallback", () => {
  const result = preferFirstAvailableContentMediaType(
    {
      "application/ld+json": {
        schema: {
          $ref: "#/components/schemas/Error.jsonld"
        }
      },
      "application/problem+json": {
        schema: {
          $ref: "#/components/schemas/Error"
        }
      },
      "application/json": {
        schema: {
          $ref: "#/components/schemas/Error"
        }
      }
    },
    responseMediaTypePreference("application/hal+json")
  );

  assert.deepEqual(Object.keys(result.content), ["application/problem+json"]);
  assert.equal(result.changed, true);
});

test("preprocessSpec applies response fallback without changing request fallback semantics", () => {
  const spec = {
    extension: "json",
    body: JSON.stringify({
      openapi: "3.1.0",
      paths: {
        "/definitions": {
          post: {
            requestBody: {
              content: {
                "application/ld+json": {
                  schema: {
                    $ref: "#/components/schemas/Definition.jsonld"
                  }
                },
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Definition"
                  }
                }
              }
            },
            responses: {
              400: {
                description: "Bad request",
                content: {
                  "application/ld+json": {
                    schema: {
                      $ref: "#/components/schemas/Error.jsonld"
                    }
                  },
                  "application/problem+json": {
                    schema: {
                      $ref: "#/components/schemas/Error"
                    }
                  },
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/Error"
                    }
                  }
                }
              }
            }
          }
        }
      }
    })
  };

  const result = preprocessSpec(spec, {
    preferMediaType: "application/hal+json"
  });
  const document = JSON.parse(result.body);
  const operation = document.paths["/definitions"].post;

  assert.deepEqual(Object.keys(operation.requestBody.content), [
    "application/ld+json",
    "application/json"
  ]);
  assert.deepEqual(Object.keys(operation.responses[400].content), [
    "application/problem+json"
  ]);
  assert.equal(result.changed, true);
});
