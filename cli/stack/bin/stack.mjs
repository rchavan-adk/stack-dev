#!/usr/bin/env node
/** Entry point for the `stack` binary. All logic lives in ../src/cli.mjs. */

import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = typeof code === "number" ? code : 0;
  },
  (error) => {
    process.stderr.write(`\n  error ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  },
);
