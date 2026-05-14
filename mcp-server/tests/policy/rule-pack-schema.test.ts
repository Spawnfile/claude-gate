// mcp-server/tests/policy/rule-pack-schema.test.ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  RulePackSchema,
  PoliciesFileSchema,
} from "../../src/policy/rule-pack-schema";

const repoRoot = resolve(__dirname, "../../..");

describe("RulePackSchema", () => {
  test("accepts a minimal valid sql pack", () => {
    const minimal = {
      version: "1.0.0",
      name: "sql",
      description: "SQL operation risk classification",
      applies_to: {
        tool_patterns: ["mcp__*supabase*__execute_sql*"],
      },
      parser: "sql",
      risk_tiers: {
        LOW: { statement_types: ["SELECT"] },
        MED: [{ statement_type: "INSERT" }],
        HIGH: [{ statement_type: "UPDATE", forbids: ["WHERE"] }],
        CRIT: { statement_types: ["DROP"] },
      },
    };
    expect(() => RulePackSchema.parse(minimal)).not.toThrow();
  });

  test("rejects a pack with missing risk tiers", () => {
    const bad = {
      version: "1.0.0",
      name: "sql",
      description: "x",
      applies_to: { tool_patterns: ["a"] },
      parser: "sql",
      risk_tiers: { LOW: { statement_types: ["SELECT"] } },
    };
    expect(() => RulePackSchema.parse(bad)).toThrow();
  });

  test("rejects an unknown parser", () => {
    const bad = {
      version: "1.0.0",
      name: "weird",
      description: "x",
      applies_to: { tool_patterns: ["a"] },
      parser: "java",
      risk_tiers: {
        LOW: { statement_types: ["X"] },
        MED: [],
        HIGH: [],
        CRIT: { statement_types: ["Y"] },
      },
    };
    expect(() => RulePackSchema.parse(bad)).toThrow();
  });

  test("rejects an unknown top-level field (strict mode)", () => {
    const bad = {
      version: "1.0.0",
      name: "sql",
      description: "x",
      applies_to: { tool_patterns: ["a"] },
      parser: "sql",
      risk_tiers: {
        LOW: { statement_types: ["SELECT"] },
        MED: [],
        HIGH: [],
        CRIT: { statement_types: ["DROP"] },
      },
      extraneous: true,
    };
    expect(() => RulePackSchema.parse(bad)).toThrow();
  });

  test("accepts the shipped rules/sql.yaml", () => {
    const raw = readFileSync(resolve(repoRoot, "rules/sql.yaml"), "utf-8");
    const obj = parseYaml(raw);
    expect(() => RulePackSchema.parse(obj)).not.toThrow();
  });
});

describe("PoliciesFileSchema", () => {
  test("accepts the four built-in policies with the full risk matrix", () => {
    const valid = {
      policies: {
        strict: { LOW: "ALLOW", MED: "DENY", HIGH: "DENY", CRIT: "DENY" },
        confirm: { LOW: "ALLOW", MED: "ASK", HIGH: "ASK", CRIT: "DENY" },
        dev: { LOW: "ALLOW", MED: "ALLOW", HIGH: "ASK", CRIT: "ASK" },
        allow: { LOW: "ALLOW", MED: "ALLOW", HIGH: "ALLOW", CRIT: "ALLOW" },
      },
    };
    expect(() => PoliciesFileSchema.parse(valid)).not.toThrow();
  });

  test("rejects a policy missing a risk level", () => {
    const bad = {
      policies: {
        strict: { LOW: "ALLOW", MED: "DENY", HIGH: "DENY" },
      },
    };
    expect(() => PoliciesFileSchema.parse(bad)).toThrow();
  });

  test("rejects a policy with an invalid decision verb", () => {
    const bad = {
      policies: {
        strict: { LOW: "MAYBE", MED: "DENY", HIGH: "DENY", CRIT: "DENY" },
      },
    };
    expect(() => PoliciesFileSchema.parse(bad)).toThrow();
  });

  test("accepts the shipped rules/policies.yaml", () => {
    const raw = readFileSync(resolve(repoRoot, "rules/policies.yaml"), "utf-8");
    const obj = parseYaml(raw);
    expect(() => PoliciesFileSchema.parse(obj)).not.toThrow();
  });
});
