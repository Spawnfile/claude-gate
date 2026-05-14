// mcp-server/src/debug/fixture.ts
//
// Discovery fixture runner. Runs the standard env + mcp-config scanners
// against an arbitrary directory path. Uses a tmpdir for the cache so it
// does not pollute any project state.

import { runDiscovery } from "../discovery/index.js";
import { envScanner } from "../discovery/scanners/env-scanner.js";
import { createMcpConfigScanner } from "../discovery/scanners/mcp-config-scanner.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureResource {
  name: string;
  env: string;
  confidence: number;
}

export interface FixtureResult {
  resources: FixtureResource[];
}

export async function runFixture(path: string): Promise<FixtureResult> {
  const cacheDir = mkdtempSync(join(tmpdir(), "cg-fixture-"));
  try {
    const result = await runDiscovery({
      projectRoot: path,
      scanners: [envScanner, createMcpConfigScanner()],
      cachePath: join(cacheDir, "registry-cache.json"),
    });
    return {
      resources: result.registry.resources.map((r) => ({
        name: r.name,
        env: r.env,
        confidence: r.confidence,
      })),
    };
  } finally {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
