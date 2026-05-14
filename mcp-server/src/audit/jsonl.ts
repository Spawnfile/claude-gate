// mcp-server/src/audit/jsonl.ts
//
// Append-only JSONL writer with SHA-256 hash chain and size-based
// rotation. Source of truth: design 4.2 and Gap 8.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AuditEntry } from "./types.js";
import { computeThisHash, GENESIS_HASH } from "./hash-chain.js";

export interface AuditWriterOpts {
  path: string;
  maxBytes?: number;
  maxAgeMs?: number;
  now?: () => number;
}

export interface AuditWriter {
  append(entry: AuditEntry): void;
  close(): void;
}

interface RotationMarker extends Record<string, unknown> {
  type: "rotation";
  prev_file: string;
  prev_final_hash: string;
  ts: string;
  prev_hash: string;
  this_hash: string;
}

export function createAuditWriter(opts: AuditWriterOpts): AuditWriter {
  const now = opts.now ?? (() => Date.now());
  const maxBytes = opts.maxBytes ?? 100 * 1024 * 1024;
  const maxAgeMs = opts.maxAgeMs ?? 30 * 24 * 3600 * 1000;

  ensureParent(opts.path);
  let { fd, prevHash, openedAt } = openOrCreate(opts.path, now);

  function shouldRotate(): boolean {
    try {
      const size = statSync(opts.path).size;
      if (size > maxBytes) return true;
    } catch {
      return false;
    }
    if (now() - openedAt > maxAgeMs) return true;
    return false;
  }

  function rotate(): void {
    closeSync(fd);
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "");
    const archivedName = `${opts.path}-${stamp}.archived`;
    renameSync(opts.path, archivedName);

    const reopen = openOrCreate(opts.path, now);
    fd = reopen.fd;
    openedAt = reopen.openedAt;

    const archivedFinal = lastHash(archivedName);
    const marker: RotationMarker = {
      type: "rotation",
      prev_file: archivedName,
      prev_final_hash: archivedFinal,
      ts: new Date(now()).toISOString(),
      prev_hash: archivedFinal,
      this_hash: "",
    };
    marker.this_hash = computeThisHash(marker, archivedFinal);
    writeLine(fd, marker);
    prevHash = marker.this_hash;
  }

  return {
    append(entry: AuditEntry): void {
      if (shouldRotate()) rotate();
      entry.prev_hash = prevHash;
      entry.this_hash = "";
      entry.this_hash = computeThisHash(
        entry as unknown as Record<string, unknown>,
        prevHash,
      );
      writeLine(fd, entry as unknown as Record<string, unknown>);
      prevHash = entry.this_hash;
    },
    close(): void {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    },
  };
}

function openOrCreate(
  path: string,
  now: () => number,
): { fd: number; prevHash: string; openedAt: number } {
  const existed = existsSync(path);
  const fd = openSync(path, "a");
  let prevHash = GENESIS_HASH;
  let openedAt = now();
  if (existed) {
    prevHash = lastHash(path);
    try {
      openedAt = statSync(path).birthtimeMs || statSync(path).mtimeMs || now();
    } catch {
      openedAt = now();
    }
  }
  return { fd, prevHash, openedAt };
}

function ensureParent(path: string): void {
  const d = dirname(path);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function lastHash(path: string): string {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (raw.length === 0) return GENESIS_HASH;
    const lines = raw.split("\n");
    const last = JSON.parse(lines.at(-1)!) as { this_hash?: string };
    return last.this_hash ?? GENESIS_HASH;
  } catch {
    return GENESIS_HASH;
  }
}

function writeLine(fd: number, obj: Record<string, unknown>): void {
  const line = JSON.stringify(obj) + "\n";
  writeSync(fd, line);
  try {
    fsyncSync(fd);
  } catch {
    // ignore on platforms where fsync is unsupported
  }
}
