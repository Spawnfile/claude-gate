#!/usr/bin/env node
// mcp-server/src/cli/gate-confirm.ts
// Out-of-band confirmation CLI for critical claude-gate actions.
// The model cannot satisfy this prompt -- it runs in the user's terminal.
import { connect } from "node:net";
import { createInterface } from "node:readline/promises";
import { encodeFrame, FrameDecoder } from "../ipc/framing.js";
import { readActiveSession } from "../active-session.js";

const PROTO = "1";

export interface GateConfirmOpts {
  actionId: string;
  socketPath: string;
  projectRoot: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  errorOutput?: NodeJS.WritableStream;
}

export async function runGateConfirm(opts: GateConfirmOpts): Promise<number> {
  const errOut = opts.errorOutput ?? opts.output;

  // 1. describe action via gate_confirm_describe IPC
  let describeRes: unknown;
  try {
    describeRes = await rpc(opts.socketPath, {
      protocol_version: PROTO,
      request_id: rid("desc"),
      type: "gate_confirm_describe",
      payload: { action_id: opts.actionId },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeStr(errOut, `gate-confirm: IPC error: ${msg}\n`);
    return 1;
  }

  const d = describeRes as Record<string, unknown>;
  if (d.error) {
    const errObj = d.error as Record<string, unknown>;
    writeStr(errOut, `gate-confirm: action not found or expired: ${String(errObj.message ?? errObj.code)}\n`);
    return 1;
  }

  // 2. Read typed action_metadata; fall back to legacy rationale-JSON for back-compat.
  let info: Record<string, unknown> | null = null;
  const meta = d.action_metadata;
  if (meta && typeof meta === "object") {
    info = meta as Record<string, unknown>;
  } else if (typeof d.rationale === "string" && d.rationale.length > 0) {
    // Back-compat with pre-0.5 servers: metadata was JSON-encoded in `rationale`.
    try {
      info = JSON.parse(d.rationale) as Record<string, unknown>;
    } catch {
      info = null;
    }
  }
  if (info === null) {
    writeStr(errOut, "gate-confirm: could not parse describe response\n");
    return 1;
  }

  // 3. Render action details to output
  writeStr(opts.output, [
    "",
    "claude-gate -- confirm critical action",
    "",
    `Action:  ${String(info.action_type ?? "<unknown>")}`,
    `Project: ${opts.projectRoot}`,
    "",
    `Summary: ${String(info.payload_summary ?? "")}`,
    "",
  ].join("\n") + "\n");

  // 4. Prompt y/N via readline
  const rl = createInterface({ input: opts.input, output: opts.output });
  let answer: string;
  try {
    answer = (await rl.question("Confirm? [y/N] ")).trim().toLowerCase();
  } finally {
    rl.close();
  }

  if (answer !== "y" && answer !== "yes") {
    writeStr(opts.output, "Aborted.\n");
    return 1;
  }

  // 5. Send gate_confirm_consume IPC
  let consumeRes: unknown;
  try {
    consumeRes = await rpc(opts.socketPath, {
      protocol_version: PROTO,
      request_id: rid("cons"),
      type: "gate_confirm_consume",
      payload: { action_id: opts.actionId },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeStr(errOut, `gate-confirm: IPC error on confirm: ${msg}\n`);
    return 1;
  }

  const r = consumeRes as Record<string, unknown>;
  if (r.error) {
    const errObj = r.error as Record<string, unknown>;
    writeStr(errOut, `gate-confirm: confirm failed: ${String(errObj.message ?? errObj.code)}\n`);
    return 1;
  }

  // 6. Success
  writeStr(opts.output, "Confirmed. Return to Claude and re-issue the command.\n");
  return 0;
}

async function rpc(socketPath: string, msg: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const c = connect(socketPath);
    const dec = new FrameDecoder();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      c.destroy();
      reject(new Error("timeout"));
    }, 2000);
    dec.on("message", (m) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.end();
      resolve(m);
    });
    dec.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.destroy();
      reject(e);
    });
    c.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.destroy();
      reject(e);
    });
    c.on("connect", () => c.write(encodeFrame(msg)));
    c.on("data", (chunk) => dec.feed(chunk));
  });
}

function rid(prefix: string): string {
  return `req_${prefix}_${Date.now().toString(36)}`;
}

function writeStr(stream: NodeJS.WritableStream, text: string): void {
  stream.write(text);
}

async function main(): Promise<void> {
  const actionId = process.argv[2];
  if (!actionId) {
    process.stderr.write("usage: gate-confirm <action_id>\n");
    process.exit(1);
  }
  const active = readActiveSession();
  if (!active) {
    process.stderr.write("no active claude-gate session found\n");
    process.exit(1);
  }
  const code = await runGateConfirm({
    actionId,
    socketPath: active.socket_path,
    projectRoot: active.project_root,
    input: process.stdin,
    output: process.stdout,
    errorOutput: process.stderr,
  });
  process.exit(code);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
