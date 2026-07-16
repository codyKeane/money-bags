import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBuildPrivacyPolicy } from "./build-privacy-policy.mjs";
import {
  formatPrivacyReport,
  inspectStandaloneTree,
  inspectTraceManifests,
} from "./check-build-privacy.mjs";

const temporaryRoots = [];

function temporaryProject() {
  const root = mkdtempSync(path.join(tmpdir(), "moneybags-build-privacy-test-"));
  temporaryRoots.push(root);
  return root;
}

function write(root, relative, contents = "synthetic") {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function tracePolicy(projectRoot, configuredDatabasePath) {
  return createBuildPrivacyPolicy({
    projectRoot,
    configuredDatabasePath:
      configuredDatabasePath ?? path.join(projectRoot, "data", "finance.db"),
    runtimeDirectories: ["data", "imports", "backups", "runtime-state"],
  });
}

function writeManifest(projectRoot, relative, files) {
  return write(
    projectRoot,
    path.join(".next", relative),
    JSON.stringify({ version: 1, files }),
  );
}

function entryFrom(manifestPath, targetPath) {
  return path.relative(path.dirname(manifestPath), targetPath);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("NFT build privacy inspection", () => {
  it("scans root and nested manifests and accepts required runtime assets", () => {
    const projectRoot = temporaryProject();
    const rootManifest = writeManifest(projectRoot, "next-server.js.nft.json", []);
    const routeManifest = writeManifest(
      projectRoot,
      "server/app/api/health/route.js.nft.json",
      [],
    );
    const requiredAssets = [
      { id: "migration", path: "drizzle/0000_synthetic.sql" },
      {
        id: "native",
        path: "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      },
      { id: "preload", path: "scripts/next-telemetry-disabled.cjs" },
    ];
    writeFileSync(
      routeManifest,
      JSON.stringify({
        version: 1,
        files: requiredAssets.map((asset) =>
          entryFrom(routeManifest, path.join(projectRoot, asset.path)),
        ),
      }),
    );

    const report = inspectTraceManifests({
      projectRoot,
      policy: tracePolicy(projectRoot),
      requiredAssets,
    });

    expect(rootManifest).toContain("next-server.js.nft.json");
    expect(report).toMatchObject({
      ok: true,
      manifestsScanned: 2,
      entriesScanned: 3,
    });
  });

  it.each([
    ["data/finance.db", "configured-database"],
    ["data/finance.db-WAL", "configured-sidecar"],
    ["data/imports/statement.csv", "repository-data"],
    ["imports/statement.csv", "runtime-directory"],
    ["runtime-state/cache.bin", "runtime-directory"],
    [".env.production.local", "private-environment"],
    ["fixtures/archive.SQLITE3", "sqlite-runtime"],
    ["scripts/import-csv.ts", "operator-script"],
  ])("rejects traced %s as %s", (relative, policyClass) => {
    const projectRoot = temporaryProject();
    const manifest = writeManifest(projectRoot, "server/app/page.js.nft.json", []);
    writeFileSync(
      manifest,
      JSON.stringify({
        version: 1,
        files: [entryFrom(manifest, path.join(projectRoot, relative))],
      }),
    );

    const report = inspectTraceManifests({
      projectRoot,
      policy: tracePolicy(projectRoot),
      requiredAssets: [],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ policyClass, entry: 1 }),
    );
  });

  it("rejects an external configured target without exposing its path", () => {
    const projectRoot = temporaryProject();
    const configuredTarget = path.join(
      path.dirname(projectRoot),
      "PRIVATE_LEDGER_SENTINEL.custom",
    );
    const manifest = writeManifest(projectRoot, "server/app/page.js.nft.json", []);
    writeFileSync(
      manifest,
      JSON.stringify({
        version: 1,
        files: [entryFrom(manifest, configuredTarget)],
      }),
    );

    const report = inspectTraceManifests({
      projectRoot,
      policy: tracePolicy(projectRoot, configuredTarget),
      requiredAssets: [],
    });
    const formatted = formatPrivacyReport(report);

    expect(formatted).toContain("class=configured-database");
    expect(formatted).not.toContain(configuredTarget);
    expect(formatted).not.toContain("PRIVATE_LEDGER_SENTINEL");
  });

  it("fails closed for absent, malformed, oversized, and symlinked manifests", () => {
    const absentRoot = temporaryProject();
    mkdirSync(path.join(absentRoot, ".next"));
    expect(
      inspectTraceManifests({
        projectRoot: absentRoot,
        policy: tracePolicy(absentRoot),
        requiredAssets: [],
      }).violations,
    ).toContainEqual(expect.objectContaining({ policyClass: "missing-trace-manifest" }));

    const malformedRoot = temporaryProject();
    write(malformedRoot, ".next/server/page.js.nft.json", "not-json");
    expect(
      inspectTraceManifests({
        projectRoot: malformedRoot,
        policy: tracePolicy(malformedRoot),
        requiredAssets: [],
      }).violations,
    ).toContainEqual(expect.objectContaining({ policyClass: "invalid-trace-manifest" }));

    const oversizedRoot = temporaryProject();
    writeManifest(oversizedRoot, "server/page.js.nft.json", []);
    expect(
      inspectTraceManifests({
        projectRoot: oversizedRoot,
        policy: tracePolicy(oversizedRoot),
        requiredAssets: [],
        maxManifestBytes: 1,
      }).violations,
    ).toContainEqual(expect.objectContaining({ policyClass: "invalid-trace-manifest" }));

    if (process.platform !== "win32") {
      const symlinkRoot = temporaryProject();
      const target = write(symlinkRoot, "synthetic-manifest.json", "{}");
      mkdirSync(path.join(symlinkRoot, ".next", "server"), { recursive: true });
      symlinkSync(target, path.join(symlinkRoot, ".next/server/page.js.nft.json"));
      expect(
        inspectTraceManifests({
          projectRoot: symlinkRoot,
          policy: tracePolicy(symlinkRoot),
          requiredAssets: [],
        }).violations,
      ).toContainEqual(expect.objectContaining({ policyClass: "symlink-escape" }));

      const linkedRoot = temporaryProject();
      const externalRoot = temporaryProject();
      writeManifest(linkedRoot, "server/safe.js.nft.json", []);
      writeManifest(externalRoot, "hidden/forbidden.js.nft.json", [
        "../../../data/hidden.sqlite",
      ]);
      symlinkSync(
        path.join(externalRoot, ".next"),
        path.join(linkedRoot, ".next", "linked-manifests"),
      );
      expect(
        inspectTraceManifests({
          projectRoot: linkedRoot,
          policy: tracePolicy(linkedRoot),
          requiredAssets: [],
        }).violations,
      ).toContainEqual(expect.objectContaining({ policyClass: "symlink-escape" }));

      const aliasRoot = temporaryProject();
      writeManifest(aliasRoot, "server/safe.js.nft.json", []);
      const aliasTarget = write(
        aliasRoot,
        "safe/deep/manifests/alias.nft.json",
        JSON.stringify({ version: 1, files: ["../../data/private.custom"] }),
      );
      symlinkSync(
        path.dirname(aliasTarget),
        path.join(aliasRoot, ".next", "alias"),
      );
      expect(
        inspectTraceManifests({
          projectRoot: aliasRoot,
          policy: tracePolicy(aliasRoot),
          requiredAssets: [],
        }).violations,
      ).toContainEqual(expect.objectContaining({ policyClass: "repository-data" }));
    }
  });

  it("reports missing required assets with stable identifiers", () => {
    const projectRoot = temporaryProject();
    writeManifest(projectRoot, "server/page.js.nft.json", []);

    const report = inspectTraceManifests({
      projectRoot,
      policy: tracePolicy(projectRoot),
      requiredAssets: [{ id: "synthetic-native", path: "native.node" }],
    });

    expect(formatPrivacyReport(report)).toContain(
      "asset=synthetic-native class=missing-required-runtime-asset",
    );
  });
});

describe("standalone build privacy inspection", () => {
  function standalonePolicy(standaloneRoot) {
    return createBuildPrivacyPolicy({
      projectRoot: standaloneRoot,
      configuredDatabasePath: path.join(standaloneRoot, "data", "finance.db"),
      runtimeDirectories: ["data", "imports", "backups"],
    });
  }

  it("accepts a minimal runtime tree with the exact preload", () => {
    const projectRoot = temporaryProject();
    const standaloneRoot = path.join(projectRoot, ".next", "standalone");
    const assets = [
      { id: "server", path: "server.js" },
      { id: "migration", path: "drizzle/0000_synthetic.sql" },
      {
        id: "native",
        path: "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      },
      { id: "preload", path: "scripts/next-telemetry-disabled.cjs" },
    ];
    for (const asset of assets) write(standaloneRoot, asset.path);
    write(standaloneRoot, "node_modules/better-sqlite3/deps/test_extension.c");
    write(standaloneRoot, "node_modules/better-sqlite3/README.md");

    const report = inspectStandaloneTree({
      projectRoot,
      standaloneRoot,
      policy: standalonePolicy(standaloneRoot),
      requiredAssets: assets,
    });

    expect(report.ok).toBe(true);
    expect(report.pathsScanned).toBeGreaterThan(assets.length);
  });

  it.each([
    [".env", "private-environment"],
    [".env.production", "private-environment"],
    ["data/finance.db", "configured-database"],
    ["src/lib/money.test.ts", "project-test"],
    ["scripts/backup-db.ts", "operator-script"],
    ["deploy/moneybags.service", "deploy-file"],
    ["README.md", "project-documentation"],
  ])("rejects packaged %s as %s", (relative, policyClass) => {
    const projectRoot = temporaryProject();
    const standaloneRoot = path.join(projectRoot, ".next", "standalone");
    write(standaloneRoot, relative);

    const report = inspectStandaloneTree({
      projectRoot,
      standaloneRoot,
      policy: standalonePolicy(standaloneRoot),
      requiredAssets: [],
    });

    expect(report.violations).toContainEqual(
      expect.objectContaining({ policyClass }),
    );
  });

  const symlinkTest = process.platform === "win32" ? it.skip : it;
  symlinkTest("requires runtime assets to be lexical regular files", () => {
    const projectRoot = temporaryProject();
    const standaloneRoot = path.join(projectRoot, ".next", "standalone");
    mkdirSync(path.join(standaloneRoot, "server.js"), { recursive: true });
    write(standaloneRoot, "runtime/unrelated.cjs");
    mkdirSync(path.join(standaloneRoot, "scripts"), { recursive: true });
    symlinkSync(
      "../runtime/unrelated.cjs",
      path.join(standaloneRoot, "scripts", "next-telemetry-disabled.cjs"),
    );

    const report = inspectStandaloneTree({
      projectRoot,
      standaloneRoot,
      policy: standalonePolicy(standaloneRoot),
      requiredAssets: [
        { id: "server", path: "server.js" },
        { id: "preload", path: "scripts/next-telemetry-disabled.cjs" },
      ],
    });

    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyClass: "missing-required-runtime-asset",
          asset: "server",
        }),
        expect.objectContaining({
          policyClass: "missing-required-runtime-asset",
          asset: "preload",
        }),
      ]),
    );
  });

  symlinkTest("rejects dangling and escaping symlink targets", () => {
    const projectRoot = temporaryProject();
    const standaloneRoot = path.join(projectRoot, ".next", "standalone");
    mkdirSync(path.join(standaloneRoot, "node_modules", "synthetic"), {
      recursive: true,
    });
    symlinkSync(
      path.join(projectRoot, "outside"),
      path.join(standaloneRoot, "node_modules", "synthetic", "escape"),
    );
    symlinkSync(
      "missing-target",
      path.join(standaloneRoot, "node_modules", "synthetic", "dangling"),
    );

    const report = inspectStandaloneTree({
      projectRoot,
      standaloneRoot,
      policy: standalonePolicy(standaloneRoot),
      requiredAssets: [],
    });

    expect(
      report.violations.filter((item) => item.policyClass === "symlink-escape"),
    ).toHaveLength(2);
  });
});
