// mcp-server/src/policy/risk.ts
//
// Stage 3 of the decision pipeline. Pure function:
//   (parsed_sql, rule_pack) -> RiskLevel
//
// Source of truth: design Section 5 (Stage 3) + rule pack schema in
// Section 7.1.
//
// Tier evaluation order: CRIT -> HIGH -> MED -> LOW, with fail-safe
// HIGH for ambiguous statements not matched by any tier.

import type { SqlOk, SqlStatementKind } from "./parsers/sql.js";
import type {
  RulePack,
  RiskLevel,
  RiskTier,
  StatementRule,
} from "./rule-pack-schema.js";

const TIER_ORDER: RiskLevel[] = ["CRIT", "HIGH", "MED", "LOW"];

const KIND_ALIASES: Record<SqlStatementKind, string[]> = {
  SELECT: ["SELECT"],
  INSERT: ["INSERT"],
  UPDATE: ["UPDATE"],
  DELETE: ["DELETE"],
  MERGE: ["MERGE"],
  COPY: ["COPY"],
  LOAD: ["LOAD", "LOAD DATA INFILE", "LOAD DATA"],
  CREATE_TABLE: ["CREATE TABLE", "CREATE"],
  DROP: ["DROP", "DROP TABLE", "DROP INDEX", "DROP SCHEMA"],
  TRUNCATE: ["TRUNCATE", "TRUNCATE TABLE"],
  ALTER: ["ALTER", "ALTER TABLE"],
  GRANT: ["GRANT"],
  REVOKE: ["REVOKE"],
  CREATE_USER: ["CREATE USER"],
  DROP_USER: ["DROP USER"],
  CREATE_ROLE: ["CREATE ROLE"],
  DROP_ROLE: ["DROP ROLE"],
  EXPLAIN: ["EXPLAIN"],
  SHOW: ["SHOW"],
  DESCRIBE: ["DESCRIBE", "DESC"],
  BEGIN: ["BEGIN"],
  START: ["START", "START TRANSACTION"],
  COMMIT: ["COMMIT"],
  ROLLBACK: ["ROLLBACK"],
  SAVEPOINT: ["SAVEPOINT"],
  RELEASE: ["RELEASE"],
  OTHER: [],
};

export function classifyRisk(parsed: SqlOk, pack: RulePack): RiskLevel {
  const aliases = KIND_ALIASES[parsed.statement_kind] ?? [];

  for (const level of TIER_ORDER) {
    const tier = pack.risk_tiers[level];
    if (tierMatches(tier, parsed, aliases)) return level;
  }

  // Fail-safe: unclassified statements default to HIGH.
  return "HIGH";
}

function tierMatches(
  tier: RiskTier,
  parsed: SqlOk,
  aliases: string[],
): boolean {
  if (Array.isArray(tier)) {
    return tier.some((rule) => ruleMatches(rule, parsed, aliases));
  }

  const list = tier as { statement_types: string[]; transactional?: string[] };
  const all = [...list.statement_types, ...(list.transactional ?? [])];
  return all.some((s) => matchesAlias(s, aliases));
}

function ruleMatches(
  rule: StatementRule,
  parsed: SqlOk,
  aliases: string[],
): boolean {
  if (!matchesAlias(rule.statement_type, aliases)) return false;

  if (rule.requires?.includes("WHERE") && !parsed.has_where) return false;
  if (rule.forbids?.includes("WHERE") && parsed.has_where) return false;

  if (rule.pattern === "AS SELECT" && !parsed.has_as_select) return false;

  return true;
}

function matchesAlias(needle: string, aliases: string[]): boolean {
  const n = needle.toUpperCase();
  for (const a of aliases) {
    if (a.toUpperCase() === n) return true;
  }
  return false;
}
