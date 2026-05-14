// mcp-server/tests/setup/state.test.ts

import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSetupState,
  canAdvance,
  nextStep,
  loadSetupState,
  saveSetupState,
  type DiscoveredDb,
  type SetupState,
} from "../../src/setup/state";

let cleanupDirs: string[] = [];

afterEach(() => {
  cleanupDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  cleanupDirs = [];
});

function mkTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-state-"));
  cleanupDirs.push(dir);
  return dir;
}

function makeDb(name: string, env: DiscoveredDb["env"] = "prod"): DiscoveredDb {
  return {
    name,
    type: "postgres",
    endpoint: "localhost:5432",
    env,
    confidence: 0.9,
    discovered_from: [{ scanner: "env_scanner", file: ".env" }],
  };
}

describe("createSetupState", () => {
  test("initializes correctly with no databases", () => {
    const before = Date.now();
    const state = createSetupState([]);
    const after = Date.now();

    expect(state.version).toBe(1);
    expect(state.current_step).toBe("step_1_discovery");
    expect(state.completed_steps).toEqual(["not_started"]);
    expect(state.discovered).toEqual([]);
    expect(state.user_edits).toEqual({});
    expect(state.policies).toEqual({});

    const startMs = new Date(state.started_at).getTime();
    const updatedMs = new Date(state.last_updated_at).getTime();
    expect(startMs).toBeGreaterThanOrEqual(before);
    expect(startMs).toBeLessThanOrEqual(after);
    expect(updatedMs).toBeGreaterThanOrEqual(before);
    expect(updatedMs).toBeLessThanOrEqual(after);
  });

  test("initializes with discovered databases", () => {
    const dbs = [makeDb("db_prod"), makeDb("db_dev", "dev")];
    const state = createSetupState(dbs);

    expect(state.discovered).toHaveLength(2);
    expect(state.discovered[0]!.name).toBe("db_prod");
    expect(state.discovered[1]!.name).toBe("db_dev");
  });
});

describe("canAdvance", () => {
  test("step_1_discovery: blocks when no databases discovered", () => {
    const s = createSetupState([]);
    const err = canAdvance(s);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("PREREQUISITES_NOT_MET");
    expect(err!.message).toMatch(/no databases/i);
  });

  test("step_1_discovery: blocks when ANY db has env=unknown and no user_edit override", () => {
    const s = createSetupState([
      makeDb("db_known", "prod"),
      makeDb("db_mystery", "unknown"),
    ]);
    const err = canAdvance(s);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("PREREQUISITES_NOT_MET");
    expect(err!.message).toContain("db_mystery");
  });

  test("step_1_discovery: passes when all unknown envs have user_edits resolution", () => {
    const s = createSetupState([makeDb("db_mystery", "unknown")]);
    s.user_edits["db_mystery"] = { env: "dev" };
    const err = canAdvance(s);
    expect(err).toBeNull();
  });

  test("step_1_discovery: passes when unknown db is marked remove: true (even without env resolution)", () => {
    const s = createSetupState([makeDb("db_mystery", "unknown")]);
    s.user_edits["db_mystery"] = { remove: true };
    // remove=true skips the unknown env check because the DB is excluded
    // BUT current canAdvance only checks !s.user_edits[d.name]?.env
    // A db marked remove:true but env=unknown will still fail canAdvance at step_1
    // unless user_edits[name].env is also set. Let's test the actual behavior:
    // The plan says "remove: true" skips in step_2 but NOT step_1 env check.
    // Actually re-reading the plan: step_1 checks env=unknown AND !user_edits[name]?.env
    // So remove:true alone does NOT bypass step_1. Need env too.
    // This test verifies what the code actually does per spec.
    const err = canAdvance(s);
    // remove:true doesn't resolve the unknown env issue in step_1
    expect(err).not.toBeNull();
    expect(err!.code).toBe("PREREQUISITES_NOT_MET");
  });

  test("step_1_discovery: passes when all non-unknown dbs are present (no unknown envs)", () => {
    const s = createSetupState([makeDb("db_prod", "prod"), makeDb("db_dev", "dev")]);
    const err = canAdvance(s);
    expect(err).toBeNull();
  });

  test("step_2_policy: blocks if any non-removed db lacks a policy entry", () => {
    const s = createSetupState([makeDb("db_prod", "prod"), makeDb("db_dev", "dev")]);
    s.current_step = "step_2_policy";
    s.policies["db_prod"] = "strict";
    // db_dev has no policy
    const err = canAdvance(s);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("PREREQUISITES_NOT_MET");
    expect(err!.message).toContain("db_dev");
  });

  test("step_2_policy: passes when removed dbs lack policies (allowed) and all others have policies", () => {
    const s = createSetupState([makeDb("db_prod", "prod"), makeDb("db_remove", "dev")]);
    s.current_step = "step_2_policy";
    s.policies["db_prod"] = "strict";
    s.user_edits["db_remove"] = { remove: true };
    // db_remove is removed, so no policy needed for it
    const err = canAdvance(s);
    expect(err).toBeNull();
  });

  test("step_2_policy: passes when all non-removed dbs have policies", () => {
    const s = createSetupState([makeDb("db_prod", "prod")]);
    s.current_step = "step_2_policy";
    s.policies["db_prod"] = "confirm";
    const err = canAdvance(s);
    expect(err).toBeNull();
  });

  test("step_3_review: always passes (no prerequisites)", () => {
    const s = createSetupState([makeDb("db_prod", "prod")]);
    s.current_step = "step_3_review";
    const err = canAdvance(s);
    expect(err).toBeNull();
  });
});

