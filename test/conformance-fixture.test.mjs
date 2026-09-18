import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  API_CONTRACT_SAMPLE_PATH,
  CANONICAL_CLIENT_SPEC_SAMPLE_PATH,
  buildConformanceFixture,
  serializeConformanceFixture
} from "../src/write-conformance-fixture.mjs";
import { isSingleResourceGet } from "../src/normalizer.mjs";

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
// The fallback path (a single-resource GET the API offers no application/json
// for) is covered by test/normalizer.test.mjs on its own document instead.
test("the sample API Contract offers a real choice on every single-resource GET", async () => {
  const contract = JSON.parse(await readFile(API_CONTRACT_SAMPLE_PATH, "utf8"));
  const singleResourceGets = Object.entries(contract.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => isSingleResourceGet(method, path))
      .map(([method, operation]) => [`${method.toUpperCase()} ${path}`, operation])
  );

  assert.ok(singleResourceGets.length > 1);

  for (const [operationName, operation] of singleResourceGets) {
    const representations = Object.keys(operation.responses["200"].content);

    assert.ok(
      representations.includes("application/json") &&
        representations.includes("application/hal+json"),
      `${operationName} must offer both representations for the choice to mean anything`
    );
  }
});
