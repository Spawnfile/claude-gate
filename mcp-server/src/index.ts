// mcp-server/src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startIpcServer } from "./ipc/server.js";
import { createBootstrap } from "./policy/registry-bootstrap.js";
import { PendingActionStore } from "./setup/pending-action.js";
import { writeActiveSession, clearActiveSession } from "./active-session.js";
import { registerAllTools } from "./tools/registry.js";
import { info, err } from "./log.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const sessionId = process.env.CLAUDE_GATE_SESSION_ID ?? `pid-${process.pid}`;
  const socketDir = join(tmpdir(), "claude-gate");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(socketDir, { recursive: true });
  const socketPath = join(socketDir, `${sessionId}.sock`);

  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const pluginRoot =
    process.env.CLAUDE_PLUGIN_ROOT ??
    fileURLToPath(new URL("../../", import.meta.url)); // dev fallback
  const rulesDir = join(pluginRoot, "rules");

  const bootstrap = createBootstrap({
    projectRoot,
    sessionId,
    rulesDir,
  });

  const pendingActions = new PendingActionStore();

  const ipc = await startIpcServer({ socketPath, bootstrap, pendingActions });
  info(`IPC ready at ${socketPath}`);

  writeActiveSession({
    socket_path: socketPath,
    session_id: sessionId,
    project_root: projectRoot,
    started_at_ms: Date.now(),
  });

  const mcp = new Server(
    { name: "claude-gate", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  registerAllTools(mcp, { bootstrap, pendingActions });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  info("MCP server connected to stdio transport");

  const shutdown = async (signal: string): Promise<void> => {
    info(`received ${signal}, shutting down`);
    clearActiveSession();
    bootstrap.close();
    await ipc.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  err("fatal", e);
  process.exit(1);
});
