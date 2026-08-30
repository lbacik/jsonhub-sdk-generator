#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const TARGETS = {
  ts: {
    generator: "typescript-fetch",
    extension: "json",
    packageVersion: "1.0.0",
    supportsNpmName: true
  },
  js: {
    generator: "javascript",
    extension: "json",
    packageVersion: "1.0.0",
    supportsNpmName: true
  },
  python: {
    generator: "python",
    extension: "json",
    packageVersion: "1.0.0"
  },
  php: {
    generator: "php",
    extension: "json",
    packageVersion: "1.0.0",
    supportsComposerName: true
  }
};

function collect(value, previous) {
  previous.push(value);
  return previous;
}

function parseTarget(value) {
  if (!TARGETS[value]) {
    throw new InvalidArgumentError(
      `Nieobsługiwany target "${value}". Dostępne: ${Object.keys(TARGETS).join(", ")}`
    );
  }

  return value;
}

function parseProperty(value, previous) {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex === -1) {
    throw new InvalidArgumentError(
      `Niepoprawne --property "${value}". Użyj formatu klucz=wartość.`
    );
  }

  const key = value.slice(0, separatorIndex).trim();
  const propertyValue = value.slice(separatorIndex + 1).trim();

  if (!key || !propertyValue) {
    throw new InvalidArgumentError(
      `Niepoprawne --property "${value}". Klucz i wartość są wymagane.`
    );
  }

  previous.push([key, propertyValue]);
  return previous;
}

function parseMediaType(value) {
  const mediaType = value.trim();

  if (!mediaType) {
    throw new InvalidArgumentError("Niepoprawne --prefer-media-type. Wartość jest wymagana.");
  }

  return mediaType;
}

