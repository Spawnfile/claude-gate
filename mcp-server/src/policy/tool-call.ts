// mcp-server/src/policy/tool-call.ts
//
// Typed envelope for a tool call as it enters the policy engine.
// Matches the verified Claude Code PreToolUse hook wire shape.
//
// The hook builds this envelope from CC's stdin JSON; tests and the
// engine consume it directly.

import { z } from "zod";

export const ToolCallEnvelopeSchema = z.object({
  protocol_version: z.literal("1"),
  tool_name: z.string().min(1),
  tool_use_id: z.string().min(1),
  parameters: z.unknown(),
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  timestamp_ms: z.number().int().nonnegative(),
  mcp_server_id: z.string().min(1).nullable(),
  permission_mode: z.string().optional(),
});

export type ToolCallEnvelope = z.infer<typeof ToolCallEnvelopeSchema>;

const MCP_TOOL_RE =
  /^mcp__plugin_(?<plugin>[^_]+(?:-[^_]+)*)_(?<server>[^_]+(?:-[^_]+)*)__(?<tool>.+)$/;

export function deriveMcpServerId(toolName: string): string | null {
  const m = MCP_TOOL_RE.exec(toolName);
  if (!m || !m.groups) return null;
  return m.groups["server"] ?? null;
}
