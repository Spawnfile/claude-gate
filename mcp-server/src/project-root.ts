// mcp-server/src/project-root.ts
//
// Project-root resolution per design doc Section 3.8.
// Pure, synchronous, no caching.

import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";

/**
 * Walk up from `cwd` looking for a claude-gate project root.
 *
 * Behavior:
 *  1. If a `.claude-gate/config.yaml` exists at any ancestor, return that
 *     ancestor (innermost wins).
 *  2. Otherwise, if a `.git` (or `.hg`/`.svn`) directory exists at an
 *     ancestor: return the first uninitialized `.claude-gate` dir we saw
 *     on the way up, else the VCS root.
 *  3. Never walk above `$HOME`.
 *  4. Returns `null` if no marker is found at or below `$HOME`.
 *
 * Symlinks are resolved via `path.resolve` before the walk so the
 * canonical path is used.
 */
export function findProjectRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  const home = homedir();
  let firstUninitClaudeGate: string | null = null;

  // Walk up until we hit the filesystem root.
  while (dir !== dirname(dir)) {
    const cfg = join(dir, ".claude-gate", "config.yaml");
    if (existsSync(cfg)) {
      return dir;
    }

    if (firstUninitClaudeGate === null && existsSync(join(dir, ".claude-gate"))) {
      firstUninitClaudeGate = dir;
    }

    if (
      existsSync(join(dir, ".git")) ||
      existsSync(join(dir, ".hg")) ||
      existsSync(join(dir, ".svn"))
    ) {
      return firstUninitClaudeGate ?? dir;
    }

    if (dir === home) {
      break;
    }

    dir = dirname(dir);
  }

  return null;
}
