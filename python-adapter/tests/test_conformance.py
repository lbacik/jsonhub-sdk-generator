"""Conformance suite for the Canonical Client Spec, as consumed by the Python SDK Target.

This suite predates the Canonical Client Spec: it used to run against a
Python-specific projection that this adapter no longer builds (see the
repository's AGENTS.md and CONTEXT.md). It is retained here, repointed at a
sample Canonical Client Spec fixture, because it encodes real knowledge about
what breaks the Python generator - most notably that every operation must
carry exactly one representation, and must ask for that representation through
an `Accept` header parameter, since the generator derives no such header from
a response's `content` entry. Its pagination assertions are rewritten from
JSON:API to HAL, per this repository's Canonical Client Spec policy.
"""

import json
import unittest
from pathlib import Path
from typing import Any

# Generated, not hand-maintained: `npm run write-conformance-fixture` reduces
# `api-contract.sample.json` next to it through src/normalizer.mjs, and
# test/conformance-fixture.test.mjs fails while the two disagree. Editing the
# fixture by hand is how it drifted away from the policy it encodes before
# issue #14's follow-up (see AGENTS.md); edit the sample contract instead.
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "canonical-client-spec.sample.json"
CONTRACT_PATH = Path(__file__).parent / "fixtures" / "api-contract.sample.json"

HAL_JSON = "application/hal+json"
PLAIN_JSON = "application/json"
PROBLEM_JSON = "application/problem+json"


def resolve_contract_schema(
    schemas: dict[str, Any], schema: Any, _seen: frozenset[str] = frozenset()
) -> Any:
    """Follow a `#/components/schemas/<name>` reference chain to the schema it names.

    Deliberately mirrors `resolveSchemaReference` in `src/normalizer.mjs`: this
    suite runs on its own toolchain, so the alternative is a hand-listed set of
    collection paths - the kind of hand-maintenance that let the fixture drift
    in the first place.
    """

    current = schema
    seen = set(_seen)
    while isinstance(current, dict) and isinstance(current.get("$ref"), str):
        ref = current["$ref"]
        if not ref.startswith("#/components/schemas/"):
            return current
        name = ref.removeprefix("#/components/schemas/")
        if name in seen:
            return current
        seen.add(name)
        resolved = schemas.get(name)
        if not isinstance(resolved, dict):
            return current
        current = resolved
    return current


def is_collection_read(contract: dict[str, Any], operation: dict[str, Any], method: str) -> bool:
    """A GET whose 2xx `application/json` schema, after resolving `$ref`, is
    `type: array` - how API Platform renders plain-JSON collections.

    Deliberately mirrors `isCollectionRead` in `src/normalizer.mjs`: the first
    2xx response (in the contract's own order) offering `application/json`
    decides.
    """

    if method.lower() != "get":
        return False
    for status, response in (operation.get("responses") or {}).items():
        if not str(status).startswith("2"):
            continue
        media = (response or {}).get("content", {}).get(PLAIN_JSON)
        if not isinstance(media, dict):
            continue
        schema = resolve_contract_schema(contract["components"]["schemas"], media.get("schema"))
        return isinstance(schema, dict) and schema.get("type") == "array"
    return False


