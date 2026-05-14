// mcp-server/src/policy/engine.ts
//
// Public entry: decide(envelope, deps) -> EngineDecision.
//
// Wires Stages 1 -> 2 -> 3 -> 4 -> 5 -> 7.
// Source of truth: design Section 5.

import type { ToolCallEnvelope } from "./tool-call.js";
import type { DatabaseConfig } from "../config/schema.js";
import type { RulePackRegistry } from "./rule-pack-loader.js";
import type { SessionState } from "./session.js";
import { applySessionOverride } from "./session.js";
import { matchResource } from "./match.js";
import { dispatchParser } from "./parse.js";
import { classifyRisk } from "./risk.js";
import { decideByPolicy } from "./decision.js";
import { hashParameters } from "../audit/redact.js";
import type { AuditEntry } from "../audit/types.js";
import type { AuditWriter } from "../audit/jsonl.js";
import type { DecisionVerb, RiskLevel } from "./rule-pack-schema.js";
import { warn } from "../log.js";

export interface EngineDeps {
  databases: DatabaseConfig[];
  rule_packs: RulePackRegistry;
  session: SessionState;
  audit: AuditWriter;
  now_ms: () => number;
}

export interface EngineDecision {
  decision: DecisionVerb;
  rationale: string;
  risk: RiskLevel | "UNRATED";
  resource: string | null;
  via: string;
}

export async function decide(
  envelope: ToolCallEnvelope,
  deps: EngineDeps,
): Promise<EngineDecision> {
  const t0 = now();
  const trace: AuditEntry["stage_trace"] = {
    match_ms: 0,
    parse_ms: 0,
    classify_ms: 0,
    policy_ms: 0,
    total_ms: 0,
  };

  // Stage 1.
  const matchStart = now();
  const resource = matchResource(envelope, deps.databases);
  trace.match_ms = now() - matchStart;

  if (resource === null) {
    const entry = makeEntry({
      envelope,
      resource: null,
      risk: "UNRATED",
      decision: "ALLOW",
      rationale: "no resource matched",
      via: "none",
      policy_mode: null,
      session: deps.session,
      trace: finalize(trace, t0),
      now: deps.now_ms,
    });
    deps.audit.append(entry);
    return {
      decision: "ALLOW",
      rationale: entry.rationale,
      risk: "UNRATED",
      resource: null,
      via: "none",
    };
  }

  // Stage 2.
  const parseStart = now();
  const dispatched = dispatchParser({
    tool_name: envelope.tool_name,
    parameters: envelope.parameters,
    packs: deps.rule_packs.packs,
  });
  trace.parse_ms = now() - parseStart;

  if (dispatched.kind === "NO_PACK") {
    const entry = makeEntry({
      envelope,
      resource: resource.name,
      env: resource.env,
      risk: "UNRATED",
      decision: "DENY",
      rationale:
        "no rule pack covers this tool; fail-closed (defense-in-depth)",
      via: "none",
      policy_mode: resource.policy,
      session: deps.session,
      trace: finalize(trace, t0),
      now: deps.now_ms,
    });
    deps.audit.append(entry);
    return {
      decision: "DENY",
      rationale: entry.rationale,
      risk: "UNRATED",
      resource: resource.name,
      via: "none",
    };
  }

  if (dispatched.kind === "PARSE_FAILED") {
    const entry = makeEntry({
      envelope,
      resource: resource.name,
      env: resource.env,
      risk: "UNRATED",
      decision: "DENY",
      rationale: `parse failed: ${dispatched.error}; fail-closed`,
      via: "none",
      policy_mode: resource.policy,
      session: deps.session,
      trace: finalize(trace, t0),
      now: deps.now_ms,
    });
    deps.audit.append(entry);
    return {
      decision: "DENY",
      rationale: entry.rationale,
      risk: "UNRATED",
      resource: resource.name,
      via: "none",
    };
  }

  // Stage 3.
  const classifyStart = now();
  const risk = classifyRisk(dispatched.parsed, dispatched.pack);
  trace.classify_ms = now() - classifyStart;

  // Stage 4.
  const policyStart = now();
  const matrix = deps.rule_packs.policies[resource.policy];
  if (matrix === undefined) {
    warn(`policy "${resource.policy}" not defined in policies.yaml`);
    const entry = makeEntry({
      envelope,
      resource: resource.name,
      env: resource.env,
      risk,
      decision: "DENY",
      rationale: `policy "${resource.policy}" not defined; fail-closed`,
      via: "none",
      policy_mode: resource.policy,
      session: deps.session,
      trace: finalize(trace, t0),
      now: deps.now_ms,
    });
    deps.audit.append(entry);
    return {
      decision: "DENY",
      rationale: entry.rationale,
      risk,
      resource: resource.name,
      via: "none",
    };
  }
  const tentative = decideByPolicy(matrix, risk);
  trace.policy_ms = now() - policyStart;

  // Stage 5.
  const override = applySessionOverride({
    session: deps.session,
    resource_name: resource.name,
    pack_name: dispatched.pack_name,
    risk,
    tentative,
    now_ms: deps.now_ms(),
    tool_name: envelope.tool_name,
  });

  const final = override.decision;
  const via = override.via;

  const rationale = buildRationale({
    decision: final,
    risk,
    resource: resource.name,
    env: resource.env,
    policy: resource.policy,
    statementKind: dispatched.parsed.statement_kind,
    via,
  });

  // Stage 7.
  const entry = makeEntry({
    envelope,
    resource: resource.name,
    env: resource.env,
    risk,
    decision: final,
    rationale,
    via,
    policy_mode: resource.policy,
    session: deps.session,
    trace: finalize(trace, t0),
    now: deps.now_ms,
  });
  deps.audit.append(entry);

  return {
    decision: final,
    rationale,
    risk,
    resource: resource.name,
    via,
  };
}

