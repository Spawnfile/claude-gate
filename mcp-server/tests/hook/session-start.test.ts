import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { startIpcServer, type IpcServer, type BootstrapLike } from "../../src/ipc/server";
import { makeTmpDir } from "../helpers/tmpdir";
import { createSessionState } from "../../src/policy/session";
import { runSessionStart } from "../../src/hook/session-start";
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

const stubAudit = { append: () => {}, close: () => {} };

function makeFirstRunBootstrap(): BootstrapLike {
  return {
    project_root: "/tmp/test",
    session_id: "sess_ss_test",
    databases: () => [] as DatabaseConfig[],
    rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
    session: () => createSessionState("sess_ss_test"),
    audit: () => stubAudit,
    config: () => null, // first-run: no config
    debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] },
    reload: () => {},
  };
}

function validStdin(sessionId = "sess_ss_test", cwd = "/tmp/project"): string {
  return JSON.stringify({
    session_id: sessionId,
    cwd,
    transcript_path: "/home/user/.claude/projects/test/sess.jsonl",
    hook_event_name: "SessionStart",
    source: "startup",
    model: "claude-sonnet-4-6",
  });
}

describe("runSessionStart - first-run notice path", () => {
  test("returns notice containing 'First time using claude-gate' when config is null", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({
      socketPath,
      bootstrap: makeFirstRunBootstrap(),
    });

    const notice = await runSessionStart(validStdin(), {
      socketOverride: socketPath,
      activeSessionOverride: null,
    });

    expect(notice).not.toBeNull();
    expect(notice).toContain("First time using claude-gate");
  });
});

describe("runSessionStart - IPC unreachable", () => {
  test("returns null when IPC socket does not exist (no exception thrown)", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const nonExistentSocket = join(tmp.dir, "ghost.sock");

    const notice = await runSessionStart(validStdin(), {
      socketOverride: nonExistentSocket,
      activeSessionOverride: null,
    });

    expect(notice).toBeNull();
  });
});

describe("runSessionStart - malformed stdin", () => {
  test("returns null for malformed JSON", async () => {
    const notice = await runSessionStart("not-valid-json", {
      activeSessionOverride: null,
    });
    expect(notice).toBeNull();
  });

  test("returns null for empty string", async () => {
    const notice = await runSessionStart("", {
      activeSessionOverride: null,
    });
    expect(notice).toBeNull();
  });

  test("returns null when session_id is missing", async () => {
    const stdinWithoutSessionId = JSON.stringify({
      cwd: "/tmp/project",
      hook_event_name: "SessionStart",
    });
    const notice = await runSessionStart(stdinWithoutSessionId, {
      activeSessionOverride: null,
    });
    expect(notice).toBeNull();
  });

  test("returns null when cwd is missing", async () => {
    const stdinWithoutCwd = JSON.stringify({
      session_id: "sess_abc",
      hook_event_name: "SessionStart",
    });
    const notice = await runSessionStart(stdinWithoutCwd, {
      activeSessionOverride: null,
    });
    expect(notice).toBeNull();
  });
});

describe("runSessionStart - configured project (no notice)", () => {
  test("returns null when config is non-null (no first-run notice, no drift, no debug)", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");

    const bootstrap: BootstrapLike = {
      ...makeFirstRunBootstrap(),
      config: () => ({} as never), // non-null config => no first-run notice
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const notice = await runSessionStart(validStdin(), {
      socketOverride: socketPath,
      activeSessionOverride: null,
    });

    expect(notice).toBeNull();
  });
});

describe("runSessionStart - legacy server back-compat", () => {
  test("back-compat: reads rationale when notice_text is absent (pre-0.5 server)", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "legacy-gate.sock");

    // Spin up a minimal ad-hoc IPC server that responds with legacy shape (no notice_text)
    const { createServer } = await import("node:net");
    const { encodeFrame, FrameDecoder } = await import("../../src/ipc/framing.js");

    const legacyServer = createServer((client) => {
      const decoder = new FrameDecoder();

      decoder.on("message", (msg: unknown) => {
        const req = msg as Record<string, unknown>;
        // Respond with legacy shape: no notice_text field, rationale carries the notice text
        const legacyResp = {
          protocol_version: "1",
          request_id: req.request_id,
          decision: "ALLOW",
          rationale: "[claude-gate] legacy notice from pre-0.5 server",
        };
        client.write(encodeFrame(legacyResp));
      });

      decoder.on("error", () => {
        client.destroy();
      });

      client.on("data", (chunk: Buffer) => {
        decoder.feed(chunk);
      });

      client.on("error", () => {
        // ignore
      });
    });

    await new Promise<void>((resolve) => {
      legacyServer.listen(socketPath, () => resolve());
    });

    cleanupFns.push(() => {
      legacyServer.close();
    });

    const notice = await runSessionStart(validStdin(), {
      socketOverride: socketPath,
      activeSessionOverride: null,
    });

    expect(notice).toBe("[claude-gate] legacy notice from pre-0.5 server");
  });
});
