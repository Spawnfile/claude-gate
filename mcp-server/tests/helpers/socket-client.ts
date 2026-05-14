// mcp-server/tests/helpers/socket-client.ts
import { connect } from "node:net";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing.js";

export async function ipcCall(
  socketPath: string,
  message: unknown,
  timeoutMs = 1000,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);

    const client = connect(socketPath);
    const decoder = new FrameDecoder();
    decoder.on("message", (m) => {
      clearTimeout(timer);
      client.end();
      resolve(m);
    });
    decoder.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    client.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    client.on("connect", () => client.write(encodeFrame(message)));
    client.on("data", (c) => decoder.feed(c));
  });
}
