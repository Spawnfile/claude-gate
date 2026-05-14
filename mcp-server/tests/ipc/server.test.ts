// mcp-server/tests/ipc/server.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { connect } from "node:net";
import { join } from "node:path";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";
import { startIpcServer, type IpcServer } from "../../src/ipc/server";
import { makeTmpDir } from "../helpers/tmpdir";

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

async function sendAndReceive(
  socketPath: string,
  message: unknown,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    const decoder = new FrameDecoder();
    decoder.on("message", (m) => {
      client.end();
      resolve(m);
    });
    decoder.on("error", reject);
    client.on("error", reject);
    client.on("connect", () => {
      client.write(encodeFrame(message));
    });
    client.on("data", (chunk) => decoder.feed(chunk));
  });
}

describe("IPC server (ping)", () => {
  test("responds to a ping request with a pong rationale", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({ socketPath });

    const response = await sendAndReceive(socketPath, {
      protocol_version: "1",
      request_id: "req_test",
      type: "ping",
    });

    expect(response).toMatchObject({
      protocol_version: "1",
      request_id: "req_test",
      decision: "ALLOW",
      rationale: expect.stringMatching(/pong/i),
    });
  });

  test("returns INTERNAL error for invalid request shape", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({ socketPath });

    const response = await sendAndReceive(socketPath, {
      not: "a real request",
    });

    expect(response).toMatchObject({
      decision: null,
      error: { code: expect.stringMatching(/INTERNAL|PARSE_FAILED/) },
    });
  });

  test("server.close() removes the socket file", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const socketPath = join(tmp.dir, "gate.sock");

    server = await startIpcServer({ socketPath });
    await server.close();
    server = null;

    const { existsSync } = await import("node:fs");
    expect(existsSync(socketPath)).toBe(false);
  });
});
