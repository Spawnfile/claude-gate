// mcp-server/tests/setup/pending-action.test.ts
import { describe, test, expect } from "vitest";
import { PendingActionStore } from "../../src/setup/pending-action";

function makeStore(initialTime = 1_000_000) {
  let t = initialTime;
  const advance = (ms: number) => { t += ms; };
  const store = new PendingActionStore(() => t);
  return { store, advance };
}

const baseOpts = {
  project_root: "/home/user/project",
  session_id: "sess_abc",
  cwd_at_creation: "/home/user/project",
  action_type: "setup_finish",
  payload_summary: "Activate gating for 2 databases",
  payload: { databases: ["db_a", "db_b"] },
};

const baseScope = {
  session_id: "sess_abc",
  project_root: "/home/user/project",
};

describe("PendingActionStore", () => {
  test("create produces unique action_ids on successive calls", () => {
    const { store } = makeStore();
    const a1 = store.create(baseOpts);
    const a2 = store.create(baseOpts);
    expect(a1.action_id).toMatch(/^act_[0-9a-f]{16}$/);
    expect(a2.action_id).toMatch(/^act_[0-9a-f]{16}$/);
    expect(a1.action_id).not.toBe(a2.action_id);
  });

  test("describe before TTL returns the entry", () => {
    const { store, advance } = makeStore();
    const action = store.create({ ...baseOpts, ttl_ms: 60_000 });
    advance(30_000);
    const result = store.describe(action.action_id);
    expect("code" in result).toBe(false);
    if (!("code" in result)) {
      expect(result.action_id).toBe(action.action_id);
      expect(result.action_type).toBe("setup_finish");
    }
  });

  test("describe after TTL returns EXPIRED and purges the entry from internal map", () => {
    const { store, advance } = makeStore();
    const action = store.create({ ...baseOpts, ttl_ms: 5_000 });
    advance(6_000);
    const result = store.describe(action.action_id);
    expect(result).toEqual({ code: "EXPIRED" });
    // Second call should return NOT_FOUND since the entry was purged
    const second = store.describe(action.action_id);
    expect(second).toEqual({ code: "NOT_FOUND" });
  });

  test("markConfirmed rejects WRONG_SCOPE when session_id mismatches", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    const result = store.markConfirmed(action.action_id, {
      session_id: "sess_other",
      project_root: baseOpts.project_root,
    });
    expect(result).toEqual({ code: "WRONG_SCOPE" });
  });

  test("markConfirmed rejects WRONG_SCOPE when project_root mismatches", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    const result = store.markConfirmed(action.action_id, {
      session_id: baseOpts.session_id,
      project_root: "/home/user/other",
    });
    expect(result).toEqual({ code: "WRONG_SCOPE" });
  });

  test("markConfirmed sets confirmed:true on the entry", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    const result = store.markConfirmed(action.action_id, baseScope);
    expect("code" in result).toBe(false);
    if (!("code" in result)) {
      expect(result.confirmed).toBe(true);
    }
  });

  test("isConfirmed returns NOT_CONFIRMED before markConfirmed is called", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    const result = store.isConfirmed(action.action_id, baseScope);
    expect(result).toEqual({ code: "NOT_CONFIRMED" });
  });

  test("isConfirmed returns the entry after markConfirmed", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    store.markConfirmed(action.action_id, baseScope);
    const result = store.isConfirmed(action.action_id, baseScope);
    expect("code" in result).toBe(false);
    if (!("code" in result)) {
      expect(result.confirmed).toBe(true);
      expect(result.action_id).toBe(action.action_id);
    }
  });

  test("isConfirmed returns WRONG_SCOPE if scope mismatches", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    store.markConfirmed(action.action_id, baseScope);
    const result = store.isConfirmed(action.action_id, {
      session_id: "sess_other",
      project_root: baseOpts.project_root,
    });
    expect(result).toEqual({ code: "WRONG_SCOPE" });
  });

  test("after markConfirmed + consume: describe returns CONSUMED; isConfirmed returns CONSUMED", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    store.markConfirmed(action.action_id, baseScope);
    store.consume(action.action_id);

    const descResult = store.describe(action.action_id);
    expect(descResult).toEqual({ code: "CONSUMED" });

    const isConfResult = store.isConfirmed(action.action_id, baseScope);
    expect(isConfResult).toEqual({ code: "CONSUMED" });
  });

  test("TTL uses injected now() deterministically", () => {
    let t = 5_000;
    const store = new PendingActionStore(() => t);
    const action = store.create({ ...baseOpts, ttl_ms: 10_000 });

    // At t=14_999 (9999ms elapsed): not expired
    t = 14_999;
    expect("code" in store.describe(action.action_id)).toBe(false);

    // At t=15_001 (10001ms elapsed): expired
    t = 15_001;
    const result = store.describe(action.action_id);
    expect(result).toEqual({ code: "EXPIRED" });
  });

  test("happy path round-trip: create, markConfirmed, isConfirmed, consume", () => {
    const { store } = makeStore();
    const action = store.create(baseOpts);
    expect(action.confirmed).toBe(false);
    expect(action.consumed).toBe(false);

    store.markConfirmed(action.action_id, baseScope);
    const confirmed = store.isConfirmed(action.action_id, baseScope);
    expect("code" in confirmed).toBe(false);
    if (!("code" in confirmed)) {
      expect(confirmed.confirmed).toBe(true);
    }

    store.consume(action.action_id);
    expect(store.describe(action.action_id)).toEqual({ code: "CONSUMED" });
  });
});
