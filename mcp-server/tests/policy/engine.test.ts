// mcp-server/tests/policy/engine.test.ts
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { decide, type EngineDeps } from "../../src/policy/engine";
import { loadRulePackRegistry } from "../../src/policy/rule-pack-loader";
import {
  createSessionState,
  type SessionState,
} from "../../src/policy/session";
import type { ToolCallEnvelope } from "../../src/policy/tool-call";
import type { DatabaseConfig } from "../../src/config/schema";
import { createAuditWriter } from "../../src/audit/jsonl";

const repoRoot = resolve(__dirname, "../../..");

let dir: string;
let auditPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-engine-"));
  auditPath = join(dir, "audit.jsonl");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const prod: DatabaseConfig = {
  name: "supabase_prod",
  matchers: [{ tool: "mcp__plugin_*_supabase_prod__*", mcp_server_id: "supabase_prod" }],
  env: "prod",
  policy: "strict",
  confidence: 0.99,
  discovered_from: [],
};

const dev: DatabaseConfig = {
  name: "supabase_dev",
  matchers: [{ tool: "mcp__plugin_*_supabase_dev__*", mcp_server_id: "supabase_dev" }],
  env: "dev",
  policy: "confirm",
  confidence: 0.95,
  discovered_from: [],
};

function buildDeps(state: SessionState): EngineDeps {
  const reg = loadRulePackRegistry({
    rulesDir: join(repoRoot, "rules"),
    pinned: {},
  });
  const audit = createAuditWriter({ path: auditPath });
  return {
    databases: [prod, dev],
    rule_packs: reg,
    session: state,
    audit,
    now_ms: () => 1_000,
  };
}

function env(o: Partial<ToolCallEnvelope> = {}): ToolCallEnvelope {
  return {
    protocol_version: "1",
    tool_name: "Bash",
    tool_use_id: "toolu_1",
    parameters: {},
    session_id: "sess",
    cwd: "/x",
    timestamp_ms: 1,
    mcp_server_id: null,
    ...o,
  };
}

describe("decide", () => {
  test("DROP TABLE on PROD under strict -> DENY", async () => {
    const state = createSessionState("sess");
    const deps = buildDeps(state);
    const r = await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        mcp_server_id: "supabase_prod",
        parameters: { query: "DROP TABLE customers" },
      }),
      deps,
    );
    deps.audit.close();
    expect(r.decision).toBe("DENY");
    expect(r.rationale).toMatch(/CRIT/);

    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    const e = JSON.parse(lines[0]!);
    expect(e.decision).toBe("DENY");
    expect(e.resource).toBe("supabase_prod");
    expect(e.risk).toBe("CRIT");
  });

  test("SELECT on DEV under confirm -> ALLOW", async () => {
    const state = createSessionState("sess");
    const deps = buildDeps(state);
    const r = await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_dev__execute_sql",
        mcp_server_id: "supabase_dev",
        parameters: { query: "SELECT * FROM customers" },
      }),
      deps,
    );
    deps.audit.close();
    expect(r.decision).toBe("ALLOW");
  });

  test("UPDATE WHERE on DEV under confirm -> ASK", async () => {
    const state = createSessionState("sess");
    const deps = buildDeps(state);
    const r = await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_dev__execute_sql",
        mcp_server_id: "supabase_dev",
        parameters: { query: "UPDATE customers SET email = 'x' WHERE id = 1" },
      }),
      deps,
    );
    deps.audit.close();
    expect(r.decision).toBe("ASK");
  });

  test("non-matching tool with no resource -> ALLOW (no resource matched)", async () => {
    const state = createSessionState("sess");
    const deps = buildDeps(state);
    const r = await decide(env({ tool_name: "Bash" }), deps);
    deps.audit.close();
    expect(r.decision).toBe("ALLOW");
    expect(r.rationale).toMatch(/no resource matched/i);
  });

  test("parse failure -> fail-closed DENY", async () => {
    const state = createSessionState("sess");
    const deps = buildDeps(state);
    const r = await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        mcp_server_id: "supabase_prod",
        parameters: { query: "this is not sql" },
      }),
      deps,
    );
    deps.audit.close();
    expect(r.decision).toBe("DENY");
    expect(r.rationale).toMatch(/parse/i);
  });

  test("missing rule pack for a matched resource tool -> fail-closed DENY", async () => {
    const state = createSessionState("sess");
    const deps = buildDeps(state);
    const r = await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_prod__custom_op",
        mcp_server_id: "supabase_prod",
        parameters: { whatever: 1 },
      }),
      deps,
    );
    deps.audit.close();
    expect(r.decision).toBe("DENY");
    expect(r.rationale).toMatch(/no rule pack/i);
  });

  test("batch token converts ASK -> ALLOW on DEV", async () => {
    const state = createSessionState("sess");
    state.batch_tokens.push({
      pattern: "sql:supabase_dev",
      created_at: 0,
      expires_at: 10_000,
      remaining_count: 5,
    });
    const deps = buildDeps(state);
    const r = await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_dev__execute_sql",
        mcp_server_id: "supabase_dev",
        parameters: { query: "UPDATE customers SET x = 1 WHERE id = 1" },
      }),
      deps,
    );
    deps.audit.close();
    expect(r.decision).toBe("ALLOW");

    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    const e = JSON.parse(lines[0]!);
    expect(e.via).toBe("batch-token");
  });

  test("batch token does NOT cover CRIT (DROP on PROD stays DENY)", async () => {
    const state = createSessionState("sess");
    state.batch_tokens.push({
      pattern: "sql:supabase_prod",
      created_at: 0,
      expires_at: 10_000,
      remaining_count: 5,
    });
    const deps = buildDeps(state);
    const r = await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        mcp_server_id: "supabase_prod",
        parameters: { query: "DROP TABLE customers" },
      }),
      deps,
    );
    deps.audit.close();
    expect(r.decision).toBe("DENY");
    expect(state.batch_tokens[0]!.remaining_count).toBe(5);
  });

  test("emits exactly one audit entry per call", async () => {
    const state = createSessionState("sess");
    const deps = buildDeps(state);
    await decide(env({ tool_name: "Bash" }), deps);
    await decide(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        mcp_server_id: "supabase_prod",
        parameters: { query: "SELECT 1" },
      }),
      deps,
    );
    deps.audit.close();
    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
  });
});
