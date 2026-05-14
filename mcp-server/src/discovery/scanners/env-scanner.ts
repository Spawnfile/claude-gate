// mcp-server/src/discovery/scanners/env-scanner.ts
//
// Scans <project>/.env and <project>/.env.* for connection-string env vars.
// Pure parser: no DB drivers imported. Symlinks resolved by readFileSync.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Scanner,
  RawDetection,
  DetectionType,
  InferredEnv,
} from "../scanner.js";

const FILENAME_ENV_MAP: Record<string, { env: InferredEnv; conf: number }> = {
  ".env.prod": { env: "prod", conf: 0.7 },
  ".env.production": { env: "prod", conf: 0.7 },
  ".env.dev": { env: "dev", conf: 0.7 },
  ".env.development": { env: "dev", conf: 0.7 },
  ".env.staging": { env: "dev", conf: 0.6 },
  ".env.local": { env: "local", conf: 0.7 },
  ".env.test": { env: "local", conf: 0.7 },
};

const SKIP_FILES = new Set([".env.example", ".env.sample", ".env.template"]);

interface EnvFile {
  filename: string;
  vars: Map<string, string>;
}

export const envScanner: Scanner = {
  name: "env_scanner",
  async scan(projectRoot: string): Promise<RawDetection[]> {
    if (!existsSync(projectRoot)) return [];
    const files = listEnvFiles(projectRoot);
    const detections: RawDetection[] = [];
    for (const file of files) {
      const parsed = parseEnvFile(projectRoot, file);
      detections.push(...detectFromEnv(parsed));
    }
    return detections;
  },
};

function listEnvFiles(projectRoot: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(projectRoot);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries) {
    if (!name.startsWith(".env")) continue;
    if (SKIP_FILES.has(name)) continue;
    const full = join(projectRoot, name);
    let st;
    try {
      st = statSync(full); // follows symlinks
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    files.push(name);
  }
  return files.sort();
}

function parseEnvFile(projectRoot: string, filename: string): EnvFile {
  const raw = readFileSync(join(projectRoot, filename), "utf-8");
  const vars = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    val = stripQuotes(val);
    vars.set(key, val);
  }
  return { filename, vars };
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function envInfoFor(
  filename: string,
): { env: InferredEnv; conf: number } | undefined {
  return FILENAME_ENV_MAP[filename];
}

function makeDetection(
  type: DetectionType,
  endpoint: string,
  rawValue: string,
  filename: string,
  field: string,
): RawDetection {
  const info = envInfoFor(filename);
  const det: RawDetection = {
    type,
    endpoint,
    raw_value: rawValue,
    source: { scanner: "env_scanner", file: filename, field },
  };
  if (info) {
    det.inferred_env = info.env;
    det.inferred_env_confidence = info.conf;
  }
  return det;
}

function detectFromEnv(file: EnvFile): RawDetection[] {
  const out: RawDetection[] = [];
  const v = file.vars;

  const supabase = v.get("SUPABASE_URL");
  if (supabase) {
    out.push(
      makeDetection(
        "supabase",
        canonicalUrlEndpoint(supabase),
        supabase,
        file.filename,
        "SUPABASE_URL",
      ),
    );
  }

  const dbUrl = v.get("DATABASE_URL");
  if (dbUrl) {
    const t = typeFromUrlScheme(dbUrl);
    out.push(
      makeDetection(
        t,
        canonicalUrlEndpoint(dbUrl),
        dbUrl,
        file.filename,
        "DATABASE_URL",
      ),
    );
  }

  const redisUrl = v.get("REDIS_URL");
  if (redisUrl) {
    out.push(
      makeDetection(
        "redis",
        canonicalUrlEndpoint(redisUrl),
        redisUrl,
        file.filename,
        "REDIS_URL",
      ),
    );
  } else {
    const rh = v.get("REDIS_HOST");
    if (rh) {
      const rp = v.get("REDIS_PORT") ?? "6379";
      const ep = `${rh}:${rp}`;
      out.push(makeDetection("redis", ep, ep, file.filename, "REDIS_HOST"));
    }
  }

  const mongo = v.get("MONGO_URI") ?? v.get("MONGODB_URI");
  if (mongo) {
    const field = v.has("MONGO_URI") ? "MONGO_URI" : "MONGODB_URI";
    out.push(
      makeDetection(
        "mongodb",
        canonicalUrlEndpoint(mongo),
        mongo,
        file.filename,
        field,
      ),
    );
  }

  // Generic *_DB_HOST + *_DB_PORT pairs.
  for (const [k, host] of v) {
    if (!k.endsWith("_DB_HOST")) continue;
    if (k === "REDIS_HOST") continue;
    const prefix = k.slice(0, -"_DB_HOST".length);
    const portKey = `${prefix}_DB_PORT`;
    const port = v.get(portKey);
    if (!port) continue;
    const ep = `${host}:${port}`;
    out.push(makeDetection("generic", ep, ep, file.filename, k));
  }

  return out;
}

function typeFromUrlScheme(url: string): DetectionType {
  const lower = url.toLowerCase();
  if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) {
    return "postgres";
  }
  if (lower.startsWith("mysql://") || lower.startsWith("mysql2://")) {
    return "mysql";
  }
  if (lower.startsWith("mongodb://") || lower.startsWith("mongodb+srv://")) {
    return "mongodb";
  }
  if (lower.startsWith("redis://") || lower.startsWith("rediss://")) {
    return "redis";
  }
  if (lower.startsWith("sqlite:") || lower.startsWith("file:")) {
    return "sqlite";
  }
  return "generic";
}

function canonicalUrlEndpoint(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.port) return `${host}:${u.port}`;
    return host;
  } catch {
    const idx = raw.indexOf("://");
    return idx >= 0 ? raw.slice(idx + 3) : raw;
  }
}
