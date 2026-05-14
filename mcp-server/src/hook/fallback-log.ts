// mcp-server/src/hook/fallback-log.ts
//
// Best-effort JSONL writer for hook fallback events.
// Written to ~/.claude/gate/hook-fallback.log when gate-mcp
// is unreachable and the hook falls back to registry-cache.json.
// Failures are silently swallowed; this is operational, not forensic.

import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FallbackEntry {
  ts: string;
  tool: string;
  mcp_server_id: string | null;
  env: string;
  decision: "ALLOW" | "DENY";
  reason: string;
}

export function appendFallback(path: string, entry: FallbackEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // intentionally silent: fallback log is best-effort
  }
}
