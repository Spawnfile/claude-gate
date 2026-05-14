// mcp-server/tests/policy/rule-pack-loader.test.ts
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  loadRulePackRegistry,
  RulePackLoadError,
} from "../../src/policy/rule-pack-loader";

const fix = (name: string) => resolve(__dirname, "fixtures", name);

describe("loadRulePackRegistry", () => {
  test("loads sql.yaml and policies.yaml from a directory", () => {
    const reg = loadRulePackRegistry({
      rulesDir: fix("rules-good"),
      pinned: {},
    });
    expect(reg.packs.size).toBe(1);
    expect(reg.packs.get("sql")?.version).toBe("1.0.0");
    expect(reg.policies["strict"].CRIT).toBe("DENY");
    expect(reg.policies["allow"].HIGH).toBe("ALLOW");
  });

  test("respects pinned_version when multiple versions exist", () => {
    const reg = loadRulePackRegistry({
      rulesDir: fix("rules-pinned"),
      pinned: { sql: "1.0.0" },
    });
    expect(reg.packs.get("sql")?.version).toBe("1.0.0");
  });

  test("falls back to the default (versionless) file when pin is absent", () => {
    const reg = loadRulePackRegistry({
      rulesDir: fix("rules-pinned"),
      pinned: {},
    });
    expect(reg.packs.get("sql")?.version).toBe("1.2.0");
  });

  test("throws when rules dir is missing", () => {
    expect(() =>
      loadRulePackRegistry({
        rulesDir: fix("does-not-exist"),
        pinned: {},
      }),
    ).toThrow(RulePackLoadError);
  });

  test("throws on invalid yaml", () => {
    expect(() =>
      loadRulePackRegistry({
        rulesDir: fix("rules-broken-yaml"),
        pinned: {},
      }),
    ).toThrow(RulePackLoadError);
  });

  test("throws when policies.yaml is missing from the rules dir", () => {
    expect(() =>
      loadRulePackRegistry({
        rulesDir: fix("rules-missing-policies"),
        pinned: {},
      }),
    ).toThrow(/policies\.yaml missing/i);
  });

  test("throws when a pack's version mismatches the pinned version", () => {
    expect(() =>
      loadRulePackRegistry({
        rulesDir: fix("rules-pinned"),
        pinned: { sql: "9.9.9" },
      }),
    ).toThrow(RulePackLoadError);
  });
});

describe("loadRulePackRegistry with userRulesDir", () => {
  test("user override wins when user pack matches pinned version", () => {
    const reg = loadRulePackRegistry({
      rulesDir: fix("rules-user-override"),
      userRulesDir: fix("user-rules-override"),
      pinned: { sql: "1.0.0" },
    });
    expect(reg.packs.get("sql")?.description).toBe("user pack");
  });

  test("missing userRulesDir is silently ignored and shipped pack loads normally", () => {
    const reg = loadRulePackRegistry({
      rulesDir: fix("rules-user-override"),
      userRulesDir: fix("nonexistent-user-rules"),
      pinned: { sql: "1.0.0" },
    });
    expect(reg.packs.get("sql")?.description).toBe("shipped pack");
  });

  test("mismatched user pack version is rejected with canonical error message", () => {
    expect(() =>
      loadRulePackRegistry({
        rulesDir: fix("rules-user-mismatch"),
        userRulesDir: fix("user-rules-mismatch"),
        pinned: { sql: "1.0.0" },
      }),
    ).toThrow(/pinned to "1\.0\.0".*no matching version/);
  });
});
