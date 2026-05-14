import { describe, test, expect } from "vitest";
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { debugTools } from "../../src/tools/debug-tools";
import { loadRulePackRegistry } from "../../src/policy/rule-pack-loader";
import { createSessionState } from "../../src/policy/session";
import type { ToolContext } from "../../src/tools/registry";
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

function makeCtx(dbs: DatabaseConfig[] = [], debugState = { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] }): ToolContext {
  const session = createSessionState("sess_debug");
  const audit = { append: () => {}, close: () => {} };
  return {
    bootstrap: {
      project_root: "/tmp/test_debug",
      session_id: "sess_debug",
      databases: () => dbs,
      rule_packs: () => rulePacks,
      session: () => session,
      audit: () => audit,
      config: () => null,
      debugState,
      reload: () => {},
      close: () => {},
    },
    pendingActions: {
      create: () => ({ action_id: "act_test", action_type: "test" as const, payload_summary: "", created_at_ms: Date.now(), ttl_ms: 60000 }),
      describe: () => ({ code: "NOT_FOUND" } as { code: string }),
      markConfirmed: () => ({ code: "NOT_FOUND" } as { code: string }),
      listPending: () => [],
    } as unknown as ToolContext["pendingActions"],
  };
}

describe("gate.debug_simulate handler", () => {
  test("returns rendered decision trace text", async () => {
    const ctx = makeCtx([prodDb]);
    const tool = debugTools.find((t) => t.name === "gate.debug_simulate")!;
    const result = await tool.handler(
      {
        tool: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        parameters: { query: "DROP TABLE users" },
      },
      ctx,
    );
    const text = result.content[0]!.text;
    expect(text).toContain("Decision:");
    expect(text).toContain("DENY");
    expect(text).toContain("Rationale:");
    expect(text).toContain("Risk:");
    expect(text).toContain("CRIT");
  });

  test("SELECT returns ALLOW in rendered trace", async () => {
    const ctx = makeCtx([prodDb]);
    const tool = debugTools.find((t) => t.name === "gate.debug_simulate")!;
    const result = await tool.handler(
      {
        tool: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        parameters: { query: "SELECT id FROM users" },
      },
      ctx,
    );
    expect(result.content[0]!.text).toContain("ALLOW");
  });
});

describe("gate.debug_fixture handler", () => {
  test("returns rendered resources list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-debug-tools-fix-"));
    try {
      writeFileSync(join(dir, ".env"), "DATABASE_URL=postgres://localhost:5432/x\n");
      const ctx = makeCtx();
      const tool = debugTools.find((t) => t.name === "gate.debug_fixture")!;
      const result = await tool.handler({ path: dir }, ctx);
      const text = result.content[0]!.text;
      expect(text.length).toBeGreaterThan(0);
      // Should mention at least one resource or "no resources"
      expect(typeof text).toBe("string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gate.debug_sandbox_mcp_on handler", () => {
  test("without confirm_i_am_testing returns refusal message", async () => {
    const ctx = makeCtx();
    const tool = debugTools.find((t) => t.name === "gate.debug_sandbox_mcp_on")!;
    const result = await tool.handler(
      { intercept: "mcp__plugin_*__*" },
      ctx,
    );
    expect(result.content[0]!.text).toContain("Refused");
    expect(result.content[0]!.text).toContain("--confirm-i-am-testing");
  });

  test("with confirm flag mutates bootstrap.debugState", async () => {
    const debugState = { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] };
    const ctx = makeCtx([], debugState);
    const tool = debugTools.find((t) => t.name === "gate.debug_sandbox_mcp_on")!;
    const result = await tool.handler(
      { intercept: "mcp__plugin_*__*", confirm_i_am_testing: true, minutes: 30 },
      ctx,
    );
    expect(result.content[0]!.text).toContain("Sandbox MCP on");
    expect(result.content[0]!.text).toContain("30m");
    expect(debugState.active).toBe(true);
    expect(debugState.intercept_patterns).toContain("mcp__plugin_*__*");
    expect(debugState.expires_at_ms).toBeGreaterThan(Date.now());
  });

  test("minutes is clamped to 60 maximum", async () => {
    const debugState = { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] };
    const ctx = makeCtx([], debugState);
    const tool = debugTools.find((t) => t.name === "gate.debug_sandbox_mcp_on")!;
    const result = await tool.handler(
      { intercept: "*", confirm_i_am_testing: true, minutes: 999 },
      ctx,
    );
    expect(result.content[0]!.text).toContain("60m");
    // expires_at_ms should be within 60 minutes + small buffer
    const expectedMax = Date.now() + 60 * 60_000 + 5000;
    expect(debugState.expires_at_ms).toBeLessThanOrEqual(expectedMax);
  });
});

describe("gate.debug_sandbox_mcp_off handler", () => {
  test("resets debugState and returns confirmation", async () => {
    const debugState = {
      active: true,
      expires_at_ms: Date.now() + 60_000,
      intercept_patterns: ["mcp__*"],
    };
    const ctx = makeCtx([], debugState);
    const tool = debugTools.find((t) => t.name === "gate.debug_sandbox_mcp_off")!;
    const result = await tool.handler({}, ctx);
    expect(result.content[0]!.text).toContain("Sandbox MCP off");
    expect(debugState.active).toBe(false);
    expect(debugState.intercept_patterns).toEqual([]);
    expect(debugState.expires_at_ms).toBe(0);
  });
});
