// mcp-server/src/policy/match.ts
//
// Stage 1 of the decision pipeline. Matches an envelope against the
// list of configured databases. Most-specific match wins per design
// Section 5 Stage 1.

import type { ToolCallEnvelope } from "./tool-call.js";
import type { DatabaseConfig, Matcher } from "../config/schema.js";
import { warn } from "../log.js";
import { globMatch } from "../util/glob.js";

interface Scored {
  resource: DatabaseConfig;
  matcher: Matcher;
  score: number;
}

export function matchResource(
  env: ToolCallEnvelope,
  databases: DatabaseConfig[],
): DatabaseConfig | null {
  const hits: Scored[] = [];

  for (const db of databases) {
    for (const m of db.matchers) {
      const s = scoreMatcher(m, env);
      if (s > 0) hits.push({ resource: db, matcher: m, score: s });
    }
  }

  if (hits.length === 0) return null;

  hits.sort((a, b) => b.score - a.score);
  const top = hits[0]!.score;
  const ties = hits.filter((h) => h.score === top);
  if (ties.length > 1) {
    warn(
      `multiple resources tied at score ${top} for tool ${env.tool_name}; preferring "${ties[0]!.resource.name}"`,
    );
  }
  return ties[0]!.resource;
}

function scoreMatcher(m: Matcher, env: ToolCallEnvelope): number {
  let score = 0;
  let toolOk = true;
  let mcpOk = true;
  let paramOk = true;

  if (m.mcp_server_id !== undefined) {
    if (env.mcp_server_id === m.mcp_server_id) {
      score += 100;
    } else if (env.mcp_server_id !== null) {
      // envelope has a server id but it doesn't match — hard reject
      mcpOk = false;
    }
    // env.mcp_server_id === null: skip the mcp constraint (no bonus, no penalty)
  }

  if (m.tool !== undefined) {
    if (globMatch(m.tool, env.tool_name)) {
      score += m.tool.length;
    } else {
      toolOk = false;
    }
  }

  if (m.param_match !== undefined) {
    const params = (env.parameters ?? {}) as Record<string, unknown>;
    let allMatch = true;
    let n = 0;
    for (const [k, v] of Object.entries(m.param_match)) {
      n++;
      if (params[k] !== v) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      score += n * 10;
    } else {
      paramOk = false;
    }
  }

  if (!toolOk || !mcpOk || !paramOk) return 0;
  return score;
}

