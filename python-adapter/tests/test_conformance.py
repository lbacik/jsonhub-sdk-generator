"""Conformance suite for the Canonical Client Spec, as consumed by the Python SDK Target.

This suite predates the Canonical Client Spec: it used to run against a
Python-specific projection that this adapter no longer builds (see the
repository's AGENTS.md and CONTEXT.md). It is retained here, repointed at a
sample Canonical Client Spec fixture, because it encodes real knowledge about
what breaks the Python generator - most notably that every operation must
carry exactly one representation. Its pagination assertions are rewritten
from JSON:API to HAL, per this repository's Canonical Client Spec policy.
"""

import json
import unittest
from pathlib import Path
from typing import Any

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

    def test_excludes_jsonld_and_duplicate_representation_schemas(self) -> None:
        self.assertFalse(any("jsonld" in name.lower() for name in self.schemas))
        self.assertNotIn("@", json.dumps(self.schemas))


if __name__ == "__main__":
    unittest.main()
