// mcp-server/src/setup/setup.ts
//
// Public entry points for the 3-step setup wizard.
// Imports discovery (env + mcp-config scanners), state.ts, and config/loader.

import { runDiscovery } from "../discovery/index.js";
import { envScanner } from "../discovery/scanners/env-scanner.js";
import { createMcpConfigScanner } from "../discovery/scanners/mcp-config-scanner.js";
import { ConfigSchema, type Config } from "../config/schema.js";
import { configPath } from "../config/loader.js";
import { stringify as yamlStringify } from "yaml";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  createSetupState,
  canAdvance,
  nextStep,
  loadSetupState,
  saveSetupState,
  type SetupState,
  type DiscoveredDb,
} from "./state.js";

export interface StartOpts {
  projectRoot: string;
  cacheDir?: string;
}

export async function startOrResumeSetup(opts: StartOpts): Promise<SetupState> {
  const existing = loadSetupState(opts.projectRoot);
  if (existing) return existing;

  const cachePath = join(
    opts.cacheDir ?? join(homedir(), ".claude", "gate"),
    "registry-cache.json",
  );
  const discovery = await runDiscovery({
    projectRoot: opts.projectRoot,
    scanners: [envScanner, createMcpConfigScanner()],
    cachePath,
  });
  const discovered: DiscoveredDb[] = discovery.registry.resources.map((r) => ({
    name: r.name,
    type: r.type,
    endpoint: r.endpoint,
    env: r.env,
    confidence: r.confidence,
    discovered_from: r.discovered_from,
  }));
  const state = createSetupState(discovered);
  saveSetupState(opts.projectRoot, state);
  return state;
}

export function editDb(
  projectRoot: string,
  name: string,
  edits: { env?: "prod" | "dev" | "local"; remove?: boolean },
): SetupState {
  const s = mustLoad(projectRoot);
  const next: SetupState = {
    ...s,
    user_edits: { ...s.user_edits, [name]: { ...s.user_edits[name], ...edits } },
    last_updated_at: new Date().toISOString(),
  };
  saveSetupState(projectRoot, next);
  return next;
}

export function setPolicy(
  projectRoot: string,
  name: string,
  policy: "strict" | "confirm" | "dev" | "allow",
): SetupState {
  const s = mustLoad(projectRoot);
  const next: SetupState = {
    ...s,
    policies: { ...s.policies, [name]: policy },
    last_updated_at: new Date().toISOString(),
  };
  saveSetupState(projectRoot, next);
  return next;
}

export function advance(
  projectRoot: string,
): { state: SetupState } | { error: { code: string; message: string } } {
  const s = mustLoad(projectRoot);
  const block = canAdvance(s);
  if (block) return { error: block };
  const nx = nextStep(s);
  if (typeof nx === "object" && "code" in nx) return { error: nx };
  const next: SetupState = {
    ...s,
    completed_steps: [...s.completed_steps, s.current_step],
    current_step: nx,
    last_updated_at: new Date().toISOString(),
  };
  saveSetupState(projectRoot, next);
  return { state: next };
}

export interface FinalizeResult {
  config_path: string;
}

export function finalize(projectRoot: string): FinalizeResult {
  const s = mustLoad(projectRoot);
  if (s.current_step !== "step_3_review") {
    throw new Error(`cannot finalize from step ${s.current_step}`);
  }
  const cfg: Config = buildConfig(s);
  const parsed = ConfigSchema.safeParse(cfg);
  if (!parsed.success) {
    throw new Error(
      `invalid config built from setup state: ${parsed.error.message}`,
    );
  }
  const p = configPath(projectRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, yamlStringify(parsed.data), "utf-8");
  const next: SetupState = {
    ...s,
    completed_steps: [...s.completed_steps, "step_3_review"],
    current_step: "active",
    last_updated_at: new Date().toISOString(),
  };
  saveSetupState(projectRoot, next);
  return { config_path: p };
}

function buildConfig(s: SetupState): Config {
  const dbs = s.discovered
    .filter((d) => !s.user_edits[d.name]?.remove)
    .map((d) => {
      const env =
        s.user_edits[d.name]?.env ??
        (d.env === "unknown" ? "unknown" : d.env);
      const policy = s.policies[d.name];
      if (!policy) throw new Error(`missing policy for ${d.name}`);
      // Pull MCP server-id from discovered_from when an mcp_config_scanner
      // entry exists; otherwise fall back to the resource name.
      const mcpSource = d.discovered_from.find(
        (src) => src.scanner === "mcp_config_scanner" && src.server,
      );
      const mcpServerId = mcpSource?.server ?? d.name;
      // We emit BOTH mcp_server_id and a tool glob. CC's wire format is
      // `mcp__plugin_<plugin>_<server>__<tool>`; the regex that derives
      // mcp_server_id fails when <server> contains underscores.
      // The tool glob is the always-works fallback: globMatch matches
      // even when regex-based id derivation returns null. matchResource
      // skips the mcp_server_id constraint when envelope.mcp_server_id
      // is null (no hard reject), so adding the glob is purely additive.
      return {
        name: d.name,
        matchers: [
          {
            mcp_server_id: mcpServerId,
            tool: `mcp__plugin_*_${mcpServerId}__*`,
          },
        ],
        env: env as Config["databases"][number]["env"],
        policy: policy as Config["databases"][number]["policy"],
        confidence: d.confidence,
        discovered_from: d.discovered_from,
      };
    });
  return {
    version: 1,
    global: {
      fail_policy: { prod: "closed", dev: "open", local: "open" },
      audit: { integrity: "hash_chain", redact_params: true },
    },
    databases: dbs,
    rule_packs: { sql: { pinned_version: "1.0.0", enabled: true } },
    custom_rules: [],
  };
}

function mustLoad(projectRoot: string): SetupState {
  const s = loadSetupState(projectRoot);
  if (!s) throw new Error("no setup state; call startOrResumeSetup first");
  return s;
}
