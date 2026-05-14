// mcp-server/tests/project-root.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { makeTmpDir } from "./helpers/tmpdir";
import { findProjectRoot } from "../src/project-root";

let cleanupTmp: (() => void) | null = null;

afterEach(() => {
  if (cleanupTmp) {
    cleanupTmp();
    cleanupTmp = null;
  }
});

describe("findProjectRoot", () => {
  test("returns dir containing .claude-gate/config.yaml", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const proj = realpathSync(tmp.dir);
    mkdirSync(join(proj, ".claude-gate"), { recursive: true });
    writeFileSync(join(proj, ".claude-gate/config.yaml"), "version: 1\n");

    const sub = join(proj, "src", "deep");
    mkdirSync(sub, { recursive: true });

    expect(findProjectRoot(sub)).toBe(proj);
  });

  test("returns git root when no .claude-gate config exists", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const proj = realpathSync(tmp.dir);
    mkdirSync(join(proj, ".git"), { recursive: true });
    const sub = join(proj, "src");
    mkdirSync(sub, { recursive: true });

    expect(findProjectRoot(sub)).toBe(proj);
  });

  test("prefers innermost .claude-gate config in nested layout", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const outer = realpathSync(tmp.dir);
    mkdirSync(join(outer, ".claude-gate"), { recursive: true });
    writeFileSync(join(outer, ".claude-gate/config.yaml"), "version: 1\n");

    const inner = join(outer, "packages", "api");
    mkdirSync(join(inner, ".claude-gate"), { recursive: true });
    writeFileSync(join(inner, ".claude-gate/config.yaml"), "version: 1\n");

    const sub = join(inner, "src");
    mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(inner);
  });

  test("when only an uninitialized .claude-gate dir and a higher .git exist, returns the .claude-gate dir's parent", () => {
    // Per design Section 3.8 the algorithm tracks the first
    // uninitialized .claude-gate seen, and on hitting a .git
    // ancestor returns `firstClaudeGate ?? gitDir`. We test that
    // coded behavior, which favors the inner uninit dir for
    // first-run setup.
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const root = realpathSync(tmp.dir);
    mkdirSync(join(root, ".git"), { recursive: true });

    const inner = join(root, "packages", "api");
    mkdirSync(join(inner, ".claude-gate"), { recursive: true });
    // NOTE: no config.yaml inside, so it's "uninitialized"

    const sub = join(inner, "src");
    mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(inner);
  });

  test("returns null or a valid bound when neither config nor git exist below $HOME", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const proj = realpathSync(tmp.dir);
    const sub = join(proj, "no-markers");
    mkdirSync(sub, { recursive: true });

    const result = findProjectRoot(sub);
    expect(result === null || result === proj || result.startsWith(homedir())).toBe(true);
  });

  test("resolves symlinked cwd to canonical path before walking", () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const proj = realpathSync(tmp.dir);
    mkdirSync(join(proj, ".claude-gate"), { recursive: true });
    writeFileSync(join(proj, ".claude-gate/config.yaml"), "version: 1\n");

    const target = join(proj, "real-src");
    mkdirSync(target, { recursive: true });
    const link = join(proj, "link-src");
    symlinkSync(target, link);

    expect(findProjectRoot(link)).toBe(proj);
  });
});
