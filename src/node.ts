/**
 * Node — the core entry point for AgentAnycast TypeScript SDK.
 *
 * Manages the connection to the local Go daemon via gRPC and provides
 * an async API for sending/receiving A2A Tasks.
 *
 * Usage:
 *   const node = new Node({ card: myCard });
 *   await node.start();
 *   const handle = await node.sendTask({ role: "user", parts: [...] }, { peerId });
 *   const result = await handle.wait();
 *   await node.stop();
 */

import type { AgentCard } from "./card.js";
import { DaemonManager, type DaemonManagerOptions } from "./daemon.js";
import {
  GrpcClient,
  STATUS_PROTO_TO_SDK,
  protoArtifactToSdk,
  protoCardToSdk,
  protoTaskToSdk,
  type DiscoveredAgent,
  type PeerInfo,
} from "./grpc-client.js";
import type { Artifact, IncomingTask, Message } from "./task.js";
import { TaskHandle, TaskStatus } from "./task.js";

/** Task handler function type. */
export type TaskHandler = (task: IncomingTask) => Promise<void>;

export interface NodeOptions {
  /** Your agent's AgentCard describing its identity and skills. */
  card: AgentCard;
  /** Relay server multiaddr for cross-network communication. */
  relay?: string;
  /** Path to the libp2p identity key file. */
  keyPath?: string;
  /** Connect to an already-running daemon at this gRPC address. */
  daemonAddr?: string;
  /** Path to a local agentanycastd binary. */
  daemonPath?: string;
  /** Data directory for daemon state. */
  home?: string;
  /**
   * Transport specification for the daemon (e.g., "nats://broker:4222", "auto", "libp2p").
   * When undefined, defaults to libp2p.
   */
  transport?: string;
  /**
   * Namespace for multi-tenant isolation.
   * When undefined, defaults to "default".
   */
  namespace?: string;
}

export class Node {
  private readonly _card: AgentCard;
  private readonly _relay?: string;
  private readonly _keyPath?: string;
  private readonly _daemonAddr?: string;
  private readonly _daemonPath?: string;
  private readonly _home?: string;
  private readonly _transport?: string;
  private readonly _namespace?: string;

  private _daemon?: DaemonManager;
  private _grpc?: GrpcClient;
  private _peerId?: string;
  private _running = false;
  private readonly _taskHandlers: TaskHandler[] = [];
  private readonly _tasks = new Map<string, TaskHandle>();
  private _incomingAbort?: AbortController;

  constructor(options: NodeOptions) {
    this._card = options.card;
    this._relay = options.relay;
    this._keyPath = options.keyPath;
    this._daemonAddr = options.daemonAddr;
    this._daemonPath = options.daemonPath;
    this._home = options.home;
    this._transport = options.transport;
    this._namespace = options.namespace;
  }

  /** This node's PeerID (available after start). */
  get peerId(): string {
    if (!this._peerId) {
      throw new Error("Node not started. Call await node.start() first.");
    }
    return this._peerId;
  }

  get isRunning(): boolean {
    return this._running;
  }

  /** Start the node: launch daemon, connect gRPC, set agent card. */
  async start(): Promise<void> {
    if (this._running) return;

    let grpcAddr = this._daemonAddr;

    if (!grpcAddr) {
      const daemonOpts: DaemonManagerOptions = {
        daemonPath: this._daemonPath,
        keyPath: this._keyPath,
        relay: this._relay,
        home: this._home,
        transport: this._transport,
        namespace: this._namespace,
      };
      this._daemon = new DaemonManager(daemonOpts);
      await this._daemon.start();
      grpcAddr = this._daemon.grpcAddress;
    }

    this._grpc = new GrpcClient(grpcAddr!);
    await this._grpc.connect();
    await this._grpc.setAgentCard(this._card);
    const info = await this._grpc.getNodeInfo();
    this._peerId = info.peerId;

    this._running = true;
  }

  /** Stop the node and clean up resources. */
  async stop(): Promise<void> {
    if (!this._running) return;

    this._incomingAbort?.abort();

    if (this._grpc) {
      this._grpc.close();
      this._grpc = undefined;
    }

    if (this._daemon) {
      await this._daemon.stop();
    }

    this._running = false;
  }

  /**
   * Register a task handler. Incoming tasks are dispatched to all handlers.
   *
   * Usage:
   *   node.onTask(async (task) => {
   *     await task.complete([{ parts: [{ text: "result" }] }]);
   *   });
   */
  onTask(handler: TaskHandler): void {
    this._taskHandlers.push(handler);
  }

