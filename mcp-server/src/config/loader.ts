//
// Reads <project>/.claude-gate/config.yaml, parses YAML, and validates
// against ConfigSchema. Throws a typed ConfigLoadError on every failure
// path so callers can switch on `.code`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ConfigSchema, type Config } from "./schema.js";

export enum ConfigErrorCode {
  NOT_FOUND = "CONFIG_NOT_FOUND",
  YAML_PARSE_ERROR = "YAML_PARSE_ERROR",
  SCHEMA_VALIDATION = "SCHEMA_VALIDATION",
  IO_ERROR = "IO_ERROR",
}

export class ConfigLoadError extends Error {
  public override readonly name = "ConfigLoadError";
  public override readonly cause: unknown;
  public readonly code: ConfigErrorCode;
  public readonly path: string;

  constructor(
    code: ConfigErrorCode,
    message: string,
    path: string,
    cause?: unknown,
  ) {
    super(`[claude-gate] config ${code} at ${path}: ${message}`);
    Object.setPrototypeOf(this, ConfigLoadError.prototype);
    this.code = code;
    this.path = path;
    this.cause = cause;
  }
}

export function configPath(projectRoot: string): string {
  return join(projectRoot, ".claude-gate", "config.yaml");
}

export function loadConfig(projectRoot: string): Config {
  const path = configPath(projectRoot);

  if (!existsSync(path)) {
    throw new ConfigLoadError(
      ConfigErrorCode.NOT_FOUND,
      "config file does not exist",
      path,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    throw new ConfigLoadError(
      ConfigErrorCode.IO_ERROR,
      e instanceof Error ? e.message : String(e),
      path,
      e,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    const msg =
      e instanceof YAMLParseError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    throw new ConfigLoadError(
      ConfigErrorCode.YAML_PARSE_ERROR,
      msg,
      path,
      e,
    );
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(
      ConfigErrorCode.SCHEMA_VALIDATION,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      path,
      result.error,
    );
  }
  return result.data;
}
