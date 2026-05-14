// mcp-server/src/ipc/framing.ts
import { EventEmitter } from "node:events";

const MAX_FRAME_BYTES = 1 * 1024 * 1024; // 1 MiB

export function encodeFrame(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length, 0);
  return Buffer.concat([header, json]);
}

type DecoderEvents = {
  message: [unknown];
  error: [Error];
};

export class FrameDecoder extends EventEmitter<DecoderEvents> {
  private buffer = Buffer.alloc(0);

  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (len > MAX_FRAME_BYTES) {
        this.emit("error", new Error(`oversize frame: ${len} bytes`));
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (this.buffer.length < 4 + len) return; // wait for more
      const payload = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      try {
        const message: unknown = JSON.parse(payload.toString("utf-8"));
        this.emit("message", message);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.emit("error", new Error(`invalid json: ${msg}`));
      }
    }
  }
}
