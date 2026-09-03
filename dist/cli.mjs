#!/usr/bin/env node
import {
  buildCli,
  buildCliCommandErrorPayload,
  printJson,
  printStderr
} from "./chunk-623HG63W.mjs";

// src/cli.ts
async function main() {
  const program = buildCli();
  await program.parseAsync(process.argv);
}
main().catch((error) => {
  const payload = buildCliCommandErrorPayload(error);
  printStderr(payload.message);
  printJson(payload);
  process.exit(1);
});
//# sourceMappingURL=cli.mjs.map