function normalizePackageName(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeProjectName(input) {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createBaseProperties(options, targetConfig) {
  const packageName = normalizeProjectName(options.packageName || `sdk-${options.target}`);
  const properties = {
    packageName,
    projectName: packageName,
    packageVersion: options.packageVersion || targetConfig.packageVersion
  };

  if (options.target === "ts" || options.target === "js") {
    properties.useSingleRequestParameter = "true";
    properties.es6 = "true";
  }

  if (options.target === "python") {
    properties.packageVersion = options.packageVersion || "0.1.0";
    properties.packageName = packageName.replace(/-/g, "_");
    properties.projectName = packageName;
  }

  if (options.target === "php") {
    properties.invokerPackage = packageName.replace(/-/g, "\\");
  }

  if (targetConfig.supportsNpmName) {
    properties.npmName = normalizePackageName(options.packageName || packageName);
  }

  if (targetConfig.supportsComposerName && options.composerName) {
    properties.composerPackageName = normalizePackageName(options.composerName);
  }

  for (const [key, value] of options.property) {
    properties[key] = value;
  }

  return properties;
}

async function fetchSpec(specUrl, headers) {
  const response = await fetch(specUrl, {
    headers: Object.fromEntries(headers.map((headerLine) => {
      const separatorIndex = headerLine.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(
          `Niepoprawny nagłówek "${headerLine}". Użyj formatu "Nazwa: wartość".`
        );
      }

      const name = headerLine.slice(0, separatorIndex).trim();
      const value = headerLine.slice(separatorIndex + 1).trim();
      return [name, value];
    }))
  });

  if (!response.ok) {
    throw new Error(
      `Nie udało się pobrać specyfikacji: ${response.status} ${response.statusText}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (!body.trim()) {
    throw new Error("Pobrana specyfikacja jest pusta.");
  }

  const isYaml =
    contentType.includes("yaml") ||
    contentType.includes("yml") ||
    specUrl.endsWith(".yaml") ||
    specUrl.endsWith(".yml");

  return {
    body,
    extension: isYaml ? "yaml" : "json"
  };
}

function preferContentMediaType(content, mediaType) {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { content, changed: false };
  }

  if (!(mediaType in content)) {
    return { content, changed: false };
  }

  return {
    content: {
      [mediaType]: content[mediaType]
    },
    changed: Object.keys(content).length > 1
  };
}

function preferFirstAvailableContentMediaType(content, mediaTypes) {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { content, changed: false };
  }

  const selectedMediaType = mediaTypes.find((mediaType) => mediaType in content);

  if (!selectedMediaType) {
    return { content, changed: false };
  }

  return {
    content: {
      [selectedMediaType]: content[selectedMediaType]
    },
    changed: Object.keys(content).length > 1
  };
}

function responseMediaTypePreference(preferredMediaType) {
  return [
    preferredMediaType,
    "application/problem+json",
    "application/json"
  ].filter((mediaType, index, mediaTypes) => mediaTypes.indexOf(mediaType) === index);
}

function preprocessSpec(spec, options) {
  if (!options.preferMediaType) {
    return {
      body: spec.body,
      changed: false
    };
  }

  if (spec.extension !== "json") {
    throw new Error("Preprocessing --prefer-media-type jest obecnie wspierany tylko dla specyfikacji JSON.");
  }

  let document;

  try {
    document = JSON.parse(spec.body);
  } catch {
    throw new Error("Nie udało się sparsować specyfikacji JSON.");
  }

  let changed = false;
  const paths = document.paths ?? {};
  const responseMediaTypes = responseMediaTypePreference(options.preferMediaType);

  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) {
      continue;
    }

    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        continue;
      }

      if (operation.requestBody?.content) {
        const result = preferContentMediaType(
          operation.requestBody.content,
          options.preferMediaType
        );
        operation.requestBody.content = result.content;
        changed = changed || result.changed;
      }

      if (!operation.responses || typeof operation.responses !== "object") {
        continue;
      }

      for (const response of Object.values(operation.responses)) {
        if (!response || typeof response !== "object" || Array.isArray(response)) {
          continue;
        }

        if (!response.content) {
          continue;
        }

        const result = preferFirstAvailableContentMediaType(response.content, responseMediaTypes);
        response.content = result.content;
        changed = changed || result.changed;
      }
    }
  }

  return {
    body: JSON.stringify(document, null, 2),
    changed
  };
}

function collectImportedModels(fileContent, importPath) {
  const models = new Set();
  const pattern = new RegExp(
    `import\\s+(?:type\\s+)?\\{([\\s\\S]*?)\\}\\s+from\\s+'${importPath.replace("/", "\\/")}';`,
    "g"
  );

  for (const match of fileContent.matchAll(pattern)) {
    const imports = match[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const imported of imports) {
      const modelName = imported
        .replace(/\s+as\s+.+$/, "")
        .replace(/(FromJSON|FromJSONTyped|ToJSON|ToJSONTyped)$/, "");

      if (modelName) {
        models.add(modelName);
      }
    }
  }

  return models;
}

function collectRelativeModelDependencies(fileContent) {
  const dependencies = new Set();
  const pattern = /from\s+'\.\/([^']+)';/g;

  for (const match of fileContent.matchAll(pattern)) {
    const dependency = match[1].trim();

    if (dependency && dependency !== "index") {
      dependencies.add(dependency);
    }
  }

  return dependencies;
}

async function pruneUnusedTsModels(outputDir) {
  const modelsDir = join(outputDir, "src", "models");
  const apisDir = join(outputDir, "src", "apis");
  const docsDir = join(outputDir, "docs");
  const modelFiles = (await readdir(modelsDir))
    .filter((fileName) => fileName.endsWith(".ts") && fileName !== "index.ts");
  const apiFiles = (await readdir(apisDir))
    .filter((fileName) => fileName.endsWith(".ts") && fileName !== "index.ts");
  const reachableModels = new Set();
  const modelFileNames = new Set(modelFiles.map((fileName) => fileName.replace(/\.ts$/u, "")));

  for (const apiFile of apiFiles) {
    const apiFilePath = join(apisDir, apiFile);
    const apiContent = await readFile(apiFilePath, "utf8");

    for (const modelName of collectImportedModels(apiContent, "../models/index")) {
      if (modelFileNames.has(modelName)) {
        reachableModels.add(modelName);
      }
    }
  }

  const queue = [...reachableModels];

  while (queue.length > 0) {
    const modelName = queue.pop();
    const modelFilePath = join(modelsDir, `${modelName}.ts`);
    const modelContent = await readFile(modelFilePath, "utf8");

    for (const dependency of collectRelativeModelDependencies(modelContent)) {
      if (modelFileNames.has(dependency) && !reachableModels.has(dependency)) {
        reachableModels.add(dependency);
        queue.push(dependency);
      }
    }
  }

  const indexFilePath = join(modelsDir, "index.ts");
  const indexContent = await readFile(indexFilePath, "utf8");
  const nextIndexContent = indexContent
    .split("\n")
    .filter((line) => {
      const match = line.match(/^export \* from '\.\/(.+)';$/);
      return !match || reachableModels.has(match[1]);
    })
    .join("\n");

  await writeFile(indexFilePath, nextIndexContent, "utf8");

  let removedCount = 0;

  for (const fileName of modelFiles) {
    const modelName = fileName.replace(/\.ts$/u, "");

    if (reachableModels.has(modelName)) {
      continue;
    }

    await rm(join(modelsDir, fileName), { force: true });
    await rm(join(docsDir, `${modelName}.md`), { force: true });
    removedCount += 1;
  }

  return {
    keptCount: reachableModels.size,
    removedCount
  };
}

function runGenerator(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["@openapitools/openapi-generator-cli", ...args],
      {
        cwd: rootDir,
        stdio: "inherit"
      }
    );

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`openapi-generator zakończył się kodem ${code}`));
    });
  });
}

const program = new Command();

program
  .name("jh-client-generator")
  .description("Generuje SDK z OpenAPI po URL dla JS/TS, Python i PHP.")
  .requiredOption("--url <specUrl>", "URL do specyfikacji OpenAPI")
  .requiredOption("--target <target>", "Target: ts | js | python | php", parseTarget)
  .option(
    "--output <dir>",
    "Katalog wyjściowy",
    (value) => resolve(process.cwd(), value)
  )
  .option(
    "--package-name <name>",
    "Nazwa paczki/projektu w wygenerowanym SDK"
  )
  .option(
    "--package-version <version>",
    "Wersja wygenerowanego SDK"
  )
  .option(
    "--composer-name <vendor/package>",
    "Nazwa paczki Composer dla targetu php"
  )
  .option(
    "--header <name:value>",
    "Nagłówek HTTP używany przy pobieraniu specyfikacji",
    collect,
    []
  )
  .option(
    "--property <key=value>",
    "Dodatkowe additionalProperties przekazane do openapi-generator",
    parseProperty,
    []
  )
  .option(
    "--prefer-media-type <mediaType>",
    "Preferowany media type dla content; responses mogą użyć bezpiecznego fallbacku JSON",
    parseMediaType
  )
  .option(
    "--skip-validate-spec",
    "Wyłącza walidację specyfikacji po stronie generatora",
    false
  )
  .option(
    "--prune-unused-models",
    "Po generacji targetu ts usuwa modele nieosiągalne z apis/* i ich zależności",
    false
  )
  .action(async (options) => {
    const targetConfig = TARGETS[options.target];
    const fetchedSpec = await fetchSpec(options.url, options.header);
    const spec = preprocessSpec(fetchedSpec, options);
    const cacheDir = resolve(rootDir, ".cache");
    const specFilePath = join(cacheDir, `openapi.${fetchedSpec.extension}`);
    const outputDir = options.output
      ? options.output
      : resolve(process.cwd(), "generated", options.target);

    await mkdir(cacheDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(specFilePath, spec.body, "utf8");

    const additionalProperties = createBaseProperties(options, targetConfig);
    const generatorArgs = [
      "generate",
      "-g",
      targetConfig.generator,
      "-i",
      specFilePath,
      "-o",
      outputDir,
      "--additional-properties",
      Object.entries(additionalProperties)
        .map(([key, value]) => `${key}=${value}`)
        .join(",")
    ];

    if (options.skipValidateSpec) {
      generatorArgs.push("--skip-validate-spec");
    }

    console.log(`Pobrano specyfikację do ${specFilePath}`);
    if (options.preferMediaType) {
      console.log(
        spec.changed
          ? `Przefiltrowano content do media type "${options.preferMediaType}".`
          : `Media type "${options.preferMediaType}" nie wymagał zmian w content.`
      );
    }
    console.log(`Generowanie targetu "${options.target}" do ${outputDir}`);

    await runGenerator(generatorArgs);

    if (options.pruneUnusedModels) {
      if (options.target !== "ts") {
        throw new Error("--prune-unused-models jest obecnie wspierane tylko dla targetu ts.");
      }

      const pruneResult = await pruneUnusedTsModels(outputDir);
      console.log(
        `Usunięto ${pruneResult.removedCount} nieużywanych modeli, pozostawiono ${pruneResult.keptCount}.`
      );
    }

    console.log("Gotowe.");
  });

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(`Błąd: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  preferContentMediaType,
  preferFirstAvailableContentMediaType,
  preprocessSpec,
  responseMediaTypePreference
};
