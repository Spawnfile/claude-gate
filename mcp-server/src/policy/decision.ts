// mcp-server/src/policy/decision.ts
//
// Stage 4 of the decision pipeline. Pure decision matrix lookup.
// Source of truth: design Section 5 Stage 4 + rules/policies.yaml.

import type {
  PolicyMatrix,
  RiskLevel,
  DecisionVerb,
} from "./rule-pack-schema.js";

export function decideByPolicy(
  matrix: PolicyMatrix,
  risk: RiskLevel,
): DecisionVerb {
  const v = matrix[risk];
  if (v === undefined) {
    throw new Error(
      `policy matrix is missing the "${risk}" risk level; this is a bug or a malformed policy`,
    );
  }
  return v;
}
