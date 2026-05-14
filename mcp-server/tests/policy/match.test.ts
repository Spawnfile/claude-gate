// mcp-server/tests/policy/match.test.ts
import { describe, expect, test } from "vitest";
import { matchResource } from "../../src/policy/match";
import type { ToolCallEnvelope } from "../../src/policy/tool-call";
import type { DatabaseConfig } from "../../src/config/schema";

function env(overrides: Partial<ToolCallEnvelope> = {}): ToolCallEnvelope {
  return {
    protocol_version: "1",
    tool_name: "Bash",
    tool_use_id: "toolu_1",
    parameters: { command: "echo" },
    session_id: "sess",
    cwd: "/x",
    timestamp_ms: 1,
    mcp_server_id: null,
    ...overrides,
  };
}

const supabaseProd: DatabaseConfig = {
  name: "supabase_prod",
  matchers: [
    { tool: "mcp__plugin_*_supabase_prod__*", mcp_server_id: "supabase_prod" },
  ],
  env: "prod",
  policy: "strict",
  confidence: 0.99,
  discovered_from: [{ scanner: "env_scanner", file: ".env.prod" }],
};

const supabaseShared: DatabaseConfig = {
  name: "supabase_shared",
  matchers: [
    {
      tool: "mcp__plugin_*_supabase__*",
      mcp_server_id: "supabase",
      param_match: { project_ref: "prodabc123xyz" },
    },
  ],
  env: "prod",
  policy: "strict",
  confidence: 0.95,
  discovered_from: [{ scanner: "mcp_config_scanner", server: "supabase" }],
};

const postgresLocal: DatabaseConfig = {
  name: "postgres_local",
  matchers: [{ tool: "mcp__plugin_*_postgres__*", mcp_server_id: "postgres" }],
  env: "local",
  policy: "allow",
  confidence: 0.9,
  discovered_from: [{ scanner: "docker_scanner", file: "docker-compose.yml" }],
};

describe("matchResource", () => {
  test("matches by mcp_server_id (primary)", () => {
    const r = matchResource(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        mcp_server_id: "supabase_prod",
      }),
      [supabaseProd, postgresLocal],
    );
    expect(r?.name).toBe("supabase_prod");
  });

  test("matches by tool pattern when mcp_server_id is null", () => {
    const r = matchResource(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        mcp_server_id: null,
      }),
      [supabaseProd, postgresLocal],
    );
    expect(r?.name).toBe("supabase_prod");
  });

  test("matches by param_match when mcp_server_id and tool both match", () => {
    const r = matchResource(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase__execute_sql",
        mcp_server_id: "supabase",
        parameters: { project_ref: "prodabc123xyz", query: "SELECT 1" },
      }),
      [supabaseShared],
    );
    expect(r?.name).toBe("supabase_shared");
  });

  test("does not match when param_match constraint fails", () => {
    const r = matchResource(
      env({
        tool_name: "mcp__plugin_claude-gate_supabase__execute_sql",
        mcp_server_id: "supabase",
        parameters: { project_ref: "devxyz789abc", query: "SELECT 1" },
      }),
      [supabaseShared],
    );
    expect(r).toBeNull();
  });

  test("returns null when no resource matches", () => {
    const r = matchResource(env({ tool_name: "Bash" }), [
      supabaseProd,
      postgresLocal,
    ]);
    expect(r).toBeNull();
  });

  test("prefers the most specific match (mcp_server_id > tool > param)", () => {
    const generic: DatabaseConfig = {
      name: "generic",
      matchers: [{ tool: "mcp__*" }],
      env: "unknown",
      policy: "strict",
      confidence: 0.4,
      discovered_from: [],
    };
    const r = matchResource(
      env({
        tool_name: "mcp__plugin_claude-gate_postgres__query",
        mcp_server_id: "postgres",
      }),
      [generic, postgresLocal],
    );
    expect(r?.name).toBe("postgres_local");
  });

  test("matches glob tool patterns case-insensitively on `mcp__` prefix", () => {
    const r = matchResource(
      env({
        tool_name: "mcp__plugin_claude-gate_postgres__query",
        mcp_server_id: null,
      }),
      [postgresLocal],
    );
    expect(r?.name).toBe("postgres_local");
  });
});
