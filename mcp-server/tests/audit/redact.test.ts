// mcp-server/tests/audit/redact.test.ts
import { describe, expect, test } from "vitest";
import { redactParameters, hashParameters } from "../../src/audit/redact";

describe("redactParameters", () => {
  test("redacts well-known secret keys", () => {
    const out = redactParameters({
      query: "SELECT 1",
      password: "p@ss",
      api_key: "sk-abc",
      token: "t-xyz",
      authorization: "Bearer x",
    });
    expect(out.query).toBe("SELECT 1");
    expect(out.password).toBe("[REDACTED]");
    expect(out.api_key).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
  });

  test("is case-insensitive", () => {
    const out = redactParameters({ ApiKey: "x", PASSWORD: "y" });
    expect(out["ApiKey"]).toBe("[REDACTED]");
    expect(out["PASSWORD"]).toBe("[REDACTED]");
  });

  test("recurses into nested objects", () => {
    const out = redactParameters({
      headers: { Authorization: "Bearer x", "User-Agent": "claude" },
    });
    const h = out["headers"] as Record<string, unknown>;
    expect(h["Authorization"]).toBe("[REDACTED]");
    expect(h["User-Agent"]).toBe("claude");
  });

  test("does not mutate input", () => {
    const input = { password: "p" };
    redactParameters(input);
    expect(input.password).toBe("p");
  });

  test("returns {} for non-object input", () => {
    expect(redactParameters(null)).toEqual({});
    expect(redactParameters(42 as unknown as object)).toEqual({});
    expect(redactParameters("string" as unknown as object)).toEqual({});
  });
});

describe("hashParameters", () => {
  test("returns a sha256: prefixed hex digest", () => {
    const h = hashParameters({ query: "SELECT 1" });
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("is deterministic for equivalent inputs", () => {
    const a = hashParameters({ a: 1, b: 2 });
    const b = hashParameters({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  test("hashes the REDACTED form, not the raw secrets", () => {
    const a = hashParameters({ query: "SELECT 1", password: "p1" });
    const b = hashParameters({ query: "SELECT 1", password: "p2" });
    expect(a).toBe(b);
  });
});
