import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  backupDirectoryForDatabase,
  backupRootForDatabase,
} from "./backup-location";

describe("backup locations", () => {
  it("gives each normalized database path a deterministic isolated namespace", () => {
    const parent = path.join(path.parse(process.cwd()).root, "synthetic", "runtime");
    const first = path.join(parent, "ledger-a.sqlite3");
    const second = path.join(parent, "ledger-b.sqlite3");

    expect(backupRootForDatabase(first)).toBe(path.join(parent, "backups"));
    expect(backupDirectoryForDatabase(first)).toMatch(
      new RegExp(`^${escapeRegExp(path.join(parent, "backups", "target-"))}[0-9a-f]{24}$`),
    );
    expect(backupDirectoryForDatabase(first)).toBe(backupDirectoryForDatabase(first));
    expect(backupDirectoryForDatabase(first)).not.toBe(
      backupDirectoryForDatabase(second),
    );
  });

  it.each([
    "relative.sqlite3",
    `${path.parse(process.cwd()).root}a${path.sep}..${path.sep}b`,
  ])(
    "rejects non-normalized target %s",
    (databasePath) => {
      expect(() => backupRootForDatabase(databasePath)).toThrow(
        "absolute normalized database path",
      );
      expect(() => backupDirectoryForDatabase(databasePath)).toThrow(
        "absolute normalized database path",
      );
    },
  );
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
