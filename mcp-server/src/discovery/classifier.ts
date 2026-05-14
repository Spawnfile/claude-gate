// mcp-server/src/discovery/classifier.ts
//
// Environment classification for the Discovery Engine.
// Source of truth: design doc Section 6.3 (per-detection) and 6.4
// (aggregation across deduped sources).

import type { RawDetection, InferredEnv } from "./scanner.js";

export type Signal = "filename" | "hostname" | "string-match" | "localhost" | "none";

export interface Classification {
  env: InferredEnv;
  confidence: number;
  signal: Signal;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function classifyOne(det: RawDetection): Classification {
  // Priority 1: filename signal already attached by scanner.
  if (det.inferred_env && det.inferred_env !== "unknown") {
    const conf = det.inferred_env_confidence ?? 0.7;
    return { env: det.inferred_env, confidence: conf, signal: "filename" };
  }

  const ep = det.endpoint.toLowerCase();
  const host = ep.split(":")[0] ?? ep;

  // Priority 2: localhost (checked before string-match because some
  // vendor URL templates incorrectly include "dev" or "test" in
  // localhost-pointing URLs).
  if (LOCAL_HOSTS.has(host)) {
    return { env: "local", confidence: 0.85, signal: "localhost" };
  }

  // Priority 3: string-match in endpoint or raw value.
  const blob = `${det.endpoint} ${det.raw_value}`.toLowerCase();
  if (/\b(prod|production|live)\b/.test(blob) || /(^|[^a-z])prod[a-z0-9]/.test(blob)) {
    return { env: "prod", confidence: 0.5, signal: "string-match" };
  }
  if (/\b(dev|development|staging|test)\b/.test(blob) || /(^|[^a-z])(dev|staging|test)[a-z0-9]/.test(blob)) {
    return { env: "dev", confidence: 0.5, signal: "string-match" };
  }

  return { env: "unknown", confidence: 0, signal: "none" };
}

export function aggregateClassifications(
  cs: Classification[],
): Classification {
  if (cs.length === 0) {
    return { env: "unknown", confidence: 0, signal: "none" };
  }

  const byEnv = new Map<InferredEnv, Classification[]>();
  for (const c of cs) {
    if (c.env === "unknown") continue;
    const arr = byEnv.get(c.env) ?? [];
    arr.push(c);
    byEnv.set(c.env, arr);
  }

  if (byEnv.size === 0) {
    return { env: "unknown", confidence: 0, signal: "none" };
  }
  if (byEnv.size > 1) {
    return { env: "unknown", confidence: 0, signal: "none" };
  }

  const [env, group] = [...byEnv.entries()][0]!;
  const n = group.length;
  let confidence: number;
  if (n >= 3) confidence = 0.95;
  else if (n === 2) confidence = 0.85;
  else confidence = group[0]!.confidence;

  return { env, confidence, signal: group[0]!.signal };
}
