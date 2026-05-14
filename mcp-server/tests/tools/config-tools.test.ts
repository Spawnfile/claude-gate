// mcp-server/tests/tools/config-tools.test.ts

import { describe, test, expect, afterEach, vi } from "vitest";
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
import { createBootstrap } from "../../src/policy/registry-bootstrap.js";
import { configTools } from "../../src/tools/config-tools.js";
import type { GateTool, ToolContext } from "../../src/tools/registry.js";
import type { Config } from "../../src/config/schema.js";

const RULES_DIR = join(process.cwd(), "rules");

let cleanupDirs: string[] = [];
afterEach(() => {
  cleanupDirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  cleanupDirs = [];
  vi.clearAllMocks();
});

function mkProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-config-tools-"));
  cleanupDirs.push(dir);
  return dir;
}

const MINIMAL_CONFIG_YAML = `version: 1
global:
  fail_policy: { prod: closed, dev: open, local: open }
  audit: { integrity: hash_chain, redact_params: true }
databases:
  - name: test_db
    matchers:
      - { mcp_server_id: test_server }
    env: prod
    policy: strict
    confidence: 0.99
    discovered_from: [{ scanner: test_scanner, file: ".env" }]
rule_packs:
  sql: { pinned_version: "1.0.0", enabled: true }
custom_rules: []
`;

function writeConfig(root: string, yaml: string = MINIMAL_CONFIG_YAML): void {
  mkdirSync(join(root, ".claude-gate"), { recursive: true });
  writeFileSync(join(root, ".claude-gate", "config.yaml"), yaml);
}

function makeCtx(root: string): { ctx: ToolContext; boot: ReturnType<typeof createBootstrap> } {
  const boot = createBootstrap({
    projectRoot: root,
    sessionId: "sess_config_t",
    rulesDir: RULES_DIR,
    auditPath: join(root, "audit.jsonl"),
  });
  const ctx: ToolContext = {
    bootstrap: boot,
    pendingActions: null as any, // not used in config tools
  };
  return { ctx, boot };
}

function findTool(name: string): GateTool {
  const t = configTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe("gate.config_get", () => {
  test("returns global block as JSON text containing fail_policy and audit", async () => {
    const root = mkProject();
    writeConfig(root);
    const { ctx, boot } = makeCtx(root);
    try {
      const tool = findTool("gate.config_get");
      const result = await Promise.resolve(tool.handler({}, ctx));
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("fail_policy");
      expect(text).toContain("audit");
    } finally {
      boot.close();
    }
  });
});

describe("gate.config_set", () => {
  test("rejects paths outside the whitelist (e.g., global.audit.integrity) without calling reload", async () => {
    const root = mkProject();
    writeConfig(root);
    const { ctx, boot } = makeCtx(root);
    const reloadSpy = vi.spyOn(boot, "reload");
    try {
      const tool = findTool("gate.config_set");
      const result = await Promise.resolve(
        tool.handler(
          {
            path: "global.audit.integrity",
            value: "none",
          },
          ctx,
        ),
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("not allowed for gate.config_set");

      // Verify reload was NOT called
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      boot.close();
      reloadSpy.mockRestore();
    }
  });

  test("validates fail_policy env paths: valid path accepted", async () => {
    const root = mkProject();
    writeConfig(root);
    const { ctx, boot } = makeCtx(root);
    const reloadSpy = vi.spyOn(boot, "reload");
    try {
      const tool = findTool("gate.config_set");
      const result = await Promise.resolve(
        tool.handler(
          {
            path: "global.fail_policy.dev",
            value: "closed",
          },
          ctx,
        ),
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("config updated");

      // Verify reload was called
      expect(reloadSpy).toHaveBeenCalled();

      // Verify config.yaml was updated
      const raw = readFileSync(join(root, ".claude-gate", "config.yaml"), "utf-8");
      const parsed = parseYaml(raw) as { global: { fail_policy: { dev: string } } };
      expect(parsed.global.fail_policy.dev).toBe("closed");
    } finally {
      boot.close();
      reloadSpy.mockRestore();
    }
  });

  test("rejects invalid fail_policy values without calling reload", async () => {
    const root = mkProject();
    writeConfig(root);
    const { ctx, boot } = makeCtx(root);
    const reloadSpy = vi.spyOn(boot, "reload");
    try {
      const tool = findTool("gate.config_set");
      const result = await Promise.resolve(
        tool.handler(
          {
            path: "global.fail_policy.prod",
            value: "maybe",
          },
          ctx,
        ),
      );
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("invalid value");

      // Verify reload was NOT called
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      boot.close();
      reloadSpy.mockRestore();
    }
  });
});
