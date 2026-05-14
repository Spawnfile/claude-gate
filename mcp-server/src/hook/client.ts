// mcp-server/src/hook/client.ts
//
// Node entry point for the PreToolUse hook.
// Executed by hooks/pre-tool-use.sh (the thin POSIX shell shim).
//
// Reads CC's stdin JSON envelope, builds an IPC decide request,
// sends it over the gate-mcp Unix socket, and maps the response
// to a CC exit code (ALLOW=0, DENY=2, ASK=0+hookSpecificOutput JSON).
// On IPC unreachable, falls back to registry-cache.json and applies
// the tiered fail policy (prod=closed, dev=open, local=open, unknown=closed).

import { connect } from "node:net";
import { encodeFrame, FrameDecoder } from "../ipc/framing.js";
import { deriveMcpServerId } from "../policy/tool-call.js";
import {
  IPC_TIMEOUT_MS,
  PROTOCOL_VERSION,
  EXIT_ALLOW,
  EXIT_DENY,
  socketPathFor,
  fallbackLogPath,
  registryCachePath,
} from "./protocol.js";
import { readCache, lookupEnv, fallbackDecision } from "./cache.js";
import { appendFallback } from "./fallback-log.js";
import { warn } from "../log.js";

export interface HookOutcome {
  exitCode: number;
  stderr?: string;
  stdout?: string;
}

// CC's stdin JSON envelope shape
interface RawStdin {
  session_id: string;
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  cwd: string;
  permission_mode?: string;
  transcript_path?: string;
  hook_event_name?: string;
}

export interface HookOpts {
  stdinJson: string;
  // Test seams (all undefined in production):
  socketOverride?: string;
  cachePathOverride?: string;
  fallbackLogPathOverride?: string;
  // Explicit null disables active-session.json lookup; undefined uses default.
  activeSessionOverride?: { socket_path: string } | null;
}

export async function runHook(opts: HookOpts): Promise<HookOutcome> {
  let parsed: RawStdin;
  try {
    parsed = JSON.parse(opts.stdinJson) as RawStdin;
  } catch {
    // Unknown stdin shape: fail open to avoid breaking CC.
    return { exitCode: EXIT_ALLOW };
  }

  if (!parsed.session_id || !parsed.tool_name) {
    return { exitCode: EXIT_ALLOW };
  }

  // Socket path resolution (priority order):
  // 1. explicit socketOverride (tests)
  // 2. activeSessionOverride?.socket_path (tests / explicit override)
  // 3. readActiveSession() from ~/.claude/gate/active-session.json (production)
  // 4. derived from CC's stdin session_id (last resort)
  let resolvedSocket: string;
  if (opts.socketOverride !== undefined) {
    resolvedSocket = opts.socketOverride;
  } else if (opts.activeSessionOverride !== undefined) {
    resolvedSocket =
      opts.activeSessionOverride?.socket_path ?? socketPathFor(parsed.session_id);
  } else {
    const { readActiveSession } = await import("../active-session.js");
    const active = readActiveSession();
    resolvedSocket = active?.socket_path ?? socketPathFor(parsed.session_id);
  }

  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const response = await sendDecide(resolvedSocket, {
      protocol_version: PROTOCOL_VERSION,
      request_id: requestId,
      type: "decide",
      payload: {
        tool_name: parsed.tool_name,
        tool_use_id: parsed.tool_use_id,
        parameters: parsed.tool_input,
        session_id: parsed.session_id,
        cwd: parsed.cwd,
        timestamp_ms: Date.now(),
        mcp_server_id: deriveMcpServerId(parsed.tool_name),
        ...(parsed.permission_mode !== undefined
          ? { permission_mode: parsed.permission_mode }
          : {}),
      },
    });
    return mapDecisionToOutcome(response);
  } catch (e) {
    return runFallback(parsed, String(e), opts);
  }
}

function runFallback(
  parsed: RawStdin,
  reason: string,
  opts: HookOpts,
): HookOutcome {
  const cachePath = opts.cachePathOverride ?? registryCachePath();
  const logPath = opts.fallbackLogPathOverride ?? fallbackLogPath();
  const cache = readCache(cachePath);
  const mcpServerId = deriveMcpServerId(parsed.tool_name);
  const env = lookupEnv(cache, parsed.tool_name, mcpServerId);
  const decision = fallbackDecision(env);

  appendFallback(logPath, {
    ts: new Date().toISOString(),
    tool: parsed.tool_name,
    mcp_server_id: mcpServerId,
    env,
    decision,
    reason,
  });

  if (decision === "DENY") {
    return {
      exitCode: EXIT_DENY,
      stderr:
        `[claude-gate] gate-mcp unreachable; failing closed for ${env} (${parsed.tool_name})\n`,
    };
  }
  return { exitCode: EXIT_ALLOW };
}

async function sendDecide(socketPath: string, request: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    const dec = new FrameDecoder();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(new Error(`ipc timeout after ${IPC_TIMEOUT_MS}ms`));
    }, IPC_TIMEOUT_MS);

    dec.on("message", (m: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end();
      resolve(m);
    });

    dec.on("error", (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      reject(e);
    });

    client.on("error", (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      reject(e);
    });

    client.on("connect", () => {
      client.write(encodeFrame(request));
    });

    client.on("data", (c: Buffer) => {
      dec.feed(c);
    });
  });
}

function mapDecisionToOutcome(response: unknown): HookOutcome {
  if (!response || typeof response !== "object") return { exitCode: EXIT_ALLOW };
  const resp = response as Record<string, unknown>;
  const decision = resp["decision"];
  const rationale = typeof resp["rationale"] === "string" ? resp["rationale"] : "";

  if (decision === "ALLOW") return { exitCode: EXIT_ALLOW };

  if (decision === "DENY") {
    return {
      exitCode: EXIT_DENY,
      stderr: renderDeny(rationale),
    };
  }

  if (decision === "ASK") {
    return {
      exitCode: EXIT_ALLOW,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason:
            rationale || "claude-gate flagged this tool call for confirmation.",
        },
      }),
    };
  }

  if (decision === "SANDBOX_RESPONSE") {
    return {
      exitCode: EXIT_ALLOW,
      stdout: JSON.stringify({ tool_response: resp["sandbox_response"] }),
    };
  }

  // Unknown decision shape: fail open with a warning logged (not to stderr).
  warn(`unknown decision shape from IPC: ${JSON.stringify(decision)}`);
  return { exitCode: EXIT_ALLOW };
}

function renderDeny(rationale: string): string {
  return (
    [
      "==================================================================",
      "  claude-gate -- BLOCKED",
      "==================================================================",
      "",
      `Reason: ${rationale}`,
      "",
      "To temporarily allow this in this session:",
      "  /gate allow-once <tool-pattern>",
      "",
    ].join("\n") + "\n"
  );
}


// CLI entry -- called by hooks/pre-tool-use.sh
export async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const stdinJson = Buffer.concat(chunks).toString("utf-8");
  const outcome = await runHook({ stdinJson });
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  process.exit(outcome.exitCode);
}

// Auto-run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
