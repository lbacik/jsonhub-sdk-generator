import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveProduct } from "../src/product.mjs";

function sampleProducts() {
  return {
    jsonhub: {
      packageName: "jsonhub-sdk",
      apiContractUrl: "https://api.jsonhub.cloud/api/docs.jsonopenapi",
      targets: {
        ts: { repository: "lbacik/jsonhub-sdk-ts" },
        python: { repository: "lbacik/jsonhub-sdk-python" }
      }
    }
  };
}

function resolveEnabled(product = "jsonhub", target = "ts", overrides = {}) {
  return resolveProduct({
    products: sampleProducts(),
    product,
    target,
    event: {},
    hasHandOwnedMetadata: true,
    ...overrides
  });
}

test("an enabled SDK Target resolves its repository, package name, and metadata location", () => {
  const resolution = resolveEnabled("jsonhub", "ts");

  assert.equal(resolution.enabled, true);
  assert.equal(resolution.repository, "lbacik/jsonhub-sdk-ts");
  assert.equal(resolution.packageName, "jsonhub-sdk");
  assert.equal(resolution.handOwnedMetadata, "products/jsonhub/ts/package.metadata.json");
});

test("each enabled SDK Target of a Product resolves", () => {
  const python = resolveEnabled("jsonhub", "python");

  assert.equal(python.enabled, true);
  assert.equal(python.repository, "lbacik/jsonhub-sdk-python");
  assert.equal(python.handOwnedMetadata, "products/jsonhub/python/package.metadata.json");
});

test("a disabled SDK Target reports enabled false with no repository or metadata", () => {
  const resolution = resolveEnabled("jsonhub", "php");

  assert.equal(resolution.enabled, false);
  assert.equal(resolution.repository, null);
  assert.equal(resolution.handOwnedMetadata, null);
  // Product-level facts still resolve: the Product exists, only the target
  // is not part of its SDK family.
  assert.equal(resolution.packageName, "jsonhub-sdk");
});

test("an unknown Product throws a short, actionable error", () => {
  assert.throws(
    () => resolveEnabled("pay-subscriptions", "ts"),
    /Unknown product "pay-subscriptions"/
  );
});

test("a Product missing packageName throws", () => {
  const products = sampleProducts();
  delete products.jsonhub.packageName;

  assert.throws(() => resolveProduct({
    products,
    product: "jsonhub",
    target: "ts",
    event: {},
    hasHandOwnedMetadata: true
  }), /missing "packageName"/);
});

test("a Product missing apiContractUrl throws", () => {
  const products = sampleProducts();
  delete products.jsonhub.apiContractUrl;

  assert.throws(() => resolveProduct({
    products,
    product: "jsonhub",
    target: "ts",
    event: {},
    hasHandOwnedMetadata: true
  }), /missing "apiContractUrl"/);
});

test("a Product with a malformed targets map throws", () => {
  const products = sampleProducts();
  products.jsonhub.targets = ["ts", "python"];

  assert.throws(() => resolveProduct({
    products,
    product: "jsonhub",
    target: "ts",
    event: {},
    hasHandOwnedMetadata: true
  }), /"targets"/);
});

test("an enabled SDK Target without hand-owned metadata throws", () => {
  assert.throws(() => resolveProduct({
    products: sampleProducts(),
    product: "jsonhub",
    target: "ts",
    event: {},
    hasHandOwnedMetadata: false
  }), /without hand-owned metadata at products\/jsonhub\/ts\/package\.metadata\.json/);
});

test("an enabled SDK Target missing its repository throws", () => {
  const products = sampleProducts();
  products.jsonhub.targets.ts = {};

  assert.throws(() => resolveProduct({
    products,
    product: "jsonhub",
    target: "ts",
    event: {},
    hasHandOwnedMetadata: true
  }), /missing "repository"/);
});

test("the API Contract URL defaults to the Product's apiContractUrl", () => {
  const resolution = resolveEnabled("jsonhub", "ts");

  assert.equal(resolution.apiContractUrl, "https://api.jsonhub.cloud/api/docs.jsonopenapi");
});

test("a dispatch payload api_url overrides the Product's apiContractUrl", () => {
  const resolution = resolveEnabled("jsonhub", "ts", {
    event: { dispatchApiUrl: "https://preview.example.com/openapi.json" }
  });

  assert.equal(resolution.apiContractUrl, "https://preview.example.com/openapi.json");
});

test("a manual api_url overrides both the dispatch payload and the Product default", () => {
  const resolution = resolveEnabled("jsonhub", "ts", {
    event: {
      manualApiUrl: "https://manual.example.com/openapi.json",
      dispatchApiUrl: "https://preview.example.com/openapi.json"
    }
  });

  assert.equal(resolution.apiContractUrl, "https://manual.example.com/openapi.json");
});

