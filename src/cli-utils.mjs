/**
 * Small pieces shared by this repository's CLI entry points
 * (src/cli.mjs, src/decide-release.mjs).
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function collect(value, previous) {
  previous.push(value);
  return previous;
}

function runIfMain(moduleUrl, program) {
  if (process.argv[1] && fileURLToPath(moduleUrl) === resolve(process.argv[1])) {
    program.parseAsync(process.argv).catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

export { collect, runIfMain };
