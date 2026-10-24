// Runtime test for the `ts` SDK Surface (needs Java).
//
// Generates the `ts` SDK Surface from the committed sample API Contract with
// the pinned toolchain and the `src/templates/typescript-fetch` override,
// through the same CLI path the pipeline uses (`node ./src/cli.mjs --target
// ts`); transpiles it with the pinned `typescript` devDependency (without
// installing the generated package's own dependencies); drives it with a fake
// `fetchApi` that records requests and returns canned responses; and asserts
// on what the generated SDK actually sends and returns - not on template text:
// the `Accept` headers (the Canonical Client Spec default goes out unless the
// caller passes `accept`), the `Authorization` header for `oauth2`- and
// `http`/`bearer`-secured operations (a raw token from the `accessToken`
// provider goes out as `Bearer <token>`), and the typed models for HAL
// collection items (`_embedded.item` entries arrive with `createdAt` as a
// `Date` and `links` rather than `_links`) and for POST/PATCH responses (the
// relation arrives as a direct member).
//
// Run it with:
//
//   npm run test:ts-runtime
//
// It is separate from `npm test` because it needs Java (openapi-generator).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { test, before, after } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

const CONTRACT_FIXTURE = join(rootDir, "python-adapter/tests/fixtures/api-contract.sample.json");

let server = null;
let serverUrl = null;
let outputDir = null;
let tmpRoot = null;
let DefaultApi = null;
let Configuration = null;
const recorded = [];

let cannedBody = {};

function setCannedBody(body) {
  cannedBody = body;
}

function cannedResponse() {
  return {
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => cannedBody,
    text: async () => JSON.stringify(cannedBody)
  };
}

function lastRequestHeaders() {
  assert.ok(recorded.length > 0, "expected the fake fetchApi to have recorded a request");
  return recorded[recorded.length - 1].init?.headers ?? {};
}

function lastAcceptHeader() {
  return lastRequestHeaders()["Accept"];
}

function lastAuthHeader() {
  return lastRequestHeaders()["Authorization"];
}

async function transpileGeneratedSdk(srcDir, distDir) {
  async function collectTsFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await collectTsFiles(full)));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }

    return files;
  }

  const tsFiles = await collectTsFiles(join(srcDir, "src"));

  for (const tsFile of tsFiles) {
    const source = await readFile(tsFile, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true
      },
      fileName: tsFile
    });

    const relative = tsFile.slice(join(srcDir, "src").length + 1).replace(/\.ts$/, ".js");
    const outFile = join(distDir, relative);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, outputText, "utf8");
  }
}

before(async () => {
  const contractBody = await readFile(CONTRACT_FIXTURE, "utf8");

  server = createServer((req, res) => {
    if (req.url === "/api-contract.sample.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(contractBody);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const { port } = server.address();
  serverUrl = `http://127.0.0.1:${port}/api-contract.sample.json`;

  tmpRoot = await mkdtemp(join(tmpdir(), "ts-accept-"));
  outputDir = join(tmpRoot, "sdk");

  // Async spawn (not spawnSync): the sample-contract HTTP server above runs
  // on this process's event loop, so a synchronous spawn would block it and
  // deadlock generation's fetch.
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        "./src/cli.mjs",
        "--url",
        serverUrl,
        "--target",
        "ts",
        "--package-name",
        "jsonhub-sdk",
        "--output",
        outputDir
      ],
      { cwd: rootDir, stdio: "pipe" }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`ts generation failed through the CLI path: ${stderr}${stdout}`));
    });
  });

  const distDir = join(tmpRoot, "dist");
  await transpileGeneratedSdk(outputDir, distDir);

  const runtimeModule = await import(pathToFileURL(join(distDir, "runtime.js")).href);
  const apiModule = await import(pathToFileURL(join(distDir, "apis/DefaultApi.js")).href);
  DefaultApi = apiModule.DefaultApi;
  Configuration = runtimeModule.Configuration;

  assert.ok(DefaultApi, "generated SDK must export DefaultApi");
  assert.ok(Configuration, "generated SDK must export Configuration");
});

