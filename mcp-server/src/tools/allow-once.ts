// mcp-server/src/tools/allow-once.ts
//
// gate.allow_once: pushes a one-shot approval onto the session state.
// The next tool call matching tool_pattern will be allowed once and the
// approval entry is then consumed.

import type { GateTool, ToolContext, ToolResult } from "./registry.js";

export const allowOnceTools: GateTool[] = [
  {
    name: "gate.allow_once",
    description:
      "Queue a one-shot approval for the next matching tool call. " +
      "Accepts a glob pattern (e.g. mcp__supabase__execute_sql).",
    inputSchema: {
      type: "object",
      properties: {
        tool_pattern: {
          type: "string",
          description:
            "Tool name or glob pattern to approve once " +
            "(e.g. mcp__supabase_prod__execute_sql or mcp__supabase_*__*).",
        },
      },
      required: ["tool_pattern"],
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const args = _args as Record<string, unknown>;
      const pattern = String(args["tool_pattern"] ?? "");
      const session = ctx.bootstrap.session();
      session.one_shot_approvals.push({ tool_glob: pattern });
      const text =
        `[claude-gate] One-shot approval queued for "${pattern}". ` +
        "Next matching tool call will be allowed.";
      return { content: [{ type: "text", text }] };
    },
  },
];
