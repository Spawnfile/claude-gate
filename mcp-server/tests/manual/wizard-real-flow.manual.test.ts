// Manual harness — end-to-end verification that the wizard-produced
// config actually gates real CC wire-format tool calls.
//
// Flow:
// 1. Set up a synthetic project with .env / .env.prod / .env.dev / .env.local
// 2. Run real discovery + wizard programmatically (no CC, no slash commands)
// 3. Read the generated config.yaml; verify matcher shape (mcp_server_id +
//    tool glob fallback)
// 4. Boot the real IPC server against this project
// 5. Send decide() requests with real CC wire-format tool names whose
//    server segment contains underscores (a known failure case)
// 6. Verify the full policy matrix:
//      strict + CRIT (DROP)            -> DENY
//      strict + LOW (SELECT)           -> ALLOW
//      confirm + MED (UPDATE WHERE)    -> ASK
//      confirm + LOW (SELECT)          -> ALLOW
//      confirm + CRIT (DROP)           -> DENY
//      dev + MED (UPDATE WHERE)        -> ALLOW
//      dev + CRIT (DROP)               -> ASK
//      allow + CRIT (DROP)             -> ALLOW

import { describe, test, expect } from "vitest";
import { connect } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { encodeFrame, FrameDecoder } from "../../src/ipc/framing";
import { startIpcServer } from "../../src/ipc/server";
import { createBootstrap } from "../../src/policy/registry-bootstrap";
import { PendingActionStore } from "../../src/setup/pending-action";
import {
  startOrResumeSetup,
  setPolicy,
  advance,
  editDb,
  finalize,
} from "../../src/setup/setup";

const RULES_DIR = resolve(__dirname, "../../../rules");

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

function decideRequest(toolName: string, query: string, root: string, suffix: string) {
  return {
    protocol_version: "1" as const,
    request_id: `req_${suffix}`,
    type: "decide" as const,
    payload: {
      tool_name: toolName,
      tool_use_id: `toolu_${suffix}`,
      parameters: { query },
      session_id: "manual-test-plan-f",
      cwd: root,
      timestamp_ms: Date.now(),
      mcp_server_id: null, // let the IPC server derive it
    },
  };
}

