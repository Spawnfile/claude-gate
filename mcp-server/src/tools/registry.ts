// mcp-server/src/tools/registry.ts
//
// Hub registry: collects all gate.* GateTool definitions and wires them into
// an MCP Server instance via ListTools + CallTool request handlers.
//
// Each handler file exports an array of GateTool objects. Import them here and
// merge them into the `tools` array that registerAllTools uses.

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Bootstrap } from "../policy/registry-bootstrap.js";
import type { PendingActionStore } from "../setup/pending-action.js";
import { pingToolDef } from "./ping.js";
import { statusTools } from "./status.js";
import { setupTools } from "./setup-tools.js";
import { dbTools } from "./db-tools.js";
import { allowOnceTools } from "./allow-once.js";
import { debugTools } from "./debug-tools.js";
import { configTools } from "./config-tools.js";

export interface ToolContext {
  bootstrap: Bootstrap;
  pendingActions: PendingActionStore;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface GateTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export function registerAllTools(mcp: Server, ctx: ToolContext): void {
  const tools: GateTool[] = [
    pingToolDef,
    ...statusTools,
    ...setupTools,
    ...dbTools,
    ...allowOnceTools,
    ...debugTools,
    ...configTools,
  ];

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown tool: ${request.params.name}`,
      );
    }
    const result = await tool.handler(request.params.arguments, ctx);
    return { content: result.content };
  });
}
