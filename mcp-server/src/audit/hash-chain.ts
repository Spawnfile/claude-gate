// mcp-server/src/audit/hash-chain.ts
//
// Computes this_hash = SHA256( canonical_json(entry minus this_hash)
// || prev_hash ). Source of truth: design 4.2 + Gap 8.

import { createHash } from "node:crypto";
import { canonicalJson } from "./redact.js";

export const GENESIS_HASH = "0".repeat(64);

type AnyEntry = Record<string, unknown> & { this_hash?: string };

export function computeThisHash(entry: AnyEntry, prevHash: string): string {
  const { this_hash: _omit, ...rest } = entry;
  const payload = canonicalJson(rest) + "|" + prevHash;
  return createHash("sha256").update(payload).digest("hex");
}
