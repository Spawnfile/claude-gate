// Manual harness — gate.config_set whitelist verification.
//
// Calls the real configTools handlers from the registry against a tmp project,
// exercising allowed/refused paths and confirming bootstrap.reload() is called
// only on success.

import { describe, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { vi } from "vitest";
import { createBootstrap } from "../../src/policy/registry-bootstrap";
import { PendingActionStore } from "../../src/setup/pending-action";
import { configTools } from "../../src/tools/config-tools";

const ROOT = "/tmp/cg-manual-test/proj-config";

function setupRoot(): void {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, ".claude-gate"), { recursive: true });
  writeFileSync(join(ROOT, ".claude-gate", "config.yaml"), [
    "version: 1",
    "global:",
    "  fail_policy:",
    "    prod: closed",
    "    dev: open",
    "    local: open",
    "  audit:",
    "    integrity: hash_chain",
    "    redact_params: true",
    "databases: []",
    "rule_packs:",
    "  sql:",
    "    pinned_version: \"1.0.0\"",
    "    enabled: true",
    "custom_rules: []",
    "",
  ].join("\n"));
}

describe("Manual harness — gate.config_set whitelist", () => {
  test("allowed paths land; refused paths reject without reload", () => {
    setupRoot();
    const realBootstrap = createBootstrap({
      projectRoot: ROOT,
      sessionId: "manual-config",
      rulesDir: resolve(__dirname, "../../../rules"),
    });
    const reloadSpy = vi.spyOn(realBootstrap, "reload");
    const pendingActions = new PendingActionStore();
    const ctx = { bootstrap: realBootstrap, pendingActions };

    const get = configTools.find((t) => t.name === "gate.config_get")!;
    const set = configTools.find((t) => t.name === "gate.config_set")!;

    function show(label: string, result: { content: Array<{ text: string }> }) {
      console.log(`\n  [${label}]\n    ${result.content[0].text.split("\n").join("\n    ")}`);
    }

    console.log("\n========== Scenario 1: gate.config_get baseline ==========");
    show("config_get", get.handler({}, ctx) as { content: Array<{ text: string }> });
    console.log(`    reload calls so far: ${reloadSpy.mock.calls.length}`);

    console.log("\n========== Scenario 2: ALLOWED  global.fail_policy.dev=closed ==========");
    show("set", set.handler(
      { path: "global.fail_policy.dev", value: "closed" },
      ctx,
    ) as { content: Array<{ text: string }> });
    console.log(`    reload calls so far: ${reloadSpy.mock.calls.length}`);

    console.log("\n========== Scenario 3: ALLOWED  global.fail_policy.prod=open ==========");
    show("set", set.handler(
      { path: "global.fail_policy.prod", value: "open" },
      ctx,
    ) as { content: Array<{ text: string }> });
    console.log(`    reload calls so far: ${reloadSpy.mock.calls.length}`);

    console.log("\n========== Scenario 4: REFUSED  bad path (global.audit.integrity) ==========");
    const callsBefore4 = reloadSpy.mock.calls.length;
    show("set", set.handler(
      { path: "global.audit.integrity", value: "none" },
      ctx,
    ) as { content: Array<{ text: string }> });
    console.log(`    reload calls delta: ${reloadSpy.mock.calls.length - callsBefore4} (expect 0)`);

    console.log("\n========== Scenario 5: REFUSED  bad value ('maybe' on fail_policy) ==========");
    const callsBefore5 = reloadSpy.mock.calls.length;
    show("set", set.handler(
      { path: "global.fail_policy.local", value: "maybe" },
      ctx,
    ) as { content: Array<{ text: string }> });
    console.log(`    reload calls delta: ${reloadSpy.mock.calls.length - callsBefore5} (expect 0)`);

    console.log("\n========== Final on-disk config.yaml ==========");
    console.log(readFileSync(join(ROOT, ".claude-gate", "config.yaml"), "utf-8"));

    console.log("\n========== Total reload calls ==========");
    console.log(`Total reload() invocations: ${reloadSpy.mock.calls.length} (expect 2: scenarios 2, 3)`);

    realBootstrap.close();
  });
});
