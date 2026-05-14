// mcp-server/src/tools/setup-tools.ts
//
// MCP tools for the 3-step setup wizard:
//   gate.setup_start       - start or resume the wizard
//   gate.setup_edit_db     - edit a discovered database entry (env, remove)
//   gate.setup_set_policy  - set a database policy
//   gate.setup_advance     - advance to the next step
//   gate.setup_finalize    - finalize (requires out-of-band confirmation)

import { join } from "node:path";
import {
  startOrResumeSetup,
  editDb,
  setPolicy,
  advance,
  finalize,
} from "../setup/setup.js";
import { loadSetupState, type SetupState } from "../setup/state.js";
import type { GateTool, ToolContext, ToolResult } from "./registry.js";

const SEP = "==================================================================";

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderStep1(state: SetupState): string {
  const dbs = state.discovered;
  const lines: string[] = [
    SEP,
    "  claude-gate setup -- Step 1: Database Discovery",
    SEP,
    "",
    `Discovered ${dbs.length} database(s):`,
    "",
  ];

  if (dbs.length === 0) {
    lines.push(
      "  (none found)",
      "",
      "No databases discovered. You can still advance to configure manually.",
      "",
    );
  } else {
    for (const db of dbs) {
      const edit = state.user_edits[db.name];
      const removed = edit?.remove === true;
      const env = edit?.env ?? db.env;
      const status = removed ? "[REMOVED]" : `env=${env}`;
      lines.push(`  ${db.name.padEnd(24)} ${status}`);
    }
    lines.push("");
    const unresolved = dbs.filter(
      (d) => d.env === "unknown" && !state.user_edits[d.name]?.env,
    );
    if (unresolved.length > 0) {
      lines.push(
        `WARNING: ${unresolved.length} database(s) have env=unknown.`,
        "Use gate.setup_edit_db to assign an environment before advancing.",
        "",
      );
    }
  }

  lines.push(
    "Commands:",
    "  gate.setup_edit_db  {name, env}  -- assign env (prod|dev|local)",
    "  gate.setup_edit_db  {name, remove: true} -- exclude database",
    "  gate.setup_advance  {}           -- advance to Step 2",
    "",
  );

  return lines.join("\n");
}

function renderStep2(state: SetupState): string {
  const dbs = state.discovered.filter(
    (d) => !state.user_edits[d.name]?.remove,
  );
  const lines: string[] = [
    SEP,
    "  claude-gate setup -- Step 2: Policy Assignment",
    SEP,
    "",
    `Assign a policy to each of the ${dbs.length} database(s):`,
    "",
    "  Policies: strict | confirm | dev | allow",
    "  strict  = DENY all mutations, ALLOW reads",
    "  confirm = ASK for every write",
    "  dev     = ALLOW all (dev environment)",
    "  allow   = ALLOW all (any environment, critical action)",
    "",
  ];

  for (const db of dbs) {
    const env = state.user_edits[db.name]?.env ?? db.env;
    const policy = state.policies[db.name] ?? "(not set)";
    lines.push(
      `  ${db.name.padEnd(24)} env=${env.padEnd(7)} policy=${policy}`,
    );
  }
  lines.push("");

  const missing = dbs.filter((d) => !state.policies[d.name]);
  if (missing.length > 0) {
    lines.push(
      `${missing.length} database(s) need a policy before advancing.`,
      "Use gate.setup_set_policy {name, policy} to set each.",
      "",
    );
  }

  lines.push(
    "Commands:",
    "  gate.setup_set_policy {name, policy} -- set policy",
    "  gate.setup_advance {}                -- advance to Step 3",
    "",
  );

  return lines.join("\n");
}

