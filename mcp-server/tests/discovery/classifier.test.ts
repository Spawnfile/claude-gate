// mcp-server/tests/discovery/classifier.test.ts
import { describe, expect, test } from "vitest";
import {
  classifyOne,
  aggregateClassifications,
} from "../../src/discovery/classifier";
import type { RawDetection } from "../../src/discovery/scanner";

function det(over: Partial<RawDetection> = {}): RawDetection {
  return {
    type: "postgres",
    endpoint: "db.example.com:5432",
    raw_value: "postgres://db.example.com:5432/app",
    source: { scanner: "env_scanner", file: ".env" },
    ...over,
  };
}

describe("classifyOne", () => {
  test("trusts scanner-supplied filename signal", () => {
    const r = classifyOne(
      det({
        inferred_env: "prod",
        inferred_env_confidence: 0.7,
        source: { scanner: "env_scanner", file: ".env.prod" },
      }),
    );
    expect(r.env).toBe("prod");
    expect(r.confidence).toBeCloseTo(0.7);
    expect(r.signal).toBe("filename");
  });

  test("falls through to localhost signal on bare endpoint", () => {
    const r = classifyOne(
      det({ endpoint: "localhost:5432", raw_value: "postgres://localhost:5432/x" }),
    );
    expect(r.env).toBe("local");
    expect(r.confidence).toBeCloseTo(0.85);
    expect(r.signal).toBe("localhost");
  });

  test("treats 127.0.0.1 as local", () => {
    const r = classifyOne(
      det({ endpoint: "127.0.0.1:6379", raw_value: "redis://127.0.0.1:6379" }),
    );
    expect(r.env).toBe("local");
  });

  test("falls through to string-match (prod) on URL substring", () => {
    const r = classifyOne(
      det({
        endpoint: "prodabc.supabase.co",
        raw_value: "https://prodabc.supabase.co",
      }),
    );
    expect(r.env).toBe("prod");
    expect(r.confidence).toBeCloseTo(0.5);
    expect(r.signal).toBe("string-match");
  });

  test("falls through to string-match (dev) on URL substring", () => {
    const r = classifyOne(
      det({ endpoint: "stagingapi.example.com", raw_value: "https://stagingapi.example.com" }),
    );
    expect(r.env).toBe("dev");
    expect(r.signal).toBe("string-match");
  });

  test("returns unknown / 0 when no signal", () => {
    const r = classifyOne(
      det({ endpoint: "db.example.com:5432", raw_value: "postgres://db.example.com:5432/x" }),
    );
    expect(r.env).toBe("unknown");
    expect(r.confidence).toBe(0);
    expect(r.signal).toBe("none");
  });
});

describe("aggregateClassifications", () => {
  test("two agreeing sources => 0.85", () => {
    const a = {
      env: "prod" as const,
      confidence: 0.7,
      signal: "filename" as const,
    };
    const b = {
      env: "prod" as const,
      confidence: 0.5,
      signal: "string-match" as const,
    };
    const r = aggregateClassifications([a, b]);
    expect(r.env).toBe("prod");
    expect(r.confidence).toBeCloseTo(0.85);
  });

  test("three agreeing sources => 0.95", () => {
    const r = aggregateClassifications([
      { env: "dev", confidence: 0.7, signal: "filename" },
      { env: "dev", confidence: 0.5, signal: "string-match" },
      { env: "dev", confidence: 0.7, signal: "filename" },
    ]);
    expect(r.confidence).toBeCloseTo(0.95);
  });

  test("disagreement collapses to unknown / 0", () => {
    const r = aggregateClassifications([
      { env: "prod", confidence: 0.7, signal: "filename" },
      { env: "dev", confidence: 0.7, signal: "filename" },
    ]);
    expect(r.env).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  test("single source preserves its confidence", () => {
    const r = aggregateClassifications([
      { env: "local", confidence: 0.85, signal: "localhost" },
    ]);
    expect(r.env).toBe("local");
    expect(r.confidence).toBeCloseTo(0.85);
  });

  test("empty input returns unknown / 0", () => {
    const r = aggregateClassifications([]);
    expect(r.env).toBe("unknown");
    expect(r.confidence).toBe(0);
  });
});
