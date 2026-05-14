import { describe, test, expect } from "vitest";
import { computeNotice } from "../src/notices";
import type { DriftReport } from "../src/discovery/drift";
import type { RegistryResource } from "../src/discovery/registry";

// Minimal RegistryResource fixture
function makeResource(name: string): RegistryResource {
  return {
    name,
    type: "postgres",
    endpoint: "localhost:5432",
    env: "prod",
    confidence: 0.99,
    discovered_from: [],
  };
}

const emptyDrift: DriftReport = { added: [], removed: [], changed: [] };

describe("computeNotice", () => {
  test("config=null produces first-run notice", () => {
    const result = computeNotice({ config: null, drift: null, debug_active: false });
    expect(result).not.toBeNull();
    expect(result).toContain("[claude-gate] First time using claude-gate in this project.");
    expect(result).toContain("/gate setup");
  });

  test("config=null without drift or debug only has first-run section", () => {
    const result = computeNotice({ config: null, drift: null, debug_active: false });
    expect(result).toContain("Audit-only mode");
    expect(result).not.toContain("Coverage drift");
    expect(result).not.toContain("GATE DEBUG MODE");
  });

  test("drift with one added resource contains the added name", () => {
    const drift: DriftReport = {
      added: [makeResource("supabase_prod")],
      removed: [],
      changed: [],
    };
    const result = computeNotice({ config: {} as never, drift, debug_active: false });
    expect(result).not.toBeNull();
    expect(result).toContain("supabase_prod");
    expect(result).toContain("Added (1)");
  });

  test("drift with one removed resource contains Removed (1)", () => {
    const drift: DriftReport = {
      added: [],
      removed: [makeResource("old_db")],
      changed: [],
    };
    const result = computeNotice({ config: {} as never, drift, debug_active: false });
    expect(result).not.toBeNull();
    expect(result).toContain("Removed (1)");
    expect(result).toContain("old_db");
  });

  test("drift with one changed resource contains Changed (1)", () => {
    const before = makeResource("some_db");
    const after = { ...before, confidence: 0.88 };
    const drift: DriftReport = {
      added: [],
      removed: [],
      changed: [{ name: "some_db", before, after }],
    };
    const result = computeNotice({ config: {} as never, drift, debug_active: false });
    expect(result).not.toBeNull();
    expect(result).toContain("Changed (1)");
    expect(result).toContain("some_db");
  });

  test("empty drift (all arrays empty) produces no drift section", () => {
    const result = computeNotice({ config: {} as never, drift: emptyDrift, debug_active: false });
    expect(result).toBeNull();
  });

  test("null drift produces no drift section", () => {
    const result = computeNotice({ config: {} as never, drift: null, debug_active: false });
    expect(result).toBeNull();
  });

  test("debug_active produces the debug banner", () => {
    const result = computeNotice({
      config: {} as never,
      drift: null,
      debug_active: true,
      debug_expires_minutes: 30,
    });
    expect(result).not.toBeNull();
    expect(result).toContain("GATE DEBUG MODE");
    expect(result).toContain("30m");
  });

  test("debug_active with no expires_minutes defaults to 60m", () => {
    const result = computeNotice({
      config: {} as never,
      drift: null,
      debug_active: true,
    });
    expect(result).toContain("60m");
  });

  test("all three sections stack with blank lines between", () => {
    const drift: DriftReport = {
      added: [makeResource("new_db")],
      removed: [],
      changed: [],
    };
    const result = computeNotice({
      config: null,
      drift,
      debug_active: true,
      debug_expires_minutes: 15,
    });
    expect(result).not.toBeNull();
    expect(result).toContain("[claude-gate] First time using claude-gate in this project.");
    expect(result).toContain("Coverage drift");
    expect(result).toContain("GATE DEBUG MODE");
    // Sections are separated by double newlines
    expect(result).toContain("\n\n");
    const parts = result!.split("\n\n");
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  test("empty case (config set, no drift, no debug) returns null", () => {
    const result = computeNotice({
      config: {} as never,
      drift: null,
      debug_active: false,
    });
    expect(result).toBeNull();
  });

  test("drift notice includes run /gate setup prompt", () => {
    const drift: DriftReport = {
      added: [makeResource("added_db")],
      removed: [],
      changed: [],
    };
    const result = computeNotice({ config: {} as never, drift, debug_active: false });
    expect(result).toContain("Run /gate setup to bring claude-gate up to date.");
  });
});
