// mcp-server/src/setup/pending-action.ts
// Per-session pending-action store with TTL, single-use, and scope binding.
// Used by gate-confirm CLI (via IPC) and MCP tools to coordinate out-of-band
// confirmation for critical actions.
import { randomBytes } from "node:crypto";

export interface PendingActionScope {
  project_root: string;
  session_id: string;
  cwd_at_creation: string;
}

export interface PendingAction {
  action_id: string;
  scope: PendingActionScope;
  action_type: string;
  payload_summary: string;
  payload: unknown;
  created_at_ms: number;
  ttl_ms: number;
  confirmed: boolean;
  consumed: boolean;
}

export type StoreError =
  | { code: "NOT_FOUND" }
  | { code: "EXPIRED" }
  | { code: "CONSUMED" }
  | { code: "NOT_CONFIRMED" }
  | { code: "WRONG_SCOPE" };

export class PendingActionStore {
  private store = new Map<string, PendingAction>();
  private readonly defaultTtlMs = 120_000;

  constructor(private now: () => number = () => Date.now()) {}

  create(opts: {
    project_root: string;
    session_id: string;
    cwd_at_creation: string;
    action_type: string;
    payload_summary: string;
    payload: unknown;
    ttl_ms?: number;
  }): PendingAction {
    const action_id = "act_" + randomBytes(8).toString("hex");
    const entry: PendingAction = {
      action_id,
      scope: {
        project_root: opts.project_root,
        session_id: opts.session_id,
        cwd_at_creation: opts.cwd_at_creation,
      },
      action_type: opts.action_type,
      payload_summary: opts.payload_summary,
      payload: opts.payload,
      created_at_ms: this.now(),
      ttl_ms: opts.ttl_ms ?? this.defaultTtlMs,
      confirmed: false,
      consumed: false,
    };
    this.store.set(action_id, entry);
    return entry;
  }

  describe(action_id: string): PendingAction | StoreError {
    const e = this.store.get(action_id);
    if (!e) return { code: "NOT_FOUND" };
    if (this.now() - e.created_at_ms > e.ttl_ms) {
      this.store.delete(action_id);
      return { code: "EXPIRED" };
    }
    if (e.consumed) return { code: "CONSUMED" };
    return e;
  }

  // Called by gate-confirm CLI via the IPC server. Flips `confirmed: true`
  // after validating the action is in scope for the current session.
  markConfirmed(
    action_id: string,
    scope: { session_id: string; project_root: string },
  ): PendingAction | StoreError {
    const d = this.describe(action_id);
    if ("code" in d) return d;
    if (
      d.scope.session_id !== scope.session_id ||
      d.scope.project_root !== scope.project_root
    ) {
      return { code: "WRONG_SCOPE" };
    }
    d.confirmed = true;
    return d;
  }

  // Called by MCP tools (e.g., gate.setup_finalize) to check whether the
  // out-of-band confirmation has been received before proceeding.
  isConfirmed(
    action_id: string,
    scope: { session_id: string; project_root: string },
  ): PendingAction | StoreError {
    const d = this.describe(action_id);
    if ("code" in d) return d;
    if (
      d.scope.session_id !== scope.session_id ||
      d.scope.project_root !== scope.project_root
    ) {
      return { code: "WRONG_SCOPE" };
    }
    if (!d.confirmed) return { code: "NOT_CONFIRMED" };
    return d;
  }

  // Called by MCP tools after the underlying action successfully completes.
  // Prevents replay.
  consume(action_id: string): void {
    const e = this.store.get(action_id);
    if (e) e.consumed = true;
  }
}
