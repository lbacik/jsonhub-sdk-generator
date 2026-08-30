import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isErrorStatusCode,
  pruneUnreachableSchemas,
  reduceContentToSingleMediaType,
  reduceToCanonicalClientSpec,
  requestBodyMediaTypePreference,
  responseMediaTypePreference
} from "../src/normalizer.mjs";

test("isErrorStatusCode treats 4xx and 5xx as errors", () => {
  assert.equal(isErrorStatusCode("400"), true);
  assert.equal(isErrorStatusCode("404"), true);
  assert.equal(isErrorStatusCode("422"), true);
  assert.equal(isErrorStatusCode("500"), true);
  assert.equal(isErrorStatusCode("4XX"), true);
});

test("isErrorStatusCode treats everything else as success", () => {
  assert.equal(isErrorStatusCode("200"), false);
  assert.equal(isErrorStatusCode("201"), false);
  assert.equal(isErrorStatusCode("204"), false);
  assert.equal(isErrorStatusCode("2XX"), false);
  assert.equal(isErrorStatusCode("default"), false);
});

test("responseMediaTypePreference prefers hal+json then json for success", () => {
  assert.deepEqual(responseMediaTypePreference("200"), [
    "application/hal+json",
    "application/json"
  ]);
});

test("responseMediaTypePreference resolves errors to problem+json only", () => {
  assert.deepEqual(responseMediaTypePreference("404"), ["application/problem+json"]);
});

test("requestBodyMediaTypePreference defaults to json", () => {
  assert.deepEqual(requestBodyMediaTypePreference("post", { "application/json": {} }), [
    "application/json"
  ]);
});

test("requestBodyMediaTypePreference prefers merge-patch+json for PATCH", () => {
  assert.deepEqual(requestBodyMediaTypePreference("patch", { "application/json": {} }), [
    "application/merge-patch+json",
    "application/json"
  ]);
  assert.deepEqual(requestBodyMediaTypePreference("PATCH", { "application/json": {} }), [
    "application/merge-patch+json",
    "application/json"
  ]);
});

test("requestBodyMediaTypePreference resolves OAuth form bodies to x-www-form-urlencoded", () => {
  assert.deepEqual(
    requestBodyMediaTypePreference("post", {
      "application/x-www-form-urlencoded": {},
      "application/json": {}
    }),
    ["application/x-www-form-urlencoded"]
  );
});

test("reduceContentToSingleMediaType keeps content unchanged when it already has one entry", () => {
  const content = { "application/json": { schema: { type: "object" } } };
  const result = reduceContentToSingleMediaType(content, ["application/json"]);
  assert.deepEqual(result, content);
});

test("reduceContentToSingleMediaType falls back to the only available type when preference is missing", () => {
  const content = { "application/hal+json": { schema: { type: "object" } } };
  const result = reduceContentToSingleMediaType(content, ["application/json"]);
  assert.deepEqual(Object.keys(result), ["application/hal+json"]);
});

function buildSpec({ paths, schemas }) {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    paths,
    components: { schemas }
  };
}

