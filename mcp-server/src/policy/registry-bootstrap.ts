// mcp-server/src/policy/registry-bootstrap.ts
//
// Lazily loads Config, RulePackRegistry, SessionState, and AuditWriter
// for a single gate-mcp process lifetime.
//
// On first-run (no config.yaml), the engine runs in audit-only mode:
// databases() returns [] and the engine returns ALLOW for every call.

import { join } from "node:path";
import { loadConfig, ConfigLoadError, ConfigErrorCode } from "../config/loader.js";
import type { Config, DatabaseConfig } from "../config/schema.js";
import { loadRulePackRegistry, type RulePackRegistry } from "./rule-pack-loader.js";
import { createSessionState, type SessionState } from "./session.js";
import { createAuditWriter, type AuditWriter } from "../audit/jsonl.js";
import { info, warn } from "../log.js";

export interface BootstrapOpts {
  projectRoot: string;
  sessionId: string;
  rulesDir: string;
  userRulesDir?: string; // defaults to <projectRoot>/.claude-gate/rules
  auditPath?: string;
}

export interface Bootstrap {
  databases: () => DatabaseConfig[];
  rule_packs: () => RulePackRegistry;
  session: () => SessionState;
  audit: () => AuditWriter;
  config: () => Config | null;
  reload: () => void;
  close: () => void;
  project_root: string;
  session_id: string;
  debugState: {
    active: boolean;
    expires_at_ms: number;
    intercept_patterns: string[];
  };
}

export function createBootstrap(opts: BootstrapOpts): Bootstrap {
  // undefined = not yet attempted; null = attempted and NOT_FOUND
  let cachedConfig: Config | null | undefined;
  let cachedRulePacks: RulePackRegistry | undefined;
  let cachedSession: SessionState | undefined;
  let cachedAudit: AuditWriter | undefined;

  const auditPath =
    opts.auditPath ?? join(opts.projectRoot, ".claude-gate", "audit.jsonl");

  function ensureConfig(): Config | null {
    if (cachedConfig === undefined) {
      try {
        cachedConfig = loadConfig(opts.projectRoot);
      } catch (e) {
        if (
          e instanceof ConfigLoadError &&
          e.code === ConfigErrorCode.NOT_FOUND
        ) {
          info("config not found; running in audit-only mode");
          cachedConfig = null;
        } else {
          throw e;
        }
      }
    }
    return cachedConfig;
  }

  function ensureRulePacks(): RulePackRegistry {
    if (cachedRulePacks === undefined) {
      const cfg = ensureConfig();
      const pinned: Record<string, string | undefined> = {};
      if (cfg) {
        for (const [k, v] of Object.entries(cfg.rule_packs)) {
          pinned[k] = v.pinned_version;
        }
      }
      cachedRulePacks = loadRulePackRegistry({
        rulesDir: opts.rulesDir,
        userRulesDir: opts.userRulesDir ?? join(opts.projectRoot, ".claude-gate", "rules"),
        pinned,
      });
    }
    return cachedRulePacks;
  }

  const debugState = {
    active: false,
    expires_at_ms: 0,
    intercept_patterns: [] as string[],
  };

  return {
    project_root: opts.projectRoot,
    session_id: opts.sessionId,
    debugState,
    databases: () => ensureConfig()?.databases ?? [],
    rule_packs: () => ensureRulePacks(),
    session: () => {
      if (cachedSession === undefined) {
        cachedSession = createSessionState(opts.sessionId);
      }
      return cachedSession;
    },
    audit: () => {
      if (cachedAudit === undefined) {
        cachedAudit = createAuditWriter({ path: auditPath });
      }
      return cachedAudit;
    },
    config: () => ensureConfig(),
    reload: () => {
      cachedConfig = undefined;
      cachedRulePacks = undefined;
    },
    close: () => {
      try {
        cachedAudit?.close();
      } catch (e) {
        warn(`audit close failed: ${String(e)}`);
      }
    },
  };
}
