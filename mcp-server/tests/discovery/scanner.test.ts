// mcp-server/tests/discovery/scanner.test.ts
import { describe, expect, test } from "vitest";
import type {
  Scanner,
  RawDetection,
  DetectionType,
  DetectionSource,
  InferredEnv,
} from "../../src/discovery/scanner.js";

describe("scanner types", () => {
  test("RawDetection accepts a fully-populated structure", () => {
    const det: RawDetection = {
      type: "supabase",
      endpoint: "prodabc.supabase.co",
      raw_value: "https://prodabc.supabase.co",
      source: {
        scanner: "env_scanner",
        file: ".env.prod",
        field: "SUPABASE_URL",
      },
      inferred_env: "prod",
      inferred_env_confidence: 0.7,
    };
    expect(det.type).toBe("supabase");
  });

  test("RawDetection optional fields can be omitted", () => {
    const det: RawDetection = {
      type: "postgres",
      endpoint: "localhost:5432",
      raw_value: "postgres://localhost:5432/x",
      source: { scanner: "env_scanner", file: ".env" },
    };
    expect(det.inferred_env).toBeUndefined();
  });

  test("DetectionType union includes the expected types", () => {
    const types: DetectionType[] = [
      "supabase",
      "postgres",
      "mysql",
      "mongodb",
      "redis",
      "sqlite",
      "generic",
    ];
    expect(types.length).toBe(7);
  });

  test("InferredEnv union members compile", () => {
    const envs: InferredEnv[] = ["prod", "dev", "local", "unknown"];
    expect(envs).toContain("prod");
  });

  test("DetectionSource is a structural type", () => {
    const s: DetectionSource = {
      scanner: "test",
      file: ".env",
    };
    expect(s.scanner).toBe("test");
  });

  test("Scanner interface admits a no-op implementation", async () => {
    const noop: Scanner = {
      name: "noop",
      scan: async () => [],
    };
    expect(noop.name).toBe("noop");
    expect(await noop.scan("/tmp")).toEqual([]);
  });
});
