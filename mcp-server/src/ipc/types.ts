// mcp-server/src/ipc/types.ts
import { z } from "zod";

export const DecideRequestPayloadSchema = z.object({
  tool_name: z.string(),
  tool_use_id: z.string(),
  parameters: z.unknown(),
  session_id: z.string(),
  cwd: z.string(),
  timestamp_ms: z.number().int(),
  mcp_server_id: z.string().nullable(),
  permission_mode: z.string().optional(),
});

export const DecideRequestSchema = z.object({
  protocol_version: z.literal("1"),
  request_id: z.string(),
  type: z.enum([
    "decide",
    "ping",
    "sandbox_decide",
    "session_init",
    "session_status",
    "gate_confirm_describe",
    "gate_confirm_consume",
  ]),
  payload: z.unknown().optional(),
});

export const SessionInitPayloadSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  transcript_path: z.string().optional(),
  permission_mode: z.string().optional(),
});
export type SessionInitPayload = z.infer<typeof SessionInitPayloadSchema>;

export const SessionStatusPayloadSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
});
export type SessionStatusPayload = z.infer<typeof SessionStatusPayloadSchema>;

export const GateConfirmDescribePayloadSchema = z.object({
  action_id: z.string(),
});
export type GateConfirmDescribePayload = z.infer<typeof GateConfirmDescribePayloadSchema>;

export const GateConfirmConsumePayloadSchema = z.object({
  action_id: z.string(),
});
export type GateConfirmConsumePayload = z.infer<typeof GateConfirmConsumePayloadSchema>;

export const DecisionSchema = z.enum([
  "ALLOW",
  "DENY",
  "ASK",
  "SANDBOX_RESPONSE",
]);

export const DecideResponseSchema = z.object({
  protocol_version: z.literal("1"),
  request_id: z.string(),
  decision: DecisionSchema.nullable(),
  rationale: z.string().optional(),
  ttl_seconds: z.number().int().positive().optional(),
  sandbox_response: z.unknown().optional(),
  audit_id: z.string().optional(),
  notice_text: z.string().nullable().optional(),
  action_metadata: z
    .object({
      action_id: z.string(),
      action_type: z.string(),
      payload_summary: z.string(),
      expires_at_ms: z.number().int().positive(),
    })
    .nullable()
    .optional(),
  error: z
    .object({
      code: z.enum(["PARSE_FAILED", "TIMEOUT", "INTERNAL", "UNSUPPORTED", "GATE_ACTION_ERROR"]),
      message: z.string(),
    })
    .nullable()
    .optional(),
});

export type DecideRequest = z.infer<typeof DecideRequestSchema>;
export type DecideResponse = z.infer<typeof DecideResponseSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
