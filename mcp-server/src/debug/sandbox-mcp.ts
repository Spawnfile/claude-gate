// mcp-server/src/debug/sandbox-mcp.ts
//
// Synthetic response generator for sandbox-MCP mode. When the IPC decide
// handler intercepts a tool call in debug mode, it calls generateSynthetic
// to produce a plausible-shaped but clearly fake response instead of
// forwarding to the real MCP server.

import type { ToolCallEnvelope } from "../policy/tool-call.js";
import { parseSql } from "../policy/parsers/sql.js";

export interface SyntheticResponse {
  _synthetic: true;
  _warning: string;
  _decision: "ALLOW";
  _intercepted_tool: string;
  _intercepted_at: string;
  data: unknown;
}

export function generateSynthetic(envelope: ToolCallEnvelope): SyntheticResponse {
  const data = inferShape(envelope);
  return {
    _synthetic: true,
    _warning: "claude-gate sandbox mode -- no real operation occurred",
    _decision: "ALLOW",
    _intercepted_tool: envelope.tool_name,
    _intercepted_at: new Date().toISOString(),
    data,
  };
}

function inferShape(env: ToolCallEnvelope): unknown {
  const params = env.parameters as Record<string, unknown> | null;
  const query =
    params !== null && typeof params === "object" && typeof params["query"] === "string"
      ? params["query"]
      : null;

  if (query !== null) {
    const parsed = parseSql(query);
    if (parsed.kind === "OK") {
      switch (parsed.statement_kind) {
        case "SELECT":
          return { rows: [{ stub: true }], count: 1 };
        case "INSERT":
          return { affected_rows: 1, id: "stub_id_001" };
        case "UPDATE":
        case "DELETE":
          return { affected_rows: 1 };
        case "DROP":
        case "TRUNCATE":
        case "ALTER":
        case "CREATE_TABLE":
          return { status: "ok" };
        default:
          return { status: "ok" };
      }
    }
  }

  return { status: "ok" };
}
