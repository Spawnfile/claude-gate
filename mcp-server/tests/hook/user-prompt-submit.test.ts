// mcp-server/tests/hook/user-prompt-submit.test.ts
//
// Tests for the UserPromptSubmit hook entry point.
// Mirrors the structure of tests/hook/session-start.test.ts.

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { startIpcServer, type IpcServer, type BootstrapLike } from "../../src/ipc/server";
import { makeTmpDir } from "../helpers/tmpdir";
import { createSessionState } from "../../src/policy/session";
import { runUserPromptSubmit } from "../../src/hook/user-prompt-submit";
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
    session_id: "sess_ups_test",
    databases: () => [] as DatabaseConfig[],
    rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
    session: () => createSessionState("sess_ups_test"),
    audit: () => stubAudit,
    config: () => null, // first-run: no config
    debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] },
    reload: () => {},
  };
}

function validStdin(sessionId: string, cwd = "/tmp/project"): string {
  return JSON.stringify({
    session_id: sessionId,
    cwd,
    hook_event_name: "UserPromptSubmit",
    prompt: "What is the capital of France?",
  });
}

describe("runUserPromptSubmit - first-run one-shot semantics", () => {
  test("first call returns first-run notice; second call does not include first-run section", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({
      socketPath,
      bootstrap: makeFirstRunBootstrap(),
    });

    const sessionId = `sess_ups_fr_${Date.now().toString(36)}`;

    // First call: should include first-run notice
    const notice1 = await runUserPromptSubmit(validStdin(sessionId), {
      socketOverride: socketPath,
      activeSessionOverride: null,
    });

    expect(notice1).not.toBeNull();
    expect(notice1).toContain("First time using claude-gate");

    // Second call: should NOT include the first-run notice
    const notice2 = await runUserPromptSubmit(validStdin(sessionId), {
      socketOverride: socketPath,
      activeSessionOverride: null,
    });

    if (notice2 !== null) {
      expect(notice2).not.toContain("First time using claude-gate");
    }
    // null is also acceptable (no notice at all on second call)
  });
});

describe("runUserPromptSubmit - debug banner repeats", () => {
  test("debug banner appears on every call when debugState.active is true", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");

    const expiresMs = Date.now() + 60 * 60_000;

    const bootstrap: BootstrapLike = {
      ...makeFirstRunBootstrap(),
      config: () => ({} as never), // non-null config => no first-run
      debugState: {
        active: true,
        expires_at_ms: expiresMs,
        intercept_patterns: [],
      },
    };

    server = await startIpcServer({ socketPath, bootstrap });

    const sessionId = `sess_ups_dbg_${Date.now().toString(36)}`;

    // First call: debug banner present
    const notice1 = await runUserPromptSubmit(validStdin(sessionId), {
      socketOverride: socketPath,
      activeSessionOverride: null,
    });
    expect(notice1).not.toBeNull();
    expect(notice1).toContain("GATE DEBUG MODE");

    // Second call: debug banner must appear again
    const notice2 = await runUserPromptSubmit(validStdin(sessionId), {
      socketOverride: socketPath,
      activeSessionOverride: null,
    });
    expect(notice2).not.toBeNull();
    expect(notice2).toContain("GATE DEBUG MODE");
  });
});

describe("runUserPromptSubmit - malformed stdin", () => {
  test("returns null for malformed JSON", async () => {
    const notice = await runUserPromptSubmit("not-valid-json", {
      activeSessionOverride: null,
    });
    expect(notice).toBeNull();
  });

  test("returns null for empty string", async () => {
    const notice = await runUserPromptSubmit("", {
      activeSessionOverride: null,
    });
    expect(notice).toBeNull();
  });

  test("returns null when session_id is missing", async () => {
    const notice = await runUserPromptSubmit(
      JSON.stringify({ cwd: "/tmp/project", hook_event_name: "UserPromptSubmit" }),
      { activeSessionOverride: null },
    );
    expect(notice).toBeNull();
  });
});