after(async () => {
  if (server) {
    await new Promise((resolvePromise) => server.close(resolvePromise));
    server = null;
  }

  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

function createApi() {
  recorded.length = 0;
  setCannedBody({});
  const configuration = new Configuration({
    basePath: "http://localhost",
    fetchApi: async (url, init) => {
      recorded.push({ url, init });
      return cannedResponse();
    }
  });
  return new DefaultApi(configuration);
}

// An `accessToken` provider returning the raw token, as PaySubscriptions'
// consumers configure it: the SDK adds the `Bearer ` prefix itself.
function createAuthedApi() {
  recorded.length = 0;
  setCannedBody({});
  const configuration = new Configuration({
    basePath: "http://localhost",
    fetchApi: async (url, init) => {
      recorded.push({ url, init });
      return cannedResponse();
    },
    accessToken: async () => "raw-token-123"
  });
  return new DefaultApi(configuration);
}

test("a collection GET without accept sends application/hal+json", async () => {
  const api = createApi();
  await api.listDefinitions();
  assert.equal(lastAcceptHeader(), "application/hal+json");
});

test("a single-resource GET without accept sends application/json", async () => {
  const api = createApi();
  await api.getDefinition({ id: "d1" });
  assert.equal(lastAcceptHeader(), "application/json");
});

test("a related single-resource GET without accept sends application/json", async () => {
  const api = createApi();
  await api.getEntity({ id: "e1" });
  assert.equal(lastAcceptHeader(), "application/json");
});

test("a POST without accept sends application/json", async () => {
  const api = createApi();
  await api.createDefinition({});
  assert.equal(lastAcceptHeader(), "application/json");
});

test("a PATCH without accept sends application/json", async () => {
  const api = createApi();
  await api.patchDefinition({ id: "d1" });
  assert.equal(lastAcceptHeader(), "application/json");
});

test("an explicit accept sends that value instead (collection GET)", async () => {
  const api = createApi();
  await api.listDefinitions({ accept: "application/json" });
  assert.equal(lastAcceptHeader(), "application/json");
});

test("an explicit accept sends that value instead (single-resource GET)", async () => {
  const api = createApi();
  await api.getDefinition({ id: "d1", accept: "application/vnd.api+json" });
  assert.equal(lastAcceptHeader(), "application/vnd.api+json");
});

test("an oauth2-secured operation sends the raw accessToken as Bearer <token>", async () => {
  const api = createAuthedApi();
  await api.listDefinitions();
  assert.equal(lastAuthHeader(), "Bearer raw-token-123");
});

test("an http/bearer-secured operation's Authorization header is unchanged", async () => {
  const api = createAuthedApi();
  await api.getDefinition({ id: "d1" });
  assert.equal(lastAuthHeader(), "Bearer raw-token-123");
});

test("a HAL collection response's _embedded.item entries come back as typed models", async () => {
  const api = createApi();
  setCannedBody({
    totalItems: 1,
    itemsPerPage: 30,
    page: 1,
    _links: { self: { href: "/api/definitions?page=1" } },
    _embedded: {
      item: [
        {
          id: "d1",
          name: "One",
          createdAt: "2026-01-02T03:04:05.000Z",
          _links: { self: { href: "/api/definitions/d1" } }
        }
      ]
    }
  });
  const collection = await api.listDefinitions();
  const items = collection.embedded?.item ?? [];
  assert.equal(items.length, 1);
  const item = items[0];
  assert.ok(item.createdAt instanceof Date, "expected createdAt to be parsed as a Date");
  assert.ok("links" in item, "expected the HAL _links envelope as links");
  assert.ok(!("_links" in item), "expected no raw _links on the typed model");
});

test("a POST response's relation arrives as a direct member", async () => {
  const api = createApi();
  setCannedBody({
    id: "e1",
    definition: { id: "d1", name: "One", createdAt: "2026-01-02T03:04:05.000Z" }
  });
  const created = await api.createEntity({ entity: { id: "e1", definition: { id: "d1" } } });
  assert.equal(created.definition?.id, "d1");
});

test("a PATCH response's relation arrives as a direct member", async () => {
  const api = createApi();
  setCannedBody({
    id: "e1",
    definition: { id: "d1", name: "One", createdAt: "2026-01-02T03:04:05.000Z" }
  });
  const updated = await api.patchEntity({ id: "e1", entityPatch: { definition: { id: "d1" } } });
  assert.equal(updated.definition?.id, "d1");
});
