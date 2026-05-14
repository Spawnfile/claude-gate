// mcp-server/src/audit/redact.ts
//
// Parameter redaction + content-hash. Source of truth: design 4.2
// (params_hash uses canonical JSON of redacted params).

import { createHash } from "node:crypto";

const SECRET_KEY_RE =
  /(password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|token|authorization|bearer|cookie|session[_-]?id|x[_-]?api[_-]?key)/i;

export function redactParameters(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return redact(input as Record<string, unknown>) as Record<string, unknown>;
}

function redact(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redact(x));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(val);
    }
  }
  return out;
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") +
    "}"
  );
}

export function hashParameters(input: unknown): string {
  const redacted = redactParameters(input);
  return (
    "sha256:" + createHash("sha256").update(canonicalJson(redacted)).digest("hex")
  );
}
