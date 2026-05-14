// mcp-server/tests/policy/parsers/sql.test.ts
import { describe, expect, test } from "vitest";
import { parseSql, type SqlParseResult } from "../../../src/policy/parsers/sql";

function ok(r: SqlParseResult): Extract<SqlParseResult, { kind: "OK" }> {
  if (r.kind === "PARSE_FAILED") throw new Error(`expected OK, got ${r.error}`);
  return r;
}

describe("parseSql", () => {
  test("classifies SELECT as SELECT with no WHERE", () => {
    const r = ok(parseSql("SELECT * FROM customers"));
    expect(r.statement_kind).toBe("SELECT");
    expect(r.has_where).toBe(false);
    expect(r.tables).toEqual(["customers"]);
  });

  test("classifies SELECT with WHERE", () => {
    const r = ok(parseSql("SELECT id FROM customers WHERE id = 1"));
    expect(r.statement_kind).toBe("SELECT");
    expect(r.has_where).toBe(true);
  });

  test("classifies INSERT", () => {
    const r = ok(parseSql("INSERT INTO customers (id, email) VALUES (1, 'a@b')"));
    expect(r.statement_kind).toBe("INSERT");
    expect(r.tables).toContain("customers");
  });

  test("classifies UPDATE with WHERE", () => {
    const r = ok(parseSql("UPDATE customers SET email = 'x' WHERE id = 7"));
    expect(r.statement_kind).toBe("UPDATE");
    expect(r.has_where).toBe(true);
  });

  test("classifies UPDATE without WHERE", () => {
    const r = ok(parseSql("UPDATE customers SET email = 'x'"));
    expect(r.statement_kind).toBe("UPDATE");
    expect(r.has_where).toBe(false);
  });

  test("classifies DELETE without WHERE", () => {
    const r = ok(parseSql("DELETE FROM customers"));
    expect(r.statement_kind).toBe("DELETE");
    expect(r.has_where).toBe(false);
  });

  test("classifies DELETE with WHERE", () => {
    const r = ok(parseSql("DELETE FROM customers WHERE id = 1"));
    expect(r.statement_kind).toBe("DELETE");
    expect(r.has_where).toBe(true);
  });

  test("classifies DROP TABLE as DDL", () => {
    const r = ok(parseSql("DROP TABLE customers"));
    expect(r.statement_kind).toBe("DROP");
  });

  test("classifies TRUNCATE as DDL", () => {
    const r = ok(parseSql("TRUNCATE TABLE customers"));
    expect(r.statement_kind).toBe("TRUNCATE");
  });

  test("classifies ALTER TABLE as DDL", () => {
    const r = ok(parseSql("ALTER TABLE customers ADD COLUMN x INT"));
    expect(r.statement_kind).toBe("ALTER");
  });

  test("classifies GRANT as DDL", () => {
    const r = ok(parseSql("GRANT SELECT ON customers TO bob"));
    expect(r.statement_kind).toBe("GRANT");
  });

  test("classifies REVOKE as DDL", () => {
    const r = ok(parseSql("REVOKE SELECT ON customers FROM bob"));
    expect(r.statement_kind).toBe("REVOKE");
  });

  test("classifies BEGIN as TX", () => {
    const r = ok(parseSql("BEGIN"));
    expect(r.statement_kind).toBe("BEGIN");
  });

  test("classifies COMMIT as TX", () => {
    const r = ok(parseSql("COMMIT"));
    expect(r.statement_kind).toBe("COMMIT");
  });

  test("classifies ROLLBACK as TX", () => {
    const r = ok(parseSql("ROLLBACK"));
    expect(r.statement_kind).toBe("ROLLBACK");
  });

  test("classifies EXPLAIN", () => {
    const r = ok(parseSql("EXPLAIN SELECT * FROM customers"));
    expect(r.statement_kind).toBe("EXPLAIN");
  });

  test("classifies SHOW", () => {
    const r = ok(parseSql("SHOW TABLES"));
    expect(r.statement_kind).toBe("SHOW");
  });

  test("classifies CREATE TABLE AS SELECT", () => {
    const r = ok(
      parseSql("CREATE TABLE c2 AS SELECT * FROM customers"),
    );
    expect(r.statement_kind).toBe("CREATE_TABLE");
    expect(r.has_as_select).toBe(true);
  });

  test("classifies plain CREATE TABLE without AS SELECT", () => {
    const r = ok(parseSql("CREATE TABLE t (id INT)"));
    expect(r.statement_kind).toBe("CREATE_TABLE");
    expect(r.has_as_select).toBe(false);
  });

  test("fails closed on unparseable input", () => {
    const r = parseSql("this is not sql at all !!!");
    expect(r.kind).toBe("PARSE_FAILED");
  });

  test("fails closed on empty string", () => {
    const r = parseSql("");
    expect(r.kind).toBe("PARSE_FAILED");
  });

  test("preserves raw_normalized whitespace-collapsed text", () => {
    const r = ok(parseSql("SELECT   *\n  FROM  customers\n"));
    expect(r.raw_normalized).toBe("SELECT * FROM customers");
  });
});
