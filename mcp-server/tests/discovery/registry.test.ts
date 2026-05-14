// mcp-server/tests/discovery/registry.test.ts
import { describe, expect, test } from "vitest";
import { resolveRegistry } from "../../src/discovery/registry";
import type { RawDetection } from "../../src/discovery/scanner";

function d(over: Partial<RawDetection>): RawDetection {
  return {
    type: "postgres",
    endpoint: "db.example.com:5432",
    raw_value: "postgres://db.example.com:5432/app",
    source: { scanner: "env_scanner", file: ".env" },
    ...over,
  };
}

describe("resolveRegistry", () => {
  test("dedups two detections of the same endpoint", () => {
    const reg = resolveRegistry([
      d({ source: { scanner: "env_scanner", file: ".env" } }),
      d({ source: { scanner: "mcp_config_scanner", server: "postgres" } }),
    ]);
    expect(reg.resources).toHaveLength(1);
    expect(reg.resources[0]!.discovered_from).toHaveLength(2);
  });

  test("normalizes default postgres port (5432) to canonical form", () => {
    const reg = resolveRegistry([
      d({ endpoint: "db.example.com:5432" }),
      d({ endpoint: "db.example.com" }),
    ]);
    expect(reg.resources).toHaveLength(1);
  });

  test("does NOT merge across types (postgres vs mysql at same host)", () => {
    const reg = resolveRegistry([
      d({ type: "postgres", endpoint: "db.example.com:5432" }),
      d({ type: "mysql", endpoint: "db.example.com:5432" }),
    ]);
    expect(reg.resources).toHaveLength(2);
  });

  test("names resources as {type}_{env} when env is known", () => {
    const reg = resolveRegistry([
      d({
        endpoint: "prodabc.supabase.co",
        type: "supabase",
        raw_value: "https://prodabc.supabase.co",
        inferred_env: "prod",
        inferred_env_confidence: 0.7,
        source: { scanner: "env_scanner", file: ".env.prod" },
      }),
    ]);
    expect(reg.resources[0]!.name).toBe("supabase_prod");
    expect(reg.resources[0]!.env).toBe("prod");
  });

  test("disambiguates multiple unknown-env resources of the same type", () => {
    const reg = resolveRegistry([
      d({ type: "redis", endpoint: "cache-a.example.com:6379", raw_value: "redis://cache-a.example.com:6379" }),
      d({ type: "redis", endpoint: "cache-b.example.com:6379", raw_value: "redis://cache-b.example.com:6379" }),
    ]);
    const names = reg.resources.map((r) => r.name);
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n).toMatch(/^redis_unknown_[a-f0-9]+$/);
  });

  test("two agreeing sources boost confidence to 0.85", () => {
    const reg = resolveRegistry([
      d({
        type: "supabase",
        endpoint: "prodabc.supabase.co",
        raw_value: "https://prodabc.supabase.co",
        inferred_env: "prod",
        inferred_env_confidence: 0.7,
        source: { scanner: "env_scanner", file: ".env.prod" },
      }),
      d({
        type: "supabase",
        endpoint: "prodabc.supabase.co",
        raw_value: "https://prodabc.supabase.co",
        source: { scanner: "mcp_config_scanner", server: "supabase_prod" },
      }),
    ]);
    expect(reg.resources[0]!.confidence).toBeCloseTo(0.85);
  });

  test("mixed-env detections of the same endpoint collapse to unknown / 0", () => {
    const reg = resolveRegistry([
      d({
        endpoint: "db.example.com:5432",
        raw_value: "postgres://db.example.com:5432",
        inferred_env: "prod",
        inferred_env_confidence: 0.7,
        source: { scanner: "env_scanner", file: ".env.prod" },
      }),
      d({
        endpoint: "db.example.com:5432",
        raw_value: "postgres://db.example.com:5432",
        inferred_env: "dev",
        inferred_env_confidence: 0.7,
        source: { scanner: "env_scanner", file: ".env.dev" },
      }),
    ]);
    expect(reg.resources[0]!.env).toBe("unknown");
    expect(reg.resources[0]!.confidence).toBe(0);
  });

  test("preserves source breakdown for downstream UX (discovered_from)", () => {
    const reg = resolveRegistry([
      d({
        source: { scanner: "env_scanner", file: ".env.prod", field: "DATABASE_URL" },
      }),
    ]);
    expect(reg.resources[0]!.discovered_from[0]).toEqual({
      scanner: "env_scanner",
      file: ".env.prod",
      field: "DATABASE_URL",
    });
  });

  test("registry is sorted by name for deterministic output", () => {
    const reg = resolveRegistry([
      d({ type: "redis", endpoint: "127.0.0.1:6379", raw_value: "redis://127.0.0.1:6379" }),
      d({ type: "postgres", endpoint: "127.0.0.1:5432", raw_value: "postgres://127.0.0.1:5432" }),
    ]);
    expect(reg.resources.map((r) => r.name)).toEqual([
      "postgres_local",
      "redis_local",
    ]);
  });

  test("throws when a detection produces confidence outside [0,1]", () => {
    const bad: RawDetection[] = [
      {
        type: "postgres",
        endpoint: "localhost:5432",
        raw_value: "postgres://localhost:5432/x",
        source: { scanner: "test", file: ".env" },
        inferred_env: "local",
        inferred_env_confidence: 1.5,
      },
    ];
    expect(() => resolveRegistry(bad)).toThrow(/confidence/i);
  });

  test("accepts confidence at the bounds 0 and 1", () => {
    const ok: RawDetection[] = [
      {
        type: "postgres",
        endpoint: "localhost:5432",
        raw_value: "postgres://localhost:5432/x",
        source: { scanner: "test", file: ".env" },
        inferred_env: "local",
        inferred_env_confidence: 1,
      },
    ];
    expect(() => resolveRegistry(ok)).not.toThrow();
  });
});
