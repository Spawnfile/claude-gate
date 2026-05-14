// mcp-server/src/tools/config-tools.ts
//
// MCP tools for live global-config inspection and toggling:
//   gate.config_get  - returns the global block of config.yaml as JSON text.
//   gate.config_set  - mutates a whitelisted path in config.yaml.
//
// The whitelist is intentionally narrow. Only one path family is
// editable through this tool:
//   global.fail_policy.<env>              (closed|open)
//
// Any other path returns a refusal. The fail_policy paths are bounded by
// the FailPolicyEnum already validated in ConfigSchema; we re-check the
// value before writing.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { configPath } from "../config/loader.js";
import { ConfigSchema, type Config } from "../config/schema.js";
import type { GateTool, ToolContext, ToolResult } from "./registry.js";

const FAIL_POLICY_ENUM = new Set(["closed", "open"]);
const FAIL_POLICY_PATH = /^global\.fail_policy\.(prod|dev|local|unknown)$/;

function refusal(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export const configTools: GateTool[] = [
  {
    name: "gate.config_get",
    description: "Read the global block of config.yaml.",
    inputSchema: { type: "object", properties: {} },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const cfg = ctx.bootstrap.config();
      if (cfg === null) {
        return refusal("[claude-gate] no config; run /gate setup first.");
      }
      const text = JSON.stringify(cfg.global, null, 2);
      return { content: [{ type: "text", text }] };
    },
  },
  {
    name: "gate.config_set",
    description:
      "Set a whitelisted config path. Allowed: " +
      "global.fail_policy.<env>.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Dot-separated config path" },
        value: { description: "New value (type depends on path)" },
      },
      required: ["path", "value"],
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const args = _args as Record<string, unknown>;
      const path = String(args["path"] ?? "");
      const value = args["value"];

      const cfg = ctx.bootstrap.config();
      if (cfg === null) {
        return refusal("[claude-gate] no config; run /gate setup first.");
      }

      const next = applyWhitelistedSet(cfg, path, value);
      if ("error" in next) {
        return refusal(`[claude-gate] ${next.error}`);
      }

      const parsed = ConfigSchema.safeParse(next.value);
      if (!parsed.success) {
        return refusal(`[claude-gate] config validation failed: ${parsed.error.message}`);
      }

      const p = configPath(ctx.bootstrap.project_root);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, yamlStringify(parsed.data), "utf-8");
      ctx.bootstrap.reload();

      return refusal(`[claude-gate] config updated at ${path}.`);
    },
  },
];

type ApplyResult =
  | { value: Config }
  | { error: string };

function applyWhitelistedSet(cfg: Config, path: string, value: unknown): ApplyResult {
  const next: Config = structuredClone(cfg);

  const fpMatch = path.match(FAIL_POLICY_PATH);
  if (fpMatch) {
    const env = fpMatch[1] as "prod" | "dev" | "local" | "unknown";
    if (typeof value !== "string" || !FAIL_POLICY_ENUM.has(value)) {
      return { error: "invalid value: expected 'closed' or 'open'" };
    }
    (next.global.fail_policy as Record<string, unknown>)[env] = value;
    return { value: next };
  }

  return { error: `path "${path}" is not allowed for gate.config_set` };
}
