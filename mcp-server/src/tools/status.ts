// mcp-server/src/tools/status.ts
//
// gate.status: renders a markdown block describing the current plugin state.
// Shows project root, session info, mode, and registered databases with policy.
// If config is null, shows "audit-only mode (no config)" instead.

import type { GateTool, ToolContext, ToolResult } from "./registry.js";

const SEP = "==================================================================";

function durationSince(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

function renderStatus(ctx: ToolContext): string {
  const session = ctx.bootstrap.session();
  const cfg = ctx.bootstrap.config();
  const projectRoot = ctx.bootstrap.project_root;
  const sessionId = ctx.bootstrap.session_id;
  const duration = durationSince(session.started_at);

  const lines: string[] = [
    SEP,
    "  claude-gate -- status",
    SEP,
    "",
  ];

  if (cfg === null) {
    lines.push(
      "Plugin:    active (audit-only mode, no config)",
      `Project:   ${projectRoot}`,
      `Session:   ${sessionId} (started ${duration})`,
      "Mode:      audit-only mode (no config)",
      "",
      "No databases configured. Run /gate setup to enable gating.",
      "",
    );
  } else {
    const dbs = cfg.databases;
    lines.push(
      "Plugin:    active",
      `Project:   ${projectRoot}`,
      `Session:   ${sessionId} (started ${duration})`,
      `Mode:      ${session.mode}`,
      "",
    );

    if (dbs.length === 0) {
      lines.push("Resources (0): none configured");
    } else {
      lines.push(`Resources (${dbs.length}):`);
      for (const db of dbs) {
        const name = db.name.padEnd(20);
        const env = db.env.padEnd(7);
        const policy = db.policy.padEnd(10);
        lines.push(
          `  ${name} ${env} ${policy} (no per-call stats yet)`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export const statusTools: GateTool[] = [
  {
    name: "gate.status",
    description:
      "Show claude-gate plugin status, active session, and registered databases.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const text = renderStatus(ctx);
      return { content: [{ type: "text", text }] };
    },
  },
];
