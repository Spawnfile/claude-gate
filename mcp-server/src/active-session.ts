// mcp-server/src/active-session.ts
//
// Writes, reads, and clears ~/.claude/gate/active-session.json so the
// PreToolUse hook can locate the gate-mcp Unix socket on startup.
//
// The hook reads this file as the PRIMARY source for the socket path.
// Falls back to socketPathFor(session_id) only if the file is absent.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { z } from "zod";
import { warn } from "./log.js";

const ActiveSessionSchema = z.object({
  socket_path: z.string().min(1),
  session_id: z.string().min(1),
  project_root: z.string().min(1),
  started_at_ms: z.number().int().nonnegative(),
});

export type ActiveSession = z.infer<typeof ActiveSessionSchema>;

export function activeSessionPath(homeOverride?: string): string {
  const base = homeOverride ?? homedir();
  return join(base, ".claude", "gate", "active-session.json");
}

export function writeActiveSession(
  session: ActiveSession,
  homeOverride?: string,
): void {
  const path = activeSessionPath(homeOverride);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
  } catch (e) {
    warn(`could not write active-session.json: ${String(e)}`);
  }
}

export function readActiveSession(homeOverride?: string): ActiveSession | null {
  const path = activeSessionPath(homeOverride);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    const result = ActiveSessionSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch (e) {
    warn(`could not read active-session.json: ${String(e)}`);
    return null;
  }
}

export function clearActiveSession(homeOverride?: string): void {
  const path = activeSessionPath(homeOverride);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (e) {
    warn(`could not remove active-session.json: ${String(e)}`);
  }
}
