// mcp-server/tests/policy/decision.test.ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  PoliciesFileSchema,
  type PoliciesFile,
} from "../../src/policy/rule-pack-schema";
import { decideByPolicy } from "../../src/policy/decision";

const policies: PoliciesFile = PoliciesFileSchema.parse(
  parseYaml(
    readFileSync(resolve(__dirname, "../../../rules/policies.yaml"), "utf-8"),
  ),
);

describe("decideByPolicy", () => {
  const matrix: Array<[string, "LOW" | "MED" | "HIGH" | "CRIT", "ALLOW" | "DENY" | "ASK"]> = [
    ["strict", "LOW", "ALLOW"],
    ["strict", "MED", "DENY"],
    ["strict", "HIGH", "DENY"],
    ["strict", "CRIT", "DENY"],
    ["confirm", "LOW", "ALLOW"],
    ["confirm", "MED", "ASK"],
    ["confirm", "HIGH", "ASK"],
    ["confirm", "CRIT", "DENY"],
    ["dev", "LOW", "ALLOW"],
    ["dev", "MED", "ALLOW"],
    ["dev", "HIGH", "ASK"],
    ["dev", "CRIT", "ASK"],
    ["allow", "LOW", "ALLOW"],
    ["allow", "MED", "ALLOW"],
    ["allow", "HIGH", "ALLOW"],
    ["allow", "CRIT", "ALLOW"],
  ];

  for (const [policyName, risk, expected] of matrix) {
    test(`${policyName} x ${risk} -> ${expected}`, () => {
      const pm = policies.policies[policyName];
      expect(pm).toBeDefined();
      expect(decideByPolicy(pm!, risk)).toBe(expected);
    });
  }

  test("throws on a policy that omits a risk level (defensive)", () => {
    // Build a malformed matrix to ensure the function fails loudly.
    const broken = { LOW: "ALLOW" } as unknown as Parameters<
      typeof decideByPolicy
    >[0];
    expect(() => decideByPolicy(broken, "CRIT")).toThrow();
  });
});
