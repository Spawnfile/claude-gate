// mcp-server/esbuild.config.mjs
//
// Bundles each entry point into a self-contained ESM file under dist/,
// inlining every npm dependency. This is what makes the published plugin
// installable from a bare `git clone` with no `npm install` step: the
// committed dist/ tree carries all runtime code.
//
// Type-checking is NOT done here -- `npm run lint` (tsc --noEmit) owns that.

import { build } from "esbuild";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const entryPoints = [
  "src/index.ts", // MCP server (referenced by .mcp.json)
  "src/hook/client.ts", // PreToolUse hook (hooks/pre-tool-use.sh)
  "src/hook/session-start.ts", // SessionStart hook (hooks/session-start.sh)
  "src/hook/user-prompt-submit.ts", // UserPromptSubmit hook
  "src/cli/gate-confirm.ts", // out-of-band confirmation CLI
];

await build({
  entryPoints,
  outdir: "dist",
  outbase: "src",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // ESM output, but some deps (e.g. `yaml`) are CJS and call require() for
  // Node built-ins at runtime. Define a real require via createRequire so
  // esbuild's __require shim delegates to it instead of throwing
  // "Dynamic require ... is not supported".
  banner: {
    js: "import{createRequire as __cgCreateRequire}from'node:module';const require=__cgCreateRequire(import.meta.url);",
  },
});

// gate-confirm is also exposed as a CLI bin; give it a shebang + exec bit.
const cli = "dist/cli/gate-confirm.js";
const body = readFileSync(cli, "utf-8");
if (!body.startsWith("#!")) {
  writeFileSync(cli, "#!/usr/bin/env node\n" + body);
}
chmodSync(cli, 0o755);

console.log(`esbuild: bundled ${entryPoints.length} entry points into dist/`);
