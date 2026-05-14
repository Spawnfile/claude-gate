import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(here, "../../..", "commands");

const EXPECTED = [
  "gate.md",
  "gate-status.md",
  "gate-setup.md",
  "gate-setup-confirm.md",
  "gate-setup-finish.md",
  "gate-db-list.md",
  "gate-db-policy.md",
  "gate-allow-once.md",
  "gate-debug.md",
];

describe("v1 slash command files", () => {
  for (const name of EXPECTED) {
    test(`${name} exists and is non-empty`, () => {
      const content = readFileSync(join(commandsDir, name), "utf-8");
      expect(content.length).toBeGreaterThan(20);
    });
  }
});
