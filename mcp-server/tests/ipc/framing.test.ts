// mcp-server/tests/ipc/framing.test.ts
import { describe, expect, test } from "vitest";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";

describe("IPC framing", () => {
  test("encodes a small JSON object as length prefix + utf-8 bytes", () => {
    const frame = encodeFrame({ hello: "world" });
    const expectedLen = Buffer.byteLength('{"hello":"world"}', "utf-8");
    expect(frame.readUInt32BE(0)).toBe(expectedLen);
    expect(frame.subarray(4).toString("utf-8")).toBe('{"hello":"world"}');
  });

  test("encodes utf-8 multi-byte characters with correct byte length", () => {
    const frame = encodeFrame({ greeting: "hello" });
    const expectedLen = Buffer.byteLength('{"greeting":"hello"}', "utf-8");
    expect(frame.readUInt32BE(0)).toBe(expectedLen);
  });

  test("decoder yields a single message from a complete frame", () => {
    const decoder = new FrameDecoder();
    const messages: unknown[] = [];
    decoder.on("message", (m) => messages.push(m));
    decoder.feed(encodeFrame({ kind: "ping" }));
    expect(messages).toEqual([{ kind: "ping" }]);
  });

  test("decoder yields multiple messages from concatenated frames", () => {
    const decoder = new FrameDecoder();
    const messages: unknown[] = [];
    decoder.on("message", (m) => messages.push(m));
    const buf = Buffer.concat([
      encodeFrame({ n: 1 }),
      encodeFrame({ n: 2 }),
      encodeFrame({ n: 3 }),
    ]);
    decoder.feed(buf);
    expect(messages).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  test("decoder buffers partial frames across feeds", () => {
    const decoder = new FrameDecoder();
    const messages: unknown[] = [];
    decoder.on("message", (m) => messages.push(m));
    const full = encodeFrame({ split: true });
    decoder.feed(full.subarray(0, 3));
    expect(messages).toEqual([]);
    decoder.feed(full.subarray(3, 7));
    expect(messages).toEqual([]);
    decoder.feed(full.subarray(7));
    expect(messages).toEqual([{ split: true }]);
  });

  test("decoder rejects oversize frames (> 1 MiB)", () => {
    const decoder = new FrameDecoder();
    const errors: Error[] = [];
    decoder.on("error", (e) => errors.push(e));
    const tooBig = Buffer.alloc(4);
    tooBig.writeUInt32BE(2 * 1024 * 1024, 0); // 2 MiB
    decoder.feed(tooBig);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/oversize/i);
  });

  test("decoder rejects malformed JSON inside a frame", () => {
    const decoder = new FrameDecoder();
    const errors: Error[] = [];
    decoder.on("error", (e) => errors.push(e));
    const badPayload = Buffer.from("{not-json", "utf-8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(badPayload.length, 0);
    decoder.feed(Buffer.concat([len, badPayload]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/json/i);
  });
});
