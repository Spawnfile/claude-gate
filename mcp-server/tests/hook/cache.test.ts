import { describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCache,
  lookupEnv,
  fallbackDecision,
  type RegistryCache,
} from "../../src/hook/cache";

function makeTmpDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cg-cache-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeCacheFile(dir: string, cache: RegistryCache): string {
  const path = join(dir, "registry-cache.json");
  writeFileSync(path, JSON.stringify(cache), "utf-8");
  return path;
}

const PROD_CACHE: RegistryCache = {
  version: 1,
  updated_at: "2026-01-01T00:00:00Z",
  resources: [
    {
      name: "supabase_prod",
      matchers: [{ tool: "mcp__plugin_*_supabase_prod__*", mcp_server_id: "supabase_prod" }],
      env: "prod",
      policy: "strict",
    },
  ],
};

const DEV_CACHE: RegistryCache = {
  version: 1,
  updated_at: "2026-01-01T00:00:00Z",
  resources: [
    {
      name: "supabase_dev",
      matchers: [{ mcp_server_id: "supabase_dev" }],
      env: "dev",
      policy: "confirm",
    },
  ],
};

const LOCAL_CACHE: RegistryCache = {
  version: 1,
  updated_at: "2026-01-01T00:00:00Z",
  resources: [
    {
      name: "local_db",
      matchers: [{ tool: "mcp__plugin_*_local_db__*" }],
      env: "local",
      policy: "confirm",
    },
  ],
};

describe("readCache", () => {
  test("returns null when file does not exist", () => {
    expect(readCache("/tmp/does-not-exist-xyz.json")).toBeNull();
  });

  test("returns null when file contains invalid JSON", () => {
    const tmp = makeTmpDir();
    try {
      const path = join(tmp.dir, "bad.json");
      writeFileSync(path, "not-json", "utf-8");
      expect(readCache(path)).toBeNull();
    } finally {
      tmp.cleanup();
    }
  });

  test("returns null when version is not 1", () => {
    const tmp = makeTmpDir();
    try {
      const path = join(tmp.dir, "cache.json");
      writeFileSync(path, JSON.stringify({ version: 2, resources: [] }), "utf-8");
      expect(readCache(path)).toBeNull();
    } finally {
      tmp.cleanup();
    }
  });

  test("returns null when resources is not an array", () => {
    const tmp = makeTmpDir();
    try {
      const path = join(tmp.dir, "cache.json");
      writeFileSync(path, JSON.stringify({ version: 1, resources: "bad" }), "utf-8");
      expect(readCache(path)).toBeNull();
    } finally {
      tmp.cleanup();
    }
  });

  test("parses a valid cache file", () => {
    const tmp = makeTmpDir();
    try {
      const path = writeCacheFile(tmp.dir, PROD_CACHE);
      const cache = readCache(path);
      expect(cache).not.toBeNull();
      expect(cache?.resources).toHaveLength(1);
      expect(cache?.resources[0]?.name).toBe("supabase_prod");
    } finally {
      tmp.cleanup();
    }
  });
});

describe("lookupEnv", () => {
  test("null cache returns unknown", () => {
    expect(lookupEnv(null, "Bash", null)).toBe("unknown");
  });

  test("no match in cache returns unknown", () => {
    expect(lookupEnv(PROD_CACHE, "Bash", null)).toBe("unknown");
    expect(lookupEnv(PROD_CACHE, "Read", "some_other_server")).toBe("unknown");
  });

  test("mcp_server_id match returns prod env", () => {
    const env = lookupEnv(PROD_CACHE, "mcp__plugin_claude-gate_supabase_prod__execute_sql", "supabase_prod");
    expect(env).toBe("prod");
  });

  test("tool glob match without mcp_server_id returns dev env", () => {
    const env = lookupEnv(DEV_CACHE, "mcp__plugin_claude-gate_supabase_dev__query", "supabase_dev");
    expect(env).toBe("dev");
  });

  test("mcp_server_id-only matcher (no tool field) matches by server id", () => {
    const env = lookupEnv(DEV_CACHE, "mcp__plugin_x_supabase_dev__any_tool", "supabase_dev");
    expect(env).toBe("dev");
  });

  test("tool glob match returns local env", () => {
    const env = lookupEnv(LOCAL_CACHE, "mcp__plugin_claude-gate_local_db__insert", null);
    expect(env).toBe("local");
  });

  test("mcp_server_id mismatch when tool glob matches returns unknown", () => {
    // Tool glob matches but mcp_server_id does not match
    const env = lookupEnv(PROD_CACHE, "mcp__plugin_x_supabase_prod__x", "wrong_server");
    expect(env).toBe("unknown");
  });
});

describe("fallbackDecision", () => {
  test("prod env returns DENY (closed policy)", () => {
    expect(fallbackDecision("prod")).toBe("DENY");
  });

  test("unknown env returns DENY (closed policy)", () => {
    expect(fallbackDecision("unknown")).toBe("DENY");
  });

  test("dev env returns ALLOW (open policy)", () => {
    expect(fallbackDecision("dev")).toBe("ALLOW");
  });

  test("local env returns ALLOW (open policy)", () => {
    expect(fallbackDecision("local")).toBe("ALLOW");
  });

  test("override can change prod to open", () => {
    expect(fallbackDecision("prod", { prod: "open" })).toBe("ALLOW");
  });

  test("override can change dev to closed", () => {
    expect(fallbackDecision("dev", { dev: "closed" })).toBe("DENY");
  });
});
