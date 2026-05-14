// Manual harness — user rule pack override and version-mismatch rejection.
//
// Boots a real IPC server pointing at a tmp project, writes a user rule pack
// override under <project>/.claude-gate/rules/, and shows the decision flips
// because the user pack reclassified SELECT as HIGH (default ships LOW).

import { describe, test } from "vitest";
import { connect } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";
import { startIpcServer } from "../../src/ipc/server";
import { createBootstrap } from "../../src/policy/registry-bootstrap";
import { PendingActionStore } from "../../src/setup/pending-action";

async function rpc(socketPath: string, req: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const client = connect(socketPath);
    const dec = new FrameDecoder();
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; client.destroy(); reject(new Error("timeout")); }
    }, 5000);
    dec.on("message", (m) => {
      if (!done) { done = true; clearTimeout(timer); client.end(); resolve(m); }
    });
    dec.on("error", reject);
    client.on("error", reject);
    client.on("connect", () => client.write(encodeFrame(req)));
    client.on("data", (c) => dec.feed(c));
  });
}

describe("Manual harness — user rule pack override", () => {
  test("override + version-match + version-mismatch", async () => {
    const root = "/tmp/cg-manual-test/proj-rules";
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, ".claude-gate", "rules"), { recursive: true });

    // Config pinned to sql 1.0.0.
    writeFileSync(join(root, ".claude-gate", "config.yaml"), [
      "version: 1",
      "global:",
      "  fail_policy:",
      "    prod: closed",
      "    dev: open",
      "    local: open",
      "  audit:",
      "    integrity: hash_chain",
      "    redact_params: true",
      "databases:",
      "  - name: dev_db",
      "    matchers:",
      "      - mcp_server_id: dev_db",
      "    env: dev",
      "    policy: confirm",
      "    confidence: 0.95",
      "    discovered_from:",
      "      - { scanner: env_scanner, file: \".env\" }",
      "rule_packs:",
      "  sql:",
      "    pinned_version: \"1.0.0\"",
      "    enabled: true",
      "custom_rules: []",
      "",
    ].join("\n"));

    const socketPath = join(tmpdir(), `cg-manual-rules-${process.pid}.sock`);
    if (existsSync(socketPath)) unlinkSync(socketPath);

    const bootstrap = createBootstrap({
      projectRoot: root,
      sessionId: "manual-test-rules",
      rulesDir: resolve(__dirname, "../../../rules"),
    });
    const pendingActions = new PendingActionStore();
    const ipc = await startIpcServer({ socketPath, bootstrap, pendingActions });

    function selectDecide(reqId: string) {
      return {
        protocol_version: "1" as const,
        request_id: reqId,
        type: "decide" as const,
        payload: {
          tool_name: "mcp__plugin_claude-gate_dev_db__execute_sql",
          tool_use_id: `toolu_${reqId}`,
          parameters: { query: "SELECT id, name FROM products LIMIT 10" },
          session_id: "manual-test-rules",
          cwd: root,
          timestamp_ms: Date.now(),
          mcp_server_id: "dev_db",
        },
      };
    }

    try {
      // ----- Test A: no user pack → shipped pack applies → SELECT is LOW → ALLOW
      console.log("\n========== Test A: no user pack, ship's SELECT tier (expect ALLOW) ==========");
      const respA = await rpc(socketPath, selectDecide("ruleA")) as Record<string, unknown>;
      console.log(`response.decision = ${respA["decision"]}  (expect ALLOW because SELECT is LOW under confirm)`);
      console.log(`response.rationale = ${respA["rationale"]}`);

      // ----- Test B: drop user pack at same version with rules that retier SELECT to HIGH
      console.log("\n========== Test B: drop user pack v1.0.0 retiering SELECT -> HIGH (expect ASK) ==========");
      writeFileSync(join(root, ".claude-gate", "rules", "sql.yaml"), [
        "version: \"1.0.0\"",
        "name: sql",
        "description: \"user override - SELECT retiered to HIGH\"",
        "applies_to:",
        "  tool_patterns:",
        "    - \"mcp__*dev_db*\"",
        "parser: sql",
        "risk_tiers:",
        "  LOW:",
        "    statement_types: []",
        "    transactional:",
        "      - BEGIN",
        "      - COMMIT",
        "      - ROLLBACK",
        "  MED:",
        "    - statement_type: INSERT",
        "    - statement_type: UPDATE",
        "      requires: [WHERE]",
        "    - statement_type: DELETE",
        "      requires: [WHERE]",
        "  HIGH:",
        "    - statement_type: SELECT",
        "    - statement_type: UPDATE",
        "      forbids: [WHERE]",
        "    - statement_type: DELETE",
        "      forbids: [WHERE]",
        "    - statement_type: MERGE",
        "  CRIT:",
        "    statement_types:",
        "      - DROP",
        "      - TRUNCATE",
        "      - ALTER",
        "",
      ].join("\n"));
      bootstrap.reload();

      const respB = await rpc(socketPath, selectDecide("ruleB")) as Record<string, unknown>;
      console.log(`response.decision = ${respB["decision"]}  (expect ASK because SELECT is now HIGH under confirm)`);
      console.log(`response.rationale = ${respB["rationale"]}`);

      // ----- Test C: bump user pack version to 9.9.9; expect load failure on reload
      console.log("\n========== Test C: user pack version mismatch (expect load error) ==========");
      const oldPack = readFileSync(join(root, ".claude-gate", "rules", "sql.yaml"), "utf-8");
      writeFileSync(
        join(root, ".claude-gate", "rules", "sql.yaml"),
        oldPack.replace("version: \"1.0.0\"", "version: \"9.9.9\"")
      );
      bootstrap.reload();

      let caught: string | null = null;
      try {
        await rpc(socketPath, selectDecide("ruleC"));
        // Even if no throw, the response will carry an error.
      } catch (e) {
        caught = String(e);
      }
      // Try one more decide to surface the loader error in the response.
      let respC: Record<string, unknown> | null = null;
      try {
        respC = await rpc(socketPath, selectDecide("ruleC2")) as Record<string, unknown>;
      } catch (e) {
        caught = String(e);
      }
      if (caught) {
        console.log(`(rpc-level error caught: ${caught})`);
      } else if (respC) {
        console.log(`response.decision = ${respC["decision"]}`);
        console.log(`response.error    = ${JSON.stringify(respC["error"])}`);
      }

      console.log("\n========== Expected ==========");
      console.log("A: ALLOW  (shipped pack, SELECT is LOW)");
      console.log("B: ASK    (user pack v1.0.0, SELECT retiered to HIGH)");
      console.log("C: INTERNAL error in IPC response (pack pinned to 1.0.0, only v9.9.9 user pack exists)");
    } finally {
      bootstrap.close();
      await ipc.close();
    }
  }, 30000);
});
