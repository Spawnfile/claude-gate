// mcp-server/src/policy/session.ts
//
// Stage 5 of the decision pipeline. Pure transition over an
// in-memory SessionState. Mutates the session in place (token
// decrement, expired-token cleanup, one-shot consumption).
//
// Source of truth: design Sections 4.5 and 5 Stage 5.

import type { DecisionVerb, RiskLevel } from "./rule-pack-schema.js";
import { globMatch } from "../util/glob.js";

export type SessionMode =
  | "interactive"
  | "block-all"
  | "approve-all"
  | "debug";

export interface BatchToken {
  pattern: string;
  created_at: number;
  expires_at: number;
  remaining_count: number;
}

export interface OneShotApproval {
  tool_glob: string;
}

export interface SessionState {
  session_id: string;
  mode: SessionMode;
  global_policy_override: string | null;
  batch_tokens: BatchToken[];
  one_shot_approvals: OneShotApproval[];
  started_at: number;
}

export interface OverrideContext {
  session: SessionState;
  resource_name: string;
  pack_name: string;
  risk: RiskLevel;
  tentative: DecisionVerb;
  now_ms: number;
  tool_name?: string;
}

export interface OverrideResult {
  decision: DecisionVerb;
  via:
    | "none"
    | "block-all"
    | "approve-all"
    | "batch-token"
    | "one-shot"
    | "global-override";
  global_policy_override: string | null;
}

export function createSessionState(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    mode: "interactive",
    global_policy_override: null,
    batch_tokens: [],
    one_shot_approvals: [],
    started_at: Date.now(),
  };
}

export function applySessionOverride(ctx: OverrideContext): OverrideResult {
  const s = ctx.session;

  pruneTokens(s, ctx.now_ms);

  if (s.mode === "block-all") {
    return {
      decision: "DENY",
      via: "block-all",
      global_policy_override: s.global_policy_override,
    };
  }

  if (ctx.tool_name) {
    const idx = s.one_shot_approvals.findIndex((a) =>
      globMatch(a.tool_glob, ctx.tool_name!),
    );
    if (idx >= 0) {
      s.one_shot_approvals.splice(idx, 1);
      return {
        decision: "ALLOW",
        via: "one-shot",
        global_policy_override: s.global_policy_override,
      };
    }
  }

  // Batch tokens never override CRIT.
  if (ctx.risk !== "CRIT") {
    const idx = s.batch_tokens.findIndex((t) =>
      patternMatches(t.pattern, ctx.pack_name, ctx.resource_name),
    );
    if (idx >= 0) {
      s.batch_tokens[idx]!.remaining_count -= 1;
      if (s.batch_tokens[idx]!.remaining_count <= 0) {
        s.batch_tokens.splice(idx, 1);
      }
      return {
        decision: "ALLOW",
        via: "batch-token",
        global_policy_override: s.global_policy_override,
      };
    }
  }

  return {
    decision: ctx.tentative,
    via: "none",
    global_policy_override: s.global_policy_override,
  };
}

function pruneTokens(s: SessionState, now: number): void {
  s.batch_tokens = s.batch_tokens.filter(
    (t) => t.remaining_count > 0 && t.expires_at > now,
  );
}

function patternMatches(
  pattern: string,
  pack: string,
  resource: string,
): boolean {
  // Tokens use "pack:resource" form (e.g., "sql:supabase_dev"). Each
  // side supports a trailing "*" wildcard.
  const [tp, rp] = pattern.split(":", 2);
  if (!tp || !rp) return false;
  return wild(tp, pack) && wild(rp, resource);
}

function wild(p: string, v: string): boolean {
  if (p === "*") return true;
  if (p.endsWith("*")) return v.startsWith(p.slice(0, -1));
  return p === v;
}

