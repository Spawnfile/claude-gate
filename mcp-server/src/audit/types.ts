// mcp-server/src/audit/types.ts
//
// Shape of one audit entry. Source of truth: design 4.2.

import type { DecisionVerb, RiskLevel } from "../policy/rule-pack-schema.js";

export interface AuditEntry {
  ts: string;
  session_id: string;
  tool: string;
  resource: string | null;
  env: "prod" | "dev" | "local" | "unknown" | null;
  risk: RiskLevel | "UNRATED";
  decision: DecisionVerb;
  rationale: string;
  params_hash: string;
  policy_mode: string | null;
  session_state: {
    mode: string;
    active_batch_tokens: string[];
  };
  stage_trace: {
    match_ms: number;
    parse_ms: number;
    classify_ms: number;
    policy_ms: number;
    total_ms: number;
  };
  via?: string;
  tool_use_id?: string;
  permission_mode?: string;
  transcript_path?: string;
  prev_hash: string;
  this_hash: string;
}
