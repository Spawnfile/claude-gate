// mcp-server/tests/audit/verify.test.ts
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAuditWriter } from "../../src/audit/jsonl";
import { verifyChain } from "../../src/audit/verify";
import type { AuditEntry } from "../../src/audit/types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-verify-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entry(o: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: "2026-05-11T10:00:00.000Z",
    session_id: "s",
    tool: "Bash",
    resource: null,
    env: null,
    risk: "UNRATED",
    decision: "ALLOW",
    rationale: "x",
    params_hash: "sha256:0",
    policy_mode: null,
    session_state: { mode: "interactive", active_batch_tokens: [] },
    stage_trace: { match_ms: 0, parse_ms: 0, classify_ms: 0, policy_ms: 0, total_ms: 0 },
    prev_hash: "",
    this_hash: "",
    ...o,
  };
}

describe("verifyChain", () => {
  test("reports INTACT for a freshly written chain", () => {
    const p = join(dir, "audit.jsonl");
    const w = createAuditWriter({ path: p });
    w.append(entry());
    w.append(entry({ decision: "DENY" }));
    w.append(entry());
    w.close();

    const r = verifyChain(p);
    expect(r.status).toBe("INTACT");
    expect(r.entries).toBe(3);
  });

  test("reports BROKEN with line index when an entry is tampered", () => {
    const p = join(dir, "audit.jsonl");
    const w = createAuditWriter({ path: p });
    w.append(entry());
    w.append(entry({ decision: "ALLOW" }));
    w.append(entry());
    w.close();

    // Tamper line 2.
    const lines = readFileSync(p, "utf-8").trim().split("\n");
    const parsed = JSON.parse(lines[1]!);
    parsed.decision = "DENY";
    lines[1] = JSON.stringify(parsed);
    writeFileSync(p, lines.join("\n") + "\n");

    const r = verifyChain(p);
    expect(r.status).toBe("BROKEN");
    expect(r.broken_at_line).toBe(2);
  });

  test("reports BROKEN if a line is removed", () => {
    const p = join(dir, "audit.jsonl");
    const w = createAuditWriter({ path: p });
    for (let i = 0; i < 4; i++) w.append(entry({ rationale: `r${i}` }));
    w.close();

    const lines = readFileSync(p, "utf-8").trim().split("\n");
    lines.splice(2, 1);
    writeFileSync(p, lines.join("\n") + "\n");

    const r = verifyChain(p);
    expect(r.status).toBe("BROKEN");
  });
});
