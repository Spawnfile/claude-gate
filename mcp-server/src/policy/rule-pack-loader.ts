// mcp-server/src/policy/rule-pack-loader.ts
//
// Loads YAML rule packs from a directory and validates each via the
// Zod schemas. Honors pinned-version selection from config.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import {
  RulePackSchema,
  PoliciesFileSchema,
  type RulePack,
  type PolicyMatrix,
} from "./rule-pack-schema.js";

export interface LoadOpts {
  rulesDir: string;
  userRulesDir?: string;
  pinned: Record<string, string | undefined>;
}

// Private annotation type — not exported.
type AnnotatedPack = RulePack & { __source: "user" | "shipped" };

export interface RulePackRegistry {
  packs: Map<string, RulePack>;
  policies: Record<string, PolicyMatrix>;
}

export class RulePackLoadError extends Error {
  public override readonly name = "RulePackLoadError";
  public override readonly cause: unknown;
  public readonly path: string;

  constructor(message: string, path: string, cause?: unknown) {
    super(`[claude-gate] rule-pack load failed at ${path}: ${message}`);
    Object.setPrototypeOf(this, RulePackLoadError.prototype);
    this.path = path;
    this.cause = cause;
  }
}

export function loadRulePackRegistry(opts: LoadOpts): RulePackRegistry {
  if (!existsSync(opts.rulesDir) || !statSync(opts.rulesDir).isDirectory()) {
    throw new RulePackLoadError(
      "rules directory not found",
      opts.rulesDir,
    );
  }

  const entries = readdirSync(opts.rulesDir).filter((f) => f.endsWith(".yaml"));
  const packCandidates = new Map<string, AnnotatedPack[]>();
  let policies: Record<string, PolicyMatrix> | null = null;

  for (const file of entries) {
    const fullPath = join(opts.rulesDir, file);
    const raw = readFile(fullPath);
    const obj = parseYamlOrThrow(raw, fullPath);

    if (file === "policies.yaml") {
      const parsed = PoliciesFileSchema.safeParse(obj);
      if (!parsed.success) {
        throw new RulePackLoadError(
          parsed.error.message,
          fullPath,
          parsed.error,
        );
      }
      policies = parsed.data.policies;
      continue;
    }

    const parsed = RulePackSchema.safeParse(obj);
    if (!parsed.success) {
      throw new RulePackLoadError(
        parsed.error.message,
        fullPath,
        parsed.error,
      );
    }
    const list = packCandidates.get(parsed.data.name) ?? [];
    list.push({ ...parsed.data, __source: "shipped" });
    packCandidates.set(parsed.data.name, list);
  }

  if (opts.userRulesDir && existsSync(opts.userRulesDir) && statSync(opts.userRulesDir).isDirectory()) {
    const userEntries = readdirSync(opts.userRulesDir).filter((f) => f.endsWith(".yaml"));
    for (const file of userEntries) {
      if (file === "policies.yaml") continue; // user cannot override the policy matrix
      const fullPath = join(opts.userRulesDir, file);
      const raw = readFile(fullPath);
      const obj = parseYamlOrThrow(raw, fullPath);
      const parsed = RulePackSchema.safeParse(obj);
      if (!parsed.success) {
        throw new RulePackLoadError(parsed.error.message, fullPath, parsed.error);
      }
      const list = packCandidates.get(parsed.data.name) ?? [];
      list.push({ ...parsed.data, __source: "user" });
      packCandidates.set(parsed.data.name, list);
    }
  }

  if (policies === null) {
    throw new RulePackLoadError(
      "policies.yaml missing from rules directory",
      opts.rulesDir,
    );
  }

  const packs = new Map<string, RulePack>();
  for (const [name, candidates] of packCandidates) {
    packs.set(name, pickPack(name, candidates, opts.pinned[name], opts.rulesDir));
  }

  return { packs, policies };
}

function pickPack(
  name: string,
  candidates: AnnotatedPack[],
  pinned: string | undefined,
  rulesDir: string,
): RulePack {
  let chosen: AnnotatedPack | undefined;
  if (pinned !== undefined) {
    const matching = candidates.filter((p) => p.version === pinned);
    if (matching.length === 0) {
      throw new RulePackLoadError(
        `pack "${name}" pinned to "${pinned}" but no matching version found (have: ${candidates
          .map((c) => c.version)
          .join(", ")})`,
        rulesDir,
      );
    }
    chosen = matching.find((p) => p.__source === "user") ?? matching[0];
  } else {
    candidates.sort((a, b) => compareSemver(b.version, a.version));
    chosen = candidates[0];
  }
  // Strip annotation before returning to consumers.
  const { __source: _unused, ...rest } = chosen!;
  return rest as RulePack;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n));
  const pb = b.split(".").map((n) => Number(n));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function readFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (e) {
    throw new RulePackLoadError(
      e instanceof Error ? e.message : String(e),
      path,
      e,
    );
  }
}

function parseYamlOrThrow(raw: string, path: string): unknown {
  try {
    return parseYaml(raw);
  } catch (e) {
    const msg =
      e instanceof YAMLParseError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    throw new RulePackLoadError(msg, path, e);
  }
}
