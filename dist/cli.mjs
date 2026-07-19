#!/usr/bin/env node
import {
  buildCli,
  printJson,
  printStderr
} from "./chunk-QJKJESXQ.mjs";

// src/cli.ts
async function main() {
  const program = buildCli();
  await program.parseAsync(process.argv);
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  printStderr(message);
  printJson({
    message,
    status: "failed"
  });
  process.exit(1);
});
//# sourceMappingURL=cli.mjs.map