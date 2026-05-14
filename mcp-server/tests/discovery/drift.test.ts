// mcp-server/tests/discovery/drift.test.ts
import { describe, expect, test } from "vitest";
import { computeDrift, registryHash } from "../../src/discovery/drift";
import type { Registry } from "../../src/discovery/registry";

const r = (
  name: string,
  over: Partial<Registry["resources"][number]> = {},
): Registry["resources"][number] => ({
  name,
  type: "postgres",
  endpoint: "host:5432",
  env: "dev",
  confidence: 0.85,
  discovered_from: [{ scanner: "env_scanner" }],
  ...over,
});

describe("computeDrift", () => {
  test("detects an added resource", () => {
    const last: Registry = { resources: [r("postgres_dev")] };
    const now: Registry = {
      resources: [r("postgres_dev"), r("redis_local", { type: "redis" })],
    };
    const d = computeDrift(now, last);
    expect(d.added.map((x) => x.name)).toEqual(["redis_local"]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  test("detects a removed resource", () => {
    const last: Registry = {
      resources: [r("postgres_dev"), r("redis_local", { type: "redis" })],
    };
    const now: Registry = { resources: [r("postgres_dev")] };
    const d = computeDrift(now, last);
    expect(d.removed.map((x) => x.name)).toEqual(["redis_local"]);
  });

  test("detects a changed resource (env flipped)", () => {
    const last: Registry = { resources: [r("postgres_dev", { env: "dev" })] };
    const now: Registry = { resources: [r("postgres_dev", { env: "prod" })] };
    const d = computeDrift(now, last);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.name).toBe("postgres_dev");
    expect(d.changed[0]!.before.env).toBe("dev");
    expect(d.changed[0]!.after.env).toBe("prod");
  });

  test("identical registries produce no drift", () => {
    const reg: Registry = { resources: [r("postgres_dev")] };
    const d = computeDrift(reg, reg);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  test("first-time discovery (no previous) marks all current as added", () => {
    const now: Registry = { resources: [r("postgres_dev"), r("redis_local")] };
    const d = computeDrift(now, null);
    expect(d.added).toHaveLength(2);
  });
});

describe("registryHash", () => {
  test("hashes deterministically across key order", () => {
    const a: Registry = {
      resources: [
        {
          name: "x",
          type: "postgres",
          endpoint: "h:5432",
          env: "dev",
          confidence: 0.7,
          discovered_from: [{ scanner: "env_scanner", file: ".env" }],
        },
      ],
    };
    const b: Registry = JSON.parse(JSON.stringify(a));
    expect(registryHash(a)).toBe(registryHash(b));
  });

  test("different content produces different hash", () => {
    const a: Registry = { resources: [r("postgres_dev")] };
    const b: Registry = {
      resources: [r("postgres_dev", { endpoint: "other:5432" })],
    };
    expect(registryHash(a)).not.toBe(registryHash(b));
  });
});
