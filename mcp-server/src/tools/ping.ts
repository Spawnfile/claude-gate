// mcp-server/src/tools/ping.ts
import type { GateTool } from "./registry.js";

export interface PingResult {
  content: Array<{ type: "text"; text: string }>;
  metadata: {
    timestamp_ms: number;
    protocol_version: string;
  };
}

export function handlePingTool(): PingResult {
  return {
    content: [{ type: "text", text: "pong" }],
    metadata: {
      timestamp_ms: Date.now(),
      protocol_version: "1",
    },
  };
}

export const pingToolDef: GateTool = {
  name: "gate.ping",
  description: "Health check; returns pong",
  inputSchema: { type: "object", properties: {} },
  handler: () => {
    const r = handlePingTool();
    return { content: r.content };
  },
};
