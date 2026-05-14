// mcp-server/tests/audit/hash-chain.test.ts
import { describe, expect, test } from "vitest";
import {
  computeThisHash,
  GENESIS_HASH,
} from "../../src/audit/hash-chain";

const baseEntry = {
  ts: "2026-05-11T10:00:00.000Z",
  session_id: "sess_x",
  tool: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
  resource: "supabase_prod",
  env: "prod" as const,
  risk: "CRIT" as const,
  decision: "DENY" as const,
  rationale: "test",
  params_hash: "sha256:000",
  policy_mode: "strict",
  session_state: { mode: "interactive", active_batch_tokens: [] },
  stage_trace: { match_ms: 0, parse_ms: 0, classify_ms: 0, policy_ms: 0, total_ms: 0 },
};

describe("computeThisHash", () => {
  test("genesis hash is 64 zero hex characters", () => {
    expect(GENESIS_HASH).toBe("0".repeat(64));
  });

  test("returns a sha256-style hex digest", () => {
    const h = computeThisHash(baseEntry, GENESIS_HASH);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic", () => {
    const h1 = computeThisHash(baseEntry, GENESIS_HASH);
    const h2 = computeThisHash(baseEntry, GENESIS_HASH);
    expect(h1).toBe(h2);
  });

  test("changes when prev_hash changes", () => {
    const h1 = computeThisHash(baseEntry, GENESIS_HASH);
    const h2 = computeThisHash(baseEntry, "1".repeat(64));
    expect(h1).not.toBe(h2);
  });

  test("changes when any entry field changes", () => {
    const h1 = computeThisHash(baseEntry, GENESIS_HASH);
    const h2 = computeThisHash({ ...baseEntry, decision: "ALLOW" }, GENESIS_HASH);
    expect(h1).not.toBe(h2);
  });
});
