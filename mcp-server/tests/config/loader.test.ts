// mcp-server/tests/config/loader.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeTmpDir } from "../helpers/tmpdir.js";
import {
  loadConfig,
  ConfigLoadError,
  ConfigErrorCode,
} from "../../src/config/loader.js";

const FIXTURES = resolve(__dirname, "fixtures");

let cleanupTmp: (() => void) | null = null;

afterEach(() => {
  if (cleanupTmp) {
    cleanupTmp();
    cleanupTmp = null;
  }
});

function setupProject(fixtureName: string): string {
  const tmp = makeTmpDir();
  cleanupTmp = tmp.cleanup;
  mkdirSync(join(tmp.dir, ".claude-gate"), { recursive: true });
  copyFileSync(
    join(FIXTURES, fixtureName),
    join(tmp.dir, ".claude-gate/config.yaml"),
  );
  return tmp.dir;
}

describe("loadConfig", () => {
  test("loads and validates the multi-db fixture", () => {
    const proj = setupProject("valid-multi-db.yaml");
    const cfg = loadConfig(proj);
    expect(cfg.version).toBe(1);
    expect(cfg.databases).toHaveLength(2);
    expect(cfg.databases[0]!.name).toBe("supabase_prod");
    expect(cfg.databases[1]!.policy).toBe("allow");
  });

  test("throws CONFIG_NOT_FOUND when no config exists", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    expect(() => loadConfig(tmp.dir)).toThrow(ConfigLoadError);
    try {
      loadConfig(tmp.dir);
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError);
      expect((e as ConfigLoadError).code).toBe(ConfigErrorCode.NOT_FOUND);
    }
  });

  test("throws YAML_PARSE_ERROR for malformed YAML", () => {
    const proj = setupProject("invalid-bad-yaml.yaml");
    try {
      loadConfig(proj);
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError);
      expect((e as ConfigLoadError).code).toBe(ConfigErrorCode.YAML_PARSE_ERROR);
    }
  });

  test("throws SCHEMA_VALIDATION for fixture missing version", () => {
    const proj = setupProject("invalid-missing-version.yaml");
    try {
      loadConfig(proj);
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigLoadError);
      expect((e as ConfigLoadError).code).toBe(
        ConfigErrorCode.SCHEMA_VALIDATION,
      );
    }
  });

  test("error message includes config path for diagnosability", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    try {
      loadConfig(tmp.dir);
      expect.fail("expected throw");
    } catch (e) {
      expect((e as ConfigLoadError).message).toContain(tmp.dir);
    }
  });

  test("default custom_rules is an empty array when omitted", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    mkdirSync(join(tmp.dir, ".claude-gate"), { recursive: true });
    writeFileSync(
      join(tmp.dir, ".claude-gate/config.yaml"),
      `version: 1
global:
  fail_policy: { prod: closed, dev: open, local: open }
  audit: { integrity: hash_chain, redact_params: true }
databases: []
rule_packs: {}
`,
    );
    const cfg = loadConfig(tmp.dir);
    expect(cfg.custom_rules).toEqual([]);
  });
});
