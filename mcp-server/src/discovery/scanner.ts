// mcp-server/src/discovery/scanner.ts
//
// Scanner protocol for the Discovery Engine.
// Source of truth: design doc Section 6.1.

export type DetectionType =
  | "supabase"
  | "postgres"
  | "mysql"
  | "mongodb"
  | "redis"
  | "sqlite"
  | "generic";

export type InferredEnv = "prod" | "dev" | "local" | "unknown";

export interface DetectionSource {
  scanner: string;
  file?: string;
  server?: string;
  field?: string;
}

export interface RawDetection {
  type: DetectionType;
  endpoint: string;
  raw_value: string;
  source: DetectionSource;
  inferred_env?: InferredEnv;
  inferred_env_confidence?: number;
}

export interface Scanner {
  name: string;
  scan(projectRoot: string): Promise<RawDetection[]>;
}
