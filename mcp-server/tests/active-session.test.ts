import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeActiveSession,
  readActiveSession,
  clearActiveSession,
  type ActiveSession,
} from "../src/active-session";

// Each test gets its own tmpdir as home to avoid all side effects.
let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "cg-active-sess-"));
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
});

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    socket_path: join(testHome, "gate.sock"),
    session_id: "sess_test",
    project_root: "/home/user/project",
    started_at_ms: 1730000000000,
    ...overrides,
  };
}

describe("active-session", () => {
  test("roundtrip: write then read returns the same session", () => {
    const session = makeSession({ session_id: "sess_roundtrip" });

    writeActiveSession(session, testHome);
    const result = readActiveSession(testHome);

    expect(result).not.toBeNull();
    expect(result!.socket_path).toBe(session.socket_path);
    expect(result!.session_id).toBe(session.session_id);
    expect(result!.project_root).toBe(session.project_root);
    expect(result!.started_at_ms).toBe(session.started_at_ms);
  });

  test("readActiveSession returns null when file does not exist", () => {
    const result = readActiveSession(testHome);
    expect(result).toBeNull();
  });

  test("clearActiveSession removes the file", () => {
    const session = makeSession({ session_id: "sess_clear" });

    writeActiveSession(session, testHome);
    expect(readActiveSession(testHome)).not.toBeNull();

    clearActiveSession(testHome);
    expect(readActiveSession(testHome)).toBeNull();
  });

  test("clearActiveSession is a no-op when file does not exist", () => {
    // Should not throw when the file is missing.
    expect(() => clearActiveSession(testHome)).not.toThrow();
  });

  test("writeActiveSession creates the parent directory if absent", () => {
    const gateDir = join(testHome, ".claude", "gate");
    expect(existsSync(gateDir)).toBe(false);

    writeActiveSession(makeSession(), testHome);
    expect(existsSync(gateDir)).toBe(true);
  });
});
