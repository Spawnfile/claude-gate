import { describe, test, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFallback, type FallbackEntry } from "../../src/hook/fallback-log";

function makeTmpDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cg-fblog-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("appendFallback", () => {
  test("creates the file and writes two valid JSONL entries", () => {
    const tmp = makeTmpDir();
    try {
      const logPath = join(tmp.dir, "sub", "hook-fallback.log");

      const entry1: FallbackEntry = {
        ts: "2026-01-01T00:00:00.000Z",
        tool: "mcp__plugin_x_supabase_prod__execute_sql",
        mcp_server_id: "supabase_prod",
        env: "prod",
        decision: "DENY",
        reason: "ipc timeout after 500ms",
      };
      const entry2: FallbackEntry = {
        ts: "2026-01-01T00:00:01.000Z",
        tool: "Bash",
        mcp_server_id: null,
        env: "unknown",
        decision: "DENY",
        reason: "connect ENOENT /tmp/claude-gate/sess.sock",
      };

      appendFallback(logPath, entry1);
      appendFallback(logPath, entry2);

      const contents = readFileSync(logPath, "utf-8");
      const lines = contents.trim().split("\n");
      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]!) as FallbackEntry;
      const parsed2 = JSON.parse(lines[1]!) as FallbackEntry;

      expect(parsed1.tool).toBe("mcp__plugin_x_supabase_prod__execute_sql");
      expect(parsed1.env).toBe("prod");
      expect(parsed1.decision).toBe("DENY");
      expect(parsed1.mcp_server_id).toBe("supabase_prod");

      expect(parsed2.tool).toBe("Bash");
      expect(parsed2.env).toBe("unknown");
      expect(parsed2.decision).toBe("DENY");
      expect(parsed2.mcp_server_id).toBeNull();
    } finally {
      tmp.cleanup();
    }
  });

  test("creates parent directories automatically", () => {
    const tmp = makeTmpDir();
    try {
      const logPath = join(tmp.dir, "deeply", "nested", "dir", "fallback.log");
      const entry: FallbackEntry = {
        ts: "2026-01-01T00:00:00.000Z",
        tool: "Bash",
        mcp_server_id: null,
        env: "unknown",
        decision: "DENY",
        reason: "test",
      };
      appendFallback(logPath, entry);

      const contents = readFileSync(logPath, "utf-8");
      expect(contents.trim()).toContain("Bash");
    } finally {
      tmp.cleanup();
    }
  });

  test("does not throw when path is not writable (swallowed silently)", () => {
    // Pass a path that will fail (invalid path with null byte)
    // The function must NOT throw; it swallows errors silently.
    expect(() =>
      appendFallback("/proc/1/mem/cannot-write-here/log.jsonl", {
        ts: "2026-01-01T00:00:00Z",
        tool: "Bash",
        mcp_server_id: null,
        env: "unknown",
        decision: "DENY",
        reason: "test error swallow",
      }),
    ).not.toThrow();
  });
});
