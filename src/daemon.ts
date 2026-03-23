/**
 * Daemon lifecycle management — download, start, health check, stop.
 *
 * Manages the agentanycastd binary (Go daemon). On npm install, the
 * postinstall script downloads the correct platform binary. At runtime,
 * DaemonManager starts/stops the daemon and verifies readiness via gRPC.
 */

import { execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, chmodSync } from "node:fs";
import { mkdir, unlink, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { DaemonConnectionError, DaemonNotFoundError, DaemonStartError } from "./exceptions.js";

const RELEASE_URL =
  "https://github.com/agentanycast/agentanycast-node/releases/download/" +
  "v{version}/agentanycastd-{os}-{arch}";

const PLATFORM_MAP: Record<string, [string, string]> = {
  "darwin-arm64": ["darwin", "arm64"],
  "darwin-x64": ["darwin", "amd64"],
  "linux-x64": ["linux", "amd64"],
  "linux-arm64": ["linux", "arm64"],
  "win32-x64": ["windows", "amd64"],
};

function detectPlatform(): [string, string] {
  const key = `${process.platform}-${process.arch}`;
  const mapping = PLATFORM_MAP[key];
  if (!mapping) {
    throw new DaemonNotFoundError(`Unsupported platform: ${key}`);
  }
  return mapping;
}

export interface DaemonManagerOptions {
  /** Path to a local agentanycastd binary. */
  daemonPath?: string;
  /** Override daemon version for download. */
  daemonVersion?: string;
  /** Path to the Ed25519 identity key file. */
  keyPath?: string;
  /** gRPC listen address (e.g., unix:///path/to/sock or tcp://localhost:50051). */
  grpcListen?: string;
  /** Relay server multiaddr for cross-network communication. */
  relay?: string;
  /** Log level for the daemon. */
  logLevel?: string;
  /** Data directory for daemon state. */
  home?: string;
  /** Transport specification (e.g., "nats://broker:4222", "auto", "libp2p"). */
  transport?: string;
  /** Namespace for multi-tenant isolation. */
  namespace?: string;
}

export class DaemonManager {
  private readonly _base: string;
  private readonly _binDir: string;
  private readonly _logDir: string;
  private readonly _daemonBin?: string;
  private readonly _daemonVersion: string;
  private readonly _keyPath: string;
  private readonly _grpcListen: string;
  private readonly _relay?: string;
  private readonly _logLevel: string;
  private readonly _transport?: string;
  private readonly _namespace?: string;
  private readonly _storePath: string;
  private _process?: ChildProcess;
  private _managed = false;

  constructor(options: DaemonManagerOptions = {}) {
    this._base = options.home ?? join(homedir(), ".agentanycast");
    this._binDir = join(this._base, "bin");
    this._logDir = join(this._base, "logs");
    this._daemonBin = options.daemonPath;
    this._daemonVersion = options.daemonVersion ?? "0.3.0";
    this._keyPath = options.keyPath ?? join(this._base, "key");
    this._grpcListen = options.grpcListen ?? `unix://${join(this._base, "daemon.sock")}`;
    this._relay = options.relay;
    this._logLevel = options.logLevel ?? "info";
    this._transport = options.transport;
    this._namespace = options.namespace;
    this._storePath = join(this._base, "data");
  }

  get grpcAddress(): string {
    return this._grpcListen;
  }

  get sockPath(): string {
    if (this._grpcListen.startsWith("unix://")) {
      return this._grpcListen.slice(7);
    }
    return join(this._base, "daemon.sock");
  }

  /** Find the daemon binary, checking explicit path, PATH, and default location. */
  findBinary(): string {
    if (this._daemonBin && existsSync(this._daemonBin)) {
      return this._daemonBin;
    }

    // Check default install location
    const defaultBin = join(this._binDir, "agentanycastd");
    if (existsSync(defaultBin)) {
      return defaultBin;
    }

    throw new DaemonNotFoundError(
      "agentanycastd binary not found. Install it or set daemonPath option.",
    );
  }

  /** Download the daemon binary for the current platform. */
  async downloadBinary(): Promise<string> {
    const [osName, arch] = detectPlatform();
    const suffix = osName === "windows" ? ".exe" : "";
    const url = RELEASE_URL.replace("{version}", this._daemonVersion)
      .replace("{os}", osName)
      .replace("{arch}", arch);

    const dest = join(this._binDir, `agentanycastd${suffix}`);
    await mkdir(this._binDir, { recursive: true });

    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) {
      if (resp.status === 404) {
        throw new DaemonNotFoundError(
          `Daemon binary not found at ${url} (HTTP 404). ` +
            `You can build the daemon locally from ` +
            `https://github.com/agentanycast/agentanycast-node and pass daemonPath option.`,
        );
      }
      throw new DaemonNotFoundError(
        `Failed to download daemon binary from ${url}: HTTP ${resp.status}`,
      );
    }

    const body = resp.body;
    if (!body) throw new DaemonNotFoundError("Empty response body");

    const nodeStream = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(nodeStream, createWriteStream(dest));
    chmodSync(dest, 0o755);

    return dest;
  }

  /** Ensure the daemon binary is available, downloading if needed. */
  async ensureBinary(): Promise<string> {
    try {
      return this.findBinary();
    } catch {
      return this.downloadBinary();
    }
  }

  private _isDaemonRunning(): boolean {
    return existsSync(this.sockPath);
  }

  /** Start the daemon process if not already running. */
  async start(): Promise<void> {
    if (this._isDaemonRunning()) {
      return;
    }

    const binary = await this.ensureBinary();
    await mkdir(this._logDir, { recursive: true });

    const logFile = join(this._logDir, "daemon.log");
    const logStream = createWriteStream(logFile, { flags: "a" });

    const args = [
      `--key=${this._keyPath}`,
      `--grpc-listen=${this._grpcListen}`,
      `--log-level=${this._logLevel}`,
    ];
    if (this._relay) args.push(`--bootstrap-peers=${this._relay}`);
    if (this._transport) args.push(`--transport=${this._transport}`);
    if (this._namespace) args.push(`--namespace=${this._namespace}`);

    const child = execFile(binary, args, {
      env: { ...process.env, AGENTANYCAST_STORE_PATH: this._storePath },
    });
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    this._process = child;
    this._managed = true;

    process.on("exit", () => this.stopSync());

    await this._waitReady(10_000);
  }

  private async _waitReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this._process?.exitCode !== null && this._process?.exitCode !== undefined) {
        let logs = "";
        try {
          logs = await readFile(join(this._logDir, "daemon.log"), "utf-8");
          logs = logs.split("\n").slice(-20).join("\n");
        } catch {
          // ignore
        }
        throw new DaemonStartError(
          `Daemon exited with code ${this._process.exitCode}.` +
            (logs ? `\n\nRecent logs:\n${logs}` : ""),
        );
      }

      if (existsSync(this.sockPath)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new DaemonConnectionError(`Daemon did not become ready within ${timeoutMs}ms.`);
  }

  /** Synchronously stop the daemon. */
  stopSync(): void {
    if (this._process && this._managed) {
      try {
        this._process.kill("SIGTERM");
      } catch {
        // ignore
      }
      this._process = undefined;

      try {
        if (existsSync(this.sockPath)) {
          unlink(this.sockPath).catch(() => {});
        }
      } catch {
        // ignore
      }
    }
  }

  /** Stop the daemon process. */
  async stop(): Promise<void> {
    this.stopSync();
  }
}
