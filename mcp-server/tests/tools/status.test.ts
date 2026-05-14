// mcp-server/tests/tools/status.test.ts

import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBootstrap } from "../../src/policy/registry-bootstrap";
import { PendingActionStore } from "../../src/setup/pending-action";
import { statusTools } from "../../src/tools/status";
import type { ToolContext } from "../../src/tools/registry";

const RULES_DIR = join(process.cwd(), "rules");

let cleanupDirs: string[] = [];
afterEach(() => {
  cleanupDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  cleanupDirs = [];
});

function mkProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-status-"));
  cleanupDirs.push(dir);
  return dir;
}

const MINIMAL_CONFIG_YAML = `version: 1
global:
  fail_policy: { prod: closed, dev: open, local: open }
  audit: { integrity: hash_chain, redact_params: true }
databases:
  - name: supabase_prod
    matchers:
      - { mcp_server_id: supabase_prod }
    env: prod
    policy: strict
    confidence: 0.99
    discovered_from: [{ scanner: env_scanner, file: ".env.prod" }]
rule_packs:
  sql: { pinned_version: "1.0.0", enabled: true }
custom_rules: []
`;

function makeCtx(bootstrap: ReturnType<typeof createBootstrap>): ToolContext {
  return {
    bootstrap,
    pendingActions: new PendingActionStore(),
  };
}

describe("gate.status", () => {
  const tool = statusTools[0]!;

  test("returns audit-only text when config is null (first run)", async () => {
    const root = mkProject();
    const boot = createBootstrap({
      projectRoot: root,
      sessionId: "sess_status_1",
      rulesDir: RULES_DIR,
      auditPath: join(root, "audit.jsonl"),
    });

    try {
      const ctx = makeCtx(boot);
      const result = await Promise.resolve(tool.handler({}, ctx));
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("audit-only");
      expect(text).toContain(root);
    } finally {
      boot.close();
    }
  });

  test("returns database row when config has one DB", async () => {
    const root = mkProject();
    mkdirSync(join(root, ".claude-gate"), { recursive: true });
    writeFileSync(join(root, ".claude-gate", "config.yaml"), MINIMAL_CONFIG_YAML);

    const boot = createBootstrap({
      projectRoot: root,
      sessionId: "sess_status_2",
      rulesDir: RULES_DIR,
      auditPath: join(root, "audit.jsonl"),
    });

    try {
      const ctx = makeCtx(boot);
      const result = await Promise.resolve(tool.handler({}, ctx));
      const text = result.content[0]?.text ?? "";
      // Should include the database name in the output
      expect(text).toContain("supabase_prod");
      // Should show policy
      expect(text).toContain("strict");
      // Should show env
      expect(text).toContain("prod");
      // Should show session id
      expect(text).toContain("sess_status_2");
    } finally {
      boot.close();
    }
  });

  test("content is ASCII only (no non-ASCII characters)", async () => {
    const root = mkProject();
    const boot = createBootstrap({
      projectRoot: root,
      sessionId: "sess_ascii",
      rulesDir: RULES_DIR,
      auditPath: join(root, "audit.jsonl"),
    });

    try {
      const ctx = makeCtx(boot);
      const result = await Promise.resolve(tool.handler({}, ctx));
      const text = result.content[0]?.text ?? "";
      // All characters should be printable ASCII or whitespace
      expect(text).toMatch(/^[\x00-\x7F]*$/);
    } finally {
      boot.close();
    }
  });
});