describe("Manual harness — wizard-generated config gates real CC calls", () => {
  test("full policy matrix end-to-end", async () => {
    const root = "/tmp/cg-plan-f-test";
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });

    // Set up synthetic .env files. The env_scanner produces resources
    // named after the URL segment (typically the database name from the
    // URL); we craft URLs whose DB names contain underscores so we
    // exercise the bug-fix path.
    writeFileSync(join(root, ".env"), [
      "DATABASE_URL=postgresql://user:pw@local-host:5432/postgres_default",
      "",
    ].join("\n"));
    writeFileSync(join(root, ".env.prod"), [
      "DATABASE_URL=postgresql://user:pw@prod-host.example.com:5432/postgres_prod",
      "",
    ].join("\n"));
    writeFileSync(join(root, ".env.dev"), [
      "DATABASE_URL=postgresql://user:pw@dev-host.example.com:5432/postgres_dev",
      "",
    ].join("\n"));
    writeFileSync(join(root, ".env.local"), [
      "DATABASE_URL=postgresql://user:pw@localhost:5432/postgres_local",
      "",
    ].join("\n"));

    console.log("\n========== Phase 1: Run real wizard programmatically ==========");

    // Use a project-scoped cache dir to keep ~/.claude/gate/ untouched.
    const cacheDir = join(root, ".claude-gate-cache");
    mkdirSync(cacheDir, { recursive: true });

    // Step 1: discovery + state init
    const state = await startOrResumeSetup({ projectRoot: root, cacheDir });
    console.log(`discovered ${state.discovered.length} resources:`);
    for (const d of state.discovered) {
      console.log(`  - ${d.name}  env=${d.env}  confidence=${d.confidence.toFixed(2)}`);
    }

    // Step 2: assign policies. Pick the names from discovery and assign
    // by env hint. We want a confirm-policy DB to trigger ASK.
    let confirmDbName: string | null = null;
    let strictDbName: string | null = null;
    let devDbName: string | null = null;
    let allowDbName: string | null = null;

    for (const d of state.discovered) {
      // Resolve env=unknown to "local" so advance() doesn't bail.
      if (d.env === "unknown") editDb(root, d.name, { env: "local" });

      const effectiveEnv = d.env === "unknown" ? "local" : d.env;
      if (effectiveEnv === "prod" && !strictDbName) {
        strictDbName = d.name;
        setPolicy(root, d.name, "strict");
      } else if (effectiveEnv === "dev" && !confirmDbName) {
        confirmDbName = d.name;
        setPolicy(root, d.name, "confirm");
      } else if (effectiveEnv === "local" && !allowDbName) {
        allowDbName = d.name;
        setPolicy(root, d.name, "allow");
      } else if (!devDbName) {
        devDbName = d.name;
        setPolicy(root, d.name, "dev");
      } else {
        // any extras get strict
        setPolicy(root, d.name, "strict");
      }
    }
    console.log(`assigned: confirm=${confirmDbName} strict=${strictDbName} dev=${devDbName} allow=${allowDbName}`);

    // Step 3: advance step_1 -> step_2, advance step_2 -> step_3, finalize
    const a1 = advance(root); // step_1 -> step_2
    if ("error" in a1) throw new Error(`advance step_1 failed: ${a1.error.message}`);
    const a2 = advance(root); // step_2 -> step_3
    if ("error" in a2) throw new Error(`advance step_2 failed: ${a2.error.message}`);
    finalize(root); // writes config.yaml

    console.log("\n========== Phase 2: Inspect generated config.yaml ==========");
    const cfgPath = join(root, ".claude-gate", "config.yaml");
    const cfgYaml = readFileSync(cfgPath, "utf-8");
    console.log(cfgYaml);

    // Phase 2 sanity: every db matcher has both mcp_server_id AND tool glob
    expect(cfgYaml).toContain("mcp_server_id:");
    expect(cfgYaml).toContain("tool: mcp__plugin_*_");

    console.log("\n========== Phase 3: Boot real IPC server ==========");

    const socketPath = join(tmpdir(), `cg-plan-f-${process.pid}.sock`);
    if (existsSync(socketPath)) unlinkSync(socketPath);

    const bootstrap = createBootstrap({
      projectRoot: root,
      sessionId: "manual-test-plan-f",
      rulesDir: RULES_DIR,
    });
    const ipc = await startIpcServer({
      socketPath,
      bootstrap,
      pendingActions: new PendingActionStore(),
    });

    try {
      console.log("\n========== Phase 4: Run policy matrix through real IPC ==========\n");

      // Build wire-format tool names that mimic what CC actually sends:
      // mcp__plugin_<plugin>_<server>__<tool>
      // The <server> segment matches the wizard-generated DB name, which
      // includes underscores. The derived mcp_server_id will be null,
      // and the matcher MUST fall back to the tool glob.
      function toolFor(dbName: string): string {
        return `mcp__plugin_test_${dbName}__execute_sql`;
      }

      const scenarios: Array<{
        label: string;
        db: string | null;
        sql: string;
        expect_decision: "ALLOW" | "DENY" | "ASK";
        expect_risk: string;
      }> = [];

      if (strictDbName) {
        scenarios.push(
          { label: "strict + LOW (SELECT)", db: strictDbName, sql: "SELECT 1", expect_decision: "ALLOW", expect_risk: "LOW" },
          { label: "strict + CRIT (DROP)", db: strictDbName, sql: "DROP TABLE products", expect_decision: "DENY", expect_risk: "CRIT" },
          { label: "strict + MED (UPDATE WHERE)", db: strictDbName, sql: "UPDATE products SET status='x' WHERE id=1", expect_decision: "DENY", expect_risk: "MED" },
        );
      }
      if (confirmDbName) {
        scenarios.push(
          { label: "confirm + LOW (SELECT)", db: confirmDbName, sql: "SELECT 1", expect_decision: "ALLOW", expect_risk: "LOW" },
          { label: "confirm + MED (UPDATE WHERE)", db: confirmDbName, sql: "UPDATE products SET status='x' WHERE id=1", expect_decision: "ASK", expect_risk: "MED" },
          { label: "confirm + HIGH (UPDATE no WHERE)", db: confirmDbName, sql: "UPDATE products SET status='x'", expect_decision: "ASK", expect_risk: "HIGH" },
          { label: "confirm + CRIT (DROP)", db: confirmDbName, sql: "DROP TABLE products", expect_decision: "DENY", expect_risk: "CRIT" },
        );
      }
      if (devDbName) {
        scenarios.push(
          { label: "dev + MED (UPDATE WHERE)", db: devDbName, sql: "UPDATE products SET status='x' WHERE id=1", expect_decision: "ALLOW", expect_risk: "MED" },
          { label: "dev + CRIT (DROP)", db: devDbName, sql: "DROP TABLE products", expect_decision: "ASK", expect_risk: "CRIT" },
        );
      }
      if (allowDbName) {
        scenarios.push(
          { label: "allow + CRIT (DROP)", db: allowDbName, sql: "DROP TABLE products", expect_decision: "ALLOW", expect_risk: "CRIT" },
        );
      }

      const results: Array<{ label: string; got: string; expected: string; pass: boolean }> = [];

      for (let i = 0; i < scenarios.length; i++) {
        const s = scenarios[i]!;
        if (!s.db) continue;
        const tool = toolFor(s.db);
        const resp = await rpc(socketPath, decideRequest(tool, s.sql, root, `m${i}`)) as Record<string, unknown>;
        const got = String(resp["decision"]);
        const pass = got === s.expect_decision;
        const marker = pass ? "OK " : "FAIL";
        console.log(`  [${marker}] ${s.label.padEnd(35)} expected=${s.expect_decision.padEnd(6)} got=${got.padEnd(6)} tool=${tool}`);
        results.push({ label: s.label, got, expected: s.expect_decision, pass });
      }

      console.log("\n========== Phase 5: Inspect audit log ==========");
      const auditPath = join(root, ".claude-gate", "audit.jsonl");
      const auditLines = existsSync(auditPath)
        ? readFileSync(auditPath, "utf-8").trim().split("\n").filter(Boolean)
        : [];
      console.log(`  audit.jsonl has ${auditLines.length} entries`);
      for (const line of auditLines.slice(-Math.min(5, auditLines.length))) {
        const e = JSON.parse(line);
        console.log(`    decision=${e.decision} risk=${e.risk} resource=${e.resource} via=${e.via}`);
      }

      console.log("\n========== Summary ==========");
      const failed = results.filter((r) => !r.pass);
      if (failed.length === 0) {
        console.log(`  ALL ${results.length} POLICY MATRIX SCENARIOS PASSED`);
      } else {
        console.log(`  ${failed.length} of ${results.length} FAILED:`);
        for (const f of failed) {
          console.log(`    - ${f.label}: expected=${f.expected}, got=${f.got}`);
        }
      }

      // Assert every scenario matched its expected decision.
      for (const r of results) {
        expect(r.got, `policy matrix mismatch for "${r.label}"`).toBe(r.expected);
      }

      // Audit should have one entry per decide call.
      expect(auditLines.length).toBe(results.length);
    } finally {
      bootstrap.close();
      await ipc.close();
    }
  }, 30000);
});
