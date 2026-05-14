// mcp-server/src/discovery/drift.ts
//
// Drift detection for the Discovery Engine. Source of truth: design
// Section 6.5. Pure function; no I/O. The orchestrator (Task 10)
// is responsible for reading/writing the cache file.

import { createHash } from "node:crypto";
import type { Registry, RegistryResource } from "./registry.js";

export interface DriftReport {
  added: RegistryResource[];
  removed: RegistryResource[];
  changed: Array<{
    name: string;
    before: RegistryResource;
    after: RegistryResource;
  }>;
}

export function computeDrift(
  current: Registry,
  previous: Registry | null,
): DriftReport {
  const prev = new Map<string, RegistryResource>(
    (previous?.resources ?? []).map((r) => [r.name, r]),
  );
  const curr = new Map<string, RegistryResource>(
    current.resources.map((r) => [r.name, r]),
  );

  const added: RegistryResource[] = [];
  const removed: RegistryResource[] = [];
  const changed: DriftReport["changed"] = [];

  for (const [name, after] of curr) {
    const before = prev.get(name);
    if (!before) {
      added.push(after);
      continue;
    }
    if (resourceHash(before) !== resourceHash(after)) {
      changed.push({ name, before, after });
    }
  }

  for (const [name, before] of prev) {
    if (!curr.has(name)) removed.push(before);
  }

  added.sort((a, b) => a.name.localeCompare(b.name));
  removed.sort((a, b) => a.name.localeCompare(b.name));
  changed.sort((a, b) => a.name.localeCompare(b.name));

  return { added, removed, changed };
}

export function registryHash(reg: Registry): string {
  return createHash("sha256")
    .update(canonicalJson(reg))
    .digest("hex");
}

function resourceHash(r: RegistryResource): string {
  return createHash("sha256").update(canonicalJson(r)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
