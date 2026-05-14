// mcp-server/tests/discovery/scanners/mcp-config-scanner.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir } from "../../helpers/tmpdir";
import { createMcpConfigScanner } from "../../../src/discovery/scanners/mcp-config-scanner";

let cleanupTmp: (() => void) | null = null;

afterEach(() => {
  if (cleanupTmp) {
    cleanupTmp();
    cleanupTmp = null;
  }
});

function setup(
  files: Record<string, string>,
): { proj: string; userClaudeJson: string } {
  const tmp = makeTmpDir();
  cleanupTmp = tmp.cleanup;
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(tmp.dir, name), content, "utf-8");
  }
  return {
    proj: tmp.dir,
    userClaudeJson: join(tmp.dir, "_synthetic_user_claude.json"),
  };
}

describe("mcp_config_scanner", () => {
  test("name is mcp_config_scanner", () => {
    const s = createMcpConfigScanner({ userClaudeJsonPath: "/dev/null" });
    expect(s.name).toBe("mcp_config_scanner");
  });

  test("returns empty when no files exist", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const s = createMcpConfigScanner({
      userClaudeJsonPath: join(tmp.dir, "no.json"),
    });
    expect(await s.scan(tmp.dir)).toEqual([]);
  });

  test("parses flat .mcp.json with a postgres server", async () => {
    const { proj, userClaudeJson } = setup({
      ".mcp.json": JSON.stringify({
        postgres: {
          command: "npx",
          args: ["@some/postgres-mcp", "postgres://localhost:5432/app"],
        },
      }),
    });
    const s = createMcpConfigScanner({ userClaudeJsonPath: userClaudeJson });
    const out = await s.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("postgres");
    expect(out[0]!.endpoint).toBe("localhost:5432");
    expect(out[0]!.source.server).toBe("postgres");
    expect(out[0]!.source.file).toContain(".mcp.json");
  });

  test("parses nested mcpServers .mcp.json with a supabase server", async () => {
    const { proj, userClaudeJson } = setup({
      ".mcp.json": JSON.stringify({
        mcpServers: {
          supabase_prod: {
            command: "node",
            args: [
              "${CLAUDE_PLUGIN_ROOT}/server.js",
              "--url=https://prodabc.supabase.co",
            ],
          },
        },
      }),
    });
    const s = createMcpConfigScanner({ userClaudeJsonPath: userClaudeJson });
    const out = await s.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("supabase");
    expect(out[0]!.endpoint).toBe("prodabc.supabase.co");
    expect(out[0]!.source.server).toBe("supabase_prod");
  });

  test("falls back to mcp:<name> endpoint when args expose no URL", async () => {
    const { proj, userClaudeJson } = setup({
      ".mcp.json": JSON.stringify({
        mongo_atlas: { command: "node", args: ["./server.js"] },
      }),
    });
    const s = createMcpConfigScanner({ userClaudeJsonPath: userClaudeJson });
    const out = await s.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("mongodb");
    expect(out[0]!.endpoint).toBe("mcp:mongo_atlas");
  });

  test("ignores non-DB MCP servers (e.g., 'context7')", async () => {
    const { proj, userClaudeJson } = setup({
      ".mcp.json": JSON.stringify({
        context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      }),
    });
    const s = createMcpConfigScanner({ userClaudeJsonPath: userClaudeJson });
    const out = await s.scan(proj);
    expect(out).toEqual([]);
  });

  test("reads mcpServers from injected user claude.json path", async () => {
    const { proj, userClaudeJson } = setup({});
    writeFileSync(
      userClaudeJson,
      JSON.stringify({
        mcpServers: {
          redis_local: {
            command: "node",
            args: ["./srv.js", "redis://localhost:6379"],
          },
        },
      }),
      "utf-8",
    );
    const s = createMcpConfigScanner({ userClaudeJsonPath: userClaudeJson });
    const out = await s.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("redis");
    expect(out[0]!.endpoint).toBe("localhost:6379");
    expect(out[0]!.source.file).toContain("_synthetic_user_claude.json");
  });

  test("does NOT crash on malformed .mcp.json -- returns empty for that file", async () => {
    const { proj, userClaudeJson } = setup({
      ".mcp.json": "{ this is not: valid",
    });
    const s = createMcpConfigScanner({ userClaudeJsonPath: userClaudeJson });
    const out = await s.scan(proj);
    expect(out).toEqual([]);
  });

  test("parses an HTTP-transport MCP server with the host as endpoint", async () => {
    const { proj, userClaudeJson } = setup({
      ".mcp.json": JSON.stringify({
        mcpServers: {
          postgres_http: {
            type: "http",
            url: "https://api.example.com/pg-mcp/",
          },
        },
      }),
    });
    const s = createMcpConfigScanner({ userClaudeJsonPath: userClaudeJson });
    const out = await s.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("postgres");
    expect(out[0]!.endpoint).toBe("api.example.com");
  });
});
