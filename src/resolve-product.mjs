#!/usr/bin/env node

/**
 * Thin I/O wrapper around resolveProduct() (src/product.mjs): reads every
 * `products/<product>/product.json` under --products-dir, checks whether the
 * hand-owned metadata file exists for an enabled SDK Target, then prints the
 * resolution as JSON. Invoked by scripts/generate-and-decide.sh and
 * scripts/publish-to-target.sh so no Product name, repository, or metadata
 * path stays hardcoded in them - see CONTEXT.md for the Product vocabulary.
 */

import { Command } from "commander";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProduct } from "./product.mjs";
import { readJsonFile, runIfMain } from "./cli-utils.mjs";

function defaultProductsDir() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "products");
}

function loadProducts(productsDir) {
  const products = {};

  for (const entry of readdirSync(productsDir)) {
    if (!statSync(join(productsDir, entry)).isDirectory()) {
      continue;
    }

    products[entry] = null;
  }

  return products;
}

async function run(options) {
  const productsDir = resolve(process.cwd(), options.productsDir);
  const names = Object.keys(loadProducts(productsDir));
  const products = {};

  for (const name of names) {
    products[name] = await readJsonFile(join(productsDir, name, "product.json"));
  }

  const hasHandOwnedMetadata = existsSync(
    join(productsDir, options.product, options.target, "package.metadata.json")
  );

  return resolveProduct({
    products,
    product: options.product,
    target: options.target,
    event: {
      manualApiUrl: options.manualApiUrl,
      dispatchApiUrl: options.dispatchApiUrl
    },
    hasHandOwnedMetadata
  });
}

const program = new Command();

program
  .name("jh-resolve-product")
  .description(
    "Prints the Product resolution for an SDK Target as JSON: whether it is enabled, " +
      "its SDK repository, package name, API Contract URL, token secret name, and hand-owned metadata location."
  )
  .requiredOption("--product <name>", "Product, e.g. jsonhub")
  .requiredOption("--target <target>", "SDK Target, e.g. ts")
  .option("--manual-api-url <url>", "API Contract URL override from a manual trigger")
  .option("--dispatch-api-url <url>", "API Contract URL override from a repository_dispatch payload")
  .option(
    "--products-dir <dir>",
    "Directory holding one subdirectory per Product",
    defaultProductsDir()
  )
  .action(async (options) => {
    const resolution = await run(options);
    console.log(JSON.stringify(resolution, null, 2));
  });

runIfMain(import.meta.url, program);

export { run };
