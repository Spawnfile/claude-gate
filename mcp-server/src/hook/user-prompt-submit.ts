// mcp-server/src/hook/user-prompt-submit.ts
//
// Node entry point for the UserPromptSubmit hook.
// Executed by hooks/user-prompt-submit.sh (the thin POSIX shell shim).
//
// Reads CC's UserPromptSubmit stdin JSON, sends a session_status IPC request
// to gate-mcp, reads the notice_text from the response, and writes it to
// stdout. CC injects the stdout text as context before each user prompt
// reaches the model.
//
// UserPromptSubmit hooks CANNOT block prompts -- they only
// contribute context via stdout (exit 0 always).

import { connect } from "node:net";
import { encodeFrame, FrameDecoder } from "../ipc/framing.js";
import { socketPathFor, IPC_TIMEOUT_MS, PROTOCOL_VERSION } from "./protocol.js";
import type { ActiveSession } from "../active-session.js";

// CC's UserPromptSubmit stdin JSON envelope shape
interface RawStdin {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
}

export interface UserPromptSubmitOpts {
  socketOverride?: string;
  activeSessionOverride?: { socket_path: string } | null;
}

export async function runUserPromptSubmit(
  stdinJson: string,
  opts?: UserPromptSubmitOpts,
): Promise<string | null> {
  let p: RawStdin;
  try {
    p = JSON.parse(stdinJson) as RawStdin;
  } catch {
    return null;
  }

  if (!p.session_id || !p.cwd) return null;

  // Socket path resolution (priority order):
  // 1. explicit socketOverride (tests)
  // 2. activeSessionOverride?.socket_path (tests / explicit override)
  // 3. readActiveSession() from ~/.claude/gate/active-session.json (production)
  // 4. derived from CC's stdin session_id (last resort)
  let resolvedSocket: string;
  const socketOverride = opts?.socketOverride;
  const activeSessionOverride = opts?.activeSessionOverride;

  if (socketOverride !== undefined) {
    resolvedSocket = socketOverride;
  } else if (activeSessionOverride !== undefined) {
    resolvedSocket =
      activeSessionOverride?.socket_path ?? socketPathFor(p.session_id);
  } else {
    const { readActiveSession } = await import("../active-session.js");
    const active: ActiveSession | null = readActiveSession();
    resolvedSocket = active?.socket_path ?? socketPathFor(p.session_id);
  }

  const requestId = `req_ups_${Date.now().toString(36)}`;

  try {
    const r = await rpc(resolvedSocket, {
      protocol_version: PROTOCOL_VERSION,
      request_id: requestId,
      type: "session_status",
      payload: { session_id: p.session_id, cwd: p.cwd },
    });

    const noticeText = (r as Record<string, unknown>)?.["notice_text"];
    return typeof noticeText === "string" && noticeText.length > 0
      ? noticeText
      : null;
  } catch {
    // gate-mcp not ready -- silent. Do not block the prompt.
    return null;
  }
}

async function rpc(socketPath: string, msg: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    const dec = new FrameDecoder();
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      client.destroy();
      reject(new Error("timeout"));
    }, IPC_TIMEOUT_MS);

    dec.on("message", (m) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.end();
      resolve(m);
    });

    dec.on("error", (e: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.destroy();
      reject(e);
    });

    client.on("error", (e: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.destroy();
      reject(e);
    });

    client.on("connect", () => {
      client.write(encodeFrame(msg));
    });

    client.on("data", (c: Buffer) => {
      dec.feed(c);
    });
  });
}

export async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const notice = await runUserPromptSubmit(Buffer.concat(chunks).toString("utf-8"));
  if (notice) process.stdout.write(notice + "\n");
  process.exit(0);
}

// Auto-run when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
