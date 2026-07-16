import { constants, accessSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoLocalNodeShadow,
  parseMinimumNodeVersion,
  parseNodeVersion,
  parseRenderArguments,
  renderSystemdUnits,
  satisfiesMinimumNodeVersion,
} from "./render-systemd-units.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [];

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "moneybags-systemd-"));
  roots.push(root);
  const binDirectory = path.join(root, "runtime", "bin");
  const libDirectory = path.join(root, "runtime", "lib");
  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(libDirectory, { recursive: true });
  const nodeExecutable = path.join(binDirectory, "node");
  const npmCli = path.join(libDirectory, "npm-cli.js");
  symlinkSync(process.execPath, nodeExecutable);
  writeFileSync(
    npmCli,
    [
      'const { spawnSync } = require("node:child_process");',
      'if (process.argv[2] === "--version") process.stdout.write("10.9.4\\n");',
      "else {",
      '  const result = spawnSync("node", ["-p", "process.execPath"], { encoding: "utf8" });',
      "  process.stdout.write(result.stdout ?? \"\");",
      "  process.stderr.write(result.stderr ?? \"\");",
      "  process.exitCode = result.status ?? 1;",
      "}",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const outputDirectory = path.join(root, "staged-units");
  return { root, binDirectory, nodeExecutable, npmCli, outputDirectory };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("systemd unit runtime renderer", () => {
  it("renders both services and the timer with one validated runtime pair", () => {
    const current = fixture();

    const result = renderSystemdUnits({
      nodeExecutable: current.nodeExecutable,
      npmCli: current.npmCli,
      serviceUser: "finance",
      outputDirectory: current.outputDirectory,
    });

    expect(result.nodeVersion).toBe(process.version);
    expect(result.npmVersion).toBe("10.9.4");
    expect(result.nextVersion).toBe("16.2.10");
    expect(result.tsxVersion).toBe("4.23.0");
    expect(result.serviceUser).toBe("finance");
    expect(result.nextCli).toBe(
      path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next"),
    );
    expect(result.tsxCli).toBe(
      path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    );
    expect(result.unitFiles).toEqual([
      "finance.service",
      "finance-backup.service",
      "finance-backup.timer",
    ]);

    for (const filename of result.unitFiles) {
      const source = readFileSync(path.join(current.outputDirectory, filename), "utf8");
      expect(source).not.toMatch(/@@[A-Z0-9_]+@@/);
      expect(source).not.toContain("/usr/bin/npm");
    }

    const app = readFileSync(path.join(current.outputDirectory, "finance.service"), "utf8");
    expect(app).toContain(`Environment="PATH=${current.binDirectory}:`);
    expect(app).toContain("User=finance");
    expect(app).toContain(`WorkingDirectory=${PROJECT_ROOT}`);
    expect(app).toContain(
      `ExecStartPre="${current.nodeExecutable}" "${result.tsxCli}" --no-cache "${path.join(
        PROJECT_ROOT,
        "scripts",
        "service-preflight.ts",
      )}" app`,
    );
    expect(app).toContain(
      `ExecStart="${current.nodeExecutable}" --require "${path.join(
        PROJECT_ROOT,
        "scripts",
        "next-telemetry-disabled.cjs",
      )}" "${result.nextCli}" start -p 3100 -H 127.0.0.1`,
    );
    expect(app).toContain("Environment=NODE_ENV=production");
    expect(app).toContain("Environment=NEXT_TELEMETRY_DISABLED=1");
    expect(app).toContain("Environment=MONEYBAGS_TRUST_LOOPBACK_PROXY=1");
    expect(app).toContain("Restart=on-failure");
    expect(app).toContain("UMask=0077");
    expect(app).toContain("NoNewPrivileges=true");
    expect(app).toContain("SuccessExitStatus=143");
    expect(app).not.toContain(current.npmCli);

    const backup = readFileSync(
      path.join(current.outputDirectory, "finance-backup.service"),
      "utf8",
    );
    expect(backup).toContain(
      `ExecStartPre="${current.nodeExecutable}" "${result.tsxCli}" --no-cache "${path.join(
        PROJECT_ROOT,
        "scripts",
        "service-preflight.ts",
      )}" backup`,
    );
    expect(backup).toContain(
      `ExecStart="${current.nodeExecutable}" "${result.tsxCli}" --no-cache "${path.join(
        PROJECT_ROOT,
        "scripts",
        "backup-db.ts",
      )}" --keep 14`,
    );
    expect(backup).toContain("UMask=0077");
    expect(backup).toContain("NoNewPrivileges=true");
    expect(backup).not.toContain(current.npmCli);
    expect(readFileSync(path.join(current.outputDirectory, "finance-backup.timer"), "utf8"))
      .toContain("OnCalendar=daily");
  });

  it("rejects a selected Node below the package engine before writing output", () => {
    const current = fixture();
    const runCommand = (_executable, argumentsList) => ({
      error: undefined,
      status: 0,
      stderr: "",
      stdout: argumentsList[0] === "--version" ? "v20.11.9\n" : "10.9.4\n",
    });

    expect(() =>
      renderSystemdUnits({
        nodeExecutable: current.nodeExecutable,
        npmCli: current.npmCli,
        serviceUser: "finance",
        outputDirectory: current.outputDirectory,
        runCommand,
      }),
    ).toThrow("does not satisfy >=20.12");
    expect(() => accessSync(current.outputDirectory, constants.F_OK)).toThrow();
  });

  it("rejects an npm CLI that cannot run through the selected Node", () => {
    const current = fixture();
    writeFileSync(current.npmCli, "throw new Error('synthetic npm failure');\n");

    expect(() =>
      renderSystemdUnits({
        nodeExecutable: current.nodeExecutable,
        npmCli: current.npmCli,
        serviceUser: "finance",
        outputDirectory: current.outputDirectory,
      }),
    ).toThrow("npm CLI version check failed");
    expect(() => accessSync(current.outputDirectory, constants.F_OK)).toThrow();
  });

  it("rejects unknown template tokens before writing output", () => {
    const current = fixture();
    const templateDirectory = path.join(current.root, "templates");
    cpSync(path.join(PROJECT_ROOT, "deploy"), templateDirectory, { recursive: true });
    writeFileSync(
      path.join(templateDirectory, "finance.service"),
      `${readFileSync(path.join(templateDirectory, "finance.service"), "utf8")}\n@@UNKNOWN@@\n`,
    );

    expect(() =>
      renderSystemdUnits({
        nodeExecutable: current.nodeExecutable,
        npmCli: current.npmCli,
        serviceUser: "finance",
        outputDirectory: current.outputDirectory,
        templateDirectory,
      }),
    ).toThrow("unknown systemd template token");
  });

  it("rejects unsafe runtime paths and existing output directories", () => {
    const current = fixture();
    expect(() =>
      renderSystemdUnits({
        nodeExecutable: "relative/node",
        npmCli: current.npmCli,
        serviceUser: "finance",
        outputDirectory: current.outputDirectory,
      }),
    ).toThrow("normalized absolute path");

    mkdirSync(current.outputDirectory);
    expect(() =>
      renderSystemdUnits({
        nodeExecutable: current.nodeExecutable,
        npmCli: current.npmCli,
        serviceUser: "finance",
        outputDirectory: current.outputDirectory,
      }),
    ).toThrow("must not already exist");
  });

  it("rejects a dependency executable named node", () => {
    const current = fixture();
    const projectRoot = path.join(current.root, "project");
    mkdirSync(path.join(projectRoot, "node_modules", ".bin"), { recursive: true });
    writeFileSync(path.join(projectRoot, "node_modules", ".bin", "node"), "shadow");

    expect(() => assertNoLocalNodeShadow(projectRoot)).toThrow("would shadow");
  });

  it("parses the selected engine/version and CLI arguments exactly", () => {
    expect(parseMinimumNodeVersion(">=20.12")).toEqual([20, 12, 0]);
    expect(parseNodeVersion("v22.22.1\n")).toEqual([22, 22, 1]);
    expect(satisfiesMinimumNodeVersion([20, 12, 0], [20, 12, 0])).toBe(true);
    expect(satisfiesMinimumNodeVersion([20, 11, 9], [20, 12, 0])).toBe(false);
    expect(
      parseRenderArguments([
        "--npm-cli",
        "/runtime/npm-cli.js",
        "--service-user",
        "finance",
        "--output",
        "/tmp/units",
        "--node",
        "/runtime/node",
      ]),
    ).toEqual({
      nodeExecutable: "/runtime/node",
      npmCli: "/runtime/npm-cli.js",
      serviceUser: "finance",
      outputDirectory: "/tmp/units",
    });
  });

  it("rejects root and unsafe systemd service accounts", () => {
    const current = fixture();
    for (const serviceUser of ["root", "Finance User", "-finance"]) {
      expect(() =>
        renderSystemdUnits({
          nodeExecutable: current.nodeExecutable,
          npmCli: current.npmCli,
          serviceUser,
          outputDirectory: current.outputDirectory,
        }),
      ).toThrow("conservative non-root account name");
    }
  });

  it("keeps npm lifecycle child Node resolution on the selected runtime", () => {
    const current = fixture();
    const packageRoot = path.join(current.root, "lifecycle");
    mkdirSync(packageRoot);
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ private: true, scripts: { runtime: "node -p process.execPath" } }),
    );

    const result = spawnSync(current.nodeExecutable, [current.npmCli, "run", "--silent", "runtime"], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        HOME: current.root,
        PATH: `${current.binDirectory}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`,
      },
      shell: false,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(realpathSync(result.stdout.trim())).toBe(realpathSync(process.execPath));
  });

  const systemdAvailable = spawnSync("systemd-analyze", ["--version"], {
    encoding: "utf8",
    shell: false,
  }).status === 0;
  const systemdIt = systemdAvailable ? it : it.skip;

  systemdIt("passes installed systemd verification after rendering", () => {
    const current = fixture();
    renderSystemdUnits({
      nodeExecutable: current.nodeExecutable,
      npmCli: current.npmCli,
      serviceUser: "finance",
      outputDirectory: current.outputDirectory,
    });

    const unitFiles = ["finance.service", "finance-backup.service", "finance-backup.timer"].map(
      (filename) => path.join(current.outputDirectory, filename),
    );
    const result = spawnSync(
      "systemd-analyze",
      [
        "--system",
        "--generators=no",
        "--man=no",
        "--recursive-errors=yes",
        "verify",
        ...unitFiles,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, SYSTEMD_UNIT_PATH: `${current.outputDirectory}:` },
        shell: false,
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