test("empty URL overrides count as absent and fall back to the Product default", () => {
  const resolution = resolveEnabled("jsonhub", "ts", {
    event: { manualApiUrl: "", dispatchApiUrl: "" }
  });

  assert.equal(resolution.apiContractUrl, "https://api.jsonhub.cloud/api/docs.jsonopenapi");
});

test("the token secret name is <PRODUCT>_SDK_<TARGET>_TOKEN", () => {
  assert.equal(resolveEnabled("jsonhub", "ts").tokenSecret, "JSONHUB_SDK_TS_TOKEN");
  assert.equal(resolveEnabled("jsonhub", "python").tokenSecret, "JSONHUB_SDK_PYTHON_TOKEN");
});

test("a hyphenated Product name maps hyphens to underscores in the secret name", () => {
  const resolution = resolveProduct({
    products: {
      "pay-subscriptions": {
        packageName: "pay-subscriptions-sdk",
        apiContractUrl: "https://api.example.com/openapi.json",
        targets: { ts: { repository: "lbacik/pay-subscriptions-sdk-ts" } }
      }
    },
    product: "pay-subscriptions",
    target: "ts",
    event: {},
    hasHandOwnedMetadata: true
  });

  assert.equal(resolution.tokenSecret, "PAY_SUBSCRIPTIONS_SDK_TS_TOKEN");
});

// Guards the committed configuration itself: a broken product.json (an
// unknown field name, a target without metadata, a missing repository) fails
// `npm test` here rather than at 3am in a release workflow.
test("every committed Product resolves for each SDK Target it enables", async () => {
  const productsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "products");
  const names = readdirSync(productsDir).filter((entry) =>
    statSync(join(productsDir, entry)).isDirectory()
  );

  assert.ok(names.length > 0, "products/ holds no Product");

  const products = {};
  for (const name of names) {
    products[name] = JSON.parse(await readFile(join(productsDir, name, "product.json"), "utf8"));
  }

  for (const [name, config] of Object.entries(products)) {
    for (const target of Object.keys(config.targets)) {
      const resolution = resolveProduct({
        products,
        product: name,
        target,
        event: {},
        hasHandOwnedMetadata: existsSync(join(productsDir, name, target, "package.metadata.json"))
      });

      assert.equal(resolution.enabled, true, `${name}/${target} should be enabled`);
      assert.ok(resolution.repository, `${name}/${target} should resolve a repository`);
      assert.ok(resolution.packageName, `${name}/${target} should resolve a package name`);
      assert.ok(resolution.apiContractUrl, `${name}/${target} should resolve an API Contract URL`);
      assert.ok(resolution.tokenSecret, `${name}/${target} should resolve a token secret`);
      assert.equal(
        resolution.handOwnedMetadata,
        `products/${name}/${target}/package.metadata.json`
      );
    }
  }
});

// The second Product enables only the `ts` SDK Target: it resolves for `ts`
// with the PaySubscriptions package, repository, API Contract URL and secret,
// while `python` reports not enabled. Read from the committed files so a
// broken products/paysubscriptions/ fails `npm test` here.
test("the committed paysubscriptions Product resolves for ts and reports python as not enabled", async () => {
  const productsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "products");
  const names = readdirSync(productsDir).filter((entry) =>
    statSync(join(productsDir, entry)).isDirectory()
  );
  assert.ok(names.includes("paysubscriptions"), "products/ holds no paysubscriptions Product");

  const products = {};
  for (const name of names) {
    products[name] = JSON.parse(await readFile(join(productsDir, name, "product.json"), "utf8"));
  }

  assert.equal(products.paysubscriptions.packageName, "paysubscriptions-sdk");

  const ts = resolveProduct({
    products,
    product: "paysubscriptions",
    target: "ts",
    event: {},
    hasHandOwnedMetadata: existsSync(join(productsDir, "paysubscriptions", "ts", "package.metadata.json"))
  });

  assert.equal(ts.enabled, true);
  assert.equal(ts.repository, "lbacik/paysubscriptions-sdk-ts");
  assert.equal(ts.packageName, "paysubscriptions-sdk");
  assert.equal(
    ts.apiContractUrl,
    "https://paysubscriptions.com/api/docs.jsonopenapi?spec_version=3.0.0"
  );
  assert.equal(ts.tokenSecret, "PAYSUBSCRIPTIONS_SDK_TS_TOKEN");
  assert.equal(ts.handOwnedMetadata, "products/paysubscriptions/ts/package.metadata.json");

  const python = resolveProduct({
    products,
    product: "paysubscriptions",
    target: "python",
    event: {},
    hasHandOwnedMetadata: false
  });

  assert.equal(python.enabled, false);
  assert.equal(python.repository, null);
  assert.equal(python.handOwnedMetadata, null);
  assert.equal(python.packageName, "paysubscriptions-sdk");
  assert.equal(python.tokenSecret, "PAYSUBSCRIPTIONS_SDK_PYTHON_TOKEN");
});
