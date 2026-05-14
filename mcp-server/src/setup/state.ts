// mcp-server/src/setup/state.ts
//
// Schema, types, and state-transition logic for the 3-step setup wizard.
// Persists state to <project>/.claude-gate/setup-state.json.
// Pure module: no network, no config loading, no business logic beyond transitions.

import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { warn } from "../log.js";

export const StepEnum = z.enum([
  "not_started",
  "step_1_discovery",
  "step_2_policy",
  "step_3_review",
  "active",
]);
export type Step = z.infer<typeof StepEnum>;

export const DiscoveredDbSchema = z.object({
  name: z.string(),
  type: z.string(),
  endpoint: z.string(),
  env: z.enum(["prod", "dev", "local", "unknown"]),
  confidence: z.number().min(0).max(1),
  discovered_from: z.array(
    z.object({
      scanner: z.string(),
      file: z.string().optional(),
      server: z.string().optional(),
      field: z.string().optional(),
    }),
  ),
});
export type DiscoveredDb = z.infer<typeof DiscoveredDbSchema>;

export const SetupStateSchema = z.object({
  version: z.literal(1),
  current_step: StepEnum,
  completed_steps: z.array(StepEnum),
  discovered: z.array(DiscoveredDbSchema),
  user_edits: z.record(
    z.string(),
    z.object({
      env: z.enum(["prod", "dev", "local"]).optional(),
      name: z.string().optional(),
      remove: z.boolean().optional(),
    }),
  ),
  policies: z.record(z.string(), z.enum(["strict", "confirm", "dev", "allow"])),
  started_at: z.string(),
  last_updated_at: z.string(),
});
export type SetupState = z.infer<typeof SetupStateSchema>;

export function setupStatePath(projectRoot: string): string {
  return join(projectRoot, ".claude-gate", "setup-state.json");
}

export function loadSetupState(projectRoot: string): SetupState | null {
  const p = setupStatePath(projectRoot);
  if (!existsSync(p)) return null;
  try {
    const parsed = SetupStateSchema.safeParse(
      JSON.parse(readFileSync(p, "utf-8")),
    );
    if (!parsed.success) {
      warn(`failed to parse setup-state.json at ${p}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveSetupState(projectRoot: string, s: SetupState): void {
  const p = setupStatePath(projectRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2), "utf-8");
}

const STEP_ORDER: Step[] = [
  "not_started",
  "step_1_discovery",
  "step_2_policy",
  "step_3_review",
  "active",
];

export interface AdvanceError {
  code: "INVALID_TRANSITION" | "PREREQUISITES_NOT_MET";
  message: string;
}

export function nextStep(s: SetupState): Step | AdvanceError {
  const idx = STEP_ORDER.indexOf(s.current_step);
  if (idx < 0 || idx === STEP_ORDER.length - 1) {
    return {
      code: "INVALID_TRANSITION",
      message: `cannot advance from ${s.current_step}`,
    };
  }
  return STEP_ORDER[idx + 1]!;
}

export function canAdvance(s: SetupState): AdvanceError | null {
  if (s.current_step === "step_1_discovery") {
    if (s.discovered.length === 0) {
      return {
        code: "PREREQUISITES_NOT_MET",
        message: "no databases discovered; cannot advance",
      };
    }
    const unresolvedUnknown = s.discovered.find(
      (d) => d.env === "unknown" && !s.user_edits[d.name]?.env,
    );
    if (unresolvedUnknown) {
      return {
        code: "PREREQUISITES_NOT_MET",
        message: `database "${unresolvedUnknown.name}" has env=unknown; resolve before advancing`,
      };
    }
  }
  if (s.current_step === "step_2_policy") {
    for (const d of s.discovered) {
      if (s.user_edits[d.name]?.remove) continue;
      if (!s.policies[d.name]) {
        return {
          code: "PREREQUISITES_NOT_MET",
          message: `no policy selected for "${d.name}"`,
        };
      }
    }
  }
  return null;
}

export function createSetupState(discovered: DiscoveredDb[]): SetupState {
  const now = new Date().toISOString();
  return {
    version: 1,
    current_step: "step_1_discovery",
    completed_steps: ["not_started"],
    discovered,
    user_edits: {},
    policies: {},
    started_at: now,
    last_updated_at: now,
  };
}
