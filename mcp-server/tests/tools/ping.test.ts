// mcp-server/tests/tools/ping.test.ts
import { describe, expect, test } from "vitest";
import { handlePingTool } from "../../src/tools/ping.js";

describe("gate.ping tool", () => {
  test("returns pong with timestamp and protocol version", () => {
    const before = Date.now();
    const result = handlePingTool();
    const after = Date.now();

    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toMatch(/pong/);

    const metadata = result.metadata as { timestamp_ms: number; protocol_version: string };
    expect(metadata.timestamp_ms).toBeGreaterThanOrEqual(before);
    expect(metadata.timestamp_ms).toBeLessThanOrEqual(after);
    expect(metadata.protocol_version).toBe("1");
  });
});
