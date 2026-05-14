// mcp-server/src/notices.ts
//
// Computes first-run, drift, and debug-banner notice text for the
// SessionStart hook notice channel.
//
// Pure function -- no I/O. The IPC server calls this and returns the
// result in the session_init response rationale field.

import type { Config } from "./config/schema.js";
import type { DriftReport } from "./discovery/drift.js";

export interface NoticeOpts {
  config: Config | null;
  drift: DriftReport | null;
  debug_active: boolean;
  debug_expires_minutes?: number;
  /** When true, include the first-run notice. Defaults to (config === null). */
  include_first_run?: boolean;
}

export function computeNotice(opts: NoticeOpts): string | null {
  const sections: string[] = [];

  const includeFirstRun = opts.include_first_run ?? (opts.config === null);
  if (includeFirstRun && opts.config === null) {
    sections.push(firstRunNotice());
  }

  if (
    opts.drift &&
    (opts.drift.added.length > 0 ||
      opts.drift.removed.length > 0 ||
      opts.drift.changed.length > 0)
  ) {
    sections.push(driftNotice(opts.drift));
  }

  if (opts.debug_active) {
    sections.push(debugBanner(opts.debug_expires_minutes ?? 60));
  }

  return sections.length === 0 ? null : sections.join("\n\n");
}

function firstRunNotice(): string {
  return [
    "[claude-gate] First time using claude-gate in this project.",
    "              No gating is active until you complete /gate setup.",
    "              Audit-only mode: every tool call is logged but not blocked.",
    "",
    "              Run /gate setup to configure database policies (~5 min).",
  ].join("\n");
}

function driftNotice(d: DriftReport): string {
  const lines = ["[claude-gate] Coverage drift detected since last session:", ""];
  if (d.added.length > 0) {
    lines.push("              Added (" + String(d.added.length) + "):");
    for (const r of d.added) {
      lines.push(
        `                + ${r.name} (env: ${r.env}, confidence: ${r.confidence.toFixed(2)})`,
      );
    }
  }
  if (d.removed.length > 0) {
    lines.push("              Removed (" + String(d.removed.length) + "):");
    for (const r of d.removed) {
      lines.push(`                - ${r.name}`);
    }
  }
  if (d.changed.length > 0) {
    lines.push("              Changed (" + String(d.changed.length) + "):");
    for (const r of d.changed) {
      lines.push(`                ~ ${r.name}`);
    }
  }
  lines.push("", "              Run /gate setup to bring claude-gate up to date.");
  return lines.join("\n");
}

function debugBanner(expiresInMin: number): string {
  return [
    "-----------------------------------------------------------------",
    `[GATE DEBUG MODE -- calls are sandboxed, no real effects, expires ${String(expiresInMin)}m]`,
    "-----------------------------------------------------------------",
  ].join("\n");
}
