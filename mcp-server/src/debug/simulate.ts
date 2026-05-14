// mcp-server/src/debug/simulate.ts
//
// Pure decision simulator. Builds a synthetic ToolCallEnvelope, runs it
// through engine.decide() with an in-memory audit writer (so no real
// audit.jsonl is touched), and returns the structured trace.

import { decide, type EngineDecision } from "../policy/engine.js";
import type { ToolCallEnvelope } from "../policy/tool-call.js";
import { deriveMcpServerId } from "../policy/tool-call.js";
import { createSessionState } from "../policy/session.js";
import type { Bootstrap } from "../policy/registry-bootstrap.js";

export interface SimulateOpts {
  tool: string;
  parameters: unknown;
  as_db?: string;
  bootstrap: Bootstrap;
}

export interface SimulationTrace {
  decision: EngineDecision;
  envelope: ToolCallEnvelope;
  resolved_database: string | null;
}

export async function simulate(opts: SimulateOpts): Promise<SimulationTrace> {
  const envelope: ToolCallEnvelope = {
    protocol_version: "1",
    tool_name: opts.tool,
    tool_use_id: "toolu_sim",
    parameters: opts.parameters,
    session_id: opts.bootstrap.session_id,
    cwd: opts.bootstrap.project_root,
    timestamp_ms: Date.now(),
    // Derive mcp_server_id from the tool name, mirroring what the IPC server
    // does for real PreToolUse calls. Without this, Stage 1 matchers that
    // pin to mcp_server_id silently miss and the simulator returns ALLOW
    // for every call — defeating the rehearsal purpose.
    mcp_server_id: deriveMcpServerId(opts.tool),
  };

  const dbs = opts.bootstrap.databases();
  const filtered = opts.as_db
    ? dbs.filter((d) => d.name === opts.as_db)
    : dbs;

  // Use a fresh in-memory audit writer so simulation does not pollute the
  // real audit log.
  const memWriter = { append: () => {}, close: () => {} };

  const decision = await decide(envelope, {
    databases: filtered,
    rule_packs: opts.bootstrap.rule_packs(),
    session: createSessionState("sess_sim"),
    audit: memWriter,
    now_ms: Date.now,
  });

  return { decision, envelope, resolved_database: decision.resource };
}