function renderStep3(state: SetupState): string {
  const dbs = state.discovered.filter(
    (d) => !state.user_edits[d.name]?.remove,
  );
  const lines: string[] = [
    SEP,
    "  claude-gate setup -- Step 3: Review & Activate",
    SEP,
    "",
    "Review the configuration before activation:",
    "",
  ];

  for (const db of dbs) {
    const env = state.user_edits[db.name]?.env ?? db.env;
    const policy = state.policies[db.name] ?? "(not set)";
    lines.push(`  ${db.name.padEnd(24)} env=${env.padEnd(7)} policy=${policy}`);
  }

  lines.push(
    "",
    "This will write .claude-gate/config.yaml and enable gating.",
    "Activation is a critical action and requires terminal confirmation.",
    "",
    "Commands:",
    "  gate.setup_finalize {}  -- generate pending-action token",
    "  Then run gate-confirm <action_id> in your terminal.",
    "",
  );

  return lines.join("\n");
}

function renderActive(projectRoot: string, configPath: string): string {
  const lines: string[] = [
    SEP,
    "  claude-gate setup -- Activated",
    SEP,
    "",
    "[claude-gate] Setup complete. Gating is now active.",
    "",
    `Project:     ${projectRoot}`,
    `Config:      ${configPath}`,
    "",
    "Use /gate status to view the active configuration.",
    "",
  ];
  return lines.join("\n");
}

