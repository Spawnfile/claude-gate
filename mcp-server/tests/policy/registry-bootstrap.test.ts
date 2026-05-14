import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBootstrap } from "../../src/policy/registry-bootstrap";

// rules/ lives at the repo root, one level above mcp-server/
const repoRoot = resolve(__dirname, "../../..");
const rulesDir = join(repoRoot, "rules");

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
});

function mkProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "cg-boot-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("registry-bootstrap", () => {
  test("first run (no config.yaml) yields empty databases array and a working bootstrap", () => {
    const root = mkProject();
    const boot = createBootstrap({
      projectRoot: root,
      sessionId: "sess_test",
      rulesDir,
    });
    cleanup.push(() => boot.close());
    expect(boot.databases()).toEqual([]);
    expect(boot.session().session_id).toBe("sess_test");
    expect(boot.config()).toBeNull();
  });

  test("loads config when present and reload() picks up edits", () => {
    const root = mkProject();
    mkdirSync(join(root, ".claude-gate"), { recursive: true });
    writeFileSync(join(root, ".claude-gate", "config.yaml"), MINIMAL_CONFIG_YAML);
    const boot = createBootstrap({
      projectRoot: root,
      sessionId: "s",
      rulesDir,
    });
    cleanup.push(() => boot.close());
    expect(boot.databases().length).toBe(1);

    // Edit config to add a second DB and reload.
    writeFileSync(join(root, ".claude-gate", "config.yaml"), TWO_DB_CONFIG_YAML);
    boot.reload();
    expect(boot.databases().length).toBe(2);
  });

  test("debugState is initialized to inactive with empty patterns", () => {
    const root = mkProject();
    const boot = createBootstrap({
      projectRoot: root,
      sessionId: "sess_debug",
      rulesDir,
    });
    cleanup.push(() => boot.close());
    expect(boot.debugState.active).toBe(false);
    expect(boot.debugState.expires_at_ms).toBe(0);
    expect(boot.debugState.intercept_patterns).toEqual([]);
  });

  test("rule_packs() loads from rules dir", () => {
    const root = mkProject();
    const boot = createBootstrap({
      projectRoot: root,
      sessionId: "sess_packs",
      rulesDir,
    });
    cleanup.push(() => boot.close());
    const reg = boot.rule_packs();
    expect(reg.packs.size).toBeGreaterThan(0);
  });
});

const MINIMAL_CONFIG_YAML = `version: 1
global:
  fail_policy: { prod: closed, dev: open, local: open }
  audit: { integrity: hash_chain, redact_params: true }
databases:
  - name: supabase_prod
    matchers:
      - { tool: "mcp__supabase_prod__*", mcp_server_id: "supabase_prod" }
    env: prod
    policy: strict
    confidence: 0.99
    discovered_from: [{ scanner: env_scanner, file: ".env.prod" }]
rule_packs:
  sql: { pinned_version: "1.0.0", enabled: true }
custom_rules: []
`;

const TWO_DB_CONFIG_YAML = `version: 1
global:
  fail_policy: { prod: closed, dev: open, local: open }
  audit: { integrity: hash_chain, redact_params: true }
databases:
  - name: supabase_prod
    matchers:
      - { tool: "mcp__supabase_prod__*", mcp_server_id: "supabase_prod" }
    env: prod
    policy: strict
    confidence: 0.99
    discovered_from: [{ scanner: env_scanner, file: ".env.prod" }]
  - name: supabase_dev
    matchers:
      - { tool: "mcp__supabase_dev__*", mcp_server_id: "supabase_dev" }
    env: dev
    policy: confirm
    confidence: 0.95
    discovered_from: [{ scanner: env_scanner, file: ".env.dev" }]
rule_packs:
  sql: { pinned_version: "1.0.0", enabled: true }
custom_rules: []
`;
// IMPORTANT: the second fixture is written out in full instead of constructed
// via .replace() because string replacement on a multi-line YAML preserves the
// source indentation of the template literal, which would put the second
// list item at the wrong column and break YAML parsing.
