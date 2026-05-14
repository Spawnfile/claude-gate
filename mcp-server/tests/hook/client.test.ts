import { describe, test, expect, afterEach } from "vitest";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { startIpcServer, type IpcServer } from "../../src/ipc/server";
import { makeTmpDir } from "../helpers/tmpdir";
import { createSessionState } from "../../src/policy/session";
import { loadRulePackRegistry } from "../../src/policy/rule-pack-loader";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";
import type { DatabaseConfig } from "../../src/config/schema";
import { runHook } from "../../src/hook/client";

const repoRoot = resolve(__dirname, "../../..");

// Shared cleanup
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

// Stub audit writer
const stubAudit = { append: () => {}, close: () => {} };

// Empty bootstrap for ALLOW tests
function makeEmptyBootstrap(tmpDir: string) {
  return {
    project_root: tmpDir,
    session_id: "sess_test",
    databases: () => [] as DatabaseConfig[],
    rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
    session: () => createSessionState("sess_test"),
    audit: () => stubAudit,
    config: () => null,
    debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] },
    reload: () => {},
    close: () => {},
  };
}

// Bootstrap with a prod-strict DB for DENY tests
function makeProdStrictBootstrap(tmpDir: string) {
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
  const rulePacks = loadRulePackRegistry({
    rulesDir: join(repoRoot, "rules"),
    pinned: {},
  });
  return {
    project_root: tmpDir,
    session_id: "sess_deny",
    databases: () => [prodDb],
    rule_packs: () => rulePacks,
    session: () => createSessionState("sess_deny"),
    audit: () => stubAudit,
    config: () => null,
    debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] },
    reload: () => {},
    close: () => {},
  };
}

// Bootstrap with a confirm-policy DB for ASK tests (UPDATE with WHERE => MED risk => ASK)
function makeConfirmBootstrap(tmpDir: string) {
  const confirmDb: DatabaseConfig = {
    name: "supabase_confirm",
    matchers: [
      { tool: "mcp__plugin_*_supabase_confirm__*", mcp_server_id: "supabase_confirm" },
    ],
    env: "prod",
    policy: "confirm",
    confidence: 0.99,
    discovered_from: [],
  };
  const rulePacks = loadRulePackRegistry({
    rulesDir: join(repoRoot, "rules"),
    pinned: {},
  });
  return {
    project_root: tmpDir,
    session_id: "sess_ask",
    databases: () => [confirmDb],
    rule_packs: () => rulePacks,
    session: () => createSessionState("sess_ask"),
    audit: () => stubAudit,
    config: () => null,
    debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] },
    reload: () => {},
    close: () => {},
  };
}

function bashEnvelope(sessionId = "sess_test", socketOverride?: string) {
  return {
    stdinJson: JSON.stringify({
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_use_id: "toolu_test001",
      cwd: "/tmp/test",
      permission_mode: "auto",
      hook_event_name: "PreToolUse",
    }),
    socketOverride,
    activeSessionOverride: null as null | undefined,
  };
}

