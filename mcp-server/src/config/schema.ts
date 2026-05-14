//
// Zod schema for <project>/.claude-gate/config.yaml.
// Source of truth: design doc Section 4.1.
//
// Strict mode: unknown fields are rejected (`.strict()`) to catch
// typos early. Add new fields here when extending the config.

import { z } from "zod";

const FailPolicyEnum = z.enum(["closed", "open"]);

const GlobalFailPolicySchema = z
  .object({
    prod: FailPolicyEnum,
    dev: FailPolicyEnum,
    local: FailPolicyEnum,
    unknown: FailPolicyEnum.optional(),
  })
  .strict();

const AuditSchema = z
  .object({
    integrity: z.enum(["hash_chain", "none"]),
    redact_params: z.boolean(),
  })
  .strict();

const GlobalSchema = z
  .object({
    fail_policy: GlobalFailPolicySchema,
    audit: AuditSchema,
  })
  .strict();

const MatcherSchema = z
  .object({
    tool: z.string().min(1).optional(),
    mcp_server_id: z.string().min(1).optional(),
    param_match: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((m) => m.tool !== undefined || m.mcp_server_id !== undefined, {
    message: "matcher requires at least one of `tool` or `mcp_server_id`",
  });

const EnvEnum = z.enum(["prod", "dev", "local", "unknown"]);
const PolicyEnum = z.enum(["strict", "confirm", "dev", "allow"]);

const DiscoveredFromSchema = z
  .object({
    scanner: z.string().min(1),
    file: z.string().optional(),
    server: z.string().optional(),
    field: z.string().optional(),
  })
  .strict();

const DatabaseSchema = z
  .object({
    name: z.string().min(1),
    matchers: z.array(MatcherSchema).min(1),
    env: EnvEnum,
    policy: PolicyEnum,
    confidence: z.number().min(0).max(1),
    discovered_from: z.array(DiscoveredFromSchema),
  })
  .strict();

const RulePackEntrySchema = z
  .object({
    pinned_version: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

const RulePacksSchema = z.record(z.string(), RulePackEntrySchema);

const CustomRuleSchema = z
  .object({
    file: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    global: GlobalSchema,
    databases: z.array(DatabaseSchema),
    rule_packs: RulePacksSchema,
    custom_rules: z.array(CustomRuleSchema).default([]),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseSchema>;
export type Matcher = z.infer<typeof MatcherSchema>;
