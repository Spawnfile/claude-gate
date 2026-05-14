// mcp-server/src/audit/verify.ts
//
// Walks an audit.jsonl file and verifies that every entry's
// this_hash equals computeThisHash(entry-minus-this_hash, prev_hash).

import { existsSync, readFileSync } from "node:fs";
import { computeThisHash, GENESIS_HASH } from "./hash-chain.js";

export interface VerifyResult {
  status: "INTACT" | "BROKEN" | "EMPTY" | "NOT_FOUND";
  entries: number;
  broken_at_line?: number;
  reason?: string;
}

export function verifyChain(path: string): VerifyResult {
  if (!existsSync(path)) return { status: "NOT_FOUND", entries: 0 };

  const raw = readFileSync(path, "utf-8").trim();
  if (raw.length === 0) return { status: "EMPTY", entries: 0 };

  const lines = raw.split("\n");
  let prev = GENESIS_HASH;

  for (let i = 0; i < lines.length; i++) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch (e) {
      return {
        status: "BROKEN",
        entries: i,
        broken_at_line: i + 1,
        reason: `parse error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (parsed["prev_hash"] !== prev) {
      return {
        status: "BROKEN",
        entries: i,
        broken_at_line: i + 1,
        reason: "prev_hash mismatch",
      };
    }

    const claimed = parsed["this_hash"];
    const recomputed = computeThisHash(parsed, prev);
    if (claimed !== recomputed) {
      return {
        status: "BROKEN",
        entries: i,
        broken_at_line: i + 1,
        reason: "this_hash mismatch",
      };
    }

    prev = String(claimed);
  }

  return { status: "INTACT", entries: lines.length };
}