function renderCurrentStep(
  state: SetupState,
  projectRoot: string,
): string {
  switch (state.current_step) {
    case "not_started":
    case "step_1_discovery":
      return renderStep1(state);
    case "step_2_policy":
      return renderStep2(state);
    case "step_3_review":
      return renderStep3(state);
    case "active":
      return renderActive(projectRoot, `${projectRoot}/.claude-gate/config.yaml`);
    default:
      return `[claude-gate] Unknown step: ${state.current_step}`;
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const setupTools: GateTool[] = [
  {
    name: "gate.setup_start",
    description:
      "Start or resume the claude-gate setup wizard. Returns the current step page.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (_args: unknown, ctx: ToolContext): Promise<ToolResult> => {
      const projectRoot = ctx.bootstrap.project_root;
      const cacheDir = join(projectRoot, ".claude-gate");
      const state = await startOrResumeSetup({ projectRoot, cacheDir });
      const text = renderCurrentStep(state, projectRoot);
      return { content: [{ type: "text", text }] };
    },
  },

  {
    name: "gate.setup_edit_db",
    description:
      "Edit a discovered database entry: assign env (prod|dev|local) or mark it for removal.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Database name to edit" },
        env: {
          type: "string",
          enum: ["prod", "dev", "local"],
          description: "Environment classification",
        },
        remove: {
          type: "boolean",
          description: "Set to true to exclude this database",
        },
      },
      required: ["name"],
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const projectRoot = ctx.bootstrap.project_root;
      const args = _args as Record<string, unknown>;
      const name = String(args["name"] ?? "");
      const edits: { env?: "prod" | "dev" | "local"; remove?: boolean } = {};
      if (args["env"] !== undefined) {
        edits.env = args["env"] as "prod" | "dev" | "local";
      }
      if (args["remove"] !== undefined) {
        edits.remove = Boolean(args["remove"]);
      }
      const state = editDb(projectRoot, name, edits);
      const text = renderStep1(state);
      return { content: [{ type: "text", text }] };
    },
  },

  {
    name: "gate.setup_set_policy",
    description:
      "Set the policy for a database in Step 2 of the wizard.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Database name" },
        policy: {
          type: "string",
          enum: ["strict", "confirm", "dev", "allow"],
          description: "Policy to assign",
        },
      },
      required: ["name", "policy"],
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const projectRoot = ctx.bootstrap.project_root;
      const args = _args as Record<string, unknown>;
      const name = String(args["name"] ?? "");
      const policy = String(args["policy"] ?? "") as
        | "strict"
        | "confirm"
        | "dev"
        | "allow";
      const state = setPolicy(projectRoot, name, policy);
      const text = renderStep2(state);
      return { content: [{ type: "text", text }] };
    },
  },

  {
    name: "gate.setup_advance",
    description:
      "Advance the setup wizard to the next step. Returns an error if prerequisites are not met.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: (_args: unknown, ctx: ToolContext): ToolResult => {
      const projectRoot = ctx.bootstrap.project_root;
      const result = advance(projectRoot);
      if ("error" in result) {
        const text = [
          "[claude-gate] Cannot advance:",
          `  code:    ${result.error.code}`,
          `  message: ${result.error.message}`,
          "",
          "Resolve the issue above, then call gate.setup_advance again.",
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }
      const text = renderCurrentStep(result.state, projectRoot);
      return { content: [{ type: "text", text }] };
    },
  },

  {
    name: "gate.setup_finalize",
    description:
      "Finalize setup. Without action_id, creates a pending-action token and " +
      "instructs the user to run gate-confirm in their terminal. " +
      "With a confirmed action_id, writes config.yaml and activates gating.",
    inputSchema: {
      type: "object",
      properties: {
        action_id: {
          type: "string",
          description:
            "Pending-action token returned by a previous gate.setup_finalize call.",
        },
      },
    },
    handler: async (_args: unknown, ctx: ToolContext): Promise<ToolResult> => {
      const projectRoot = ctx.bootstrap.project_root;
      const args = _args as Record<string, unknown>;
      const actionId =
        args["action_id"] !== undefined ? String(args["action_id"]) : undefined;

      if (!actionId) {
        // Phase 1: create a pending action and return the confirmation prompt.
        const state = loadSetupState(projectRoot);
        if (!state) {
          return {
            content: [
              {
                type: "text",
                text: "[claude-gate] No setup state found. Run gate.setup_start first.",
              },
            ],
          };
        }
        const activeDbs = state.discovered.filter(
          (d) => !state.user_edits[d.name]?.remove,
        );
        const dbSummary = activeDbs.map((d) => d.name).join(", ");
        const summary = `Activate gating for ${activeDbs.length} database(s): ${dbSummary}`;
        const action = ctx.pendingActions.create({
          project_root: projectRoot,
          session_id: ctx.bootstrap.session_id,
          cwd_at_creation: projectRoot,
          action_type: "setup_finish",
          payload_summary: summary,
          payload: state,
        });
        const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? projectRoot;
        const confirmCmd =
          `node ${pluginRoot}/mcp-server/dist/cli/gate-confirm.js ${action.action_id}`;
        const text = [
          SEP,
          "  claude-gate setup -- Confirmation Required",
          SEP,
          "",
          "[claude-gate] This action requires terminal confirmation.",
          "",
          `Action ID: ${action.action_id}`,
          "",
          "Run this command in your terminal:",
          "",
          `  ${confirmCmd}`,
          "",
          `(Or: gate-confirm ${action.action_id} if npm link is configured.)`,
          "",
          "After confirming, call gate.setup_finalize again with:",
          `  { action_id: "${action.action_id}" }`,
          "",
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }

      // Phase 2: check confirmation and finalize.
      const confirmed = ctx.pendingActions.isConfirmed(actionId, {
        session_id: ctx.bootstrap.session_id,
        project_root: projectRoot,
      });

      if ("code" in confirmed) {
        if (confirmed.code === "NOT_CONFIRMED") {
          return {
            content: [
              {
                type: "text",
                text: [
                  "[claude-gate] Action not yet confirmed.",
                  "Run gate-confirm in your terminal first, then retry.",
                ].join("\n"),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `[claude-gate] Error: ${confirmed.code}. The action may have expired or already been used.`,
            },
          ],
        };
      }

      // Confirmed -- finalize.
      try {
        const result = finalize(projectRoot);
        ctx.pendingActions.consume(actionId);
        ctx.bootstrap.reload();
        const text = renderActive(projectRoot, result.config_path);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `[claude-gate] Finalize failed: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        };
      }
    },
  },
];
