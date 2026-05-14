// mcp-server/src/ipc/server.ts
import { createServer, type Server, type Socket } from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import { encodeFrame, FrameDecoder } from "./framing.js";
import {
  DecideRequestSchema,
  DecideRequestPayloadSchema,
  SessionInitPayloadSchema,
  SessionStatusPayloadSchema,
  GateConfirmDescribePayloadSchema,
  GateConfirmConsumePayloadSchema,
  type DecideResponse,
} from "./types.js";
import { decide } from "../policy/engine.js";
import type { ToolCallEnvelope } from "../policy/tool-call.js";
import { deriveMcpServerId } from "../policy/tool-call.js";
import type { DatabaseConfig } from "../config/schema.js";
import type { Config } from "../config/schema.js";
import type { RulePackRegistry } from "../policy/rule-pack-loader.js";
import type { SessionState } from "../policy/session.js";
import type { AuditWriter } from "../audit/jsonl.js";
import type { PendingActionStore } from "../setup/pending-action.js";
import { computeNotice } from "../notices.js";
import { generateSynthetic } from "../debug/sandbox-mcp.js";
import { globMatch } from "../util/glob.js";
import { info, warn } from "../log.js";

// Tracks which one-shot notice sections have already been shown for a session.
// Cleared when the server is closed (per-CC-session lifecycle).
interface ShownState {
  first_run: boolean;
  drift: boolean;
}
const shownBySession = new Map<string, ShownState>();

export interface BootstrapLike {
  project_root: string;
  session_id: string;
  databases: () => DatabaseConfig[];
  rule_packs: () => RulePackRegistry;
  session: () => SessionState;
  audit: () => AuditWriter;
  config?: () => Config | null;
  reload: () => void;
  debugState: { active: boolean; expires_at_ms: number; intercept_patterns: string[] };
}

export interface StartIpcServerOptions {
  socketPath: string;
  bootstrap?: BootstrapLike;
  pendingActions?: PendingActionStore;
}

export interface IpcServer {
  close: () => Promise<void>;
}

export async function startIpcServer(
  opts: StartIpcServerOptions,
): Promise<IpcServer> {
  if (existsSync(opts.socketPath)) {
    try {
      unlinkSync(opts.socketPath);
    } catch (e) {
      warn(`could not unlink stale socket ${opts.socketPath}: ${String(e)}`);
    }
  }

  const server: Server = createServer((socket) =>
    handleConnection(socket, opts.bootstrap, opts.pendingActions),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.socketPath, () => {
      server.removeListener("error", reject);
      info(`IPC listening on ${opts.socketPath}`);
      resolve();
    });
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          if (existsSync(opts.socketPath)) {
            try {
              unlinkSync(opts.socketPath);
            } catch {
              // ignore
            }
          }
          resolve();
        });
      }),
  };
}

function handleConnection(
  socket: Socket,
  bootstrap?: BootstrapLike,
  pendingActions?: PendingActionStore,
): void {
  const decoder = new FrameDecoder();
  decoder.on("message", async (raw: unknown) => {
    try {
      const response = await handleRequest(raw, bootstrap, pendingActions);
      socket.write(encodeFrame(response));
    } catch (e) {
      const response: DecideResponse = {
        protocol_version: "1",
        request_id: "unknown",
        decision: null,
        error: { code: "INTERNAL", message: String(e) },
      };
      socket.write(encodeFrame(response));
    }
  });
  decoder.on("error", (e: Error) => {
    const response: DecideResponse = {
      protocol_version: "1",
      request_id: "unknown",
      decision: null,
      error: { code: "PARSE_FAILED", message: e.message },
    };
    socket.write(encodeFrame(response));
  });
  socket.on("data", (chunk) => decoder.feed(chunk));
  socket.on("error", (e) => warn(`socket error: ${e.message}`));
}

