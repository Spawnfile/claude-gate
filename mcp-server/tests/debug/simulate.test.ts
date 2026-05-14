import { describe, test, expect } from "vitest";
import { join, resolve } from "node:path";
import { simulate } from "../../src/debug/simulate";
import { loadRulePackRegistry } from "../../src/policy/rule-pack-loader";
import { createSessionState } from "../../src/policy/session";
import type { DatabaseConfig } from "../../src/config/schema";

const repoRoot = resolve(__dirname, "../../..");

const rulePacks = loadRulePackRegistry({
  rulesDir: join(repoRoot, "rules"),
  pinned: {},
});

const prodDb: DatabaseConfig = {
  name: "supabase_prod",
  matchers: [
    { tool: "mcp__plugin_*_supabase_prod__*", mcp_server_id: "supabase_prod" },
  ],
  env: "prod",
  policy: "strict",
  confidence: 0.99,
  discovered_from: [],
};

function makeBootstrap(dbs: DatabaseConfig[]) {
  const session = createSessionState("sess_sim");
  const auditSpy = { append: () => {}, close: () => {} };
  return {
    project_root: "/tmp/test",
    session_id: "sess_sim",
    databases: () => dbs,
    rule_packs: () => rulePacks,
    session: () => session,
    audit: () => auditSpy,
    config: () => null,
    debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] },
    reload: () => {},
    close: () => {},
  };
}

describe("simulate", () => {
  test("DROP TABLE on prod-strict returns DENY with CRIT risk", async () => {
    const bootstrap = makeBootstrap([prodDb]);
    const trace = await simulate({
      tool: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
      parameters: { query: "DROP TABLE customers" },
      bootstrap,
    });
    expect(trace.decision.decision).toBe("DENY");
    expect(trace.decision.risk).toBe("CRIT");
    expect(trace.resolved_database).toBe("supabase_prod");
  });

  test("SELECT on prod-strict returns ALLOW with LOW risk", async () => {
    const bootstrap = makeBootstrap([prodDb]);
    const trace = await simulate({
      tool: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
      parameters: { query: "SELECT id FROM users" },
      bootstrap,
    });
    expect(trace.decision.decision).toBe("ALLOW");
    expect(trace.decision.risk).toBe("LOW");
  });

  test("no DB matched returns ALLOW with UNRATED when no databases in bootstrap", async () => {
    const bootstrap = makeBootstrap([]);
    const trace = await simulate({
      tool: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
      parameters: { query: "SELECT 1" },
      bootstrap,
    });
    expect(trace.decision.decision).toBe("ALLOW");
    expect(trace.decision.risk).toBe("UNRATED");
    expect(trace.resolved_database).toBeNull();
  });

  test("matcher with only mcp_server_id (no tool glob) matches via derived id from tool name", async () => {
    // Repros the bug fixed in simulate.ts: wizard-generated configs use a
    // bare {mcp_server_id} matcher with no tool glob. The simulator must
    // derive mcp_server_id from the tool name (mirroring the IPC server)
    // so Stage 1 doesn't silently miss.
    const devDb: DatabaseConfig = {
      // Use hyphen, not underscore: the CC wire-format regex cannot extract
      // mcp_server_id from a tool name whose server segment contains "_".
      name: "supabase-dev",
      matchers: [{ mcp_server_id: "supabase-dev" }],
      env: "dev",
      policy: "confirm",
      confidence: 0.9,
      discovered_from: [],
    };
    const bootstrap = makeBootstrap([devDb]);
    const trace = await simulate({
      tool: "mcp__plugin_claude-gate_supabase-dev__execute_sql",
      parameters: { query: "UPDATE products SET status='shipped' WHERE id=1" },
      as_db: "supabase-dev",
      bootstrap,
    });
    expect(trace.resolved_database).toBe("supabase-dev");
    expect(trace.decision.risk).toBe("MED");
    // confirm policy + MED -> ASK
    expect(trace.decision.decision).toBe("ASK");
  });

  test("as_db filters to only the named database", async () => {
    const devDb: DatabaseConfig = {
      name: "supabase_dev",
      matchers: [
        { tool: "mcp__plugin_*_supabase_dev__*", mcp_server_id: "supabase_dev" },
      ],
      env: "dev",
      policy: "confirm",
      confidence: 0.95,
      discovered_from: [],
    };
    const bootstrap = makeBootstrap([prodDb, devDb]);
    // simulate as supabase_dev only - prod DB should be excluded so no match for prod tool
    const trace = await simulate({
      tool: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
      parameters: { query: "DROP TABLE x" },
      as_db: "supabase_dev",
      bootstrap,
    });
    // supabase_dev matchers don't match a supabase_prod tool name -> ALLOW (no match)
    expect(trace.decision.decision).toBe("ALLOW");
    expect(trace.decision.risk).toBe("UNRATED");
  });
});
