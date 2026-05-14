import { describe, test, expect, afterEach } from "vitest";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";
import { startIpcServer, type IpcServer } from "../../src/ipc/server";
import { makeTmpDir } from "../helpers/tmpdir";
import { createSessionState } from "../../src/policy/session";
import { loadRulePackRegistry } from "../../src/policy/rule-pack-loader";
import type { DatabaseConfig } from "../../src/config/schema";

const repoRoot = resolve(__dirname, "../../..");

let server: IpcServer | null = null;
let cleanupTmp: (() => void) | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  if (cleanupTmp) {
    cleanupTmp();
    cleanupTmp = null;
  }
});

async function rpc(socketPath: string, message: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    const dec = new FrameDecoder();
    dec.on("message", (m) => {
      client.end();
      resolve(m);
    });
    dec.on("error", reject);
    client.on("error", reject);
    client.on("connect", () => client.write(encodeFrame(message)));
    client.on("data", (c) => dec.feed(c));
  });
}

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

describe("IPC server sandbox substitution", () => {
  test("SANDBOX_RESPONSE when debug active, not expired, tool matches intercept, decision ALLOW", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    const rulePacks = loadRulePackRegistry({
      rulesDir: join(repoRoot, "rules"),
      pinned: {},
    });
    const audit = { append: () => {}, close: () => {} };
    const session = createSessionState("sess_sandbox");

    const bootstrap = {
      project_root: tmp.dir,
      session_id: "sess_sandbox",
      databases: () => [],
      rule_packs: () => rulePacks,
      session: () => session,
      audit: () => audit,
      config: () => null,
      debugState: {
        active: true,
        expires_at_ms: Date.now() + 60_000,
        intercept_patterns: ["mcp__plugin_*_supabase_prod__*"],
      },
      reload: () => {},
      close: () => {},
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_sb1",
      type: "decide",
      payload: {
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        tool_use_id: "toolu_sb",
        parameters: { query: "SELECT id FROM users" },
        session_id: "sess_sandbox",
        cwd: tmp.dir,
        timestamp_ms: Date.now(),
        mcp_server_id: null,
      },
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_sb1",
      decision: "SANDBOX_RESPONSE",
    });
    const r = res as Record<string, unknown>;
    expect(r["sandbox_response"]).toBeDefined();
    const sr = r["sandbox_response"] as Record<string, unknown>;
    expect(sr["_synthetic"]).toBe(true);
    expect(typeof r["rationale"]).toBe("string");
    expect((r["rationale"] as string)).toContain("[sandbox]");
  });

  test("normal ALLOW when intercept pattern does not match tool", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    const audit = { append: () => {}, close: () => {} };
    const session = createSessionState("sess_sb2");

    const bootstrap = {
      project_root: tmp.dir,
      session_id: "sess_sb2",
      databases: () => [],
      rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
      session: () => session,
      audit: () => audit,
      config: () => null,
      debugState: {
        active: true,
        expires_at_ms: Date.now() + 60_000,
        intercept_patterns: ["mcp__plugin_*_supabase_prod__*"],
      },
      reload: () => {},
      close: () => {},
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_sb2",
      type: "decide",
      payload: {
        tool_name: "Bash",
        tool_use_id: "toolu_sb2",
        parameters: { command: "echo hi" },
        session_id: "sess_sb2",
        cwd: tmp.dir,
        timestamp_ms: Date.now(),
        mcp_server_id: null,
      },
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_sb2",
      decision: "ALLOW",
      rationale: expect.stringContaining("no resource matched"),
    });
    const r = res as Record<string, unknown>;
    expect(r["sandbox_response"]).toBeUndefined();
  });

  test("DENY stays DENY even when debug is active and tool matches intercept", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    const rulePacks = loadRulePackRegistry({
      rulesDir: join(repoRoot, "rules"),
      pinned: {},
    });
    const audit = { append: () => {}, close: () => {} };
    const session = createSessionState("sess_deny_sb");

    const bootstrap = {
      project_root: tmp.dir,
      session_id: "sess_deny_sb",
      databases: () => [prodDb],
      rule_packs: () => rulePacks,
      session: () => session,
      audit: () => audit,
      config: () => null,
      debugState: {
        active: true,
        expires_at_ms: Date.now() + 60_000,
        intercept_patterns: ["mcp__plugin_*_supabase_prod__*"],
      },
      reload: () => {},
      close: () => {},
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_deny_sb",
      type: "decide",
      payload: {
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        tool_use_id: "toolu_deny",
        parameters: { query: "DROP TABLE customers" },
        session_id: "sess_deny_sb",
        cwd: tmp.dir,
        timestamp_ms: Date.now(),
        mcp_server_id: "supabase_prod",
      },
    });

    expect(res).toMatchObject({
      decision: "DENY",
    });
    const r = res as Record<string, unknown>;
    expect(r["sandbox_response"]).toBeUndefined();
  });

  test("no sandbox substitution when expires_at_ms is in the past", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    const audit = { append: () => {}, close: () => {} };
    const session = createSessionState("sess_expired");

    const bootstrap = {
      project_root: tmp.dir,
      session_id: "sess_expired",
      databases: () => [],
      rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
      session: () => session,
      audit: () => audit,
      config: () => null,
      debugState: {
        active: true,
        expires_at_ms: Date.now() - 1,  // expired
        intercept_patterns: ["*"],
      },
      reload: () => {},
      close: () => {},
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_exp",
      type: "decide",
      payload: {
        tool_name: "Bash",
        tool_use_id: "toolu_exp",
        parameters: { command: "ls" },
        session_id: "sess_expired",
        cwd: tmp.dir,
        timestamp_ms: Date.now(),
        mcp_server_id: null,
      },
    });

    expect(res).toMatchObject({
      decision: "ALLOW",
    });
    const r = res as Record<string, unknown>;
    expect(r["sandbox_response"]).toBeUndefined();
  });
});