async function handleRequest(
  raw: unknown,
  bootstrap?: BootstrapLike,
  pendingActions?: PendingActionStore,
): Promise<DecideResponse> {
  const parsed = DecideRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      protocol_version: "1",
      request_id:
        typeof raw === "object" && raw && "request_id" in raw
          ? String((raw as { request_id: unknown }).request_id)
          : "unknown",
      decision: null,
      error: {
        code: "INTERNAL",
        message: parsed.error.message,
      },
    };
  }

  const req = parsed.data;

  if (req.type === "ping") {
    return {
      protocol_version: "1",
      request_id: req.request_id,
      decision: "ALLOW",
      rationale: "pong",
    };
  }

  if (req.type === "decide") {
    if (!bootstrap) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: {
          code: "UNSUPPORTED",
          message: "server started without a bootstrap",
        },
      };
    }

    const payloadParse = DecideRequestPayloadSchema.safeParse(req.payload);
    if (!payloadParse.success) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "PARSE_FAILED", message: payloadParse.error.message },
      };
    }

    const p = payloadParse.data;
    const envelope: ToolCallEnvelope = {
      protocol_version: "1",
      tool_name: p.tool_name,
      tool_use_id: p.tool_use_id,
      parameters: p.parameters,
      session_id: p.session_id,
      cwd: p.cwd,
      timestamp_ms: p.timestamp_ms,
      mcp_server_id: p.mcp_server_id ?? deriveMcpServerId(p.tool_name),
      ...(p.permission_mode !== undefined
        ? { permission_mode: p.permission_mode }
        : {}),
    };

    const result = await decide(envelope, {
      databases: bootstrap.databases(),
      rule_packs: bootstrap.rule_packs(),
      session: bootstrap.session(),
      audit: bootstrap.audit(),
      now_ms: Date.now,
    });

    // T8: sandbox substitution. Replace ALLOW/ASK decisions with synthetic
    // responses when debug mode is on and the tool matches an intercept
    // pattern. DENY stays DENY (we do not substitute blocked calls).
    const dbg = bootstrap.debugState;
    if (
      dbg.active &&
      dbg.expires_at_ms > Date.now() &&
      result.decision !== "DENY" &&
      dbg.intercept_patterns.some((p) => globMatch(p, envelope.tool_name))
    ) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: "SANDBOX_RESPONSE",
        sandbox_response: generateSynthetic(envelope),
        rationale: `${result.rationale} [sandbox]`,
      };
    }

    return {
      protocol_version: "1",
      request_id: req.request_id,
      decision: result.decision,
      rationale: result.rationale,
    };
  }

  if (req.type === "gate_confirm_describe") {
    if (!pendingActions || !bootstrap) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "UNSUPPORTED", message: "server started without pendingActions or bootstrap" },
      };
    }
    const descParse = GateConfirmDescribePayloadSchema.safeParse(req.payload);
    if (!descParse.success) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "PARSE_FAILED", message: descParse.error.message },
      };
    }
    const d = pendingActions.describe(descParse.data.action_id);
    if ("code" in d) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "GATE_ACTION_ERROR", message: d.code },
      };
    }
    return {
      protocol_version: "1",
      request_id: req.request_id,
      decision: "ALLOW",
      action_metadata: {
        action_id: d.action_id,
        action_type: d.action_type,
        payload_summary: d.payload_summary,
        expires_at_ms: d.created_at_ms + d.ttl_ms,
      },
      rationale: "",
    };
  }

  if (req.type === "gate_confirm_consume") {
    if (!pendingActions || !bootstrap) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "UNSUPPORTED", message: "server started without pendingActions or bootstrap" },
      };
    }
    const consParse = GateConfirmConsumePayloadSchema.safeParse(req.payload);
    if (!consParse.success) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "PARSE_FAILED", message: consParse.error.message },
      };
    }
    const r = pendingActions.markConfirmed(consParse.data.action_id, {
      session_id: bootstrap.session_id,
      project_root: bootstrap.project_root,
    });
    if ("code" in r) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "GATE_ACTION_ERROR", message: r.code },
      };
    }
    return {
      protocol_version: "1",
      request_id: req.request_id,
      decision: "ALLOW",
      rationale: "confirmed",
    };
  }

  if (req.type === "session_init") {
    if (!bootstrap) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: "ALLOW",
        notice_text: "session_init: no bootstrap; first-run audit-only",
        rationale: "",
      };
    }
    const payloadParse = SessionInitPayloadSchema.safeParse(req.payload);
    if (!payloadParse.success) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "PARSE_FAILED", message: payloadParse.error.message },
      };
    }
    const config = bootstrap.config?.() ?? null;
    // Drift detection is not wired yet; pass null for now.
    const debugExpiresMinutes = bootstrap.debugState.active
      ? Math.max(
          0,
          Math.floor(
            (bootstrap.debugState.expires_at_ms - Date.now()) / 60_000,
          ),
        )
      : undefined;
    const notice = computeNotice({
      config,
      drift: null,
      debug_active: bootstrap.debugState.active,
      ...(debugExpiresMinutes !== undefined
        ? { debug_expires_minutes: debugExpiresMinutes }
        : {}),
    });
    return {
      protocol_version: "1",
      request_id: req.request_id,
      decision: "ALLOW",
      notice_text: notice ?? null,
      rationale: "",
    };
  }

  if (req.type === "session_status") {
    if (!bootstrap) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: "ALLOW",
        notice_text: null,
        rationale: "",
      };
    }
    const parse = SessionStatusPayloadSchema.safeParse(req.payload);
    if (!parse.success) {
      return {
        protocol_version: "1",
        request_id: req.request_id,
        decision: null,
        error: { code: "PARSE_FAILED", message: parse.error.message },
      };
    }

    const config = bootstrap.config?.() ?? null;
    const sessId = parse.data.session_id;
    const shown = shownBySession.get(sessId) ?? { first_run: false, drift: false };

    const debugExpiresMinutes = bootstrap.debugState.active
      ? Math.max(
          0,
          Math.floor(
            (bootstrap.debugState.expires_at_ms - Date.now()) / 60_000,
          ),
        )
      : undefined;
    const notice = computeNotice({
      config,
      drift: null,
      debug_active: bootstrap.debugState.active,
      ...(debugExpiresMinutes !== undefined
        ? { debug_expires_minutes: debugExpiresMinutes }
        : {}),
      include_first_run: !shown.first_run,
    });

    shown.first_run = true;
    shownBySession.set(sessId, shown);

    return {
      protocol_version: "1",
      request_id: req.request_id,
      decision: "ALLOW",
      notice_text: notice ?? null,
      rationale: "",
    };
  }

  // sandbox_decide - UNSUPPORTED (T8 wires it).
  return {
    protocol_version: "1",
    request_id: req.request_id,
    decision: null,
    error: {
      code: "UNSUPPORTED",
      message: `type "${req.type}" not yet implemented`,
    },
  };
}
