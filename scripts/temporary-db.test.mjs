import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPOSITORY_ROOT_ENV_NAME as WRAPPER_REPOSITORY_ROOT_ENV_NAME,
  cleanupTemporaryDatabaseLease,
  createTemporaryDatabaseLease,
  validateTemporaryDatabaseRoot,
} from "./temporary-db.mjs";
import { REPOSITORY_ROOT_ENV_NAME as DATABASE_REPOSITORY_ROOT_ENV_NAME } from "../src/db/path";
import {
  assertProcessTreeCleanupSupported,
  runMode,
  runTemporaryDatabaseCommand,
} from "./run-with-temp-db.mjs";
import { nextArgumentsForMode } from "./run-next.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryParents = [];

function makeTemporaryParent(prefix = "moneybags-wrapper-test-") {
  const parent = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryParents.push(parent);
  return parent;
}

afterEach(() => {
  for (const parent of temporaryParents.splice(0)) {
    rmSync(parent, { recursive: true, force: true });
  }
});

describe("temporary database lease", () => {
  it("creates a canonical external target and removes its SQLite artifacts", () => {
    const fakeRepository = makeTemporaryParent("moneybags-fake-repo-");
    const temporaryDirectory = makeTemporaryParent("moneybags-fake-tmp-");
    const lease = createTemporaryDatabaseLease({
      repositoryRoot: fakeRepository,
      temporaryDirectory,
    });

    expect(path.dirname(lease.rootPath)).toBe(temporaryDirectory);
    expect(path.dirname(lease.databasePath)).toBe(lease.rootPath);
    expect(validateTemporaryDatabaseRoot(lease.rootPath, { temporaryDirectory })).toEqual(
      lease,
    );
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      writeFileSync(`${lease.databasePath}${suffix}`, "fake");
    }

    cleanupTemporaryDatabaseLease(lease);
    cleanupTemporaryDatabaseLease(lease);

    expect(existsSync(lease.rootPath)).toBe(false);
  });

  it("refuses and cleans a target under the repository", () => {
    const fakeRepository = makeTemporaryParent("moneybags-contained-repo-");

    expect(() =>
      createTemporaryDatabaseLease({
        repositoryRoot: fakeRepository,
        temporaryDirectory: fakeRepository,
      }),
    ).toThrow(/protected runtime tree/);
    expect(readdirSync(fakeRepository)).toEqual([]);
  });

  it("refuses and cleans a target under an absolute configured runtime tree", () => {
    const fakeRepository = makeTemporaryParent("moneybags-runtime-repo-");
    const runtimeTree = makeTemporaryParent("moneybags-runtime-tree-");

    expect(() =>
      createTemporaryDatabaseLease({
        repositoryRoot: fakeRepository,
        inheritedDatabaseFileName: path.join(runtimeTree, "ledger.sqlite"),
        temporaryDirectory: runtimeTree,
      }),
    ).toThrow(/protected runtime tree/);
    expect(readdirSync(runtimeTree)).toEqual([]);
  });

  it("removes the newly-created root when marker creation fails", () => {
    const fakeRepository = makeTemporaryParent("moneybags-marker-repo-");
    const temporaryDirectory = makeTemporaryParent("moneybags-marker-tmp-");

    expect(() =>
      createTemporaryDatabaseLease({
        repositoryRoot: fakeRepository,
        temporaryDirectory,
        markerWriter() {
          throw new Error("injected marker failure");
        },
      }),
    ).toThrow(/injected marker failure/);
    expect(readdirSync(temporaryDirectory)).toEqual([]);
  });

  it("refuses to clean an existing root whose ownership marker disappeared", () => {
    const fakeRepository = makeTemporaryParent("moneybags-missing-marker-repo-");
    const temporaryDirectory = makeTemporaryParent("moneybags-missing-marker-tmp-");
    const lease = createTemporaryDatabaseLease({
      repositoryRoot: fakeRepository,
      temporaryDirectory,
    });
    const markerContents = readFileSync(lease.markerPath, "utf8");
    rmSync(lease.markerPath);

    try {
      expect(() => cleanupTemporaryDatabaseLease(lease)).toThrow(/marker is missing/);
      expect(existsSync(lease.rootPath)).toBe(true);
    } finally {
      writeFileSync(lease.markerPath, markerContents, { flag: "wx", mode: 0o600 });
      cleanupTemporaryDatabaseLease(lease);
    }
  });

  it("requires the matching ownership token when one is supplied", () => {
    const fakeRepository = makeTemporaryParent("moneybags-token-repo-");
    const temporaryDirectory = makeTemporaryParent("moneybags-token-tmp-");
    const lease = createTemporaryDatabaseLease({
      repositoryRoot: fakeRepository,
      temporaryDirectory,
    });
    try {
      expect(() =>
        validateTemporaryDatabaseRoot(lease.rootPath, {
          temporaryDirectory,
          ownershipToken: "0".repeat(64),
        }),
      ).toThrow(/token does not match/);
      expect(
        validateTemporaryDatabaseRoot(lease.rootPath, {
          temporaryDirectory,
          ownershipToken: lease.ownershipToken,
        }).rootPath,
      ).toBe(lease.rootPath);
    } finally {
      cleanupTemporaryDatabaseLease(lease);
    }
  });
});

