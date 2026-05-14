// mcp-server/src/discovery/scanners/mcp-config-scanner.ts
//
// Scans <project>/.mcp.json and a user-claude-json path for MCP server
// entries whose names suggest a database. Pure JSON parser; no spawned
// processes, no driver imports.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  Scanner,
  RawDetection,
  DetectionType,
} from "../scanner.js";

interface McpServerEntry {
  command?: string;
  args?: unknown;
  env?: Record<string, string>;
  type?: string;
  url?: string;
}

interface CreateOpts {
  userClaudeJsonPath?: string;
}

const NAME_RE =
  /(supabase|postgresql|postgres|mysql|mongodb|mongo|redis|sqlite)/i;

export function createMcpConfigScanner(opts: CreateOpts = {}): Scanner {
  const userPath =
    opts.userClaudeJsonPath ?? join(homedir(), ".claude.json");
  return {
    name: "mcp_config_scanner",
    async scan(projectRoot: string): Promise<RawDetection[]> {
      const detections: RawDetection[] = [];
      const projectMcp = join(projectRoot, ".mcp.json");
      if (existsSync(projectMcp)) {
        detections.push(...parseFile(projectMcp, ".mcp.json"));
      }
      if (existsSync(userPath)) {
        detections.push(...parseFile(userPath, userPath));
      }
      return detections;
    },
  };
}

function parseFile(absPath: string, displayPath: string): RawDetection[] {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObject(json)) return [];

  const servers = extractServers(json);
  const out: RawDetection[] = [];
  for (const [name, entry] of servers) {
    const det = detectionFor(name, entry, displayPath);
    if (det) out.push(det);
  }
  return out;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function extractServers(
  json: Record<string, unknown>,
): Array<[string, McpServerEntry]> {
  const nested = json["mcpServers"];
  const source = isObject(nested) ? nested : json;
  const out: Array<[string, McpServerEntry]> = [];
  for (const [k, v] of Object.entries(source)) {
    if (k === "mcpServers") continue;
    if (!isObject(v)) continue;
    out.push([k, v as McpServerEntry]);
  }
  return out;
}

function detectionFor(
  name: string,
  entry: McpServerEntry,
  displayPath: string,
): RawDetection | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const type = matchTypeFromKeyword(m[1]!);

  let endpoint = endpointFromEntry(entry);
  if (!endpoint) endpoint = `mcp:${name}`;

  return {
    type,
    endpoint,
    raw_value: JSON.stringify(entry),
    source: {
      scanner: "mcp_config_scanner",
      file: displayPath,
      server: name,
    },
  };
}

function matchTypeFromKeyword(kw: string): DetectionType {
  const k = kw.toLowerCase();
  if (k === "supabase") return "supabase";
  if (k === "postgres" || k === "postgresql") return "postgres";
  if (k === "mysql") return "mysql";
  if (k === "mongo" || k === "mongodb") return "mongodb";
  if (k === "redis") return "redis";
  if (k === "sqlite") return "sqlite";
  return "generic";
}

function endpointFromEntry(entry: McpServerEntry): string | null {
  if (entry.type === "http" && typeof entry.url === "string") {
    return canonicalUrlEndpoint(entry.url);
  }
  if (Array.isArray(entry.args)) {
    for (const arg of entry.args) {
      if (typeof arg !== "string") continue;
      const ep = endpointFromArg(arg);
      if (ep) return ep;
    }
  }
  if (entry.env) {
    for (const v of Object.values(entry.env)) {
      const ep = endpointFromArg(v);
      if (ep) return ep;
    }
  }
  return null;
}

function endpointFromArg(arg: string): string | null {
  const urlMatch = /(https?|postgres|postgresql|mysql|mongodb|redis|rediss):\/\/[^\s'"]+/.exec(
    arg,
  );
  if (urlMatch) return canonicalUrlEndpoint(urlMatch[0]);

  const hp = /([a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+|localhost|\d+\.\d+\.\d+\.\d+):(\d+)/.exec(
    arg,
  );
  if (hp) return `${hp[1]!.toLowerCase()}:${hp[2]}`;
  return null;
}

function canonicalUrlEndpoint(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.port) return `${host}:${u.port}`;
    return host;
  } catch {
    return raw;
  }
}
