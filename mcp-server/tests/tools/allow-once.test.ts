// mcp-server/tests/tools/allow-once.test.ts

import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBootstrap } from "../../src/policy/registry-bootstrap";
import { PendingActionStore } from "../../src/setup/pending-action";
import { allowOnceTools } from "../../src/tools/allow-once";
import type { ToolContext } from "../../src/tools/registry";

const RULES_DIR = join(process.cwd(), "rules");

let cleanupDirs: string[] = [];
afterEach(() => {
  cleanupDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  cleanupDirs = [];
});

function mkProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-allow-once-"));
  cleanupDirs.push(dir);
  return dir;
}

function makeCtx(root: string): { ctx: ToolContext; boot: ReturnType<typeof createBootstrap> } {
  const boot = createBootstrap({
    projectRoot: root,
    sessionId: "sess_ao_t",
    rulesDir: RULES_DIR,
    auditPath: join(root, "audit.jsonl"),
  });
  const ctx: ToolContext = {
    bootstrap: boot,
    pendingActions: new PendingActionStore(),
  };
  return { ctx, boot };
}

describe("gate.allow_once", () => {
  const tool = allowOnceTools[0]!;

  test("pushes one-shot approval onto session.one_shot_approvals", () => {
    const root = mkProject();
    const { ctx, boot } = makeCtx(root);
    try {
      const pattern = "mcp__supabase__execute_sql";
      const result = tool.handler({ tool_pattern: pattern }, ctx);
      const text = (result as { content: Array<{ type: string; text: string }> })
        .content[0]?.text ?? "";

      // Verify confirmation message
      expect(text).toContain("One-shot approval queued");
      expect(text).toContain(pattern);
      expect(text).toContain("[claude-gate]");

      // Verify session state
      const session = ctx.bootstrap.session();
      const found = session.one_shot_approvals.find(
        (a) => a.tool_glob === pattern,
      );
      expect(found).toBeDefined();
      expect(found!.tool_glob).toBe(pattern);
    } finally {
      boot.close();
    }
  });

  test("multiple calls add multiple approvals", () => {
    const root = mkProject();
    const { ctx, boot } = makeCtx(root);
    try {
      tool.handler({ tool_pattern: "mcp__supabase__*" }, ctx);
      tool.handler({ tool_pattern: "mcp__postgres__execute_sql" }, ctx);

      const session = ctx.bootstrap.session();
      expect(session.one_shot_approvals).toHaveLength(2);
      expect(session.one_shot_approvals[0]!.tool_glob).toBe("mcp__supabase__*");
      expect(session.one_shot_approvals[1]!.tool_glob).toBe(
        "mcp__postgres__execute_sql",
      );
    } finally {
      boot.close();
    }
  });

  test("returns ASCII-only content", () => {
    const root = mkProject();
    const { ctx, boot } = makeCtx(root);
    try {
      const result = tool.handler({ tool_pattern: "some_tool" }, ctx);
      const text = (result as { content: Array<{ type: string; text: string }> })
        .content[0]?.text ?? "";
      expect(text).toMatch(/^[\x00-\x7F]*$/);
    } finally {
      boot.close();
    }
  });
});
