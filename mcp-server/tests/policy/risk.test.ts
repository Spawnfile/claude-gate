// mcp-server/tests/policy/risk.test.ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { RulePackSchema, type RulePack } from "../../src/policy/rule-pack-schema";
import { classifyRisk } from "../../src/policy/risk";
import type { SqlOk } from "../../src/policy/parsers/sql";

const sqlPack: RulePack = RulePackSchema.parse(
  parseYaml(readFileSync(resolve(__dirname, "../../../rules/sql.yaml"), "utf-8")),
);

function ok(partial: Partial<SqlOk> & { statement_kind: SqlOk["statement_kind"] }): SqlOk {
  return {
    kind: "OK",
    has_where: false,
    has_as_select: false,
    tables: [],
    raw_normalized: "",
    ...partial,
  };
}

describe("classifyRisk(sql)", () => {
  test("SELECT is LOW", () => {
    expect(classifyRisk(ok({ statement_kind: "SELECT" }), sqlPack)).toBe("LOW");
  });

  test("EXPLAIN is LOW", () => {
    expect(classifyRisk(ok({ statement_kind: "EXPLAIN" }), sqlPack)).toBe("LOW");
  });

  test("SHOW is LOW", () => {
    expect(classifyRisk(ok({ statement_kind: "SHOW" }), sqlPack)).toBe("LOW");
  });

  test("DESCRIBE is LOW", () => {
    expect(classifyRisk(ok({ statement_kind: "DESCRIBE" }), sqlPack)).toBe("LOW");
  });

  test("BEGIN is LOW (transactional)", () => {
    expect(classifyRisk(ok({ statement_kind: "BEGIN" }), sqlPack)).toBe("LOW");
  });

  test("COMMIT is LOW (transactional)", () => {
    expect(classifyRisk(ok({ statement_kind: "COMMIT" }), sqlPack)).toBe("LOW");
  });

  test("ROLLBACK is LOW (transactional)", () => {
    expect(classifyRisk(ok({ statement_kind: "ROLLBACK" }), sqlPack)).toBe("LOW");
  });

  test("INSERT is MED", () => {
    expect(classifyRisk(ok({ statement_kind: "INSERT" }), sqlPack)).toBe("MED");
  });

  test("UPDATE with WHERE is MED", () => {
    expect(
      classifyRisk(ok({ statement_kind: "UPDATE", has_where: true }), sqlPack),
    ).toBe("MED");
  });

  test("DELETE with WHERE is MED", () => {
    expect(
      classifyRisk(ok({ statement_kind: "DELETE", has_where: true }), sqlPack),
    ).toBe("MED");
  });

  test("CREATE TABLE AS SELECT is MED", () => {
    expect(
      classifyRisk(
        ok({ statement_kind: "CREATE_TABLE", has_as_select: true }),
        sqlPack,
      ),
    ).toBe("MED");
  });

  test("UPDATE without WHERE is HIGH", () => {
    expect(
      classifyRisk(ok({ statement_kind: "UPDATE", has_where: false }), sqlPack),
    ).toBe("HIGH");
  });

  test("DELETE without WHERE is HIGH", () => {
    expect(
      classifyRisk(ok({ statement_kind: "DELETE", has_where: false }), sqlPack),
    ).toBe("HIGH");
  });

  test("MERGE is HIGH", () => {
    expect(classifyRisk(ok({ statement_kind: "MERGE" }), sqlPack)).toBe("HIGH");
  });

  test("COPY is HIGH", () => {
    expect(classifyRisk(ok({ statement_kind: "COPY" }), sqlPack)).toBe("HIGH");
  });

  test("LOAD is HIGH", () => {
    expect(classifyRisk(ok({ statement_kind: "LOAD" }), sqlPack)).toBe("HIGH");
  });

  test("DROP is CRIT", () => {
    expect(classifyRisk(ok({ statement_kind: "DROP" }), sqlPack)).toBe("CRIT");
  });

  test("TRUNCATE is CRIT", () => {
    expect(classifyRisk(ok({ statement_kind: "TRUNCATE" }), sqlPack)).toBe(
      "CRIT",
    );
  });

  test("ALTER is CRIT", () => {
    expect(classifyRisk(ok({ statement_kind: "ALTER" }), sqlPack)).toBe("CRIT");
  });

  test("GRANT is CRIT", () => {
    expect(classifyRisk(ok({ statement_kind: "GRANT" }), sqlPack)).toBe("CRIT");
  });

  test("REVOKE is CRIT", () => {
    expect(classifyRisk(ok({ statement_kind: "REVOKE" }), sqlPack)).toBe("CRIT");
  });

  test("CREATE_USER is CRIT", () => {
    expect(classifyRisk(ok({ statement_kind: "CREATE_USER" }), sqlPack)).toBe(
      "CRIT",
    );
  });

  test("DROP_USER is CRIT", () => {
    expect(classifyRisk(ok({ statement_kind: "DROP_USER" }), sqlPack)).toBe(
      "CRIT",
    );
  });

  test("plain CREATE TABLE (no AS SELECT) is unclassified -> defaults to HIGH (fail-safe)", () => {
    // Plain CREATE TABLE is not explicitly tiered in sql.yaml. The
    // classifier returns HIGH as the conservative default for unknown
    // mutations, NOT LOW. Tests pin this fail-safe behavior.
    expect(
      classifyRisk(
        ok({ statement_kind: "CREATE_TABLE", has_as_select: false }),
        sqlPack,
      ),
    ).toBe("HIGH");
  });
});
