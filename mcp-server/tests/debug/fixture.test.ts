import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFixture } from "../../src/debug/fixture";

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
});

function makeTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-fixture-test-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("runFixture", () => {
  test("detects postgres from .env DATABASE_URL", async () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, ".env"), "DATABASE_URL=postgres://localhost:5432/x\n");
    const result = await runFixture(dir);
    expect(result.resources.length).toBeGreaterThanOrEqual(1);
    // .env without env suffix maps to local
    const res = result.resources[0]!;
    expect(res.env).toBe("local");
    expect(typeof res.confidence).toBe("number");
    expect(typeof res.name).toBe("string");
  });

  test("returns empty resources for empty directory", async () => {
    const dir = makeTmpProject();
    const result = await runFixture(dir);
    expect(result.resources).toEqual([]);
  });

  test("detects prod from .env.prod DATABASE_URL", async () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, ".env.prod"), "DATABASE_URL=postgres://prodhost:5432/prod\n");
    const result = await runFixture(dir);
    expect(result.resources.length).toBeGreaterThanOrEqual(1);
    const res = result.resources.find((r) => r.env === "prod");
    expect(res).toBeDefined();
  });
});
