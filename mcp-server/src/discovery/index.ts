// mcp-server/src/discovery/index.ts
//
// Discovery orchestrator. Public entry point: runDiscovery().
// Source of truth: design Sections 6.4 + 6.5.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Scanner, RawDetection } from "./scanner.js";
import { resolveRegistry, type Registry } from "./registry.js";
import { computeDrift, type DriftReport } from "./drift.js";
import { warn } from "../log.js";

export interface RunDiscoveryOpts {
  projectRoot: string;
  scanners: Scanner[];
  cachePath: string;
}

export interface ScanMetadata {
  scan_ms: number;
  scanner_count: number;
  scanner_errors: Array<{ scanner: string; message: string }>;
}

export interface DiscoveryResult {
  registry: Registry;
  drift: DriftReport;
  scan_metadata: ScanMetadata;
}

interface CacheFile {
  version: 1;
  updated_at: string;
  resources: Registry["resources"];
}

export async function runDiscovery(
  opts: RunDiscoveryOpts,
): Promise<DiscoveryResult> {
  const start = Date.now();
  const errors: ScanMetadata["scanner_errors"] = [];

  const settled = await Promise.all(
    opts.scanners.map(async (s) => {
      try {
        return await s.scan(opts.projectRoot);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warn(`scanner ${s.name} failed: ${msg}`);
        errors.push({ scanner: s.name, message: msg });
        return [] as RawDetection[];
      }
    }),
  );

  const detections = settled.flat();
  const registry = resolveRegistry(detections);

  const previous = readCache(opts.cachePath);
  const drift = computeDrift(registry, previous);

  writeCache(opts.cachePath, registry);

  return {
    registry,
    drift,
    scan_metadata: {
      scan_ms: Date.now() - start,
      scanner_count: opts.scanners.length,
      scanner_errors: errors,
    },
  };
}

function readCache(path: string): Registry | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as CacheFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.resources)) return null;
    return { resources: parsed.resources };
  } catch (e) {
    warn(`could not parse cache at ${path}: ${String(e)}`);
    return null;
  }
}

function writeCache(path: string, registry: Registry): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file: CacheFile = {
    version: 1,
    updated_at: new Date().toISOString(),
    resources: registry.resources,
  };
  writeFileSync(path, JSON.stringify(file, null, 2), "utf-8");
}
