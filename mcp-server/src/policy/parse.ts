// mcp-server/src/policy/parse.ts
//
// Stage 2 of the decision pipeline. Selects the matching rule pack
// by walking applies_to.tool_patterns; invokes the named parser.

import type { RulePack } from "./rule-pack-schema.js";
import { parseSql, type SqlOk } from "./parsers/sql.js";

export type DispatchResult =
  | { kind: "OK"; pack_name: string; pack: RulePack; parsed: SqlOk }
  | { kind: "NO_PACK" }
  | { kind: "PARSE_FAILED"; pack_name: string; error: string };

export interface DispatchInput {
  tool_name: string;
  parameters: unknown;
  packs: Map<string, RulePack>;
}

export function dispatchParser(input: DispatchInput): DispatchResult {
  for (const [name, pack] of input.packs) {
    if (!coversTool(pack, input.tool_name)) continue;

    switch (pack.parser) {
      case "sql":
        return runSql(name, pack, input.parameters);
      case "shell":
      case "fs":
      case "noop":
        return { kind: "NO_PACK" };
    }
  }
  return { kind: "NO_PACK" };
}

function coversTool(pack: RulePack, toolName: string): boolean {
  for (const p of pack.applies_to.tool_patterns) {
    if (globMatch(p, toolName)) return true;
  }
  return false;
}

function runSql(
  name: string,
  pack: RulePack,
  params: unknown,
): DispatchResult {
  if (!params || typeof params !== "object") {
    return { kind: "PARSE_FAILED", pack_name: name, error: "no parameters" };
  }
  const obj = params as Record<string, unknown>;
  const query =
    typeof obj["query"] === "string"
      ? obj["query"]
      : typeof obj["sql"] === "string"
        ? obj["sql"]
        : null;
  if (query === null) {
    return {
      kind: "PARSE_FAILED",
      pack_name: name,
      error: "missing `query` parameter",
    };
  }

  const r = parseSql(query);
  if (r.kind === "PARSE_FAILED") {
    return { kind: "PARSE_FAILED", pack_name: name, error: r.error };
  }
  return { kind: "OK", pack_name: name, pack, parsed: r };
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$");
  return re.test(value);
}