test("every operation ends with exactly one representation, for both request bodies and responses", () => {
  const spec = buildSpec({
    paths: {
      "/definitions": {
        post: {
          requestBody: {
            content: {
              "application/ld+json": { schema: { $ref: "#/components/schemas/Definition.jsonld" } },
              "application/hal+json": { schema: { $ref: "#/components/schemas/Definition.jsonhal" } },
              "application/json": { schema: { $ref: "#/components/schemas/Definition" } }
            }
          },
          responses: {
            201: {
              content: {
                "application/hal+json": { schema: { $ref: "#/components/schemas/Definition.jsonhal" } },
                "application/ld+json": { schema: { $ref: "#/components/schemas/Definition.jsonld" } }
              }
            },
            400: {
              content: {
                "application/problem+json": { schema: { $ref: "#/components/schemas/Error" } },
                "application/json": { schema: { $ref: "#/components/schemas/Error" } }
              }
            }
          }
        }
      },
      "/definitions/{id}": {
        patch: {
          requestBody: {
            content: {
              "application/merge-patch+json": { schema: { $ref: "#/components/schemas/DefinitionPatch" } },
              "application/vnd.api+json": { schema: { $ref: "#/components/schemas/Definition.jsonapi" } }
            }
          },
          responses: {
            200: {
              content: {
                "application/hal+json": { schema: { $ref: "#/components/schemas/Definition.jsonhal" } }
              }
            }
          }
        }
      }
    },
    schemas: {
      "Definition.jsonld": { type: "object" },
      "Definition.jsonhal": { type: "object" },
      Definition: { type: "object" },
      DefinitionPatch: { type: "object" },
      "Definition.jsonapi": { type: "object" },
      Error: { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);

  const createOperation = canonical.paths["/definitions"].post;
  assert.equal(Object.keys(createOperation.requestBody.content).length, 1);
  assert.equal(Object.keys(createOperation.responses[201].content).length, 1);
  assert.equal(Object.keys(createOperation.responses[400].content).length, 1);

  const patchOperation = canonical.paths["/definitions/{id}"].patch;
  assert.equal(Object.keys(patchOperation.requestBody.content).length, 1);
  assert.equal(Object.keys(patchOperation.responses[200].content).length, 1);
});

test("success responses resolve to hal+json where the API offers it", () => {
  const spec = buildSpec({
    paths: {
      "/entities": {
        get: {
          responses: {
            200: {
              content: {
                "application/ld+json": { schema: { $ref: "#/components/schemas/Entities.jsonld" } },
                "application/hal+json": { schema: { $ref: "#/components/schemas/Entities.jsonhal" } },
                "application/json": { schema: { $ref: "#/components/schemas/Entities" } }
              }
            }
          }
        }
      }
    },
    schemas: {
      "Entities.jsonld": { type: "object" },
      "Entities.jsonhal": { type: "object" },
      Entities: { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  assert.deepEqual(Object.keys(canonical.paths["/entities"].get.responses[200].content), [
    "application/hal+json"
  ]);
});

test("success responses resolve to plain json where hal+json is not offered", () => {
  const spec = buildSpec({
    paths: {
      "/oauth2/token": {
        post: {
          responses: {
            200: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/TokenResponse" } }
              }
            }
          }
        }
      }
    },
    schemas: {
      TokenResponse: { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  assert.deepEqual(Object.keys(canonical.paths["/oauth2/token"].post.responses[200].content), [
    "application/json"
  ]);
});

test("error responses resolve to problem+json", () => {
  const spec = buildSpec({
    paths: {
      "/entities/{id}": {
        get: {
          responses: {
            404: {
              content: {
                "application/ld+json": { schema: { $ref: "#/components/schemas/Error.jsonld" } },
                "application/problem+json": { schema: { $ref: "#/components/schemas/Error" } },
                "application/json": { schema: { $ref: "#/components/schemas/Error" } }
              }
            }
          }
        }
      }
    },
    schemas: {
      "Error.jsonld": { type: "object" },
      Error: { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  assert.deepEqual(Object.keys(canonical.paths["/entities/{id}"].get.responses[404].content), [
    "application/problem+json"
  ]);
});

test("OAuth form request bodies resolve to x-www-form-urlencoded", () => {
  const spec = buildSpec({
    paths: {
      "/oauth2/token": {
        post: {
          requestBody: {
            content: {
              "application/x-www-form-urlencoded": { schema: { $ref: "#/components/schemas/TokenRequest" } }
            }
          },
          responses: {}
        }
      }
    },
    schemas: {
      TokenRequest: { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  assert.deepEqual(Object.keys(canonical.paths["/oauth2/token"].post.requestBody.content), [
    "application/x-www-form-urlencoded"
  ]);
});

test("PATCH request bodies prefer merge-patch+json over JSON:API", () => {
  const spec = buildSpec({
    paths: {
      "/entities/{id}": {
        patch: {
          requestBody: {
            content: {
              "application/merge-patch+json": { schema: { $ref: "#/components/schemas/EntityPatch" } },
              "application/vnd.api+json": { schema: { $ref: "#/components/schemas/Entity.jsonapi" } }
            }
          },
          responses: {}
        }
      }
    },
    schemas: {
      EntityPatch: { type: "object" },
      "Entity.jsonapi": { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  assert.deepEqual(Object.keys(canonical.paths["/entities/{id}"].patch.requestBody.content), [
    "application/merge-patch+json"
  ]);
});

test("collection endpoints retain total item count, page size, and current page", () => {
  const spec = buildSpec({
    paths: {
      "/definitions": {
        get: {
          responses: {
            200: {
              content: {
                "application/hal+json": {
                  schema: { $ref: "#/components/schemas/DefinitionCollection" }
                },
                "application/ld+json": {
                  schema: { $ref: "#/components/schemas/DefinitionCollection.jsonld" }
                }
              }
            }
          }
        }
      }
    },
    schemas: {
      DefinitionCollection: {
        type: "object",
        properties: {
          totalItems: { type: "integer" },
          itemsPerPage: { type: "integer" },
          page: { type: "integer" },
          _embedded: { type: "object" }
        }
      },
      "DefinitionCollection.jsonld": { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  const collectionSchema = canonical.components.schemas.DefinitionCollection;

  assert.ok(collectionSchema, "the retained collection schema must still be present");
  assert.ok("totalItems" in collectionSchema.properties);
  assert.ok("itemsPerPage" in collectionSchema.properties);
  assert.ok("page" in collectionSchema.properties);
});

test("every schema reference in the output resolves, and no unreachable schema survives", () => {
  const spec = buildSpec({
    paths: {
      "/definitions": {
        get: {
          responses: {
            200: {
              content: {
                "application/hal+json": { schema: { $ref: "#/components/schemas/DefinitionCollection" } },
                "application/ld+json": { schema: { $ref: "#/components/schemas/DefinitionCollection.jsonld" } }
              }
            }
          }
        }
      }
    },
    schemas: {
      DefinitionCollection: {
        type: "object",
        properties: {
          _embedded: {
            type: "array",
            items: { $ref: "#/components/schemas/Definition" }
          }
        }
      },
      Definition: { type: "object" },
      "DefinitionCollection.jsonld": { type: "object" },
      "Definition.jsonld": { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  const remainingSchemaNames = Object.keys(canonical.components.schemas).sort();

  assert.deepEqual(remainingSchemaNames, ["Definition", "DefinitionCollection"]);

  const serialized = JSON.stringify(canonical);
  for (const ref of serialized.matchAll(/#\/components\/schemas\/([A-Za-z0-9_.\-]+)/g)) {
    assert.ok(
      ref[1] in canonical.components.schemas,
      `dangling reference to ${ref[1]}`
    );
  }
});

test("pruneUnreachableSchemas keeps schemas transitively reachable through nested references", () => {
  const document = {
    paths: {
      "/x": {
        get: {
          responses: {
            200: { content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } }
          }
        }
      }
    },
    components: {
      schemas: {
        A: { properties: { b: { $ref: "#/components/schemas/B" } } },
        B: { properties: { c: { $ref: "#/components/schemas/C" } } },
        C: { type: "string" },
        Unused: { type: "string" }
      }
    }
  };

  const result = pruneUnreachableSchemas(structuredClone(document));
  assert.deepEqual(Object.keys(result.components.schemas).sort(), ["A", "B", "C"]);
});

test("success responses fall back to the only available representation when neither hal+json nor json is offered", () => {
  const spec = buildSpec({
    paths: {
      "/legacy": {
        get: {
          responses: {
            200: {
              content: {
                "application/ld+json": { schema: { $ref: "#/components/schemas/Legacy" } }
              }
            }
          }
        }
      }
    },
    schemas: { Legacy: { type: "object" } }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  assert.deepEqual(Object.keys(canonical.paths["/legacy"].get.responses[200].content), [
    "application/ld+json"
  ]);
});

test("collection endpoints shaped like the real API's allOf-composed HAL schema retain pagination fields", () => {
  const spec = buildSpec({
    paths: {
      "/api/definitions": {
        get: {
          responses: {
            200: {
              content: {
                "application/hal+json": { schema: { $ref: "#/components/schemas/DefinitionCollection" } },
                "application/ld+json": { schema: { $ref: "#/components/schemas/DefinitionCollection.jsonld" } }
              }
            }
          }
        }
      }
    },
    schemas: {
      DefinitionCollection: {
        allOf: [
          { $ref: "#/components/schemas/HalCollectionBase" },
          {
            type: "object",
            properties: {
              _embedded: {
                additionalProperties: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Definition" }
                }
              }
            }
          }
        ]
      },
      HalCollectionBase: {
        type: "object",
        properties: {
          totalItems: { type: "integer" },
          itemsPerPage: { type: "integer" },
          page: { type: "integer" }
        }
      },
      Definition: { type: "object" },
      "DefinitionCollection.jsonld": { type: "object" }
    }
  });

  const canonical = reduceToCanonicalClientSpec(spec);
  const remaining = canonical.components.schemas;

  assert.deepEqual(Object.keys(remaining).sort(), ["Definition", "DefinitionCollection", "HalCollectionBase"]);
  const pagination = remaining.HalCollectionBase.properties;
  assert.ok("totalItems" in pagination);
  assert.ok("itemsPerPage" in pagination);
  assert.ok("page" in pagination);
});

test("a requestBody that is itself a $ref into components.requestBodies still resolves to one representation", () => {
  const document = {
    paths: {
      "/tokens": {
        post: {
          requestBody: { $ref: "#/components/requestBodies/TokenRequest" },
          responses: {}
        }
      }
    },
    components: {
      requestBodies: {
        TokenRequest: {
          content: {
            "application/x-www-form-urlencoded": { schema: { $ref: "#/components/schemas/TokenForm" } },
            "application/json": { schema: { $ref: "#/components/schemas/TokenJson" } }
          }
        }
      },
      schemas: {
        TokenForm: { type: "object" },
        TokenJson: { type: "object" }
      }
    }
  };

  const canonical = reduceToCanonicalClientSpec(document);

  assert.deepEqual(Object.keys(canonical.components.requestBodies.TokenRequest.content), [
    "application/x-www-form-urlencoded"
  ]);
  assert.deepEqual(Object.keys(canonical.components.schemas), ["TokenForm"]);
});

test("a response that is itself a $ref into components.responses still resolves to one representation", () => {
  const document = {
    paths: {
      "/definitions/{id}": {
        get: {
          responses: {
            404: { $ref: "#/components/responses/NotFound" }
          }
        }
      }
    },
    components: {
      responses: {
        NotFound: {
          content: {
            "application/problem+json": { schema: { $ref: "#/components/schemas/Error" } },
            "application/json": { schema: { $ref: "#/components/schemas/Error" } }
          }
        }
      },
      schemas: {
        Error: { type: "object" },
        Unused: { type: "object" }
      }
    }
  };

  const canonical = reduceToCanonicalClientSpec(document);

  assert.deepEqual(Object.keys(canonical.components.responses.NotFound.content), [
    "application/problem+json"
  ]);
  assert.deepEqual(Object.keys(canonical.components.schemas), ["Error"]);
});

test("reduceToCanonicalClientSpec is a pure transformation that does not mutate its input", () => {
  const spec = buildSpec({
    paths: {
      "/definitions": {
        get: {
          responses: {
            200: {
              content: {
                "application/hal+json": { schema: { $ref: "#/components/schemas/Definition" } },
                "application/ld+json": { schema: { $ref: "#/components/schemas/Definition.jsonld" } }
              }
            }
          }
        }
      }
    },
    schemas: {
      Definition: { type: "object" },
      "Definition.jsonld": { type: "object" }
    }
  });

  const before = structuredClone(spec);
  reduceToCanonicalClientSpec(spec);

  assert.deepEqual(spec, before);
});