def resolve_schema(schemas: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
        return schemas[ref.removeprefix("#/components/schemas/")]
    return schema


def merged_properties(schemas: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """Collect the properties of a schema, flattening one level of allOf."""

    schema = resolve_schema(schemas, schema)
    if "allOf" in schema:
        properties: dict[str, Any] = {}
        for part in schema["allOf"]:
            properties.update(merged_properties(schemas, part))
        return properties
    return schema.get("properties", {})


class CanonicalClientSpecConformanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec: dict[str, Any] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.schemas: dict[str, Any] = cls.spec["components"]["schemas"]
        cls.contract: dict[str, Any] = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_uses_one_representation_per_operation(self) -> None:
        for path_item in self.spec["paths"].values():
            for operation in path_item.values():
                if not isinstance(operation, dict):
                    continue
                request_body = operation.get("requestBody", {})
                if "content" in request_body:
                    self.assertEqual(len(request_body["content"]), 1)
                for response in operation.get("responses", {}).values():
                    if "content" in response:
                        self.assertEqual(len(response["content"]), 1)

    def test_collection_endpoints_keep_pagination_through_hal(self) -> None:
        operation = self.spec["paths"]["/api/definitions"]["get"]
        response = operation["responses"]["200"]

        self.assertEqual(list(response["content"]), [HAL_JSON])

        schema = response["content"][HAL_JSON]["schema"]
        properties = merged_properties(self.schemas, schema)

        self.assertEqual(properties["totalItems"]["type"], "integer")
        self.assertEqual(properties["itemsPerPage"]["type"], "integer")
        self.assertEqual(properties["page"]["type"], "integer")
        self.assertIn("_embedded", properties)

    def test_error_responses_resolve_to_problem_json(self) -> None:
        for path_item in self.spec["paths"].values():
            for operation in path_item.values():
                if not isinstance(operation, dict):
                    continue
                for status, response in operation.get("responses", {}).items():
                    if status.startswith(("4", "5")) and "content" in response:
                        self.assertEqual(list(response["content"]), [PROBLEM_JSON])

    def test_single_entity_read_inlines_its_definition_relation(self) -> None:
        """Regression for issue #14, on the operation that reported it: the
        model generated for `GET /api/entities/{id}` has to carry `definition`
        as a direct property, which only the `application/json` representation
        provides - HAL puts the same relation under `_links`/`_embedded`, and
        `from_dict()` raised `KeyError: 'definition'` on it.
        """

        operation = self.spec["paths"]["/api/entities/{id}"]["get"]
        response = operation["responses"]["200"]

        self.assertEqual(list(response["content"]), [PLAIN_JSON])

        schema = response["content"][PLAIN_JSON]["schema"]
        properties = merged_properties(self.schemas, schema)

        self.assertIn("definition", properties)
        self.assertNotIn("_links", properties)
        self.assertNotIn("_embedded", properties)

    def test_responses_carrying_one_resource_resolve_to_plain_json(self) -> None:
        """The rule behind issue #14, applied to every response carrying one
        resource rather than to single-resource GETs alone: the HAL
        representation of a single resource hides relations under
        `_links`/`_embedded`, so a generated model built from the direct
        schema needs `application/json`. That covers POST 201, PATCH 200 and
        report GETs - shapes a path-based rule ("a GET whose path ends in a
        path parameter") cannot classify.

        `test/conformance-fixture.test.mjs` keeps every 2xx response with a
        body in the sample contract offering both representations, so each of
        these is a real choice rather than the only one available; the fallback
        case (an operation the API offers no `application/json` for) is covered
        by `test/normalizer.test.mjs` on the generator side.
        """

        single_responses = [
            (method, path, status, response)
            for path, path_item in self.contract["paths"].items()
            for method, operation in path_item.items()
            if isinstance(operation, dict)
            for status, response in (operation.get("responses") or {}).items()
            if (
                str(status).startswith("2")
                and isinstance(response, dict)
                and "content" in response
                and not is_collection_read(self.contract, operation, method)
            )
        ]

        self.assertGreater(len(single_responses), 1)

        for method, path, status, _response in single_responses:
            with self.subTest(method=method, path=path, status=status):
                operation = self.spec["paths"][path][method]
                response = operation["responses"][status]
                self.assertEqual(list(response["content"]), [PLAIN_JSON])

    def test_collection_reads_resolve_to_hal_json(self) -> None:
        """The other half of the policy: a GET whose 2xx `application/json`
        schema is `type: array` keeps the HAL envelope, since pagination needs
        it. Classified from the sample contract's schemas, exactly as
        `src/normalizer.mjs` classifies the real one.
        """

        collection_reads = [
            (method, path, status)
            for path, path_item in self.contract["paths"].items()
            for method, operation in path_item.items()
            if isinstance(operation, dict)
            for status in (operation.get("responses") or {})
            if str(status).startswith("2")
            and is_collection_read(self.contract, operation, method)
        ]

        self.assertGreater(len(collection_reads), 0)

        for method, path, status in collection_reads:
            with self.subTest(method=method, path=path, status=status):
                operation = self.spec["paths"][path][method]
                response = operation["responses"][status]
                self.assertEqual(list(response["content"]), [HAL_JSON])

    def test_every_operation_asks_for_the_representation_it_declares(self) -> None:
        """Regression for issue #14: choosing one representation per operation
        only fixes the model the generator builds. `openapi-python-client`
        derives no `Accept` header from a response's `content` entry, so the
        Canonical Client Spec has to state the choice as an `Accept` header
        parameter - which the generator does render, as a keyword-only
        argument carrying that default. Without it the request goes out with
        whatever `Accept` a consumer set once on its client.
        """

        for path, path_item in self.spec["paths"].items():
            for method, operation in path_item.items():
                if not isinstance(operation, dict):
                    continue

                success = next(
                    (
                        response
                        for status, response in operation.get("responses", {}).items()
                        if status.startswith("2") and "content" in response
                    ),
                    None,
                )
                if success is None:
                    continue

                with self.subTest(method=method, path=path):
                    accept = [
                        parameter
                        for parameter in operation.get("parameters", [])
                        if parameter.get("in") == "header"
                        and parameter.get("name", "").lower() == "accept"
                    ]

                    self.assertEqual(len(accept), 1)
                    self.assertEqual(
                        accept[0]["schema"]["default"], next(iter(success["content"]))
                    )

    def test_array_schemas_declare_their_items(self) -> None:
        """`openapi-python-client` refuses a `type: array` schema that declares
        neither `items` nor `prefixItems` ("type array must have items or
        prefixItems defined"), though OpenAPI allows it - the JsonHub API's HAL
        collection base leaves `_embedded.item` open, since it doesn't know a
        collection's item type before the per-operation override. The Canonical
        Client Spec fills those in, and generation fails outright when it stops.
        """

        def array_schemas_without_items(node: Any) -> list[dict[str, Any]]:
            if isinstance(node, list):
                return [found for item in node for found in array_schemas_without_items(item)]
            if not isinstance(node, dict):
                return []

            declares_items = bool({"items", "prefixItems"} & node.keys())
            found = [node] if node.get("type") == "array" and not declares_items else []

            return found + [
                nested for value in node.values() for nested in array_schemas_without_items(value)
            ]

        self.assertEqual(array_schemas_without_items(self.spec), [])

    def test_excludes_jsonld_and_duplicate_representation_schemas(self) -> None:
        self.assertFalse(any("jsonld" in name.lower() for name in self.schemas))
        self.assertNotIn("@", json.dumps(self.schemas))


if __name__ == "__main__":
    unittest.main()
