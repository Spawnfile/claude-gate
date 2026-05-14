// mcp-server/tests/audit/jsonl.test.ts
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAuditWriter } from "../../src/audit/jsonl";
import type { AuditEntry } from "../../src/audit/types";
import { GENESIS_HASH } from "../../src/audit/hash-chain";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-audit-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: "2026-05-11T10:00:00.000Z",
    session_id: "sess",
    tool: "Bash",
    resource: null,
    env: null,
    risk: "UNRATED",
    decision: "ALLOW",
    rationale: "no resource matched",
    params_hash: "sha256:0",
    policy_mode: null,
    session_state: { mode: "interactive", active_batch_tokens: [] },
    stage_trace: { match_ms: 0, parse_ms: 0, classify_ms: 0, policy_ms: 0, total_ms: 0 },
    prev_hash: "",
    this_hash: "",
    ...overrides,
  };
}

describe("createAuditWriter", () => {
  test("appends a JSON line with hash chain linkage", () => {
    const w = createAuditWriter({ path: join(dir, "audit.jsonl") });
    w.append(entry({ decision: "ALLOW" }));
    w.append(entry({ decision: "DENY" }));
    w.close();

    const lines = readFileSync(join(dir, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines.length).toBe(2);
    const e1 = JSON.parse(lines[0]!);
    const e2 = JSON.parse(lines[1]!);
    expect(e1.prev_hash).toBe(GENESIS_HASH);
    expect(e1.this_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e2.prev_hash).toBe(e1.this_hash);
  });

  test("creates the parent directory if missing", () => {
    const p = join(dir, "nested", "deep", "audit.jsonl");
    const w = createAuditWriter({ path: p });
    w.append(entry());
    w.close();
    expect(existsSync(p)).toBe(true);
  });

  test("rotates when the file grows past the size threshold", () => {
    const p = join(dir, "audit.jsonl");
    const w = createAuditWriter({
      path: p,
      maxBytes: 200,
      now: () => Date.parse("2026-05-11T11:00:00Z"),
    });
    for (let i = 0; i < 10; i++) {
      w.append(entry({ rationale: `large ratio ${"x".repeat(50)} ${i}` }));
    }
    w.close();

    const files = readdirSync(dir);
    const archived = files.filter((f) => f.includes(".archived"));
    expect(archived.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(p)).toBe(true);
  });

  test("rotation preserves the cross-file hash chain", () => {
    const p = join(dir, "audit.jsonl");
    const w = createAuditWriter({
      path: p,
      maxBytes: 200,
      now: () => Date.parse("2026-05-11T11:00:00Z"),
    });
    for (let i = 0; i < 8; i++) {
      w.append(entry({ rationale: `pad ${"x".repeat(60)} ${i}` }));
    }
    w.close();

    const archived = readdirSync(dir).find((f) => f.endsWith(".archived"));
    expect(archived).toBeDefined();
    const arcLines = readFileSync(join(dir, archived!), "utf-8")
      .trim()
      .split("\n");
    const lastArc = JSON.parse(arcLines.at(-1)!);

    const newLines = readFileSync(p, "utf-8").trim().split("\n");
    const first = JSON.parse(newLines[0]!);
    expect(first.type).toBe("rotation");
    expect(first.prev_final_hash).toBe(lastArc.this_hash);

    if (newLines.length > 1) {
      const second = JSON.parse(newLines[1]!);
      expect(second.prev_hash).toBe(first.this_hash);
    }
  });
});
