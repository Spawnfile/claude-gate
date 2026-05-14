// mcp-server/src/policy/parsers/sql.ts
//
// Stage 2 SQL parser. Wraps node-sql-parser; surfaces a fail-closed
// PARSE_FAILED on any unparseable input. Normalizes statement kinds
// to a stable enum that the risk classifier (Stage 3) consumes.

// node-sql-parser is a CJS module; Node 24 strict ESM rejects named imports
// from it, so we go through the default export and destructure. Vitest's own
// loader handles the named-import form, which is why this only surfaces in
// production `node dist/...` runs.
import sqlParserPkg from "node-sql-parser";
const { Parser } = sqlParserPkg;

export type SqlStatementKind =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "MERGE"
  | "COPY"
  | "LOAD"
  | "CREATE_TABLE"
  | "DROP"
  | "TRUNCATE"
  | "ALTER"
  | "GRANT"
  | "REVOKE"
  | "CREATE_USER"
  | "DROP_USER"
  | "CREATE_ROLE"
  | "DROP_ROLE"
  | "EXPLAIN"
  | "SHOW"
  | "DESCRIBE"
  | "BEGIN"
  | "START"
  | "COMMIT"
  | "ROLLBACK"
  | "SAVEPOINT"
  | "RELEASE"
  | "OTHER";

export interface SqlOk {
  kind: "OK";
  statement_kind: SqlStatementKind;
  has_where: boolean;
  has_as_select: boolean;
  tables: string[];
  raw_normalized: string;
}

export interface SqlParseFailure {
  kind: "PARSE_FAILED";
  error: string;
  raw_normalized: string;
}

export type SqlParseResult = SqlOk | SqlParseFailure;

const parser = new Parser();

const DDL_FAST_PATTERNS: Array<[RegExp, SqlStatementKind]> = [
  [/^\s*CREATE\s+USER\b/i, "CREATE_USER"],
  [/^\s*DROP\s+USER\b/i, "DROP_USER"],
  [/^\s*CREATE\s+ROLE\b/i, "CREATE_ROLE"],
  [/^\s*DROP\s+ROLE\b/i, "DROP_ROLE"],
  [/^\s*GRANT\b/i, "GRANT"],
  [/^\s*REVOKE\b/i, "REVOKE"],
  [/^\s*TRUNCATE\b/i, "TRUNCATE"],
];

const TX_FAST_PATTERNS: Array<[RegExp, SqlStatementKind]> = [
  [/^\s*BEGIN\b/i, "BEGIN"],
  [/^\s*START\s+TRANSACTION\b/i, "START"],
  [/^\s*COMMIT\b/i, "COMMIT"],
  [/^\s*ROLLBACK\b/i, "ROLLBACK"],
  [/^\s*SAVEPOINT\b/i, "SAVEPOINT"],
  [/^\s*RELEASE\b/i, "RELEASE"],
];

const COPY_LOAD_FAST: Array<[RegExp, SqlStatementKind]> = [
  [/^\s*COPY\b/i, "COPY"],
  [/^\s*LOAD\s+DATA\b/i, "LOAD"],
  [/^\s*MERGE\b/i, "MERGE"],
];

export function parseSql(query: string): SqlParseResult {
  const normalized = normalize(query);

  if (normalized.length === 0) {
    return { kind: "PARSE_FAILED", error: "empty query", raw_normalized: "" };
  }

  for (const [re, kind] of DDL_FAST_PATTERNS) {
    if (re.test(normalized)) {
      return {
        kind: "OK",
        statement_kind: kind,
        has_where: /\bWHERE\b/i.test(normalized),
        has_as_select: false,
        tables: [],
        raw_normalized: normalized,
      };
    }
  }

  for (const [re, kind] of TX_FAST_PATTERNS) {
    if (re.test(normalized)) {
      return {
        kind: "OK",
        statement_kind: kind,
        has_where: false,
        has_as_select: false,
        tables: [],
        raw_normalized: normalized,
      };
    }
  }

  for (const [re, kind] of COPY_LOAD_FAST) {
    if (re.test(normalized)) {
      return {
        kind: "OK",
        statement_kind: kind,
        has_where: false,
        has_as_select: false,
        tables: [],
        raw_normalized: normalized,
      };
    }
  }

  let ast: unknown;
  try {
    ast = parser.astify(normalized);
  } catch (e) {
    return {
      kind: "PARSE_FAILED",
      error: e instanceof Error ? e.message : String(e),
      raw_normalized: normalized,
    };
  }

  const node = Array.isArray(ast) ? ast[0] : ast;
  if (!node || typeof node !== "object" || !("type" in node)) {
    return {
      kind: "PARSE_FAILED",
      error: "parser returned no statement node",
      raw_normalized: normalized,
    };
  }

  const ty = String((node as { type: unknown }).type).toLowerCase();

  const statement_kind = mapKind(ty);
  if (statement_kind === "OTHER") {
    return {
      kind: "PARSE_FAILED",
      error: `unknown statement type: ${ty}`,
      raw_normalized: normalized,
    };
  }

  const tables = extractTables(node);
  const has_where = /\bWHERE\b/i.test(normalized);
  const has_as_select =
    statement_kind === "CREATE_TABLE" && /\bAS\s+SELECT\b/i.test(normalized);

  return {
    kind: "OK",
    statement_kind,
    has_where,
    has_as_select,
    tables,
    raw_normalized: normalized,
  };
}

function normalize(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function mapKind(ty: string): SqlStatementKind {
  switch (ty) {
    case "select":
      return "SELECT";
    case "insert":
      return "INSERT";
    case "update":
      return "UPDATE";
    case "delete":
      return "DELETE";
    case "merge":
      return "MERGE";
    case "create":
      return "CREATE_TABLE";
    case "drop":
      return "DROP";
    case "alter":
      return "ALTER";
    case "explain":
      return "EXPLAIN";
    case "show":
      return "SHOW";
    case "describe":
      return "DESCRIBE";
    case "use":
    case "set":
      return "OTHER";
    default:
      return "OTHER";
  }
}

function extractTables(node: unknown): string[] {
  const out: string[] = [];
  if (!node || typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;

  if (Array.isArray(obj["from"])) {
    for (const f of obj["from"]) {
      if (f && typeof f === "object" && "table" in f && typeof (f as { table: unknown }).table === "string") {
        out.push((f as { table: string }).table);
      }
    }
  }
  if (Array.isArray(obj["table"])) {
    for (const t of obj["table"]) {
      if (t && typeof t === "object" && "table" in t && typeof (t as { table: unknown }).table === "string") {
        out.push((t as { table: string }).table);
      }
    }
  } else if (typeof obj["table"] === "string") {
    out.push(obj["table"] as string);
  }

  return [...new Set(out)];
}