function buildRationale(args: {
  decision: DecisionVerb;
  risk: RiskLevel;
  resource: string;
  env: string;
  policy: string;
  statementKind: string;
  via: string;
}): string {
  const viaSuffix = args.via && args.via !== "none" ? ` (via ${args.via})` : "";
  return `${args.risk} operation (${args.statementKind}) on ${args.resource} [${args.env}] under ${args.policy} policy -> ${args.decision}${viaSuffix}`;
}

interface MakeEntryArgs {
  envelope: ToolCallEnvelope;
  resource: string | null;
  env?: AuditEntry["env"];
  risk: RiskLevel | "UNRATED";
  decision: DecisionVerb;
  rationale: string;
  via: string;
  policy_mode: string | null;
  session: SessionState;
  trace: AuditEntry["stage_trace"];
  now: () => number;
}

function makeEntry(args: MakeEntryArgs): AuditEntry {
  return {
    ts: new Date(args.now()).toISOString(),
    session_id: args.session.session_id,
    tool: args.envelope.tool_name,
    resource: args.resource,
    env: (args.env ?? null) as AuditEntry["env"],
    risk: args.risk,
    decision: args.decision,
    rationale: args.rationale,
    params_hash: hashParameters(args.envelope.parameters),
    policy_mode: args.policy_mode,
    session_state: {
      mode: args.session.mode,
      active_batch_tokens: args.session.batch_tokens.map((t) => t.pattern),
    },
    stage_trace: args.trace,
    via: args.via,
    tool_use_id: args.envelope.tool_use_id,
    ...(args.envelope.permission_mode !== undefined
      ? { permission_mode: args.envelope.permission_mode }
      : {}),
    prev_hash: "",
    this_hash: "",
  };
}

function finalize(
  trace: AuditEntry["stage_trace"],
  t0: number,
): AuditEntry["stage_trace"] {
  trace.total_ms = now() - t0;
  return trace;
}

function now(): number {
  return Date.now();
}
