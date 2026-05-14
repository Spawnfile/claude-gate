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

describe("IPC server decide", () => {
  test("returns ALLOW with 'no resource matched' for a Bash call when bootstrap has no DBs", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    const audit = { append: () => {}, close: () => {} };
    const bootstrap = {
      project_root: tmp.dir,
      session_id: "sess_t",
      databases: () => [],
      rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
      session: () => createSessionState("sess_t"),
      audit: () => audit,
      config: () => null,
      debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] },
      reload: () => {},
      close: () => {},
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_d1",
      type: "decide",
      payload: {
        tool_name: "Bash",
        tool_use_id: "toolu_aaa",
        parameters: { command: "echo hi" },
        session_id: "sess_t",
        cwd: tmp.dir,
        timestamp_ms: 1730000000000,
        mcp_server_id: null,
      },
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_d1",
      decision: "ALLOW",
      rationale: expect.stringContaining("no resource matched"),
    });
  });

  test("returns DENY with CRIT rationale for DROP TABLE on a prod-strict database", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    const prodDb: DatabaseConfig = {
      name: "supabase_prod",
      matchers: [
        {
          tool: "mcp__plugin_*_supabase_prod__*",
          mcp_server_id: "supabase_prod",
        },
      ],
      env: "prod",
      policy: "strict",
      confidence: 0.99,
      discovered_from: [],
    };

    const rulePacks = loadRulePackRegistry({
      rulesDir: join(repoRoot, "rules"),
      pinned: {},
    });

    const auditWriter = { append: () => {}, close: () => {} };
    const sessionState = createSessionState("sess_deny");

    const bootstrap = {
      project_root: tmp.dir,
      session_id: "sess_deny",
      databases: () => [prodDb],
      rule_packs: () => rulePacks,
      session: () => sessionState,
      audit: () => auditWriter,
      config: () => null,
      debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] },
      reload: () => {},
      close: () => {},
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_d2",
      type: "decide",
      payload: {
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        tool_use_id: "toolu_bbb",
        parameters: { query: "DROP TABLE customers" },
        session_id: "sess_deny",
        cwd: tmp.dir,
        timestamp_ms: 1730000000000,
        mcp_server_id: "supabase_prod",
      },
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_d2",
      decision: "DENY",
      rationale: expect.stringContaining("CRIT"),
    });
  });
});
