import { describe, test, expect } from "vitest";
import { globMatch } from "../../src/util/glob";

describe("globMatch", () => {
  test("* matches anything", () => {
    expect(globMatch("*", "anything")).toBe(true);
    expect(globMatch("*", "mcp__plugin_x_y__z")).toBe(true);
  });

  test("exact match", () => {
    expect(globMatch("Bash", "Bash")).toBe(true);
    expect(globMatch("Bash", "bash")).toBe(false);
  });

  test("prefix wildcard", () => {
    expect(globMatch("mcp__plugin_*_supabase_prod__*", "mcp__plugin_claude-gate_supabase_prod__execute_sql")).toBe(true);
    expect(globMatch("mcp__plugin_*_supabase_prod__*", "mcp__plugin_x_supabase_dev__execute_sql")).toBe(false);
  });

  test("suffix wildcard", () => {
    expect(globMatch("mcp__*", "mcp__plugin_x_y__z")).toBe(true);
    expect(globMatch("mcp__*", "Bash")).toBe(false);
  });

  test("dot in pattern is literal", () => {
    expect(globMatch("a.b", "a.b")).toBe(true);
    expect(globMatch("a.b", "axb")).toBe(false);
  });
});
