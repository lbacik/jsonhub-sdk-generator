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

# FIXME(next pass): the fixture is hand-maintained and has drifted from what
# src/normalizer.mjs actually produces - `GET /api/definitions/{id}` resolves to
# application/hal+json, though it is a single-resource GET and the policy
# prefers application/json for those (README, "Canonical Client Spec"). Either
# the sample contract it was written against offered no application/json for
# that operation, in which case the fallback is correct and should be spelled
# out here, or the fixture predates the policy and should be regenerated. Until
# that is settled the fixture under-represents the single-resource rule: only
# `/api/entities/{id}` exercises it. The assertions below are deliberately
# written against each operation's own representation rather than a hardcoded
# media type, so they stay honest either way.
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "canonical-client-spec.sample.json"

HAL_JSON = "application/hal+json"
PROBLEM_JSON = "application/problem+json"


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

    def test_single_entity_reads_use_plain_json_with_inlined_relations(self) -> None:
        """Regression for issue #14: a single-resource GET must resolve to
        `application/json`, not `application/hal+json`, when the generated
        model expects relations (e.g. `definition`) as direct properties
        rather than under HAL's `_links`/`_embedded`.
        """

        operation = self.spec["paths"]["/api/entities/{id}"]["get"]
        response = operation["responses"]["200"]

        self.assertEqual(list(response["content"]), ["application/json"])

        schema = response["content"]["application/json"]["schema"]
        properties = merged_properties(self.schemas, schema)

        self.assertIn("definition", properties)
        self.assertNotIn("_links", properties)
        self.assertNotIn("_embedded", properties)

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

    def test_excludes_jsonld_and_duplicate_representation_schemas(self) -> None:
        self.assertFalse(any("jsonld" in name.lower() for name in self.schemas))
        self.assertNotIn("@", json.dumps(self.schemas))


if __name__ == "__main__":
    unittest.main()
