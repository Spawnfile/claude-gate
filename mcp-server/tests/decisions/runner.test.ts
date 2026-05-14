// mcp-server/tests/decisions/runner.test.ts
import { describe, expect, test, beforeAll } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { decide } from "../../src/policy/engine";
import {
  loadRulePackRegistry,
  type RulePackRegistry,
} from "../../src/policy/rule-pack-loader";
import {
  createSessionState,
  type SessionState,
  type BatchToken,
} from "../../src/policy/session";
import { createAuditWriter } from "../../src/audit/jsonl";
import type { DatabaseConfig } from "../../src/config/schema";
import type { ToolCallEnvelope } from "../../src/policy/tool-call";

interface FixtureCase {
  name: string;
  session_setup?: {
    batch_tokens?: Array<{
      pattern: string;
      expires_in_ms: number;
      remaining_count: number;
    }>;
    mode?: "interactive" | "block-all" | "approve-all" | "debug";
  };
  input: Partial<ToolCallEnvelope> & {
    tool_name: string;
    mcp_server_id: string | null;
    parameters: unknown;
  };
  expected: {
    decision: "ALLOW" | "DENY" | "ASK";
    risk: "LOW" | "MED" | "HIGH" | "CRIT" | "UNRATED";
    resource?: string | null;
    via?: string;
  };
}

const fixturesDir = resolve(__dirname, "fixtures");
const repoRoot = resolve(__dirname, "../../..");
const dbConfig = parseYaml(
  readFileSync(join(fixturesDir, "configs", "multi-db.yaml"), "utf-8"),
) as { databases: DatabaseConfig[] };

let registry: RulePackRegistry;
beforeAll(() => {
  registry = loadRulePackRegistry({
    rulesDir: join(repoRoot, "rules"),
    pinned: {},
  });
});

function buildEnvelope(c: FixtureCase): ToolCallEnvelope {
  return {
    protocol_version: "1",
    tool_name: c.input.tool_name,
    tool_use_id: "toolu_test",
    parameters: c.input.parameters,
    session_id: "sess_fixture",
    cwd: "/x",
    timestamp_ms: 1,
    mcp_server_id: c.input.mcp_server_id,
  };
}

function buildSession(c: FixtureCase): SessionState {
  const s = createSessionState("sess_fixture");
  if (c.session_setup?.mode) s.mode = c.session_setup.mode;
  if (c.session_setup?.batch_tokens) {
    const now = 1_000;
    s.batch_tokens = c.session_setup.batch_tokens.map<BatchToken>((t) => ({
      pattern: t.pattern,
      created_at: now,
      expires_at: now + t.expires_in_ms,
      remaining_count: t.remaining_count,
    }));
  }
  return s;
}

const fixtureFiles = readdirSync(fixturesDir).filter(
  (f) => f.endsWith(".json"),
);

describe("decision regression suite", () => {
  for (const file of fixtureFiles) {
    const cases: FixtureCase[] = JSON.parse(
      readFileSync(join(fixturesDir, file), "utf-8"),
    );
    describe(file, () => {
      for (const c of cases) {
        test(c.name, async () => {
          const dir = mkdtempSync(join(tmpdir(), "cg-regression-"));
          try {
            const audit = createAuditWriter({ path: join(dir, "audit.jsonl") });
            const session = buildSession(c);
            const r = await decide(buildEnvelope(c), {
              databases: dbConfig.databases,
              rule_packs: registry,
              session,
              audit,
              now_ms: () => 1_000,
            });
            audit.close();

            expect(r.decision).toBe(c.expected.decision);
            expect(r.risk).toBe(c.expected.risk);
            if (c.expected.resource !== undefined) {
              expect(r.resource).toBe(c.expected.resource);
            }
            if (c.expected.via !== undefined) {
              expect(r.via).toBe(c.expected.via);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        });
      }
    });
  }
});
