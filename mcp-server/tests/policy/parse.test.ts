// mcp-server/tests/policy/parse.test.ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  RulePackSchema,
  type RulePack,
} from "../../src/policy/rule-pack-schema";
import { dispatchParser } from "../../src/policy/parse";

const sqlPack: RulePack = RulePackSchema.parse(
  parseYaml(
    readFileSync(resolve(__dirname, "../../../rules/sql.yaml"), "utf-8"),
  ),
);

describe("dispatchParser", () => {
  test("selects the SQL pack and parses a SELECT", () => {
    const r = dispatchParser({
      tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
      parameters: { query: "SELECT 1" },
      packs: new Map([["sql", sqlPack]]),
    });
    expect(r.kind).toBe("OK");
    if (r.kind === "OK") {
      expect(r.pack_name).toBe("sql");
      expect(r.parsed.statement_kind).toBe("SELECT");
    }
  });

  test("returns NO_PACK when no rule pack covers the tool", () => {
    const r = dispatchParser({
      tool_name: "Bash",
      parameters: { command: "echo hi" },
      packs: new Map([["sql", sqlPack]]),
    });
    expect(r.kind).toBe("NO_PACK");
  });

  test("returns PARSE_FAILED for malformed SQL parameters", () => {
    const r = dispatchParser({
      tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
      parameters: { query: "this is not sql at all" },
      packs: new Map([["sql", sqlPack]]),
    });
    expect(r.kind).toBe("PARSE_FAILED");
  });

  test("returns PARSE_FAILED when the expected parameter key is missing", () => {
    const r = dispatchParser({
      tool_name: "mcp__plugin_claude-gate_supabase_prod__execute_sql",
      parameters: { wrong_key: "SELECT 1" },
      packs: new Map([["sql", sqlPack]]),
    });
    expect(r.kind).toBe("PARSE_FAILED");
  });
});
