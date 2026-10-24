import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  API_CONTRACT_SAMPLE_PATH,
  CANONICAL_CLIENT_SPEC_SAMPLE_PATH,
  buildConformanceFixture,
  serializeConformanceFixture
} from "../src/write-conformance-fixture.mjs";
import { isErrorStatusCode, isSuccessStatusCode } from "../src/normalizer.mjs";

const STALE_FIXTURE =
  "the Python conformance fixture is stale - run `npm run write-conformance-fixture`";

// What makes the fixture generated rather than merely generatable (AGENTS.md).
test("the committed conformance fixture is the Canonical Client Spec of its sample contract", async () => {
  const committed = await readFile(CANONICAL_CLIENT_SPEC_SAMPLE_PATH, "utf8");
  const rebuilt = await buildConformanceFixture();

  // Compared as documents first, so a drifted operation is reported as that
  // operation rather than as two 30KB strings, then as text for formatting.
  assert.deepEqual(rebuilt, JSON.parse(committed), STALE_FIXTURE);
  assert.equal(serializeConformanceFixture(rebuilt), committed, STALE_FIXTURE);
});

// An operation offering one representation satisfies the policy whichever way
// the policy goes, so it would leave the conformance suite asserting nothing.
// The fallback path (a response the API offers no application/json for) is
// covered by test/normalizer.test.mjs on its own document instead.
test("the sample API Contract offers a real choice on every 2xx response with a body", async () => {
  const contract = JSON.parse(await readFile(API_CONTRACT_SAMPLE_PATH, "utf8"));
  const successResponses = Object.entries(contract.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).flatMap(([method, operation]) =>
      Object.entries(operation?.responses ?? {})
        .filter(
          ([statusCode, response]) =>
            isSuccessStatusCode(statusCode) &&
            !isErrorStatusCode(statusCode) &&
            response?.content &&
            Object.keys(response.content).length > 0
        )
        .map(([statusCode]) => [`${method.toUpperCase()} ${path} ${statusCode}`, operation, statusCode])
    )
  );

  assert.ok(successResponses.length > 1);

  for (const [responseName, operation, statusCode] of successResponses) {
    const representations = Object.keys(operation.responses[statusCode].content);

    assert.ok(
      representations.includes("application/json") &&
        representations.includes("application/hal+json"),
      `${responseName} must offer both representations for the choice to mean anything`
    );
  }
});
