// mcp-server/src/hook/protocol.ts
//
// Pure module: exit-code constants, socket-path resolution, and tiered
// fail-policy defaults for the PreToolUse hook client.

import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

export const IPC_TIMEOUT_MS = 500;
export const PROTOCOL_VERSION = "1";

export const EXIT_ALLOW = 0;
export const EXIT_DENY = 2;
export const EXIT_ASK = 2;

export function socketPathFor(sessionId: string): string {
  return join(tmpdir(), "claude-gate", `${sessionId}.sock`);
}

export function fallbackLogPath(): string {
  return join(homedir(), ".claude", "gate", "hook-fallback.log");
}

export function registryCachePath(): string {
  return join(homedir(), ".claude", "gate", "registry-cache.json");
}

export type FailPolicy = "closed" | "open";
export type Env = "prod" | "dev" | "local" | "unknown";

export const DEFAULT_FAIL_POLICY: Record<Env, FailPolicy> = {
  prod: "closed",
  dev: "open",
  local: "open",
  unknown: "closed",
};
