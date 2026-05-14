// mcp-server/src/policy/rule-pack-schema.ts
//
// Zod schemas for shipped and custom rule packs.
// Source of truth: design doc Sections 7.1 and 7.2.

import { z } from "zod";

export const RiskLevelEnum = z.enum(["LOW", "MED", "HIGH", "CRIT"]);
export type RiskLevel = z.infer<typeof RiskLevelEnum>;

export const DecisionVerbEnum = z.enum(["ALLOW", "DENY", "ASK"]);
export type DecisionVerb = z.infer<typeof DecisionVerbEnum>;

export const ParserNameEnum = z.enum(["sql", "shell", "fs", "noop"]);
export type ParserName = z.infer<typeof ParserNameEnum>;

const StatementListTierSchema = z
  .object({
    statement_types: z.array(z.string().min(1)),
    transactional: z.array(z.string().min(1)).optional(),
  })
  .strict();

const StatementRuleSchema = z
  .object({
    statement_type: z.string().min(1),
    requires: z.array(z.string().min(1)).optional(),
    forbids: z.array(z.string().min(1)).optional(),
    pattern: z.string().min(1).optional(),
  })
  .strict();

const StatementRuleArrayTierSchema = z.array(StatementRuleSchema);

const RiskTierSchema = z.union([
  StatementListTierSchema,
  StatementRuleArrayTierSchema,
]);

const AppliesToSchema = z
  .object({
    tool_patterns: z.array(z.string().min(1)).min(1),
  })
  .strict();

const RiskTiersSchema = z
  .object({
    LOW: RiskTierSchema,
    MED: RiskTierSchema,
    HIGH: RiskTierSchema,
    CRIT: RiskTierSchema,
  })
  .strict();

export const RulePackSchema = z
  .object({
    version: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    applies_to: AppliesToSchema,
    parser: ParserNameEnum,
    risk_tiers: RiskTiersSchema,
  })
  .strict();

export type RulePack = z.infer<typeof RulePackSchema>;
export type StatementListTier = z.infer<typeof StatementListTierSchema>;
export type StatementRule = z.infer<typeof StatementRuleSchema>;
export type RiskTier = z.infer<typeof RiskTierSchema>;

const PolicyMatrixSchema = z
  .object({
    LOW: DecisionVerbEnum,
    MED: DecisionVerbEnum,
    HIGH: DecisionVerbEnum,
    CRIT: DecisionVerbEnum,
  })
  .strict();

export const PoliciesFileSchema = z
  .object({
    policies: z.record(z.string(), PolicyMatrixSchema),
  })
  .strict();

export type PolicyMatrix = z.infer<typeof PolicyMatrixSchema>;
export type PoliciesFile = z.infer<typeof PoliciesFileSchema>;
