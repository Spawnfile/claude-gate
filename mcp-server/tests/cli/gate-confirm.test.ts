// mcp-server/tests/cli/gate-confirm.test.ts
import { describe, test, expect, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { startIpcServer, type IpcServer } from "../../src/ipc/server";
import { PendingActionStore } from "../../src/setup/pending-action";
import { runGateConfirm } from "../../src/cli/gate-confirm";
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

const SESSION_ID = "sess_cli";
const PROJECT_ROOT = "/home/user/project";

function makeBootstrap() {
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
  payload: { databases: ["db_a"] },
};

function makeStreams(inputData: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const errOutput = new PassThrough();

  // Pre-fill stdin so readline can consume it
  input.write(inputData);
  input.end();

  let outData = "";
  let errData = "";
  output.on("data", (chunk: Buffer) => { outData += chunk.toString(); });
  errOutput.on("data", (chunk: Buffer) => { errData += chunk.toString(); });

  return {
    input,
    output,
    errOutput,
    getOut: () => outData,
    getErr: () => errData,
  };
}

describe("gate-confirm CLI", () => {
  test("y answer + valid action_id + matching scope -> return 0 and store has confirmed:true", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    const action = store.create(ACTION_OPTS);
    server = await startIpcServer({ socketPath, bootstrap: makeBootstrap(), pendingActions: store });

    const { input, output, errOutput, getOut } = makeStreams("y\n");
    const code = await runGateConfirm({
      actionId: action.action_id,
      socketPath,
      projectRoot: PROJECT_ROOT,
      input,
      output,
      errorOutput: errOutput,
    });

    expect(code).toBe(0);
    expect(getOut()).toContain("Confirmed. Return to Claude and re-issue the command.");

    // Store should have confirmed:true
    const described = store.describe(action.action_id);
    expect("code" in described).toBe(false);
    if (!("code" in described)) {
      expect(described.confirmed).toBe(true);
    }
  });

  test("N answer -> return 1 and store has confirmed:false", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    const action = store.create(ACTION_OPTS);
    server = await startIpcServer({ socketPath, bootstrap: makeBootstrap(), pendingActions: store });

    const { input, output, errOutput, getOut } = makeStreams("n\n");
    const code = await runGateConfirm({
      actionId: action.action_id,
      socketPath,
      projectRoot: PROJECT_ROOT,
      input,
      output,
      errorOutput: errOutput,
    });

    expect(code).toBe(1);
    expect(getOut()).toContain("Aborted.");

    // Store should still have confirmed:false
    const described = store.describe(action.action_id);
    expect("code" in described).toBe(false);
    if (!("code" in described)) {
      expect(described.confirmed).toBe(false);
    }
  });

  test("non-existent action_id -> return 1 with error message", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    server = await startIpcServer({ socketPath, bootstrap: makeBootstrap(), pendingActions: store });

    const { input, output, errOutput, getOut, getErr } = makeStreams("y\n");
    const code = await runGateConfirm({
      actionId: "act_doesnotexist",
      socketPath,
      projectRoot: PROJECT_ROOT,
      input,
      output,
      errorOutput: errOutput,
    });

    expect(code).toBe(1);
    expect(getErr()).toContain("NOT_FOUND");
  });

  test("WRONG_SCOPE: gate-confirm projectRoot does not match action scope -> return 1", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");
    const store = new PendingActionStore();
    // Action created for a different project root
    const action = store.create({
      ...ACTION_OPTS,
      project_root: "/home/user/other-project",
    });
    server = await startIpcServer({ socketPath, bootstrap: makeBootstrap(), pendingActions: store });

    const { input, output, errOutput, getErr } = makeStreams("y\n");
    const code = await runGateConfirm({
      actionId: action.action_id,
      socketPath,
      projectRoot: PROJECT_ROOT,
      input,
      output,
      errorOutput: errOutput,
    });

    // The describe will succeed (no scope check on describe), but consume (markConfirmed)
    // will fail with WRONG_SCOPE since bootstrap.project_root != action.scope.project_root
    expect(code).toBe(1);
    expect(getErr()).toContain("WRONG_SCOPE");
  });

  test("IPC timeout (no server listening) -> return 1", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "no-server.sock");
    // Don't start any server

    const { input, output, errOutput, getErr } = makeStreams("y\n");
    const code = await runGateConfirm({
      actionId: "act_anything",
      socketPath,
      projectRoot: PROJECT_ROOT,
      input,
      output,
      errorOutput: errOutput,
    });

    expect(code).toBe(1);
    expect(getErr()).toContain("IPC error");
  }, 5000);

  test("back-compat: reads JSON-encoded rationale when action_metadata is absent (pre-0.5 server)", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "legacy-gate.sock");

    // Spin up a minimal ad-hoc IPC server that responds with legacy shape (no action_metadata)
    const { createServer } = await import("node:net");
    const { encodeFrame, FrameDecoder } = await import("../../src/ipc/framing.js");

    let requestCount = 0;

    const legacyServer = createServer((client) => {
      const decoder = new FrameDecoder();

      decoder.on("message", (msg: unknown) => {
        const req = msg as Record<string, unknown>;
        requestCount++;

        // First request: gate_confirm_describe
        // Second request: gate_confirm_consume
        if (requestCount === 1) {
          // Respond with legacy shape for describe: no action_metadata field,
          // metadata is JSON-encoded in rationale
          const legacyResp = {
            protocol_version: "1",
            request_id: req.request_id,
            decision: "ALLOW",
            rationale: JSON.stringify({
              action_id: "act_legacy_001",
              action_type: "setup_finish",
              payload_summary: "Activate gating for 2 databases",
              expires_at_ms: Date.now() + 60_000,
            }),
          };
          client.write(encodeFrame(legacyResp));
        } else if (requestCount === 2) {
          // Respond to consume request
          const legacyResp = {
            protocol_version: "1",
            request_id: req.request_id,
            decision: "ALLOW",
            rationale: "confirmed",
          };
          client.write(encodeFrame(legacyResp));
        }
      });

      decoder.on("error", () => {
        client.destroy();
      });

      client.on("data", (chunk: Buffer) => {
        decoder.feed(chunk);
      });

      client.on("error", () => {
        // ignore
      });
    });

    await new Promise<void>((resolve) => {
      legacyServer.listen(socketPath, () => resolve());
    });

    const store = new PendingActionStore();
    const action = store.create(ACTION_OPTS);

    // Store is just a mock here; the legacy server above will respond directly
    // without the real gate-mcp logic

    const { input, output, errOutput, getOut } = makeStreams("y\n");
    const code = await runGateConfirm({
      actionId: action.action_id,
      socketPath,
      projectRoot: PROJECT_ROOT,
      input,
      output,
      errorOutput: errOutput,
    });

    legacyServer.close();

    expect(code).toBe(0);
    expect(getOut()).toContain("setup_finish");
  });
});
