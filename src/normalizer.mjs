/**
 * Reduces an API Contract (an OpenAPI document) to a Canonical Client Spec:
 * the same document with exactly one representation per operation, chosen by
 * one shared policy instead of a single global "preferred media type" flag.
 *
 * Policy:
 *   response 2xx      -> application/hal+json, falling back to application/json
 *   response 4xx/5xx  -> application/problem+json
 *   request body      -> application/json
 *     PATCH           -> application/merge-patch+json
 *     OAuth forms      -> application/x-www-form-urlencoded
 *
 * This module is a pure, standalone transformation: it takes a document and
 * returns a document, with no network access, no code generation, and no
 * dependency on the rest of this pipeline. That is deliberate - the policy is
 * a contract decision expected to move into the API repository later, and
 * this isolation is what makes that move a deletion rather than a rewrite.
 *
 * Alongside representation selection, this module also repairs `type: array`
 * schemas the API Contract leaves without an `items`/`prefixItems` schema
 * (the JsonHub API's generic HAL collection base schema does this for its
 * `_embedded` property, since it doesn't know a collection's item type ahead
 * of the per-operation override merged in over it) - such schemas are valid
 * OpenAPI/JSON Schema, but unparseable by openapi-python-client. Filling
 * `items: {}` (accept anything) keeps every SDK Target's generator able to
 * process the Canonical Client Spec without hardcoding knowledge of any one
 * schema.
 */

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace"
]);

const SUCCESS_RESPONSE_MEDIA_TYPE_PREFERENCE = ["application/hal+json", "application/json"];
const ERROR_RESPONSE_MEDIA_TYPE_PREFERENCE = ["application/problem+json"];
const DEFAULT_REQUEST_BODY_MEDIA_TYPE_PREFERENCE = ["application/json"];
const PATCH_REQUEST_BODY_MEDIA_TYPE_PREFERENCE = ["application/merge-patch+json", "application/json"];
const FORM_REQUEST_BODY_MEDIA_TYPE = "application/x-www-form-urlencoded";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isErrorStatusCode(statusCode) {
  return /^[45]/.test(String(statusCode).trim());
}

function responseMediaTypePreference(statusCode) {
  return isErrorStatusCode(statusCode)
    ? ERROR_RESPONSE_MEDIA_TYPE_PREFERENCE
    : SUCCESS_RESPONSE_MEDIA_TYPE_PREFERENCE;
}

// Forms are identified by content rather than by path or operationId, so the
// policy stays data-driven and free of knowledge about individual operations.
function requestBodyMediaTypePreference(method, content) {
  if (content && FORM_REQUEST_BODY_MEDIA_TYPE in content) {
    return [FORM_REQUEST_BODY_MEDIA_TYPE];
  }

  if (String(method).toUpperCase() === "PATCH") {
    return PATCH_REQUEST_BODY_MEDIA_TYPE_PREFERENCE;
  }

  return DEFAULT_REQUEST_BODY_MEDIA_TYPE_PREFERENCE;
}

function pickMediaType(content, preferenceList) {
  const availableMediaTypes = Object.keys(content);

  if (availableMediaTypes.length === 0) {
    return null;
  }

  return preferenceList.find((mediaType) => mediaType in content) ?? availableMediaTypes[0];
}

function reduceContentToSingleMediaType(content, preferenceList) {
  if (!isPlainObject(content)) {
    return content;
  }

  const chosenMediaType = pickMediaType(content, preferenceList);

  if (chosenMediaType === null) {
    return content;
  }

  return { [chosenMediaType]: content[chosenMediaType] };
}

