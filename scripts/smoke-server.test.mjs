import { createServer } from "node:net";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runServerSmoke } from "./smoke-server.mjs";

const temporaryRoots = [];

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function makeTemporaryParent() {
  const parent = mkdtempSync(path.join(tmpdir(), "moneybags-smoke-test-"));
  temporaryRoots.push(parent);
  return parent;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fakeHealthServer(port, ignoreTermination = false) {
  return [
    "-e",
    `require('node:fs').writeFileSync(process.env.DB_FILE_NAME,'fake');const http=require('node:http');${
      ignoreTermination ? "process.on('SIGTERM',()=>{});" : ""
    }http.createServer((req,res)=>{if(req.url==='/api/health'){res.writeHead(200,{'content-type':'application/json'});res.end('{\"ok\":true}')}else{res.writeHead(404);res.end()}}).listen(${port},'127.0.0.1')`,
  ];
}

describe("bounded loopback smoke helper", () => {
  it("accepts a healthy loopback server, stops it, and removes the lease", async () => {
    const port = await availablePort();
    const result = await runServerSmoke("dev", {
      port,
      nodeArguments: fakeHealthServer(port),
      temporaryDirectory: makeTemporaryParent(),
      stdio: "ignore",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 500,
      log() {},
    });

    expect(result.code).toBe(0);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("fails an early nonzero child exit and removes the lease", async () => {
    const result = await runServerSmoke("start", {
      port: await availablePort(),
      nodeArguments: ["-e", "process.exit(19)"],
      temporaryDirectory: makeTemporaryParent(),
      stdio: "ignore",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
      log() {},
    });

    expect(result.code).toBe(1);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("fails an early zero child exit instead of reporting a false positive", async () => {
    const result = await runServerSmoke("start", {
      port: await availablePort(),
      nodeArguments: ["-e", "process.exit(0)"],
      temporaryDirectory: makeTemporaryParent(),
      stdio: "ignore",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
      log() {},
    });

    expect(result.code).toBe(1);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("fails a process that serves health once and immediately exits", async () => {
    const port = await availablePort();
    const oneResponseServer = [
      "-e",
      `require('node:fs').writeFileSync(process.env.DB_FILE_NAME,'fake');const http=require('node:http');const server=http.createServer((req,res)=>{res.setHeader('connection','close');res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}',()=>server.close())});server.listen(${port},'127.0.0.1')`,
    ];
    const result = await runServerSmoke("dev", {
      port,
      nodeArguments: oneResponseServer,
      temporaryDirectory: makeTemporaryParent(),
      stdio: "ignore",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
      log() {},
    });

    expect(result.code).toBe(1);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("times out, terminates the child, and removes the lease", async () => {
    const result = await runServerSmoke("dev", {
      port: await availablePort(),
      nodeArguments: ["-e", "setInterval(()=>{},1000)"],
      temporaryDirectory: makeTemporaryParent(),
      stdio: "ignore",
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 100,
      log() {},
    });

    expect(result.code).toBe(1);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("does not accept a healthy responder that never opens the owned database", async () => {
    const port = await availablePort();
    const unrelatedHealthServer = [
      "-e",
      `const http=require('node:http');http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}')}).listen(${port},'127.0.0.1')`,
    ];
    const result = await runServerSmoke("dev", {
      port,
      nodeArguments: unrelatedHealthServer,
      temporaryDirectory: makeTemporaryParent(),
      stdio: "ignore",
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 100,
      log() {},
    });

    expect(result.code).toBe(1);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("escalates shutdown for a server that ignores SIGTERM", async () => {
    const port = await availablePort();
    const result = await runServerSmoke("dev", {
      port,
      nodeArguments: fakeHealthServer(port, true),
      temporaryDirectory: makeTemporaryParent(),
      stdio: "ignore",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 50,
      log() {},
    });

    expect(result.code).toBe(0);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  const processTreeTest = process.platform === "win32" ? it.skip : it;
  processTreeTest("stops an ignored descendant before removing the lease", async () => {
    const port = await availablePort();
    const temporaryDirectory = makeTemporaryParent();
    const descendantPidFile = path.join(temporaryDirectory, "descendant.pid");
    const descendantSource =
      "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const serverSource =
      "const {spawn}=require('node:child_process');const fs=require('node:fs');" +
      `const child=spawn(process.execPath,['-e',${JSON.stringify(descendantSource)}],{stdio:'ignore'});` +
      "fs.writeFileSync(process.env.DESCENDANT_PID_FILE,String(child.pid));" +
      "fs.writeFileSync(process.env.DB_FILE_NAME,'fake');" +
      `const http=require('node:http');http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}')}).listen(${port},'127.0.0.1')`;
    const result = await runServerSmoke("dev", {
      port,
      nodeArguments: ["-e", serverSource],
      environment: { ...process.env, DESCENDANT_PID_FILE: descendantPidFile },
      temporaryDirectory,
      stdio: "ignore",
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
      log() {},
    });
    const descendantPid = Number(readFileSync(descendantPidFile, "utf8"));

    expect(result.code).toBe(0);
    expect(existsSync(result.rootPath)).toBe(false);
    expect(() => process.kill(descendantPid, 0)).toThrow(
      expect.objectContaining({ code: "ESRCH" }),
    );
  });

  it("records a pre-spawn signal, skips the server, and cleans the lease", async () => {
    const signalSource = new EventEmitter();
    let spawnCalls = 0;
    const result = await runServerSmoke("dev", {
      port: await availablePort(),
      temporaryDirectory: makeTemporaryParent(),
      signalSource,
      onTarget() {
        signalSource.emit("SIGTERM");
      },
      spawnImplementation() {
        spawnCalls += 1;
        throw new Error("server must not be spawned");
      },
      log() {},
    });

    expect(result.signal).toBe("SIGTERM");
    expect(spawnCalls).toBe(0);
    expect(existsSync(result.rootPath)).toBe(false);
  });

  it("cleans the lease when target logging throws", async () => {
    let targetRoot;
    let logCalls = 0;
    const result = await runServerSmoke("dev", {
      port: await availablePort(),
      temporaryDirectory: makeTemporaryParent(),
      log(message) {
        logCalls += 1;
        const match = message.match(/^\[temp-db\] target: (.+)$/);
        if (match) targetRoot = path.dirname(match[1]);
        if (logCalls === 1) throw new Error("injected logger failure");
      },
    });

    expect(result.code).toBe(1);
    expect(result.error).toBeInstanceOf(Error);
    expect(existsSync(targetRoot)).toBe(false);
  });

  it("rejects non-loopback modes before creating a lease", async () => {
    await expect(runServerSmoke("lan", { log() {} })).rejects.toThrow(/dev or start/);
  });
});