describe("runHook - ALLOW path", () => {
  test("returns exitCode 0 for Bash call when no databases are configured", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");
    server = await startIpcServer({ socketPath, bootstrap: makeEmptyBootstrap(tmp.dir) });

    const result = await runHook({
      ...bashEnvelope("sess_test", socketPath),
      activeSessionOverride: null,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBeUndefined();
    expect(result.stdout).toBeUndefined();
  });
});

describe("runHook - DENY path", () => {
  test("returns exitCode 2 and stderr with BLOCKED for DROP TABLE on prod-strict DB", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");
    server = await startIpcServer({ socketPath, bootstrap: makeProdStrictBootstrap(tmp.dir) });

    const result = await runHook({
      stdinJson: JSON.stringify({
        session_id: "sess_deny",
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        tool_input: { query: "DROP TABLE customers" },
        tool_use_id: "toolu_deny001",
        cwd: "/tmp/test",
        permission_mode: "auto",
      }),
      socketOverride: socketPath,
      activeSessionOverride: null,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("BLOCKED");
  });
});

describe("runHook - ASK path (interactive prompt in v0.5)", () => {
  test("emits hookSpecificOutput JSON on stdout with permissionDecision=ask, exit code 0", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");
    server = await startIpcServer({
      socketPath,
      bootstrap: makeConfirmBootstrap(tmp.dir),
    });

    const result = await runHook({
      stdinJson: JSON.stringify({
        session_id: "sess_ask",
        tool_name: "mcp__plugin_claude-gate_supabase_confirm__execute_sql",
        tool_input: { query: "UPDATE orders SET status = 'shipped' WHERE id = 42" },
        tool_use_id: "toolu_ask001",
        cwd: "/tmp/test",
        permission_mode: "auto",
      }),
      socketOverride: socketPath,
      activeSessionOverride: null,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeDefined();
    const parsed = JSON.parse(result.stdout!) as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(parsed.hookSpecificOutput.permissionDecisionReason.length).toBeGreaterThan(0);
  });
});

describe("runHook - IPC unreachable fallbacks", () => {
  test("IPC unreachable + empty cache: falls back to unknown env => DENY, stderr contains unreachable", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const nonExistentSocket = join(tmp.dir, "ghost.sock");
    const nonExistentCache = join(tmp.dir, "no-cache.json");
    const logPath = join(tmp.dir, "fallback.log");

    const result = await runHook({
      stdinJson: JSON.stringify({
        session_id: "sess_fallback",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_use_id: "toolu_fb001",
        cwd: "/tmp/test",
      }),
      socketOverride: nonExistentSocket,
      cachePathOverride: nonExistentCache,
      fallbackLogPathOverride: logPath,
      activeSessionOverride: null,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unreachable");
    expect(result.stderr).toContain("unknown");
  });

  test("IPC unreachable + cache hit on PROD: exit 2", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const nonExistentSocket = join(tmp.dir, "ghost.sock");
    const cachePath = join(tmp.dir, "registry-cache.json");
    const logPath = join(tmp.dir, "fallback.log");

    writeFileSync(
      cachePath,
      JSON.stringify({
        version: 1,
        updated_at: "2026-01-01T00:00:00Z",
        resources: [
          {
            name: "supabase_prod",
            matchers: [{ mcp_server_id: "supabase_prod" }],
            env: "prod",
            policy: "strict",
          },
        ],
      }),
    );

    const result = await runHook({
      stdinJson: JSON.stringify({
        session_id: "sess_fallback",
        tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
        tool_input: { query: "SELECT 1" },
        tool_use_id: "toolu_fb002",
        cwd: "/tmp/test",
      }),
      socketOverride: nonExistentSocket,
      cachePathOverride: cachePath,
      fallbackLogPathOverride: logPath,
      activeSessionOverride: null,
    });

    expect(result.exitCode).toBe(2);
  });

  test("IPC unreachable + cache hit on DEV: exit 0 (open policy)", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const nonExistentSocket = join(tmp.dir, "ghost.sock");
    const cachePath = join(tmp.dir, "registry-cache.json");
    const logPath = join(tmp.dir, "fallback.log");

    // Use a tool-glob matcher so the cache lookup works regardless of mcp_server_id
    // derivation (server names with underscores are not parseable by the existing regex).
    writeFileSync(
      cachePath,
      JSON.stringify({
        version: 1,
        updated_at: "2026-01-01T00:00:00Z",
        resources: [
          {
            name: "supabase-dev",
            matchers: [{ tool: "mcp__plugin_*_supabase-dev__*" }],
            env: "dev",
            policy: "confirm",
          },
        ],
      }),
    );

    const result = await runHook({
      stdinJson: JSON.stringify({
        session_id: "sess_fallback",
        tool_name: "mcp__plugin_claude-gate_supabase-dev__execute_sql",
        tool_input: { query: "SELECT 1" },
        tool_use_id: "toolu_fb003",
        cwd: "/tmp/test",
      }),
      socketOverride: nonExistentSocket,
      cachePathOverride: cachePath,
      fallbackLogPathOverride: logPath,
      activeSessionOverride: null,
    });

    expect(result.exitCode).toBe(0);
  });

  test("IPC unreachable + cache hit on LOCAL: exit 0 (open policy)", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const nonExistentSocket = join(tmp.dir, "ghost.sock");
    const cachePath = join(tmp.dir, "registry-cache.json");
    const logPath = join(tmp.dir, "fallback.log");

    // Use hyphenated server name to avoid underscore-in-server-name parsing limitation.
    writeFileSync(
      cachePath,
      JSON.stringify({
        version: 1,
        updated_at: "2026-01-01T00:00:00Z",
        resources: [
          {
            name: "local-db",
            matchers: [{ tool: "mcp__plugin_*_local-db__*" }],
            env: "local",
            policy: "confirm",
          },
        ],
      }),
    );

    const result = await runHook({
      stdinJson: JSON.stringify({
        session_id: "sess_fallback",
        tool_name: "mcp__plugin_claude-gate_local-db__query",
        tool_input: { query: "SELECT 1" },
        tool_use_id: "toolu_fb004",
        cwd: "/tmp/test",
      }),
      socketOverride: nonExistentSocket,
      cachePathOverride: cachePath,
      fallbackLogPathOverride: logPath,
      activeSessionOverride: null,
    });

    expect(result.exitCode).toBe(0);
  });

  test("IPC unreachable: fallback log accumulates entries", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const nonExistentSocket = join(tmp.dir, "ghost.sock");
    const nonExistentCache = join(tmp.dir, "no-cache.json");
    const logPath = join(tmp.dir, "fallback.log");

    for (let i = 0; i < 2; i++) {
      await runHook({
        stdinJson: JSON.stringify({
          session_id: "sess_fallback",
          tool_name: "Bash",
          tool_input: { command: "ls" },
          tool_use_id: `toolu_log00${i}`,
          cwd: "/tmp/test",
        }),
        socketOverride: nonExistentSocket,
        cachePathOverride: nonExistentCache,
        fallbackLogPathOverride: logPath,
        activeSessionOverride: null,
      });
    }

    const { readFileSync } = await import("node:fs");
    const contents = readFileSync(logPath, "utf-8").trim();
    const lines = contents.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { tool: string; env: string };
      expect(parsed.tool).toBe("Bash");
      expect(parsed.env).toBe("unknown");
    }
  });
});

