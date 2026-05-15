// mcp-server/tests/lint/banlist.test.ts
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const FORBIDDEN_DB_PACKAGES = [
  "pg",
  "mysql",
  "mysql2",
  "mongodb",
  "mongoose",
  "redis",
  "ioredis",
  "@supabase/supabase-js",
  "better-sqlite3",
];

function runScan(packages: string[]): string[] {
  const testsRoot = resolve(__dirname, "..");
  const entries = readdirSync(testsRoot, { recursive: true }) as string[];
  const testFiles = entries
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => `tests/${entry.split(/[\\/]/).join("/")}`);

  expect(testFiles.length).toBeGreaterThan(0);

  const violations: string[] = [];
  for (const file of testFiles) {
    const content = readFileSync(resolve(__dirname, "../..", file), "utf-8");
    for (const pkg of packages) {
      const importRegex = new RegExp(
        `from\\s+['"]${pkg.replace(/[/@/-]/g, "\\$&")}['"]`,
        "g",
      );
      const requireRegex = new RegExp(
        `require\\(['"]${pkg.replace(/[/@/-]/g, "\\$&")}['"]\\)`,
        "g",
      );
      if (importRegex.test(content) || requireRegex.test(content)) {
        violations.push(`${file} imports ${pkg}`);
      }
    }
  }
  return violations;
}

describe("banlist", () => {
  test("test files never import real database drivers", () => {
    const violations = runScan(FORBIDDEN_DB_PACKAGES);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
