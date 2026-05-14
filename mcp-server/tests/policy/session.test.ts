// mcp-server/tests/policy/session.test.ts
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  createSessionState,
  applySessionOverride,
  type SessionState,
  type OverrideContext,
} from "../../src/policy/session";

function ctx(
  state: SessionState,
  overrides: Partial<OverrideContext> = {},
): OverrideContext {
  return {
    session: state,
    resource_name: "supabase_dev",
    pack_name: "sql",
    risk: "MED",
    tentative: "ASK",
    now_ms: 1_000,
    ...overrides,
  };
}

describe("createSessionState", () => {
  test("returns an empty state", () => {
    const s = createSessionState("sess_x");
    expect(s.session_id).toBe("sess_x");
    expect(s.mode).toBe("interactive");
    expect(s.batch_tokens).toEqual([]);
    expect(s.one_shot_approvals).toEqual([]);
  });
});

describe("applySessionOverride", () => {
  let state: SessionState;
  beforeEach(() => {
    state = createSessionState("sess_x");
  });

  test("returns tentative unchanged when no override applies", () => {
    const r = applySessionOverride(ctx(state));
    expect(r.decision).toBe("ASK");
    expect(r.via).toBe("none");
  });

  test("block-all mode forces DENY", () => {
    state.mode = "block-all";
    const r = applySessionOverride(ctx(state, { tentative: "ALLOW" }));
    expect(r.decision).toBe("DENY");
    expect(r.via).toBe("block-all");
  });

  test("a matching batch token converts ASK -> ALLOW and decrements count", () => {
    state.batch_tokens.push({
      pattern: "sql:supabase_dev",
      created_at: 0,
      expires_at: 10_000,
      remaining_count: 3,
    });
    const r = applySessionOverride(ctx(state));
    expect(r.decision).toBe("ALLOW");
    expect(r.via).toBe("batch-token");
    expect(state.batch_tokens[0]!.remaining_count).toBe(2);
  });

  test("a matching batch token does NOT cover CRIT operations", () => {
    state.batch_tokens.push({
      pattern: "sql:supabase_dev",
      created_at: 0,
      expires_at: 10_000,
      remaining_count: 3,
    });
    const r = applySessionOverride(
      ctx(state, { risk: "CRIT", tentative: "DENY" }),
    );
    expect(r.decision).toBe("DENY");
    expect(r.via).toBe("none");
    expect(state.batch_tokens[0]!.remaining_count).toBe(3);
  });

  test("an expired token (by time) is removed and ignored", () => {
    state.batch_tokens.push({
      pattern: "sql:supabase_dev",
      created_at: 0,
      expires_at: 500,
      remaining_count: 10,
    });
    const r = applySessionOverride(ctx(state, { now_ms: 1_000 }));
    expect(r.decision).toBe("ASK");
    expect(state.batch_tokens).toEqual([]);
  });

  test("an exhausted token (count 0) is removed and ignored", () => {
    state.batch_tokens.push({
      pattern: "sql:supabase_dev",
      created_at: 0,
      expires_at: 10_000,
      remaining_count: 0,
    });
    const r = applySessionOverride(ctx(state));
    expect(r.decision).toBe("ASK");
    expect(state.batch_tokens).toEqual([]);
  });

  test("a one-shot approval matches once and is removed", () => {
    state.one_shot_approvals.push({
      tool_glob: "mcp__plugin_*_supabase_*__execute_sql*",
    });
    const r = applySessionOverride(
      ctx(state, {
        tool_name: "mcp__plugin_claude-gate_supabase_dev__execute_sql",
      }),
    );
    expect(r.decision).toBe("ALLOW");
    expect(r.via).toBe("one-shot");
    expect(state.one_shot_approvals).toEqual([]);
  });

  test("a non-matching one-shot approval is preserved", () => {
    state.one_shot_approvals.push({ tool_glob: "Bash" });
    applySessionOverride(
      ctx(state, {
        tool_name: "mcp__plugin_claude-gate_supabase__execute_sql",
      }),
    );
    expect(state.one_shot_approvals.length).toBe(1);
  });

  test("global_policy_override is exposed (engine re-evaluates Stage 4)", () => {
    state.global_policy_override = "allow";
    const r = applySessionOverride(ctx(state));
    expect(r.global_policy_override).toBe("allow");
  });
});
