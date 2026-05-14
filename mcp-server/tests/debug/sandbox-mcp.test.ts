import { describe, test, expect } from "vitest";
import { generateSynthetic } from "../../src/debug/sandbox-mcp";
import type { ToolCallEnvelope } from "../../src/policy/tool-call";

function makeEnvelope(tool: string, params: unknown): ToolCallEnvelope {
  return {
    protocol_version: "1",
    tool_name: tool,
    tool_use_id: "toolu_test",
    parameters: params,
    session_id: "sess_test",
    cwd: "/tmp/test",
    timestamp_ms: 1730000000000,
    mcp_server_id: null,
  };
}

describe("generateSynthetic", () => {
  test("always sets _synthetic: true and required fields", () => {
    const env = makeEnvelope("Bash", { command: "echo hi" });
    const resp = generateSynthetic(env);
    expect(resp._synthetic).toBe(true);
    expect(resp._decision).toBe("ALLOW");
    expect(resp._intercepted_tool).toBe("Bash");
    expect(typeof resp._intercepted_at).toBe("string");
    expect(typeof resp._warning).toBe("string");
  });

  test("SELECT query returns rows + count shape", () => {
    const env = makeEnvelope("mcp__plugin_x_db__execute_sql", { query: "SELECT id FROM users" });
    const resp = generateSynthetic(env);
    expect(resp.data).toMatchObject({ rows: expect.any(Array), count: 1 });
  });

  test("INSERT query returns affected_rows + id shape", () => {
    const env = makeEnvelope("mcp__plugin_x_db__execute_sql", { query: "INSERT INTO users (name) VALUES ('x')" });
    const resp = generateSynthetic(env);
    expect(resp.data).toMatchObject({ affected_rows: 1, id: "stub_id_001" });
  });

  test("UPDATE query returns affected_rows shape", () => {
    const env = makeEnvelope("mcp__plugin_x_db__execute_sql", { query: "UPDATE users SET name='y' WHERE id=1" });
    const resp = generateSynthetic(env);
    expect(resp.data).toMatchObject({ affected_rows: 1 });
    expect((resp.data as Record<string, unknown>)["id"]).toBeUndefined();
  });

  test("DELETE query returns affected_rows shape", () => {
    const env = makeEnvelope("mcp__plugin_x_db__execute_sql", { query: "DELETE FROM users WHERE id=1" });
    const resp = generateSynthetic(env);
    expect(resp.data).toMatchObject({ affected_rows: 1 });
  });

  test("DROP TABLE returns status: ok", () => {
    const env = makeEnvelope("mcp__plugin_x_db__execute_sql", { query: "DROP TABLE users" });
    const resp = generateSynthetic(env);
    expect(resp.data).toMatchObject({ status: "ok" });
  });

  test("non-SQL tool (Bash) returns status: ok", () => {
    const env = makeEnvelope("Bash", { command: "ls -la" });
    const resp = generateSynthetic(env);
    expect(resp.data).toMatchObject({ status: "ok" });
  });

  test("SQL parse failure falls back to status: ok", () => {
    const env = makeEnvelope("mcp__plugin_x_db__execute_sql", { query: "NOT VALID SQL !!@@@" });
    const resp = generateSynthetic(env);
    expect(resp.data).toMatchObject({ status: "ok" });
  });
});