describe("runHook - malformed stdin", () => {
  test("empty string stdin returns exitCode 0 (do not break CC)", async () => {
    const result = await runHook({
      stdinJson: "",
      activeSessionOverride: null,
    });
    expect(result.exitCode).toBe(0);
  });

  test("non-JSON stdin returns exitCode 0 (do not break CC)", async () => {
    const result = await runHook({
      stdinJson: "not-json-at-all",
      activeSessionOverride: null,
    });
    expect(result.exitCode).toBe(0);
  });

  test("JSON missing required fields returns exitCode 0 (do not break CC)", async () => {
    const result = await runHook({
      stdinJson: JSON.stringify({ some: "data" }),
      activeSessionOverride: null,
    });
    expect(result.exitCode).toBe(0);
  });
});

describe("runHook - activeSessionOverride seam", () => {
  test("uses activeSessionOverride socket_path when provided", async () => {
    const tmp = makeTmpDir();
    cleanupFns.push(tmp.cleanup);
    const socketPath = join(tmp.dir, "gate.sock");
    server = await startIpcServer({ socketPath, bootstrap: makeEmptyBootstrap(tmp.dir) });

    const result = await runHook({
      stdinJson: JSON.stringify({
        session_id: "sess_test",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_use_id: "toolu_as001",
        cwd: "/tmp/test",
      }),
      // no socketOverride; instead provide activeSessionOverride
      activeSessionOverride: { socket_path: socketPath },
    });

    expect(result.exitCode).toBe(0);
  });
});
