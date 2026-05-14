import { describe, expect, test } from "vitest";
import { ConfigSchema } from "../../src/config/schema.js";

const validMultiDb = {
  version: 1,
  global: {
    fail_policy: { prod: "closed", dev: "open", local: "open" },
    audit: { integrity: "hash_chain", redact_params: true },
  },
  databases: [
    {
      name: "supabase_prod",
      matchers: [
        { tool: "mcp__supabase_prod__*", mcp_server_id: "supabase_prod" },
        {
          tool: "mcp__supabase__*",
          param_match: { project_ref: "prodabc123xyz" },
        },
      ],
      env: "prod",
      policy: "strict",
      confidence: 0.99,
      discovered_from: [
        { scanner: "env_scanner", file: ".env.prod" },
        { scanner: "mcp_config_scanner", server: "supabase_prod" },
      ],
    },
  ],
  rule_packs: {
    sql: { pinned_version: "1.0.0", enabled: true },
  },
  custom_rules: [],
};

describe("ConfigSchema", () => {
  test("accepts the design-doc multi-db example", () => {
    const r = ConfigSchema.safeParse(validMultiDb);
    expect(r.success).toBe(true);
  });

  test("rejects missing version", () => {
    const bad = structuredClone(validMultiDb) as Partial<typeof validMultiDb>;
    delete bad.version;
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects unknown top-level fields", () => {
    const bad = { ...validMultiDb, extra: "nope" };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects matcher with neither tool nor mcp_server_id", () => {
    const bad = structuredClone(validMultiDb);
    bad.databases[0]!.matchers = [{ param_match: { x: "y" } } as never];
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects bad policy enum", () => {
    const bad = structuredClone(validMultiDb);
    (bad.databases[0] as { policy: string }).policy = "wide-open";
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects bad env enum", () => {
    const bad = structuredClone(validMultiDb);
    (bad.databases[0] as { env: string }).env = "staging";
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects confidence outside [0,1]", () => {
    const bad = structuredClone(validMultiDb);
    (bad.databases[0] as { confidence: number }).confidence = 1.2;
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  test("accepts databases with only mcp_server_id matcher", () => {
    const ok = structuredClone(validMultiDb);
    ok.databases[0]!.matchers = [{ mcp_server_id: "supabase_prod" }];
    expect(ConfigSchema.safeParse(ok).success).toBe(true);
  });

  test("accepts databases with only tool matcher", () => {
    const ok = structuredClone(validMultiDb);
    ok.databases[0]!.matchers = [{ tool: "mcp__custom__*" }];
    expect(ConfigSchema.safeParse(ok).success).toBe(true);
  });

  test("accepts empty databases array", () => {
    const ok = { ...validMultiDb, databases: [] };
    expect(ConfigSchema.safeParse(ok).success).toBe(true);
  });

  test("rejects negative confidence", () => {
    const bad = structuredClone(validMultiDb);
    (bad.databases[0] as { confidence: number }).confidence = -0.1;
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects unknown integrity mode", () => {
    const bad = structuredClone(validMultiDb);
    (bad.global.audit as { integrity: string }).integrity = "merkle";
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });
});
