import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupDirectoryForDatabase,
  backupRootForDatabase,
} from "../src/db/backup-location";
import { main, servicePreflight } from "./service-preflight";

const roots: string[] = [];
type Dependencies = NonNullable<Parameters<typeof servicePreflight>[1]>;

function fixture(options: { build?: boolean; database?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "moneybags-service-preflight-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ moneybagsRepositoryRoot: true, engines: { node: ">=20.12" } }),
  );
  if (options.build ?? true) {
    mkdirSync(path.join(root, ".next"), { mode: 0o700 });
    mkdirSync(path.join(root, ".next", "cache"), { mode: 0o700 });
    writeFileSync(path.join(root, ".next", "BUILD_ID"), "synthetic-build");
    writeFileSync(
      path.join(root, ".next", "required-server-files.json"),
      JSON.stringify({
        version: 1,
        config: { distDir: ".next" },
        appDir: root,
        relativeAppDir: "",
        files: [".next/BUILD_ID", ".next/required-server-files.json"],
      }),
    );
  }
  const parent = path.join(root, "runtime");
  mkdirSync(parent, { mode: 0o700 });
  const databasePath = path.join(parent, "ledger.sqlite3");
  if (options.database) writeFileSync(databasePath, "synthetic-placeholder", { mode: 0o600 });
  const preflight = () =>
    Object.freeze({
      repositoryRoot: root,
      databasePath,
      migrationsFolder: path.join(root, "drizzle"),
    });
  const dependencies = (overrides: Dependencies = {}): Dependencies => ({
    preflight,
    workingDirectory: root,
    repositoryRootEnvironment: root,
    processEffectiveUserId: () => 1_000,
    processUmask: () => 0o077,
    processStatus: "Name:\tsynthetic\nNoNewPrivs:\t1\n",
    ...overrides,
  });
  return { root, parent, databasePath, preflight, dependencies };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("systemd service preflight", () => {
  it("accepts an app build with a private writable parent before DB creation", () => {
    const current = fixture();

    expect(servicePreflight("app", current.dependencies())).toEqual(
      current.preflight(),
    );
  });

  it("accepts a private readable backup source without requiring an app build", () => {
    const current = fixture({ build: false, database: true });

    expect(servicePreflight("backup", current.dependencies())).toEqual(
      current.preflight(),
    );
  });

  it("fails an obsolete runtime and a missing production build before startup", () => {
    const current = fixture({ build: false });

    expect(() =>
      servicePreflight("app", current.dependencies({
        runtimeVersion: "v20.11.9",
      })),
    ).toThrow("does not satisfy >=20.12");
    expect(() => servicePreflight("app", current.dependencies())).toThrow(
      "Production build directory is missing",
    );
  });

  it("refuses a permissive or linked database parent without repairing it", () => {
    if (process.platform === "win32") return;
    const current = fixture();
    chmodSync(current.parent, 0o750);

    expect(() => servicePreflight("app", current.dependencies())).toThrow(
      "exact mode 0700",
    );
    expect(() => servicePreflight("app", current.dependencies())).not.toThrow(
      /chmod/i,
    );

    const linked = fixture();
    const actualParent = path.join(linked.root, "actual-runtime");
    mkdirSync(actualParent, { mode: 0o700 });
    rmSync(linked.parent, { recursive: true });
    symlinkSync(actualParent, linked.parent);
    expect(() => servicePreflight("app", linked.dependencies())).toThrow(
      "expected regular type",
    );
  });

  it("refuses an inaccessible parent and a missing backup source", () => {
    const current = fixture();
    expect(() =>
      servicePreflight("app", current.dependencies({
        accessPath: (target) => {
          if (target === current.parent) throw new Error("injected access refusal");
        },
      })),
    ).toThrow("not writable by the service user");
    expect(() => servicePreflight("backup", current.dependencies())).toThrow(
      "backup service has no source",
    );
  });

  it("requires a non-root identity, rendered root, private umask, and Linux hardening", () => {
    const current = fixture();

    if (process.platform !== "win32") {
      expect(() =>
        servicePreflight(
          "app",
          current.dependencies({ processEffectiveUserId: () => 0 }),
        ),
      ).toThrow("non-root effective user identity");
      expect(() =>
        servicePreflight(
          "app",
          current.dependencies({ processEffectiveUserId: () => undefined }),
        ),
      ).toThrow("could not verify its effective user identity");
      expect(() =>
        servicePreflight(
          "app",
          current.dependencies({
            processEffectiveUserId: () => {
              throw new Error("injected identity failure");
            },
          }),
        ),
      ).toThrow("could not verify its effective user identity");
    }
    expect(() =>
      servicePreflight(
        "app",
        current.dependencies({ workingDirectory: path.dirname(current.root) }),
      ),
    ).toThrow("working directory");
    expect(() =>
      servicePreflight(
        "app",
        current.dependencies({ repositoryRootEnvironment: path.dirname(current.root) }),
      ),
    ).toThrow("MONEYBAGS_REPOSITORY_ROOT");
    expect(() =>
      servicePreflight("app", current.dependencies({ processUmask: () => 0o022 })),
    ).toThrow("umask 0077");
    if (process.platform === "linux") {
      expect(() =>
        servicePreflight("app", current.dependencies({ processStatus: "NoNewPrivs:\t0\n" })),
      ).toThrow("no-new-privileges");
    }
  });

  it("requires canonical build markers, server metadata, and a writable cache", () => {
    const missingMarker = fixture();
    rmSync(path.join(missingMarker.root, ".next", "BUILD_ID"));
    expect(() => servicePreflight("app", missingMarker.dependencies())).toThrow(
      "Production build marker is missing",
    );

    const emptyMarker = fixture();
    writeFileSync(path.join(emptyMarker.root, ".next", "BUILD_ID"), "");
    expect(() => servicePreflight("app", emptyMarker.dependencies())).toThrow(
      "build marker has an invalid size",
    );

    const oversizedMarker = fixture();
    writeFileSync(
      path.join(oversizedMarker.root, ".next", "BUILD_ID"),
      "x".repeat(4_097),
    );
    expect(() => servicePreflight("app", oversizedMarker.dependencies())).toThrow(
      "build marker has an invalid size",
    );

    const unsafeMarker = fixture();
    writeFileSync(path.join(unsafeMarker.root, ".next", "BUILD_ID"), "bad\nvalue");
    expect(() => servicePreflight("app", unsafeMarker.dependencies())).toThrow(
      "build marker has an invalid value",
    );

    const linkedMarker = fixture();
    const marker = path.join(linkedMarker.root, ".next", "BUILD_ID");
    const actualMarker = path.join(linkedMarker.root, "actual-build-id");
    writeFileSync(actualMarker, "synthetic-build");
    rmSync(marker);
    symlinkSync(actualMarker, marker);
    expect(() => servicePreflight("app", linkedMarker.dependencies())).toThrow(
      "expected regular type",
    );

    const linkedBuild = fixture();
    const buildDirectory = path.join(linkedBuild.root, ".next");
    const actualBuild = path.join(linkedBuild.root, "actual-build");
    rmSync(buildDirectory, { recursive: true });
    mkdirSync(path.join(actualBuild, "cache"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(actualBuild, "BUILD_ID"), "synthetic-build");
    writeFileSync(
      path.join(actualBuild, "required-server-files.json"),
      JSON.stringify({
        version: 1,
        config: { distDir: ".next" },
        appDir: linkedBuild.root,
        relativeAppDir: "",
        files: [".next/BUILD_ID", ".next/required-server-files.json"],
      }),
    );
    symlinkSync(actualBuild, buildDirectory);
    expect(() => servicePreflight("app", linkedBuild.dependencies())).toThrow(
      "expected regular type",
    );

    const missingManifest = fixture();
    rmSync(path.join(missingManifest.root, ".next", "required-server-files.json"));
    expect(() => servicePreflight("app", missingManifest.dependencies())).toThrow(
      "server-files manifest is missing",
    );

    const invalidManifest = fixture();
    writeFileSync(
      path.join(invalidManifest.root, ".next", "required-server-files.json"),
      "not-json",
    );
    expect(() => servicePreflight("app", invalidManifest.dependencies())).toThrow(
      "manifest is not valid JSON",
    );

    const wrongCheckout = fixture();
    writeFileSync(
      path.join(wrongCheckout.root, ".next", "required-server-files.json"),
      JSON.stringify({
        version: 1,
        config: { distDir: ".next" },
        appDir: path.dirname(wrongCheckout.root),
        relativeAppDir: "",
        files: [".next/BUILD_ID", ".next/required-server-files.json"],
      }),
    );
    expect(() => servicePreflight("app", wrongCheckout.dependencies())).toThrow(
      "does not match this checkout",
    );

    const unsafeManifestPath = fixture();
    writeFileSync(
      path.join(unsafeManifestPath.root, ".next", "required-server-files.json"),
      JSON.stringify({
        version: 1,
        config: { distDir: ".next" },
        appDir: unsafeManifestPath.root,
        relativeAppDir: "",
        files: ["../package.json", ".next/required-server-files.json"],
      }),
    );
    expect(() => servicePreflight("app", unsafeManifestPath.dependencies())).toThrow(
      "manifest contains an unsafe path",
    );

    const missingManifestFile = fixture();
    writeFileSync(
      path.join(missingManifestFile.root, ".next", "required-server-files.json"),
      JSON.stringify({
        version: 1,
        config: { distDir: ".next" },
        appDir: missingManifestFile.root,
        relativeAppDir: "",
        files: [
          ".next/BUILD_ID",
          ".next/required-server-files.json",
          ".next/missing.json",
        ],
      }),
    );
    expect(() => servicePreflight("app", missingManifestFile.dependencies())).toThrow(
      "references a missing file",
    );

    const inaccessibleCache = fixture();
    const cache = path.join(inaccessibleCache.root, ".next", "cache");
    expect(() =>
      servicePreflight(
        "app",
        inaccessibleCache.dependencies({
          accessPath: (target) => {
            if (target === cache) throw new Error("injected cache refusal");
          },
        }),
      ),
    ).toThrow("build and cache access is insufficient");

    const inaccessibleMarker = fixture();
    const unreadableMarker = path.join(inaccessibleMarker.root, ".next", "BUILD_ID");
    expect(() =>
      servicePreflight(
        "app",
        inaccessibleMarker.dependencies({
          accessPath: (target) => {
            if (target === unreadableMarker) throw new Error("injected marker refusal");
          },
        }),
      ),
    ).toThrow("manifest references an unreadable file");
  });

  it("checks existing database sidecars without creating or repairing files", () => {
    const current = fixture({ database: true });
    writeFileSync(`${current.databasePath}-wal`, "synthetic-wal", { mode: 0o600 });
    writeFileSync(`${current.databasePath}-shm`, "synthetic-shm", { mode: 0o600 });

    expect(servicePreflight("app", current.dependencies())).toEqual(current.preflight());
    chmodSync(`${current.databasePath}-wal`, 0o640);
    expect(() => servicePreflight("app", current.dependencies())).toThrow(
      "WAL sidecar must be exact mode 0600",
    );

    const orphaned = fixture();
    writeFileSync(`${orphaned.databasePath}-shm`, "orphaned", { mode: 0o600 });
    expect(() => servicePreflight("app", orphaned.dependencies())).toThrow(
      "database is missing while SQLite sidecars remain",
    );
    expect(readdirSync(orphaned.parent)).toEqual(["ledger.sqlite3-shm"]);
  });

  it("requires write access to an existing app database", () => {
    const current = fixture({ database: true });
    expect(() =>
      servicePreflight(
        "app",
        current.dependencies({
          accessPath: (target, mode) => {
            if (target === current.databasePath && (mode & 2) !== 0) {
              throw new Error("injected database refusal");
            }
          },
        }),
      ),
    ).toThrow("Configured database access is insufficient");
  });

  it("validates existing private backup destinations and leaves missing ones absent", () => {
    const current = fixture({ build: false, database: true });
    const backupRoot = backupRootForDatabase(current.databasePath);
    const backupDirectory = backupDirectoryForDatabase(current.databasePath);

    expect(servicePreflight("backup", current.dependencies())).toEqual(current.preflight());
    expect(existsSync(backupRoot)).toBe(false);

    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    chmodSync(backupRoot, 0o700);
    expect(servicePreflight("backup", current.dependencies())).toEqual(current.preflight());
    chmodSync(backupRoot, 0o750);
    expect(() => servicePreflight("backup", current.dependencies())).toThrow(
      "Backup root must be exact mode 0700",
    );
    chmodSync(backupRoot, 0o700);
    expect(() =>
      servicePreflight(
        "backup",
        current.dependencies({
          accessPath: (target) => {
            if (target === backupDirectory) throw new Error("injected namespace refusal");
          },
        }),
      ),
    ).toThrow("Backup target namespace is not writable");

    const linked = fixture({ build: false, database: true });
    const linkedRoot = backupRootForDatabase(linked.databasePath);
    const actualRoot = path.join(linked.root, "actual-backups");
    mkdirSync(actualRoot, { mode: 0o700 });
    symlinkSync(actualRoot, linkedRoot);
    expect(() => servicePreflight("backup", linked.dependencies())).toThrow(
      "expected regular type",
    );
  });

  it("emits bounded status without database or environment contents", () => {
    const current = fixture();
    const output: string[] = [];
    expect(
      main(["app"], {
        ...current.dependencies(),
        log: (message) => output.push(message),
      }),
    ).toBe(0);
    expect(output).toEqual(["Service preflight: READY mode=app"]);

    const errors: string[] = [];
    expect(main(["invalid"], { logError: (message) => errors.push(message) })).toBe(2);
    expect(errors).toEqual([
      "Service preflight: FAILED reason=expected-app-or-backup-mode",
    ]);
    expect(output.join("\n")).not.toMatch(/synthetic-placeholder|DB_FILE_NAME|SELECT/i);
  });
});
