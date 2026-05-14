// mcp-server/src/tools/debug-tools.ts
//
// Real handlers for the four gate.debug_* tools. Replaces the T5 stubs.

import type { GateTool, ToolContext, ToolResult } from "./registry.js";
import { simulate } from "../debug/simulate.js";
import { runFixture } from "../debug/fixture.js";
import type { SimulationTrace } from "../debug/simulate.js";
import type { FixtureResult } from "../debug/fixture.js";

function renderTrace(trace: SimulationTrace): string {
  const d = trace.decision;
  const lines: string[] = [
    `Decision: ${d.decision}`,
    `Rationale: ${d.rationale}`,
    `Risk: ${d.risk}`,
    `Resource: ${d.resource ?? "(none)"}`,
    `Via: ${d.via}`,
  ];
  return lines.join("\n");
}

function renderFixture(result: FixtureResult): string {
  if (result.resources.length === 0) {
    return "No resources discovered.";
  }
  const header = "Name                           Env      Confidence";
  const sep    = "------------------------------  -------  ----------";
  const rows = result.resources.map((r) => {
    const name = r.name.padEnd(30).slice(0, 30);
    const env  = r.env.padEnd(7).slice(0, 7);
    const conf = r.confidence.toFixed(2);
    return `${name}  ${env}  ${conf}`;
  });
  return [header, sep, ...rows].join("\n");
}

export const debugTools: GateTool[] = [
  {
    name: "gate.debug_simulate",
    description:
      "Simulate a tool-call decision without executing the real call. " +
      "Returns the engine decision, rationale, risk level, matched resource, " +
      "and the override via path.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Tool name to simulate" },
        parameters: {
          type: "object",
          description: "Tool parameters (e.g. {query: 'SELECT 1'})",
        },
        as_db: {
          type: "string",
          description: "Restrict simulation to this database name only",
        },
      },
      required: ["tool"],
    },
    handler: async (args: unknown, ctx: ToolContext): Promise<ToolResult> => {
      const a = args as { tool: string; parameters?: unknown; as_db?: string };
      const trace = await simulate({
        tool: a.tool,
        parameters: a.parameters ?? {},
        ...(a.as_db !== undefined ? { as_db: a.as_db } : {}),
        bootstrap: ctx.bootstrap,
      });
      return { content: [{ type: "text", text: renderTrace(trace) }] };
    },
  },

  {
    name: "gate.debug_fixture",
    description:
      "Run discovery against a synthetic project directory and return " +
      "the list of detected resources with their env classification.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the directory to scan",
        },
      },
      required: ["path"],
    },
    handler: async (args: unknown, _ctx: ToolContext): Promise<ToolResult> => {
      const a = args as { path: string };
      const result = await runFixture(a.path);
      return { content: [{ type: "text", text: renderFixture(result) }] };
    },
  },

  {
    name: "gate.debug_sandbox_mcp_on",
    description:
      "Enable sandbox-MCP mode: intercept matching tool calls and return " +
      "synthetic responses instead of forwarding to real MCP servers. " +
      "Maximum duration: 60 minutes.",
    inputSchema: {
      type: "object",
      properties: {
        intercept: {
          type: "string",
          description:
            "Comma-separated list of glob patterns for tool names to intercept " +
            "(e.g. 'mcp__plugin_*_supabase_prod__*')",
        },
        confirm_i_am_testing: {
          type: "boolean",
          description: "Must be true to activate sandbox mode",
        },
        minutes: {
          type: "number",
          description: "Duration in minutes (max 60, default 60)",
        },
      },
      required: ["intercept"],
    },
    handler: async (args: unknown, ctx: ToolContext): Promise<ToolResult> => {
      const a = args as {
        intercept: string;
        confirm_i_am_testing?: boolean;
        minutes?: number;
      };
      if (!a.confirm_i_am_testing) {
        return {
          content: [
            {
              type: "text",
              text: "Refused: --confirm-i-am-testing is required.",
            },
          ],
        };
      }
      const minutes = Math.min(a.minutes ?? 60, 60);
      const patterns = a.intercept
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      ctx.bootstrap.debugState.active = true;
      ctx.bootstrap.debugState.expires_at_ms = Date.now() + minutes * 60_000;
      ctx.bootstrap.debugState.intercept_patterns = patterns;
      return {
        content: [
          {
            type: "text",
            text: `Sandbox MCP on for ${minutes}m. Intercepting: ${patterns.join(", ")}`,
          },
        ],
      };
    },
  },

  {
    name: "gate.debug_sandbox_mcp_off",
    description: "Disable sandbox-MCP mode.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (_args: unknown, ctx: ToolContext): Promise<ToolResult> => {
      ctx.bootstrap.debugState.active = false;
      ctx.bootstrap.debugState.intercept_patterns = [];
      ctx.bootstrap.debugState.expires_at_ms = 0;
      return { content: [{ type: "text", text: "Sandbox MCP off." }] };
    },
  },
];
