import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupWorkerDatabaseTarget,
  createWorkerDatabaseTarget,
  type WorkerDatabaseTarget,
} from "./worker-database";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "moneybags-worker-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Vitest worker database targets", () => {
  it("creates a fresh direct child even when Vitest identifiers are reused", () => {
    const root = makeRoot();
    const first = createWorkerDatabaseTarget(root, "1", "0");
    const second = createWorkerDatabaseTarget(root, "1", "0");

    expect(first.directory).not.toBe(second.directory);
    expect(first.databasePath).not.toBe(second.databasePath);
    expect(path.dirname(first.directory)).toBe(root);
    expect(path.basename(first.directory)).toMatch(/^worker-1-0-/);
  });

  it("rejects non-canonical roots and invalid worker identifiers", () => {
    const root = makeRoot();
    expect(() => createWorkerDatabaseTarget("relative", "1", "0")).toThrow(
      /must be absolute/,
    );
    expect(() => createWorkerDatabaseTarget(root, "pool", "0")).toThrow(
      /VITEST_POOL_ID/,
    );
    expect(() => createWorkerDatabaseTarget(root, "1", undefined)).toThrow(
      /VITEST_WORKER_ID/,
    );
  });

  it("removes the database, SQLite sidecars, and only the owned child directory", () => {
    const root = makeRoot();
    const target = createWorkerDatabaseTarget(root, "2", "7");
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      writeFileSync(`${target.databasePath}${suffix}`, "fake");
    }

    cleanupWorkerDatabaseTarget(target);

    expect(existsSync(target.directory)).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it("refuses a cleanup handle that is not a validated direct child", () => {
    const root = makeRoot();
    const unrelated = path.join(root, "unrelated");
    mkdirSync(unrelated);
    const forged: WorkerDatabaseTarget = {
      root,
      directory: unrelated,
      databasePath: path.join(unrelated, "default.db"),
      markerPath: path.join(unrelated, ".moneybags-vitest-worker"),
    };

    expect(() => cleanupWorkerDatabaseTarget(forged)).toThrow(/Refusing to clean/);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("refuses a forged handle even when its path matches the worker pattern", () => {
    const root = makeRoot();
    const directory = path.join(root, "worker-1-2-forged");
    mkdirSync(directory);
    const forged: WorkerDatabaseTarget = {
      root,
      directory,
      databasePath: path.join(directory, "default.db"),
      markerPath: path.join(directory, ".moneybags-vitest-worker"),
    };

    expect(() => cleanupWorkerDatabaseTarget(forged)).toThrow(/unknown/);
    expect(existsSync(directory)).toBe(true);
  });

  it("refuses a worker directory replaced by an external symlink", () => {
    const root = makeRoot();
    const external = makeRoot();
    const externalDatabase = path.join(external, "default.db");
    writeFileSync(externalDatabase, "outside");
    const target = createWorkerDatabaseTarget(root, "3", "9");
    rmSync(target.directory, { recursive: true });
    symlinkSync(external, target.directory, "dir");

    expect(() => cleanupWorkerDatabaseTarget(target)).toThrow(/non-canonical/);
    expect(existsSync(externalDatabase)).toBe(true);
  });

  it("refuses an owned root replaced by an external symlink", () => {
    const root = makeRoot();
    const external = makeRoot();
    const externalDatabase = path.join(external, "default.db");
    writeFileSync(externalDatabase, "outside");
    const target = createWorkerDatabaseTarget(root, "4", "2");
    rmSync(root, { recursive: true });
    symlinkSync(external, root, "dir");

    expect(() => cleanupWorkerDatabaseTarget(target)).toThrow(
      /canonical directory/,
    );
    expect(existsSync(externalDatabase)).toBe(true);
  });
});
