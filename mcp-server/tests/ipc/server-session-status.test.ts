// mcp-server/tests/ipc/server-session-status.test.ts
//
// Tests for the session_status IPC request type.
// Verifies per-session shown-state semantics: first-run one-shot per session,
// debug banner repeats on every call.

import { describe, test, expect, afterEach } from "vitest";
import { connect } from "node:net";
import { join } from "node:path";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";
import { startIpcServer, type IpcServer, type BootstrapLike } from "../../src/ipc/server";
import { makeTmpDir } from "../helpers/tmpdir";
import { createSessionState } from "../../src/policy/session";
import type { DatabaseConfig } from "../../src/config/schema";

let server: IpcServer | null = null;
let cleanupFns: Array<() => void> = [];

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
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
    session_id: "sess_status_test",
    databases: () => [] as DatabaseConfig[],
    rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
    session: () => createSessionState("sess_status_test"),
    audit: () => stubAudit,
    config: opts.config ?? (() => null),
    reload: () => {},
    debugState: opts.debugState ?? { active: false, expires_at_ms: 0, intercept_patterns: [] },
  };
}

function sessionStatusRequest(sessionId: string, reqId: string) {
  return {
    protocol_version: "1",
    request_id: reqId,
    type: "session_status",
    payload: { session_id: sessionId, cwd: "/tmp/project" },
  };
}

describe("IPC server session_status - first-run one-shot semantics", () => {
  test("first call returns notice_text with first-run notice; second call does not include first-run section", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({ config: () => null }),
    });

    const sessionId = `sess_first_run_${Date.now().toString(36)}`;

    // First call: should include first-run notice
    const res1 = await rpc(socketPath, sessionStatusRequest(sessionId, "req_ss_1"));
    const r1 = res1 as Record<string, unknown>;
    expect(r1["decision"]).toBe("ALLOW");
    expect(typeof r1["notice_text"]).toBe("string");
    expect(String(r1["notice_text"])).toContain("First time using claude-gate");

    // Second call: should NOT include the first-run notice
    const res2 = await rpc(socketPath, sessionStatusRequest(sessionId, "req_ss_2"));
    const r2 = res2 as Record<string, unknown>;
    expect(r2["decision"]).toBe("ALLOW");
    // notice_text should be null or not contain first-run text
    const notice2 = r2["notice_text"];
    if (typeof notice2 === "string" && notice2.length > 0) {
      expect(notice2).not.toContain("First time using claude-gate");
    } else {
      expect([null, undefined, ""]).toContain(notice2);
    }
  });
});

describe("IPC server session_status - debug banner repeats", () => {
  test("debug banner appears on every call when debugState.active is true", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");

    const expiresMs = Date.now() + 60 * 60_000;

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({
        config: () => ({} as never), // non-null config => no first-run
        debugState: {
          active: true,
          expires_at_ms: expiresMs,
          intercept_patterns: [],
        },
      }),
    });

    const sessionId = `sess_debug_${Date.now().toString(36)}`;

    // First call: should include debug banner
    const res1 = await rpc(socketPath, sessionStatusRequest(sessionId, "req_db_1"));
    const r1 = res1 as Record<string, unknown>;
    expect(r1["decision"]).toBe("ALLOW");
    expect(typeof r1["notice_text"]).toBe("string");
    expect(String(r1["notice_text"])).toContain("GATE DEBUG MODE");

    // Second call: debug banner must appear again
    const res2 = await rpc(socketPath, sessionStatusRequest(sessionId, "req_db_2"));
    const r2 = res2 as Record<string, unknown>;
    expect(r2["decision"]).toBe("ALLOW");
    expect(typeof r2["notice_text"]).toBe("string");
    expect(String(r2["notice_text"])).toContain("GATE DEBUG MODE");
  });
});

describe("IPC server session_status - malformed payload", () => {
  test("missing session_id returns PARSE_FAILED error", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({
      socketPath,
      bootstrap: makeBootstrap({ config: () => null }),
    });

    const res = await rpc(socketPath, {
      protocol_version: "1",
      request_id: "req_malformed",
      type: "session_status",
      payload: { cwd: "/tmp/project" }, // missing session_id
    });

    const r = res as Record<string, unknown>;
    expect(r["decision"]).toBeNull();
    expect(r["error"]).toMatchObject({ code: "PARSE_FAILED" });
  });
});
