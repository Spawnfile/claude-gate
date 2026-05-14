// mcp-server/tests/tools/db-tools.test.ts

import { describe, test, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createBootstrap } from "../../src/policy/registry-bootstrap";
import { PendingActionStore } from "../../src/setup/pending-action";
import { dbTools } from "../../src/tools/db-tools";
import type { GateTool, ToolContext } from "../../src/tools/registry";

const RULES_DIR = join(process.cwd(), "rules");

let cleanupDirs: string[] = [];
afterEach(() => {
  cleanupDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  cleanupDirs = [];
});

function mkProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-db-tools-"));
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

function writeConfig(root: string, yaml: string = MINIMAL_CONFIG_YAML): void {
  mkdirSync(join(root, ".claude-gate"), { recursive: true });
  writeFileSync(join(root, ".claude-gate", "config.yaml"), yaml);
}

function makeCtx(
  root: string,
  store?: PendingActionStore,
): { ctx: ToolContext; boot: ReturnType<typeof createBootstrap> } {
  const boot = createBootstrap({
    projectRoot: root,
    sessionId: "sess_db_t",
    rulesDir: RULES_DIR,
    auditPath: join(root, "audit.jsonl"),
  });
  const ctx: ToolContext = {
    bootstrap: boot,
    pendingActions: store ?? new PendingActionStore(),
  };
  return { ctx, boot };
}

function findTool(name: string): GateTool {
  const t = dbTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe("gate.db_list", () => {
  test("returns 'no databases' when config is null", async () => {
    const root = mkProject();
    const { ctx, boot } = makeCtx(root);
    try {
      const tool = findTool("gate.db_list");
      const result = await Promise.resolve(tool.handler({}, ctx));
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("No databases");
    } finally {
      boot.close();
    }
  });

  test("returns table with database row when config has a DB", async () => {
    const root = mkProject();
    writeConfig(root);
    const { ctx, boot } = makeCtx(root);
    try {
      const tool = findTool("gate.db_list");
      const result = await Promise.resolve(tool.handler({}, ctx));
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("supabase_prod");
      expect(text).toContain("strict");
      expect(text).toContain("prod");
    } finally {
      boot.close();
    }
  });
});

describe("gate.db_set_policy", () => {
  test("changes policy to confirm without action_id (non-critical)", async () => {
    const root = mkProject();
    writeConfig(root);
    const { ctx, boot } = makeCtx(root);
    try {
      const tool = findTool("gate.db_set_policy");
      const result = await Promise.resolve(
        tool.handler({ name: "supabase_prod", policy: "confirm" }, ctx),
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("Policy updated");
      expect(text).toContain("confirm");

      // Verify config.yaml was updated
      const raw = readFileSync(join(root, ".claude-gate", "config.yaml"), "utf-8");
      const parsed = parseYaml(raw) as { databases: Array<{ name: string; policy: string }> };
      const db = parsed.databases.find((d) => d.name === "supabase_prod");
      expect(db?.policy).toBe("confirm");
    } finally {
      boot.close();
    }
  });

  test("policy=allow without action_id returns pending-confirmation message and creates pending action", async () => {
    const root = mkProject();
    writeConfig(root);
    const store = new PendingActionStore();
    const { ctx, boot } = makeCtx(root, store);
    try {
      const tool = findTool("gate.db_set_policy");
      const result = await Promise.resolve(
        tool.handler({ name: "supabase_prod", policy: "allow" }, ctx),
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("gate-confirm");
      expect(text).toMatch(/act_[0-9a-f]+/);

      // Verify pending action was created
      const actionMatch = text.match(/act_[0-9a-f]+/);
      expect(actionMatch).not.toBeNull();
      const actionId = actionMatch![0]!;
      const action = store.describe(actionId);
      expect("code" in action).toBe(false);
    } finally {
      boot.close();
    }
  });

  test("policy=allow with confirmed action_id updates config.yaml", async () => {
    const root = mkProject();
    writeConfig(root);
    const store = new PendingActionStore();
    const { ctx, boot } = makeCtx(root, store);
    try {
      // Create and confirm an action
      const action = store.create({
        project_root: root,
        session_id: "sess_db_t",
        cwd_at_creation: root,
        action_type: "db_set_policy_allow",
        payload_summary: "Set supabase_prod policy to allow",
        payload: { name: "supabase_prod", policy: "allow" },
      });
      store.markConfirmed(action.action_id, {
        session_id: "sess_db_t",
        project_root: root,
      });

      const tool = findTool("gate.db_set_policy");
      const result = await Promise.resolve(
        tool.handler(
          {
            name: "supabase_prod",
            policy: "allow",
            action_id: action.action_id,
          },
          ctx,
        ),
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("Policy updated");

      // Verify config.yaml
      const raw = readFileSync(join(root, ".claude-gate", "config.yaml"), "utf-8");
      const parsed = parseYaml(raw) as { databases: Array<{ name: string; policy: string }> };
      const db = parsed.databases.find((d) => d.name === "supabase_prod");
      expect(db?.policy).toBe("allow");

      // Action should be consumed
      const describeResult = store.describe(action.action_id);
      expect("code" in describeResult).toBe(true);
      expect((describeResult as { code: string }).code).toBe("CONSUMED");
    } finally {
      boot.close();
    }
  });

  test("returns error when database not found in config", async () => {
    const root = mkProject();
    writeConfig(root);
    const { ctx, boot } = makeCtx(root);
    try {
      const tool = findTool("gate.db_set_policy");
      const result = await Promise.resolve(
        tool.handler({ name: "nonexistent_db", policy: "confirm" }, ctx),
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("not found");
    } finally {
      boot.close();
    }
  });
});