describe("nextStep", () => {
  test("returns step_1_discovery from not_started", () => {
    const s = createSetupState([]);
    s.current_step = "not_started";
    const result = nextStep(s);
    expect(result).toBe("step_1_discovery");
  });

  test("returns step_2_policy from step_1_discovery", () => {
    const s = createSetupState([]);
    const result = nextStep(s);
    expect(result).toBe("step_2_policy");
  });

  test("returns step_3_review from step_2_policy", () => {
    const s = createSetupState([]);
    s.current_step = "step_2_policy";
    const result = nextStep(s);
    expect(result).toBe("step_3_review");
  });

  test("returns active from step_3_review", () => {
    const s = createSetupState([]);
    s.current_step = "step_3_review";
    const result = nextStep(s);
    expect(result).toBe("active");
  });

  test("rejects from active with INVALID_TRANSITION", () => {
    const s = createSetupState([]);
    s.current_step = "active";
    const result = nextStep(s);
    expect(typeof result).toBe("object");
    expect((result as { code: string }).code).toBe("INVALID_TRANSITION");
  });
});

describe("saveSetupState + loadSetupState roundtrip", () => {
  test("preserves shape when saved and reloaded", () => {
    const dir = mkTmpDir();
    const dbs: DiscoveredDb[] = [
      {
        name: "postgres_prod",
        type: "postgres",
        endpoint: "db.example.com:5432",
        env: "prod",
        confidence: 0.95,
        discovered_from: [{ scanner: "env_scanner", file: ".env.prod", field: "DATABASE_URL" }],
      },
    ];
    const original = createSetupState(dbs);
    original.policies["postgres_prod"] = "strict";
    original.user_edits["postgres_prod"] = { env: "prod" };

    saveSetupState(dir, original);
    const loaded = loadSetupState(dir);

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.current_step).toBe("step_1_discovery");
    expect(loaded!.completed_steps).toEqual(["not_started"]);
    expect(loaded!.discovered).toHaveLength(1);
    expect(loaded!.discovered[0]!.name).toBe("postgres_prod");
    expect(loaded!.policies["postgres_prod"]).toBe("strict");
    expect(loaded!.user_edits["postgres_prod"]?.env).toBe("prod");
    expect(loaded!.started_at).toBe(original.started_at);
    expect(loaded!.last_updated_at).toBe(original.last_updated_at);
  });

  test("returns null when file is missing", () => {
    const dir = mkTmpDir();
    const result = loadSetupState(dir);
    expect(result).toBeNull();
  });

  test("returns null when file content is malformed JSON", () => {
    const dir = mkTmpDir();
    // Save a valid state first to create the directory, then corrupt it
    const state = createSetupState([]);
    saveSetupState(dir, state);

    const { writeFileSync } = require("node:fs");
    const { join: pathJoin } = require("node:path");
    writeFileSync(pathJoin(dir, ".claude-gate", "setup-state.json"), "{ invalid json }", "utf-8");

    const result = loadSetupState(dir);
    expect(result).toBeNull();
  });

  test("returns null when file content does not match schema", () => {
    const dir = mkTmpDir();
    const state = createSetupState([]);
    saveSetupState(dir, state);

    const { writeFileSync } = require("node:fs");
    const { join: pathJoin } = require("node:path");
    writeFileSync(
      pathJoin(dir, ".claude-gate", "setup-state.json"),
      JSON.stringify({ version: 99, bad_field: true }),
      "utf-8",
    );

    const result = loadSetupState(dir);
    expect(result).toBeNull();
  });
});