describe("temporary database command", () => {
  it("fails closed on native Windows before process-tree ownership is needed", () => {
    expect(() => assertProcessTreeCleanupSupported("win32")).toThrow(
      /not available on native Windows/,
    );
    expect(() => assertProcessTreeCleanupSupported("linux")).not.toThrow();
    expect(() => assertProcessTreeCleanupSupported("darwin")).not.toThrow();
  });

  it("overrides a configured target, preserves it byte-for-byte, and cleans success", async () => {
    const configuredRoot = makeTemporaryParent("moneybags-configured-ledger-");
    const configuredTarget = path.join(configuredRoot, "ledger.sqlite");
    writeFileSync(configuredTarget, "fake-ledger-sentinel");
    let target;

    const result = await runTemporaryDatabaseCommand({
      executable: process.execPath,
      args: [
        "-e",
        "const fs=require('node:fs'); for (const s of ['', '-wal', '-shm']) fs.writeFileSync(process.env.DB_FILE_NAME+s, 'temporary')",
      ],
      repositoryRoot,
      environment: { ...process.env, DB_FILE_NAME: configuredTarget },
      onTarget(value) {
        target = value;
      },
    });

    expect(result.code).toBe(0);
    expect(result.spawnError).toBeNull();
    expect(readFileSync(configuredTarget, "utf8")).toBe("fake-ledger-sentinel");
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("preserves a nonzero child status and cleans the lease", async () => {
    let target;
    const result = await runTemporaryDatabaseCommand({
      executable: process.execPath,
      args: ["-e", "process.exit(23)"],
      repositoryRoot,
      onTarget(value) {
        target = value;
      },
    });

    expect(result.code).toBe(23);
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("reports a synchronous spawn failure and cleans the lease", async () => {
    let target;
    const result = await runTemporaryDatabaseCommand({
      executable: process.execPath,
      repositoryRoot,
      onTarget(value) {
        target = value;
      },
      spawnImplementation() {
        throw new Error("fake spawn failure");
      },
      signalSource: new EventEmitter(),
    });

    expect(result.spawnError).toBeInstanceOf(Error);
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("reports an asynchronous pre-PID spawn failure and cleans the lease", async () => {
    let target;
    const injectedError = new Error("injected asynchronous spawn failure");
    const result = await runTemporaryDatabaseCommand({
      executable: process.execPath,
      repositoryRoot,
      onTarget(value) {
        target = value;
      },
      spawnImplementation() {
        const fake = new EventEmitter();
        fake.pid = undefined;
        fake.exitCode = null;
        fake.signalCode = null;
        queueMicrotask(() => {
          fake.emit("error", injectedError);
          fake.emit("close", null, null);
        });
        return fake;
      },
      signalSource: new EventEmitter(),
    });

    expect(result.spawnError).toBe(injectedError);
    expect(result.cleanupError).toBeNull();
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("cleans the lease when target reporting throws", async () => {
    let target;
    await expect(
      runTemporaryDatabaseCommand({
        executable: process.execPath,
        repositoryRoot,
        onTarget(value) {
          target = value;
          throw new Error("injected target reporter failure");
        },
        signalSource: new EventEmitter(),
      }),
    ).rejects.toThrow(/target reporter failure/);

    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("records a pre-spawn signal, skips the child, and cleans the lease", async () => {
    const signalSource = new EventEmitter();
    let target;
    let spawnCalls = 0;
    const result = await runTemporaryDatabaseCommand({
      executable: process.execPath,
      repositoryRoot,
      signalSource,
      onTarget(value) {
        target = value;
        signalSource.emit("SIGTERM");
      },
      spawnImplementation() {
        spawnCalls += 1;
        throw new Error("child must not be spawned");
      },
    });

    expect(result.requestedSignal).toBe("SIGTERM");
    expect(spawnCalls).toBe(0);
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("detects any lint-created artifact before cleaning the lease", async () => {
    const result = await runTemporaryDatabaseCommand({
      executable: process.execPath,
      args: [
        "-e",
        "require('node:fs').writeFileSync(process.env.DB_FILE_NAME, 'unexpected')",
      ],
      repositoryRoot,
      lintMode: true,
    });

    expect(result.code).toBe(0);
    expect(result.lintArtifact).toBe(true);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("forwards mode arguments and the owned lease environment to the package CLI", async () => {
    let invocation;
    const result = await runMode("test", ["--reporter=dot", "sample.test.ts"], {
      repositoryRoot,
      environment: { ...process.env, DB_FILE_NAME: "/configured/ledger.sqlite" },
      signalSource: new EventEmitter(),
      spawnImplementation(executable, args, options) {
        invocation = { executable, args, options };
        const fake = new EventEmitter();
        fake.pid = 2_147_483_647;
        fake.exitCode = null;
        fake.signalCode = null;
        queueMicrotask(() => {
          fake.exitCode = 0;
          fake.emit("close", 0, null);
        });
        return fake;
      },
    });

    expect(result.code).toBe(0);
    expect(invocation.executable).toBe(process.execPath);
    expect(invocation.args.at(-3)).toBe("run");
    expect(invocation.args.slice(-2)).toEqual(["--reporter=dot", "sample.test.ts"]);
    expect(invocation.options.shell).toBe(false);
    expect(invocation.options.env.DB_FILE_NAME).toMatch(/moneybags-db-.+database\.sqlite$/);
    expect(invocation.options.env.MONEYBAGS_REPOSITORY_ROOT).toBe(repositoryRoot);
    expect(WRAPPER_REPOSITORY_ROOT_ENV_NAME).toBe(
      DATABASE_REPOSITORY_ROOT_ENV_NAME,
    );
    expect(invocation.options.env.MONEYBAGS_TEMP_DB_ROOT).toBe(
      path.dirname(invocation.options.env.DB_FILE_NAME),
    );
    expect(invocation.options.env.MONEYBAGS_TEMP_DB_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(result.rootPath)).toBe(false);
  });
});

describe("Next launcher arguments", () => {
  it.each([
    ["dev", ["dev", "-p", "3100", "-H", "127.0.0.1"]],
    ["start", ["start", "-p", "3100", "-H", "127.0.0.1"]],
    ["dev:lan", ["dev", "-p", "3100"]],
    ["start:lan", ["start", "-p", "3100"]],
  ])("maps %s to the existing binding contract", (mode, expected) => {
    expect(nextArgumentsForMode(mode, ["--inspect-contract"])).toEqual([
      ...expected,
      "--inspect-contract",
    ]);
  });

  it("rejects unknown launcher modes", () => {
    expect(() => nextArgumentsForMode("build")).toThrow(/Unsupported/);
  });
});

const signalTest = process.platform === "win32" ? it.skip : it;

describe("temporary database command signals", () => {
  signalTest.each(["SIGINT", "SIGTERM"])(
    "forwards %s, preserves signal status, and cleans before exit",
    async (signal) => {
      const moduleUrl = pathToFileURL(
        path.join(repositoryRoot, "scripts", "run-with-temp-db.mjs"),
      ).href;
      const grandchildSource =
        "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
      const childSource =
        "const {spawn}=require('node:child_process');" +
        `const descendant=spawn(process.execPath,['-e',${JSON.stringify(grandchildSource)}],{stdio:'ignore'});` +
        "require('node:fs').writeFileSync(process.env.DB_FILE_NAME,'temporary');" +
        "console.log('READY '+descendant.pid);setInterval(()=>{},1000)";
      const driverSource = `
        import { runTemporaryDatabaseCommand } from ${JSON.stringify(moduleUrl)};
        const result = await runTemporaryDatabaseCommand({
          executable: process.execPath,
          args: ['-e', ${JSON.stringify(childSource)}],
          repositoryRoot: ${JSON.stringify(repositoryRoot)},
          onTarget(value) { console.error('TARGET ' + value); },
          signalGraceMs: 1000,
        });
        const signal = result.requestedSignal ?? result.signal;
        if (signal) process.kill(process.pid, signal);
        else process.exitCode = result.code ?? 1;
      `;
      const driver = spawn(
        process.execPath,
        ["--input-type=module", "--eval", driverSource],
        { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      driver.stdout.setEncoding("utf8");
      driver.stderr.setEncoding("utf8");
      driver.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes("READY")) driver.kill(signal);
      });
      driver.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      const result = await new Promise((resolve, reject) => {
        driver.once("error", reject);
        driver.once("close", (code, closedSignal) =>
          resolve({ code, signal: closedSignal }),
        );
      });
      const match = stderr.match(/^TARGET (.+)$/m);
      const descendantMatch = stdout.match(/READY (\d+)/);
      expect(match).not.toBeNull();
      expect(descendantMatch).not.toBeNull();
      expect(result).toEqual({ code: null, signal });
      expect(existsSync(path.dirname(match[1]))).toBe(false);
      expect(() => process.kill(Number(descendantMatch[1]), 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
    },
    10_000,
  );
});
