/**
 * Product resolution: the only code that interprets `products/`.
 *
 * A Product is an API whose SDKs this pipeline releases, with its SDK family:
 * one package name, the SDK Targets it enables, one repository per SDK Target
 * (see CONTEXT.md). Each Product lives in `products/<product>/` as a
 * `product.json` (`packageName`, `apiContractUrl`, `targets`) plus one
 * `products/<product>/<target>/package.metadata.json` per enabled SDK Target.
 * An SDK Target is enabled exactly when its key is present in `targets`.
 *
 * This module is a pure transformation: it takes the already-parsed
 * configuration (a map of Product name to its `product.json` contents), a
 * Product, an SDK Target, and the event context, and returns everything the
 * release scripts and workflows need per Product - whether the SDK Target is
 * enabled, the SDK repository, the package name, the resolved API Contract
 * URL, the token secret name, and the hand-owned metadata location. No I/O
 * happens here, including no check that the hand-owned metadata file exists:
 * the caller passes that fact in as `hasHandOwnedMetadata`, so this module
 * stays testable without touching the disk. See `src/resolve-product.mjs` for
 * the thin CLI wrapper that reads the files and calls this.
 *
 * The naming convention stays hardcoded policy, not configuration (see
 * AGENTS.md): one package name per Product across registries, with the
 * language suffix on the repository name only - a registry is already the
 * namespace for its own language, so `-ts`/`-python` on the package would only
 * repeat what the registry already says. The name itself, though, is Product
 * data and comes from `product.json`, which is why this module returns it
 * rather than deriving it.
 */

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// The API Contract URL precedence both triggers share: an explicit manual
// `api_url` first, then the dispatch payload's `api_url`, then the Product's
// own `apiContractUrl` (which mirrors the JSONHUB_API_URL-style repository
// variable). Empty strings count as absent - the workflows render an unset
// input as empty, not as missing.
function resolveApiContractUrl({ productName, apiContractUrl, manualApiUrl, dispatchApiUrl }) {
  for (const candidate of [manualApiUrl, dispatchApiUrl]) {
    if (isNonEmptyString(candidate)) {
      return candidate;
    }
  }

  if (!isNonEmptyString(apiContractUrl)) {
    throw new Error(
      `Product "${productName}" is missing "apiContractUrl" in products/${productName}/product.json.`
    );
  }

  return apiContractUrl;
}

// `<PRODUCT>_SDK_<TARGET>_TOKEN`, upper-cased with hyphens as underscores, so
// a hyphenated Product name still yields a valid secret name.
function tokenSecretName(productName, target) {
  return `${productName}_SDK_${target}_TOKEN`.toUpperCase().replaceAll("-", "_");
}

function resolveProduct({ products, product, target, event = {}, hasHandOwnedMetadata = false }) {
  const productConfig = products?.[product];

  if (!productConfig || typeof productConfig !== "object") {
    const available = products && typeof products === "object" ? Object.keys(products).join(", ") : "";
    throw new Error(
      `Unknown product "${product}". Available: ${available || "(none)"}. ` +
        `Add products/${product}/product.json to register it.`
    );
  }

  const productPath = `products/${product}/product.json`;

  if (!isNonEmptyString(productConfig.packageName)) {
    throw new Error(`Product "${product}" is missing "packageName" in ${productPath}.`);
  }

  if (productConfig.targets === undefined || typeof productConfig.targets !== "object" || productConfig.targets === null || Array.isArray(productConfig.targets)) {
    throw new Error(
      `Product "${product}" has a missing or malformed "targets" in ${productPath}: expected an object of SDK Targets.`
    );
  }

  const enabled = Object.hasOwn(productConfig.targets, target);
  const packageName = productConfig.packageName;
  const apiContractUrl = resolveApiContractUrl({
    productName: product,
    apiContractUrl: productConfig.apiContractUrl,
    manualApiUrl: event.manualApiUrl,
    dispatchApiUrl: event.dispatchApiUrl
  });
  const tokenSecret = tokenSecretName(product, target);

  if (!enabled) {
    return {
      enabled: false,
      repository: null,
      packageName,
      apiContractUrl,
      tokenSecret,
      handOwnedMetadata: null
    };
  }

  const targetConfig = productConfig.targets[target];
  const metadataPath = `products/${product}/${target}/package.metadata.json`;

  if (!targetConfig || typeof targetConfig !== "object" || !isNonEmptyString(targetConfig.repository)) {
    throw new Error(`Product "${product}" target "${target}" is missing "repository" in ${productPath}.`);
  }

  if (!hasHandOwnedMetadata) {
    throw new Error(
      `Product "${product}" enables SDK Target "${target}" without hand-owned metadata at ${metadataPath}.`
    );
  }

  return {
    enabled: true,
    repository: targetConfig.repository,
    packageName,
    apiContractUrl,
    tokenSecret,
    handOwnedMetadata: metadataPath
  };
}

export { resolveProduct, tokenSecretName };
