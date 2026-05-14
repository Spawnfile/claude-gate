import { describe, test, expect } from "vitest";
import {
  socketPathFor,
  fallbackLogPath,
  registryCachePath,
  DEFAULT_FAIL_POLICY,
  EXIT_ALLOW,
  EXIT_DENY,
  EXIT_ASK,
  IPC_TIMEOUT_MS,
  PROTOCOL_VERSION,
} from "../../src/hook/protocol";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

describe("hook protocol", () => {
  test("socketPathFor returns a deterministic path under tmpdir/claude-gate/", () => {
    expect(socketPathFor("sess_abc")).toBe(
      join(tmpdir(), "claude-gate", "sess_abc.sock"),
    );
  });

  test("socketPathFor uses the provided session id in the filename", () => {
    expect(socketPathFor("my-session-123")).toBe(
      join(tmpdir(), "claude-gate", "my-session-123.sock"),
    );
  });

  test("fallbackLogPath returns path under home/.claude/gate/", () => {
    expect(fallbackLogPath()).toBe(
      join(homedir(), ".claude", "gate", "hook-fallback.log"),
    );
  });

  test("registryCachePath returns path under home/.claude/gate/", () => {
    expect(registryCachePath()).toBe(
      join(homedir(), ".claude", "gate", "registry-cache.json"),
    );
  });

  test("default fail policy is closed for prod and unknown, open for dev and local", () => {
    expect(DEFAULT_FAIL_POLICY.prod).toBe("closed");
    expect(DEFAULT_FAIL_POLICY.dev).toBe("open");
    expect(DEFAULT_FAIL_POLICY.local).toBe("open");
    expect(DEFAULT_FAIL_POLICY.unknown).toBe("closed");
  });

  test("exit codes: EXIT_ALLOW is 0, EXIT_DENY is 2, EXIT_ASK is 2", () => {
    expect(EXIT_ALLOW).toBe(0);
    expect(EXIT_DENY).toBe(2);
    expect(EXIT_ASK).toBe(2);
  });

  test("IPC_TIMEOUT_MS is 500", () => {
    expect(IPC_TIMEOUT_MS).toBe(500);
  });

  test("PROTOCOL_VERSION is '1'", () => {
    expect(PROTOCOL_VERSION).toBe("1");
  });
});