function decodeJsonPointerSegment(segment) {
  return decodeURIComponent(segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

// requestBody and response objects may themselves be $refs into
// components.requestBodies / components.responses (common in API-Platform
// specs). Resolve one level so the policy still reaches their `content`.
// If several operations share one such component with conflicting policies
// (e.g. both POST and PATCH pointing at the same components.requestBodies
// entry), the last operation processed wins - not a shape this API uses.
function resolveComponentRef(document, node) {
  if (!isPlainObject(node) || typeof node.$ref !== "string") {
    return node;
  }

  const match = node.$ref.match(/^#\/components\/(requestBodies|responses)\/(.+)$/);
  if (!match) {
    return node;
  }

  const [, section, encodedName] = match;
  return document.components?.[section]?.[decodeJsonPointerSegment(encodedName)] ?? node;
}

function reduceOperationToCanonicalRepresentations(document, operation, method) {
  const requestBody = resolveComponentRef(document, operation.requestBody);
  if (requestBody?.content) {
    requestBody.content = reduceContentToSingleMediaType(
      requestBody.content,
      requestBodyMediaTypePreference(method, requestBody.content)
    );
  }

  if (isPlainObject(operation.responses)) {
    for (const [statusCode, rawResponse] of Object.entries(operation.responses)) {
      const response = resolveComponentRef(document, rawResponse);
      if (!isPlainObject(response) || !response.content) {
        continue;
      }

      response.content = reduceContentToSingleMediaType(
        response.content,
        responseMediaTypePreference(statusCode)
      );
    }
  }
}

// Collects every "#/components/<section>/<name>" ref under node, grouped by
// section. Used both for schema reachability and, first, for finding which
// components.requestBodies/responses entries a path actually points at - those
// are logically inlined, so schemas reachable only through them still count.
function collectComponentRefs(node, refsBySection = new Map()) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectComponentRefs(item, refsBySection);
    }
  } else if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        const match = value.match(/^#\/components\/([^/]+)\/(.+)$/);
        if (match) {
          const [, section, encodedName] = match;
          const names = refsBySection.get(section) ?? new Set();
          names.add(decodeJsonPointerSegment(encodedName));
          refsBySection.set(section, names);
        }
        continue;
      }

      collectComponentRefs(value, refsBySection);
    }
  }

  return refsBySection;
}

function collectSchemaRefs(node) {
  return collectComponentRefs(node).get("schemas") ?? new Set();
}

function pruneUnreachableSchemas(document) {
  const schemas = document.components?.schemas;

  if (!schemas) {
    return document;
  }

  const pathRefs = collectComponentRefs(document.paths ?? {});
  const reachable = new Set(pathRefs.get("schemas") ?? []);

  for (const section of ["requestBodies", "responses"]) {
    for (const name of pathRefs.get(section) ?? []) {
      const component = document.components?.[section]?.[name];
      for (const schemaName of collectSchemaRefs(component ?? {})) {
        reachable.add(schemaName);
      }
    }
  }

  const queue = [...reachable];

  while (queue.length > 0) {
    const schemaName = queue.pop();
    const schema = schemas[schemaName];

    if (!schema) {
      continue;
    }

    for (const referencedSchemaName of collectSchemaRefs(schema)) {
      if (!reachable.has(referencedSchemaName)) {
        reachable.add(referencedSchemaName);
        queue.push(referencedSchemaName);
      }
    }
  }

  document.components.schemas = Object.fromEntries(
    Object.entries(schemas).filter(([schemaName]) => reachable.has(schemaName))
  );

  return document;
}

// A `type: array` schema with neither `items` nor `prefixItems` is valid
// OpenAPI/JSON Schema (it places no constraint on element shape), but
// openapi-python-client refuses to generate one ("type array must have items
// or prefixItems defined"). Filling in a permissive `items: {}` preserves the
// schema's meaning while making it something every SDK Target's generator can
// process. Walks the whole document, not just components.schemas, since
// array schemas can also appear inline.
function fillMissingArrayItemSchemas(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      fillMissingArrayItemSchemas(item);
    }
    return;
  }

  if (!isPlainObject(node)) {
    return;
  }

  if (node.type === "array" && node.items === undefined && node.prefixItems === undefined) {
    node.items = {};
  }

  for (const value of Object.values(node)) {
    fillMissingArrayItemSchemas(value);
  }
}

function reduceToCanonicalClientSpec(document) {
  const canonical = structuredClone(document);

  for (const pathItem of Object.values(canonical.paths ?? {})) {
    if (!isPlainObject(pathItem)) {
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isPlainObject(operation)) {
        continue;
      }

      reduceOperationToCanonicalRepresentations(canonical, operation, method);
    }
  }

  const pruned = pruneUnreachableSchemas(canonical);
  fillMissingArrayItemSchemas(pruned);
  return pruned;
}

export {
  isErrorStatusCode,
  requestBodyMediaTypePreference,
  responseMediaTypePreference,
  reduceContentToSingleMediaType,
  pruneUnreachableSchemas,
  fillMissingArrayItemSchemas,
  reduceToCanonicalClientSpec
};
