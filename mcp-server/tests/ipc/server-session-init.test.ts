import { describe, test, expect, afterEach } from "vitest";
import { connect } from "node:net";
import { join } from "node:path";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";
import { startIpcServer, type IpcServer, type BootstrapLike } from "../../src/ipc/server";
import { makeTmpDir } from "../helpers/tmpdir";
import { createSessionState } from "../../src/policy/session";
import type { DatabaseConfig } from "../../src/config/schema";

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

const stubAudit = { append: () => {}, close: () => {} };

function makeBootstrap(opts: {
  config: (() => ReturnType<BootstrapLike["config"] & {}>) | null;
  debugState?: { active: boolean; expires_at_ms: number; intercept_patterns: string[] };
}): BootstrapLike {
  return {
    project_root: "/tmp/test",
    session_id: "sess_init_test",
    databases: () => [] as DatabaseConfig[],
    rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
    session: () => createSessionState("sess_init_test"),
    audit: () => stubAudit,
    config: opts.config ?? (() => null),
    reload: () => {},
    debugState: opts.debugState ?? { active: false, expires_at_ms: 0, intercept_patterns: [] },
  };
}

const validPayload = {
  session_id: "sess_abc",
  cwd: "/tmp/project",
};

describe("IPC server session_init", () => {
  test("bootstrap with config:null => notice_text contains 'First time using claude-gate'", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({ config: () => null }),
    });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_si_1",
      type: "session_init",
      payload: validPayload,
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_si_1",
      decision: "ALLOW",
    });
    const r = res as Record<string, unknown>;
    expect(typeof r["notice_text"]).toBe("string");
    expect(r["notice_text"]).toContain("First time using claude-gate");
  });

  test("bootstrap with a real config (non-null) => notice_text is null (no notice)", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    // A minimal valid config object (shape used in other tests)
    const fakeConfig = {
      version: 1 as const,
      global: {
        fail_policy: { prod: "closed" as const, dev: "open" as const, local: "open" as const },
        audit: { integrity: "hash_chain" as const, redact_params: true },
      },
      databases: [],
      rule_packs: {},
      custom_rules: [],
    };

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({ config: () => fakeConfig as never }),
    });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_si_2",
      type: "session_init",
      payload: validPayload,
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_si_2",
      decision: "ALLOW",
    });
    const r = res as Record<string, unknown>;
    expect([undefined, "", null]).toContain(r["notice_text"]);
    expect([undefined, ""]).toContain(r["rationale"]);
  });

  test("malformed payload => response error code is PARSE_FAILED", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({ config: () => null }),
    });

    // Missing required cwd field
    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_si_3",
      type: "session_init",
      payload: { session_id: "sess_abc" }, // missing cwd
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_si_3",
      decision: null,
    });
    const r = res as Record<string, unknown>;
    expect(r["error"]).toMatchObject({ code: "PARSE_FAILED" });
  });

  test("bootstrap with debugState.active=true and 30min remaining => notice_text contains debug banner with '30m'", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    const expiresMs = Date.now() + 30 * 60_000;

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({
        config: () => null, // first-run + debug
        debugState: {
          active: true,
          expires_at_ms: expiresMs,
          intercept_patterns: [],
        },
      }),
    });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_si_4",
      type: "session_init",
      payload: validPayload,
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_si_4",
      decision: "ALLOW",
    });
    const r = res as Record<string, unknown>;
    expect(typeof r["notice_text"]).toBe("string");
    expect(r["notice_text"]).toContain("GATE DEBUG MODE");
    // Allow for 29m or 30m due to floor() rounding on execution time
    expect(r["notice_text"]).toMatch(/\b2[0-9]m\b|\b30m\b/);
  });

  test("no bootstrap => decision ALLOW with audit-only notice_text", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({ socketPath }); // no bootstrap

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_si_5",
      type: "session_init",
      payload: validPayload,
    });

    expect(res).toMatchObject({
      protocol_version: "1",
      request_id: "req_si_5",
      decision: "ALLOW",
    });
    const r = res as Record<string, unknown>;
    expect(typeof r["notice_text"]).toBe("string");
    expect(r["notice_text"]).toContain("first-run audit-only");
  });

  test("session_init response populates notice_text (typed); rationale is empty", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({ config: () => null }),
    });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_si_guard",
      type: "session_init",
      payload: validPayload,
    });

    const r = res as Record<string, unknown>;
    expect(typeof r["notice_text"]).toBe("string");
    expect(String(r["notice_text"])).toContain("[claude-gate]");
    expect([undefined, ""]).toContain(r["rationale"]);
  });
});