  /**
   * Send an A2A Task to a remote agent.
   *
   * Exactly one of peerId, skill, or url must be provided.
   */
  async sendTask(
    message: Message,
    target: { peerId?: string; skill?: string; url?: string },
  ): Promise<TaskHandle> {
    this._ensureRunning();

    const targets = [target.peerId, target.skill, target.url].filter(Boolean);
    if (targets.length !== 1) {
      throw new Error("Exactly one of peerId, skill, or url must be provided");
    }

    const task = await this._grpc!.sendTask(message, target);

    const handle = new TaskHandle(task, async () => {
      await this._grpc!.cancelTask(task.taskId);
    });
    this._tasks.set(task.taskId, handle);

    // Subscribe to status updates in the background.
    this._subscribeUpdates(task.taskId, handle);

    return handle;
  }

  /** Get the Agent Card of a connected peer. */
  async getCard(peerId: string): Promise<AgentCard> {
    this._ensureRunning();
    return this._grpc!.getPeerCard(peerId);
  }

  /** Connect to a remote peer by PeerID. */
  async connectPeer(peerId: string, addresses?: string[]): Promise<PeerInfo> {
    this._ensureRunning();
    return this._grpc!.connectPeer(peerId, addresses);
  }

  /** List all currently connected peers. */
  async listPeers(): Promise<PeerInfo[]> {
    this._ensureRunning();
    return this._grpc!.listPeers();
  }

  /**
   * Discover agents that offer a specific skill.
   * Queries the discovery network (DHT + Relay Registry).
   */
  async discover(
    skill: string,
    options?: { tags?: Record<string, string>; limit?: number },
  ): Promise<DiscoveredAgent[]> {
    this._ensureRunning();
    return this._grpc!.discover(skill, options);
  }

  /** Run the node, processing incoming tasks until stopped. */
  async serveForever(): Promise<void> {
    this._ensureRunning();
    this._incomingAbort = new AbortController();
    const stream = this._grpc!.subscribeIncomingTasks();

    return new Promise<void>((resolve, reject) => {
      this._incomingAbort!.signal.addEventListener("abort", () => {
        stream.cancel();
        resolve();
      });

      stream.on("data", (resp) => {
        const task = resp.task;
        if (!task) return;

        const sdkTask = protoTaskToSdk(task);
        const senderCard = resp.senderCard ? protoCardToSdk(resp.senderCard) : undefined;

        const incoming: IncomingTask = {
          taskId: sdkTask.taskId,
          peerId: sdkTask.originatorPeerId ?? "",
          messages: sdkTask.messages,
          targetSkillId: sdkTask.targetSkillId ?? "",
          senderCard: senderCard as unknown as Record<string, unknown> | undefined,
          updateStatus: async (s: string) => {
            await this._grpc!.updateTaskStatus(sdkTask.taskId, s);
          },
          complete: async (artifacts?: Artifact[]) => {
            await this._grpc!.completeTask(sdkTask.taskId, artifacts);
          },
          fail: async (error: string) => {
            await this._grpc!.failTask(sdkTask.taskId, error);
          },
          requestInput: async (message?: Message) => {
            await this._grpc!.updateTaskStatus(
              sdkTask.taskId,
              TaskStatus.INPUT_REQUIRED,
              message,
            );
          },
        };

        for (const handler of this._taskHandlers) {
          handler(incoming).catch((err) => {
            incoming.fail(String(err)).catch(() => {});
          });
        }
      });

      stream.on("error", (err: Error & { code?: number }) => {
        // gRPC CANCELLED (code 1) means we stopped intentionally.
        if (err.code === 1) {
          resolve();
        } else {
          reject(err);
        }
      });

      stream.on("end", () => {
        resolve();
      });
    });
  }

  /** Subscribe to status updates for a sent task. */
  private _subscribeUpdates(taskId: string, handle: TaskHandle, attempt = 0): void {
    const stream = this._grpc!.subscribeTaskUpdates(taskId);

    stream.on("data", (resp) => {
      const sdkStatus = STATUS_PROTO_TO_SDK[resp.status];
      if (sdkStatus) {
        const artifacts = resp.artifacts?.map(protoArtifactToSdk);
        handle._update(sdkStatus, artifacts?.length ? artifacts : undefined);
      }
    });

    stream.on("error", (err: Error & { code?: number }) => {
      // gRPC CANCELLED (code 1) means we stopped intentionally.
      if (err.code === 1) return;

      // Retry with exponential backoff if the node is still running.
      if (attempt < 3 && this._running) {
        const delay = Math.pow(2, attempt) * 1000;
        setTimeout(() => this._subscribeUpdates(taskId, handle, attempt + 1), delay);
      }
    });
  }

  private _ensureRunning(): void {
    if (!this._running) {
      throw new Error("Node not started. Call await node.start() first.");
    }
  }
}
