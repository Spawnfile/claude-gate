// mcp-server/src/discovery/registry.ts
//
// Registry resolver: dedup + classify + name. Source of truth: design
// Section 6.4. Pure function; no I/O.

import { createHash } from "node:crypto";
import type {
  RawDetection,
  DetectionType,
  DetectionSource,
  InferredEnv,
} from "./scanner.js";
import { classifyOne, aggregateClassifications } from "./classifier.js";

export interface RegistryResource {
  name: string;
  type: DetectionType;
  endpoint: string;
  env: InferredEnv;
  confidence: number;
  discovered_from: DetectionSource[];
}

export interface Registry {
  resources: RegistryResource[];
}

const DEFAULT_PORTS: Record<DetectionType, number | null> = {
  postgres: 5432,
  mysql: 3306,
  mongodb: 27017,
  redis: 6379,
  supabase: 443,
  sqlite: null,
  generic: null,
};

export function resolveRegistry(detections: RawDetection[]): Registry {
  const groups = new Map<string, RawDetection[]>();
  for (const det of detections) {
    const key = groupKey(det);
    const arr = groups.get(key) ?? [];
    arr.push(det);
    groups.set(key, arr);
  }

  const resources: RegistryResource[] = [];
  for (const [, group] of groups) {
    const cls = aggregateClassifications(group.map((d) => classifyOne(d)));
    const type = group[0]!.type;
    const endpoint = pickCanonicalEndpoint(group);
    const name = nameFor(type, cls.env, endpoint);
    if (
      !Number.isFinite(cls.confidence) ||
      cls.confidence < 0 ||
      cls.confidence > 1
    ) {
      throw new Error(
        `registry: confidence ${cls.confidence} for resource ${name} is outside [0,1]`,
      );
    }
    resources.push({
      name,
      type,
      endpoint,
      env: cls.env,
      confidence: cls.confidence,
      discovered_from: group.map((d) => d.source),
    });
  }

  resources.sort((a, b) => a.name.localeCompare(b.name));
  return { resources };
}

function groupKey(det: RawDetection): string {
  return `${det.type}|${normalizeEndpoint(det.type, det.endpoint)}`;
}

function normalizeEndpoint(type: DetectionType, endpoint: string): string {
  const lower = endpoint.toLowerCase();
  const def = DEFAULT_PORTS[type];
  if (def === null) return lower;
  const idx = lower.lastIndexOf(":");
  if (idx === -1) return lower;
  const tail = lower.slice(idx + 1);
  if (/^\d+$/.test(tail) && Number(tail) === def) {
    return lower.slice(0, idx);
  }
  return lower;
}

function pickCanonicalEndpoint(group: RawDetection[]): string {
  const withPort = group.find((d) => /:\d+$/.test(d.endpoint));
  return (withPort ?? group[0]!).endpoint.toLowerCase();
}

function nameFor(
  type: DetectionType,
  env: InferredEnv,
  endpoint: string,
): string {
  if (env !== "unknown") return `${type}_${env}`;
  const h = createHash("sha256").update(endpoint).digest("hex").slice(0, 6);
  return `${type}_unknown_${h}`;
}
