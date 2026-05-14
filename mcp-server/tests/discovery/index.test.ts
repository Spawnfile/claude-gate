// mcp-server/tests/discovery/index.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir } from "../helpers/tmpdir";
import { runDiscovery } from "../../src/discovery";
import { envScanner } from "../../src/discovery/scanners/env-scanner";
import { createMcpConfigScanner } from "../../src/discovery/scanners/mcp-config-scanner";

let cleanupTmp: (() => void) | null = null;

afterEach(() => {
  if (cleanupTmp) {
    cleanupTmp();
    cleanupTmp = null;
  }
});

describe("runDiscovery", () => {
  test("end-to-end: detects supabase_prod, supabase_dev, redis_local", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    writeFileSync(
      join(tmp.dir, ".env.prod"),
      "SUPABASE_URL=https://prodabc.supabase.co\n",
    );
    writeFileSync(
      join(tmp.dir, ".env.dev"),
      "SUPABASE_URL=https://devxyz.supabase.co\n",
    );
    writeFileSync(
      join(tmp.dir, ".env"),
      "REDIS_URL=redis://localhost:6379\n",
    );

    mkdirSync(join(tmp.dir, ".claude-gate"), { recursive: true });
    const cache = join(tmp.dir, ".claude-gate", "registry-cache.json");

    const result = await runDiscovery({
      projectRoot: tmp.dir,
      scanners: [
        envScanner,
        createMcpConfigScanner({
          userClaudeJsonPath: join(tmp.dir, "_no_user_claude.json"),
        }),
      ],
      cachePath: cache,
    });

    const names = result.registry.resources.map((r) => r.name).sort();
    expect(names).toEqual(["redis_local", "supabase_dev", "supabase_prod"]);
    expect(result.drift.added.map((r) => r.name).sort()).toEqual(names);
    expect(result.drift.removed).toEqual([]);
    expect(result.drift.changed).toEqual([]);
    expect(result.scan_metadata.scanner_count).toBe(2);
    expect(result.scan_metadata.scan_ms).toBeGreaterThanOrEqual(0);
    expect(existsSync(cache)).toBe(true);
  });

  test("second run produces no drift when nothing changed", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    writeFileSync(
      join(tmp.dir, ".env"),
      "REDIS_URL=redis://localhost:6379\n",
    );
    mkdirSync(join(tmp.dir, ".claude-gate"), { recursive: true });
    const cache = join(tmp.dir, ".claude-gate", "registry-cache.json");

    await runDiscovery({
      projectRoot: tmp.dir,
      scanners: [envScanner],
      cachePath: cache,
    });
    const second = await runDiscovery({
      projectRoot: tmp.dir,
      scanners: [envScanner],
      cachePath: cache,
    });
    expect(second.drift.added).toEqual([]);
    expect(second.drift.removed).toEqual([]);
    expect(second.drift.changed).toEqual([]);
  });

  test("second run detects an added resource", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    writeFileSync(
      join(tmp.dir, ".env"),
      "REDIS_URL=redis://localhost:6379\n",
    );
    mkdirSync(join(tmp.dir, ".claude-gate"), { recursive: true });
    const cache = join(tmp.dir, ".claude-gate", "registry-cache.json");

    await runDiscovery({
      projectRoot: tmp.dir,
      scanners: [envScanner],
      cachePath: cache,
    });

    writeFileSync(
      join(tmp.dir, ".env.prod"),
      "SUPABASE_URL=https://prodabc.supabase.co\n",
    );

    const second = await runDiscovery({
      projectRoot: tmp.dir,
      scanners: [envScanner],
      cachePath: cache,
    });
    expect(second.drift.added.map((r) => r.name)).toEqual(["supabase_prod"]);
  });

  test("isolates a crashing scanner without failing the whole run", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    writeFileSync(
      join(tmp.dir, ".env"),
      "REDIS_URL=redis://localhost:6379\n",
    );
    mkdirSync(join(tmp.dir, ".claude-gate"), { recursive: true });
    const cache = join(tmp.dir, ".claude-gate", "registry-cache.json");

    const crashy = {
      name: "crashy",
      scan: async () => {
        throw new Error("boom");
      },
    };

    const result = await runDiscovery({
      projectRoot: tmp.dir,
      scanners: [envScanner, crashy],
      cachePath: cache,
    });

    expect(result.registry.resources.map((r) => r.name)).toContain(
      "redis_local",
    );
    expect(result.scan_metadata.scanner_errors).toHaveLength(1);
    expect(result.scan_metadata.scanner_errors[0]!.scanner).toBe("crashy");
  });

  test("written cache is parseable as a Registry", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    writeFileSync(
      join(tmp.dir, ".env"),
      "REDIS_URL=redis://localhost:6379\n",
    );
    mkdirSync(join(tmp.dir, ".claude-gate"), { recursive: true });
    const cache = join(tmp.dir, ".claude-gate", "registry-cache.json");

    await runDiscovery({
      projectRoot: tmp.dir,
      scanners: [envScanner],
      cachePath: cache,
    });
    const parsed = JSON.parse(readFileSync(cache, "utf-8")) as {
      version: number;
      updated_at: string;
      resources: unknown[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.resources).toHaveLength(1);
    expect(typeof parsed.updated_at).toBe("string");
  });
});
