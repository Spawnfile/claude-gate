// mcp-server/tests/ipc/types.test.ts
import { describe, expect, test } from "vitest";
import { DecideRequestSchema, DecideResponseSchema } from "../../src/ipc/types";

describe("IPC schemas", () => {
  test("accepts a valid decide request", () => {
    const valid = {
      protocol_version: "1",
      request_id: "req_abc",
      type: "decide",
      payload: {
        tool_name: "Bash",
        tool_use_id: "toolu_01abc",
        parameters: { command: "echo hi" },
        session_id: "sess_1",
        cwd: "/home/user/x",
        timestamp_ms: 1730000000000,
        mcp_server_id: null,
      },
    };
    expect(() => DecideRequestSchema.parse(valid)).not.toThrow();
  });

  test("rejects a request missing required fields", () => {
    expect(() => DecideRequestSchema.parse({ type: "decide" })).toThrow();
  });

  test("accepts a valid ALLOW response", () => {
    const valid = {
      protocol_version: "1",
      request_id: "req_abc",
      decision: "ALLOW",
      rationale: "no resource matched",
      audit_id: "aud_1",
      error: null,
    };
    expect(() => DecideResponseSchema.parse(valid)).not.toThrow();
  });

  test("accepts a valid DENY response", () => {
    const valid = {
      protocol_version: "1",
      request_id: "req_abc",
      decision: "DENY",
      rationale: "blocked by force-deny",
      audit_id: "aud_2",
      error: null,
    };
    expect(() => DecideResponseSchema.parse(valid)).not.toThrow();
  });

  test("accepts an error response with null decision", () => {
    const valid = {
      protocol_version: "1",
      request_id: "req_abc",
      decision: null,
      error: { code: "INTERNAL", message: "boom" },
    };
    expect(() => DecideResponseSchema.parse(valid)).not.toThrow();
  });

  test("rejects an unknown decision value", () => {
    const invalid = {
      protocol_version: "1",
      request_id: "req_abc",
      decision: "MAYBE",
      rationale: "uh",
    };
    expect(() => DecideResponseSchema.parse(invalid)).toThrow();
  });

  test("DecideRequestSchema accepts session_init type", () => {
    const ok = DecideRequestSchema.safeParse({
      protocol_version: "1",
      request_id: "req_a",
      type: "session_init",
      payload: { session_id: "s1", cwd: "/tmp/x" },
    });
    expect(ok.success).toBe(true);
  });

  test("DecideRequestSchema accepts gate_confirm_describe type", () => {
    const ok = DecideRequestSchema.safeParse({
      protocol_version: "1",
      request_id: "req_b",
      type: "gate_confirm_describe",
      payload: { action_id: "act_1" },
    });
    expect(ok.success).toBe(true);
  });

  test("DecideRequestSchema accepts gate_confirm_consume type", () => {
    const ok = DecideRequestSchema.safeParse({
      protocol_version: "1",
      request_id: "req_c",
      type: "gate_confirm_consume",
      payload: { action_id: "act_1" },
    });
    expect(ok.success).toBe(true);
  });
});
