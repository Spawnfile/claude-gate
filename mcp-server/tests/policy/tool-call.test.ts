// mcp-server/tests/policy/tool-call.test.ts
import { describe, expect, test } from "vitest";
import {
  deriveMcpServerId,
  ToolCallEnvelopeSchema,
} from "../../src/policy/tool-call";

describe("deriveMcpServerId", () => {
  test("extracts server-id from mangled plugin MCP tool name", () => {
    expect(
      deriveMcpServerId("mcp__plugin_claude-gate_supabase__execute_sql"),
    ).toBe("supabase");
  });

  test("returns null for non-MCP built-in tools", () => {
    expect(deriveMcpServerId("Bash")).toBeNull();
    expect(deriveMcpServerId("Read")).toBeNull();
    expect(deriveMcpServerId("ToolSearch")).toBeNull();
  });

  test("returns null for unrecognized mcp-prefixed names", () => {
    expect(deriveMcpServerId("mcp_garbage_form")).toBeNull();
    expect(deriveMcpServerId("mcp__not-plugin_anything__tool")).toBeNull();
  });

  test("preserves server-id hyphens (claude-gate -> claude-gate)", () => {
    expect(
      deriveMcpServerId("mcp__plugin_my-plugin_claude-gate__gate_ping"),
    ).toBe("claude-gate");
  });
});

describe("ToolCallEnvelopeSchema", () => {
  test("accepts a minimal envelope", () => {
    const env = {
      protocol_version: "1",
      tool_name: "Bash",
      tool_use_id: "toolu_01abc",
      parameters: { command: "echo hi" },
      session_id: "sess_x",
      cwd: "/home/user/x",
      timestamp_ms: 1730000000000,
      mcp_server_id: null,
    };
    expect(() => ToolCallEnvelopeSchema.parse(env)).not.toThrow();
  });

  test("rejects when tool_use_id is missing", () => {
    const bad = {
      protocol_version: "1",
      tool_name: "Bash",
      parameters: {},
      session_id: "sess_x",
      cwd: "/x",
      timestamp_ms: 1730000000000,
      mcp_server_id: null,
    };
    expect(() => ToolCallEnvelopeSchema.parse(bad)).toThrow();
  });
});
