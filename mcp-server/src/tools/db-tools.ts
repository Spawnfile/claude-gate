// mcp-server/src/tools/db-tools.ts
//
// MCP tools for live database configuration management:
//   gate.db_list        - list registered databases
//   gate.db_set_policy  - change a database policy
//
// Policy changes (except "allow") take effect immediately by writing config.yaml
// and calling bootstrap.reload(). Setting policy to "allow" is a critical action
// and requires out-of-band confirmation via gate-confirm.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { configPath } from "../config/loader.js";
import { ConfigSchema } from "../config/schema.js";
import type { GateTool, ToolContext, ToolResult } from "./registry.js";

const SEP = "==================================================================";

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderDbList(ctx: ToolContext): string {
  const cfg = ctx.bootstrap.config();
  if (cfg === null) {
    return [
      "[claude-gate] No databases configured.",
      "Run /gate setup to configure databases.",
    ].join("\n");
  }

  const dbs = cfg.databases;
  if (dbs.length === 0) {
    return "[claude-gate] No databases in config (empty list).";
  }

  const lines: string[] = [
    SEP,
    "  claude-gate -- database list",
    SEP,
    "",
    "  Name                     Env       Policy",
    "  ----                     ---       ------",
  ];

  for (const db of dbs) {
    const name = db.name.padEnd(24);
    const env = db.env.padEnd(9);
    const policy = db.policy.padEnd(10);
    lines.push(`  ${name} ${env} ${policy}`);
  }

  lines.push(
    "",
    "(no per-call stats yet)",
    "",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const dbTools: GateTool[] = [
  {
    name: "gate.db_list",
    description: "List registered databases and their current policies.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const text = renderDbList(ctx);
      return { content: [{ type: "text", text }] };
    },
  },

  {
    name: "gate.db_set_policy",
    description:
      "Change a database's policy. Setting policy to 'allow' requires " +
      "out-of-band confirmation via gate-confirm (provide action_id on second call).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Database name to update",
        },
        policy: {
          type: "string",
          enum: ["strict", "confirm", "dev", "allow"],
          description: "New policy",
        },
        action_id: {
          type: "string",
          description:
            "Confirmation token (required when policy=allow on second call).",
        },
      },
      required: ["name", "policy"],
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const projectRoot = ctx.bootstrap.project_root;
      const args = _args as Record<string, unknown>;
      const name = String(args["name"] ?? "");
      const policy = String(args["policy"] ?? "") as
        | "strict"
        | "confirm"
        | "dev"
        | "allow";
      const actionId =
        args["action_id"] !== undefined
          ? String(args["action_id"])
          : undefined;

      const cfg = ctx.bootstrap.config();
      if (cfg === null) {
        return {
          content: [
            {
              type: "text",
              text: "[claude-gate] No config; complete /gate setup first.",
            },
          ],
        };
      }

      const dbIdx = cfg.databases.findIndex((d) => d.name === name);
      if (dbIdx < 0) {
        return {
          content: [
            {
              type: "text",
              text: `[claude-gate] Database "${name}" not found in config.`,
            },
          ],
        };
      }

      // "allow" is a critical policy -- requires out-of-band confirmation.
      if (policy === "allow") {
        if (!actionId) {
          // Phase 1: create pending action.
          const action = ctx.pendingActions.create({
            project_root: projectRoot,
            session_id: ctx.bootstrap.session_id,
            cwd_at_creation: projectRoot,
            action_type: "db_set_policy_allow",
            payload_summary: `Set ${name} policy to allow`,
            payload: { name, policy },
          });
          const text = [
            SEP,
            "  claude-gate -- confirmation required",
            SEP,
            "",
            `[claude-gate] Setting policy to "allow" requires terminal confirmation.`,
            "",
            `Action ID: ${action.action_id}`,
            "",
            "Run in your terminal:",
            `  gate-confirm ${action.action_id}`,
            "",
            "Then call gate.db_set_policy again with:",
            `  { name: "${name}", policy: "allow", action_id: "${action.action_id}" }`,
            "",
          ].join("\n");
          return { content: [{ type: "text", text }] };
        }

        // Phase 2: verify confirmation.
        const confirmed = ctx.pendingActions.isConfirmed(actionId, {
          session_id: ctx.bootstrap.session_id,
          project_root: projectRoot,
        });
        if ("code" in confirmed) {
          if (confirmed.code === "NOT_CONFIRMED") {
            return {
              content: [
                {
                  type: "text",
                  text: "[claude-gate] Action not yet confirmed. Run gate-confirm first.",
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `[claude-gate] Error: ${confirmed.code}. Action may have expired or been consumed.`,
              },
            ],
          };
        }
        // Fall through to the write path.
        ctx.pendingActions.consume(actionId);
      }

      // Write updated config.
      const updatedDbs = cfg.databases.map((db, i) =>
        i === dbIdx ? { ...db, policy } : db,
      );
      const updatedCfg = { ...cfg, databases: updatedDbs };
      const parsed = ConfigSchema.safeParse(updatedCfg);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text",
              text: `[claude-gate] Config validation failed: ${parsed.error.message}`,
            },
          ],
        };
      }

      const p = configPath(projectRoot);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, yamlStringify(parsed.data), "utf-8");
      ctx.bootstrap.reload();

      const text = [
        `[claude-gate] Policy updated: ${name} -> ${policy}`,
        "",
        "Use gate.db_list to confirm the change.",
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  },
];
