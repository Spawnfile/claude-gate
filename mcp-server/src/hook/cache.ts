// mcp-server/src/hook/cache.ts
//
// Reads ~/.claude/gate/registry-cache.json and applies the tiered
// fail policy (prod=closed, dev=open, local=open, unknown=closed).
//
// The fallback path intentionally supports only tool-glob and
// mcp_server_id matching. Parameter-level matching is omitted
// to keep the fallback path safe: if a tool does not match any
// resource, env=unknown and the default policy is fail-closed.

import { readFileSync, existsSync } from "node:fs";
import { DEFAULT_FAIL_POLICY, type Env, type FailPolicy } from "./protocol.js";

export interface CachedResource {
  name: string;
  matchers: Array<{ tool?: string; mcp_server_id?: string }>;
  env: Env;
  policy: string;
}

export interface RegistryCache {
  version: 1;
  updated_at: string;
  resources: CachedResource[];
}

export function readCache(path: string): RegistryCache | null {
  if (!existsSync(path)) return null;
  try {
    const obj = JSON.parse(readFileSync(path, "utf-8")) as RegistryCache;
    if (obj.version !== 1 || !Array.isArray(obj.resources)) return null;
    return obj;
  } catch {
    return null;
  }
}

export function lookupEnv(
  cache: RegistryCache | null,
  tool: string,
  mcpServerId: string | null,
): Env {
  if (cache === null) return "unknown";
  for (const r of cache.resources) {
    for (const m of r.matchers) {
      const hasConstraint = m.tool !== undefined || m.mcp_server_id !== undefined;
      if (!hasConstraint) continue;
      const mcpOk =
        m.mcp_server_id === undefined ||
        (mcpServerId !== null && m.mcp_server_id === mcpServerId);
      const toolOk = m.tool === undefined || globMatch(m.tool, tool);
      if (mcpOk && toolOk) {
        return r.env;
      }
    }
  }
  return "unknown";
}

export function fallbackDecision(
  env: Env,
  override?: Partial<Record<Env, FailPolicy>>,
): "ALLOW" | "DENY" {
  const policy = override?.[env] ?? DEFAULT_FAIL_POLICY[env];
  return policy === "closed" ? "DENY" : "ALLOW";
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, ".*") + "$").test(value);
}
