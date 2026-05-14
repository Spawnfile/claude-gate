// mcp-server/tests/discovery/scanners/env-scanner.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir } from "../../helpers/tmpdir";
import { envScanner } from "../../../src/discovery/scanners/env-scanner";

let cleanupTmp: (() => void) | null = null;

afterEach(() => {
  if (cleanupTmp) {
    cleanupTmp();
    cleanupTmp = null;
  }
});

function setup(files: Record<string, string>): string {
  const tmp = makeTmpDir();
  cleanupTmp = tmp.cleanup;
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(tmp.dir, name), content, "utf-8");
  }
  return tmp.dir;
}

describe("envScanner", () => {
  test("name is env_scanner", () => {
    expect(envScanner.name).toBe("env_scanner");
  });

  test("returns empty array when no env files exist", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    const out = await envScanner.scan(tmp.dir);
    expect(out).toEqual([]);
  });

  test("detects SUPABASE_URL as supabase with prod env from filename", async () => {
    const proj = setup({
      ".env.prod": "SUPABASE_URL=https://prodabc.supabase.co\n",
    });
    const out = await envScanner.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("supabase");
    expect(out[0]!.endpoint).toBe("prodabc.supabase.co");
    expect(out[0]!.inferred_env).toBe("prod");
    expect(out[0]!.inferred_env_confidence).toBeCloseTo(0.7);
    expect(out[0]!.source.field).toBe("SUPABASE_URL");
    expect(out[0]!.source.file).toBe(".env.prod");
  });

  test("detects DATABASE_URL with postgres scheme as postgres", async () => {
    const proj = setup({
      ".env": "DATABASE_URL=postgres://user:pass@db.example.com:5432/app\n",
    });
    const out = await envScanner.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("postgres");
    expect(out[0]!.endpoint).toBe("db.example.com:5432");
  });

  test("detects DATABASE_URL with postgresql:// scheme as postgres", async () => {
    const proj = setup({
      ".env.dev": "DATABASE_URL=postgresql://localhost:5432/x\n",
    });
    const out = await envScanner.scan(proj);
    expect(out[0]!.type).toBe("postgres");
    expect(out[0]!.inferred_env).toBe("dev");
  });

  test("detects DATABASE_URL with mysql scheme as mysql", async () => {
    const proj = setup({
      ".env": "DATABASE_URL=mysql://root@127.0.0.1:3306/app\n",
    });
    const out = await envScanner.scan(proj);
    expect(out[0]!.type).toBe("mysql");
  });

  test("detects REDIS_URL as redis", async () => {
    const proj = setup({
      ".env.local": "REDIS_URL=redis://localhost:6379/0\n",
    });
    const out = await envScanner.scan(proj);
    expect(out[0]!.type).toBe("redis");
    expect(out[0]!.endpoint).toBe("localhost:6379");
    expect(out[0]!.inferred_env).toBe("local");
  });

  test("detects REDIS_HOST + REDIS_PORT as redis", async () => {
    const proj = setup({
      ".env": "REDIS_HOST=redis.example.com\nREDIS_PORT=6380\n",
    });
    const out = await envScanner.scan(proj);
    expect(out[0]!.type).toBe("redis");
    expect(out[0]!.endpoint).toBe("redis.example.com:6380");
  });

  test("detects MONGO_URI as mongodb", async () => {
    const proj = setup({
      ".env.production": "MONGO_URI=mongodb://atlas.example.com:27017/app\n",
    });
    const out = await envScanner.scan(proj);
    expect(out[0]!.type).toBe("mongodb");
    expect(out[0]!.inferred_env).toBe("prod");
  });

  test("detects MONGODB_URI as mongodb (alternate name)", async () => {
    const proj = setup({
      ".env": "MONGODB_URI=mongodb://localhost:27017/x\n",
    });
    const out = await envScanner.scan(proj);
    expect(out[0]!.type).toBe("mongodb");
  });

  test("detects prefixed *_DB_HOST + *_DB_PORT as generic", async () => {
    const proj = setup({
      ".env": "ANALYTICS_DB_HOST=warehouse.example.com\nANALYTICS_DB_PORT=5439\n",
    });
    const out = await envScanner.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("generic");
    expect(out[0]!.endpoint).toBe("warehouse.example.com:5439");
    expect(out[0]!.source.field).toBe("ANALYTICS_DB_HOST");
  });

  test("ignores comment lines and blank lines", async () => {
    const proj = setup({
      ".env": "# this is a comment\n\nSUPABASE_URL=https://prodabc.supabase.co\n",
    });
    const out = await envScanner.scan(proj);
    expect(out).toHaveLength(1);
  });

  test("strips matching surrounding quotes from values", async () => {
    const proj = setup({
      ".env": `SUPABASE_URL="https://devxyz.supabase.co"\n`,
    });
    const out = await envScanner.scan(proj);
    expect(out[0]!.endpoint).toBe("devxyz.supabase.co");
  });

  test("does NOT scan .env.example", async () => {
    const proj = setup({
      ".env.example": "DATABASE_URL=postgres://nope:nope@nope:5432/nope\n",
    });
    const out = await envScanner.scan(proj);
    expect(out).toEqual([]);
  });

  test("scans multiple env files and merges detections", async () => {
    const proj = setup({
      ".env.prod": "SUPABASE_URL=https://prodabc.supabase.co\n",
      ".env.dev": "DATABASE_URL=postgres://localhost:5432/devdb\n",
    });
    const out = await envScanner.scan(proj);
    expect(out).toHaveLength(2);
    const types = out.map((d) => d.type).sort();
    expect(types).toEqual(["postgres", "supabase"]);
  });

  test("unknown DATABASE_URL scheme produces a generic detection", async () => {
    const proj = setup({
      ".env": "DATABASE_URL=ftp://nope/x\n",
    });
    const out = await envScanner.scan(proj);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("generic");
  });

  test("respects symlinked env file", async () => {
    const tmp = makeTmpDir();
    cleanupTmp = tmp.cleanup;
    mkdirSync(join(tmp.dir, "configs"), { recursive: true });
    writeFileSync(
      join(tmp.dir, "configs", "real.env"),
      "SUPABASE_URL=https://devxyz.supabase.co\n",
      "utf-8",
    );
    const { symlinkSync } = await import("node:fs");
    symlinkSync(
      join(tmp.dir, "configs", "real.env"),
      join(tmp.dir, ".env.dev"),
    );

    const out = await envScanner.scan(tmp.dir);
    expect(out).toHaveLength(1);
    expect(out[0]!.endpoint).toBe("devxyz.supabase.co");
    expect(out[0]!.inferred_env).toBe("dev");
  });
});
