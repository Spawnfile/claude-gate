// mcp-server/tests/ipc/server-confirm.test.ts
import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { startIpcServer, type IpcServer } from "../../src/ipc/server";
import { PendingActionStore } from "../../src/setup/pending-action";
import { ipcCall } from "../helpers/socket-client";
import { makeTmpDir } from "../helpers/tmpdir";
import { createSessionState } from "../../src/policy/session";

let server: IpcServer | null = null;
let cleanupTmp: (() => void) | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  if (cleanupTmp) {
    cleanupTmp();
    cleanupTmp = null;
  }
});

const SESSION_ID = "s_self";
const PROJECT_ROOT = "/home/user/project";

function makeBootstrap(tmpDir: string) {
  return {
    project_root: PROJECT_ROOT,
    session_id: SESSION_ID,
    databases: () => [],
    rule_packs: () => ({ packs: new Map(), policies: {} as Record<string, never> }),
    session: () => createSessionState(SESSION_ID),
    audit: () => ({ append: () => {}, close: () => {} }),
    config: () => null,
    debugState: { active: false, expires_at_ms: 0, intercept_patterns: [] as string[] },
    reload: () => {},
    close: () => {},
  };
}

const ACTION_OPTS = {
  project_root: PROJECT_ROOT,
  session_id: SESSION_ID,
  cwd_at_creation: PROJECT_ROOT,
  action_type: "setup_finish",
  payload_summary: "Activate gating for 2 databases",
  payload: { databases: ["db_a", "db_b"] },
};

describe("IPC server gate_confirm_describe", () => {
  test("returns ALLOW with action_metadata containing action_id when action exists", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    const action = store.create(ACTION_OPTS);
    const bootstrap = makeBootstrap(tmp.dir);
    server = await startIpcServer({ socketPath, bootstrap, pendingActions: store });

    const res = await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_desc_1",
      type: "gate_confirm_describe",
      payload: { action_id: action.action_id },
    }) as Record<string, unknown>;

    expect(res.decision).toBe("ALLOW");
    expect(res.error).toBeUndefined();
    const meta = res.action_metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.action_id).toBe(action.action_id);
    expect(meta.action_type).toBe("setup_finish");
    expect(meta.payload_summary).toBe("Activate gating for 2 databases");
    expect(typeof meta.expires_at_ms).toBe("number");
    expect([undefined, ""]).toContain(res.rationale);
  });

  test("gate_confirm_describe response populates action_metadata (typed); rationale is empty", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    const action = store.create(ACTION_OPTS);
    const bootstrap = makeBootstrap(tmp.dir);
    server = await startIpcServer({ socketPath, bootstrap, pendingActions: store });

    const res = await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_desc_guard",
      type: "gate_confirm_describe",
      payload: { action_id: action.action_id },
    }) as Record<string, unknown>;

    expect(res.decision).toBe("ALLOW");
    const meta = res.action_metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(typeof meta.action_id).toBe("string");
    expect(typeof meta.action_type).toBe("string");
    expect(typeof meta.payload_summary).toBe("string");
    expect(typeof meta.expires_at_ms).toBe("number");
    expect([undefined, ""]).toContain(res.rationale);
  });

  test("returns INTERNAL with NOT_FOUND for non-existent action_id", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    const bootstrap = makeBootstrap(tmp.dir);
    server = await startIpcServer({ socketPath, bootstrap, pendingActions: store });

    const res = await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_desc_2",
      type: "gate_confirm_describe",
      payload: { action_id: "act_nonexistent" },
    }) as Record<string, unknown>;

    expect(res.decision).toBeNull();
    expect((res.error as Record<string, unknown>)?.code).toBe("GATE_ACTION_ERROR");
    expect((res.error as Record<string, unknown>)?.message).toBe("NOT_FOUND");
  });

  test("returns UNSUPPORTED when no pendingActions provided", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const bootstrap = makeBootstrap(tmp.dir);
    // No pendingActions
    server = await startIpcServer({ socketPath, bootstrap });

    const res = await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_desc_3",
      type: "gate_confirm_describe",
      payload: { action_id: "act_anything" },
    }) as Record<string, unknown>;

    expect((res.error as Record<string, unknown>)?.code).toBe("UNSUPPORTED");
  });
});

describe("IPC server gate_confirm_consume", () => {
  test("returns ALLOW and sets confirmed:true on the action", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    const action = store.create(ACTION_OPTS);
    const bootstrap = makeBootstrap(tmp.dir);
    server = await startIpcServer({ socketPath, bootstrap, pendingActions: store });

    const res = await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_cons_1",
      type: "gate_confirm_consume",
      payload: { action_id: action.action_id },
    }) as Record<string, unknown>;

    expect(res.decision).toBe("ALLOW");
    expect(res.rationale).toBe("confirmed");
    expect(res.error).toBeUndefined();

    // The store should have confirmed=true
    const described = store.describe(action.action_id);
    expect("code" in described).toBe(false);
    if (!("code" in described)) {
      expect(described.confirmed).toBe(true);
    }

    // isConfirmed should return the action (not an error code)
    const isConf = store.isConfirmed(action.action_id, {
      session_id: SESSION_ID,
      project_root: PROJECT_ROOT,
    });
    expect("code" in isConf).toBe(false);
  });

  test("returns WRONG_SCOPE error when session_id mismatches", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    // Action created with a different session
    const action = store.create({
      ...ACTION_OPTS,
      session_id: "s_other",
    });
    const bootstrap = makeBootstrap(tmp.dir);
    server = await startIpcServer({ socketPath, bootstrap, pendingActions: store });

    const res = await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_cons_scope",
      type: "gate_confirm_consume",
      payload: { action_id: action.action_id },
    }) as Record<string, unknown>;

    expect(res.decision).toBeNull();
    expect((res.error as Record<string, unknown>)?.code).toBe("GATE_ACTION_ERROR");
    expect((res.error as Record<string, unknown>)?.message).toBe("WRONG_SCOPE");
  });

  test("after IPC consume: second describe returns entry with confirmed:true (IPC layer does not call consume)", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    const action = store.create(ACTION_OPTS);
    const bootstrap = makeBootstrap(tmp.dir);
    server = await startIpcServer({ socketPath, bootstrap, pendingActions: store });

    // Consume via IPC (marks confirmed, does NOT set consumed)
    await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_cons_2a",
      type: "gate_confirm_consume",
      payload: { action_id: action.action_id },
    });

    // Second describe should return the entry with confirmed:true, NOT CONSUMED
    // (consumed is only set by MCP tool layer after the action succeeds)
    const described = store.describe(action.action_id);
    expect("code" in described).toBe(false);
    if (!("code" in described)) {
      expect(described.confirmed).toBe(true);
      expect(described.consumed).toBe(false);
    }
  });

  test("returns UNSUPPORTED when no pendingActions provided", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const bootstrap = makeBootstrap(tmp.dir);
    server = await startIpcServer({ socketPath, bootstrap });

    const res = await ipcCall(socketPath, {
      protocol_version: "1",
      request_id: "req_cons_unsp",
      type: "gate_confirm_consume",
      payload: { action_id: "act_anything" },
    }) as Record<string, unknown>;

    expect((res.error as Record<string, unknown>)?.code).toBe("UNSUPPORTED");
  });
});
