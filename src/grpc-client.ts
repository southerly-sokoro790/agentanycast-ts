/**
 * gRPC client wrapper for communicating with the agentanycastd daemon.
 *
 * Translates between the generated proto types and the SDK's public types,
 * and maps gRPC errors to the SDK's exception hierarchy.
 */

import { credentials, type ServiceError, status } from "@grpc/grpc-js";
import type { ClientReadableStream } from "@grpc/grpc-js";
import type { AgentCard } from "./card.js";
import {
  CardNotAvailableError,
  DaemonConnectionError,
  PeerNotFoundError,
  SkillNotFoundError,
  TaskNotFoundError,
} from "./exceptions.js";
import type { Artifact, Message, Part, Task } from "./task.js";
import { TaskStatus } from "./task.js";

// Import generated proto types.
import {
  NodeServiceClient as ProtoNodeServiceClient,
} from "./generated/agentanycast/v1/node_service.js";
import type {
  GetNodeInfoRequest,
  GetNodeInfoResponse,
  SetAgentCardRequest,
  ConnectPeerRequest,
  ConnectPeerResponse,
  ListPeersRequest,
  ListPeersResponse,
  GetPeerCardRequest,
  GetPeerCardResponse,
  SendTaskRequest,
  SendTaskResponse,
  GetTaskRequest,
  CancelTaskRequest,
  CancelTaskResponse,
  SubscribeTaskUpdatesResponse,
  SubscribeIncomingTasksResponse,
  UpdateTaskStatusRequest,
  CompleteTaskRequest,
  FailTaskRequest,
  DiscoverRequest,
  DiscoverResponse,
} from "./generated/agentanycast/v1/node_service.js";
import {
  TaskStatus as ProtoTaskStatus,
  MessageRole as ProtoMessageRole,
} from "./generated/agentanycast/v1/a2a_models.js";
import type {
  Task as ProtoTask,
  Message as ProtoMessage,
  Artifact as ProtoArtifact,
  Part as ProtoPart,
} from "./generated/agentanycast/v1/a2a_models.js";
import type {
  AgentCard as ProtoAgentCard,
  Skill as ProtoSkill,
} from "./generated/agentanycast/v1/agent_card.js";

// ── Proto ↔ SDK type converters ──────────────────────────────────────

export const STATUS_PROTO_TO_SDK: Record<number, TaskStatus> = {
  [ProtoTaskStatus.TASK_STATUS_SUBMITTED]: TaskStatus.SUBMITTED,
  [ProtoTaskStatus.TASK_STATUS_WORKING]: TaskStatus.WORKING,
  [ProtoTaskStatus.TASK_STATUS_INPUT_REQUIRED]: TaskStatus.INPUT_REQUIRED,
  [ProtoTaskStatus.TASK_STATUS_COMPLETED]: TaskStatus.COMPLETED,
  [ProtoTaskStatus.TASK_STATUS_FAILED]: TaskStatus.FAILED,
  [ProtoTaskStatus.TASK_STATUS_CANCELED]: TaskStatus.CANCELED,
  [ProtoTaskStatus.TASK_STATUS_REJECTED]: TaskStatus.REJECTED,
};

const STATUS_SDK_TO_PROTO: Record<string, ProtoTaskStatus> = {
  [TaskStatus.SUBMITTED]: ProtoTaskStatus.TASK_STATUS_SUBMITTED,
  [TaskStatus.WORKING]: ProtoTaskStatus.TASK_STATUS_WORKING,
  [TaskStatus.INPUT_REQUIRED]: ProtoTaskStatus.TASK_STATUS_INPUT_REQUIRED,
  [TaskStatus.COMPLETED]: ProtoTaskStatus.TASK_STATUS_COMPLETED,
  [TaskStatus.FAILED]: ProtoTaskStatus.TASK_STATUS_FAILED,
  [TaskStatus.CANCELED]: ProtoTaskStatus.TASK_STATUS_CANCELED,
  [TaskStatus.REJECTED]: ProtoTaskStatus.TASK_STATUS_REJECTED,
};

/** Convert a proto Part (oneof content) to the SDK's flat Part. */
function protoPartToSdk(p: ProtoPart): Part {
  const part: Part = {};
  if (p.content) {
    switch (p.content.$case) {
      case "textPart":
        part.text = p.content.textPart.text;
        break;
      case "dataPart":
        part.data = p.content.dataPart.data as Record<string, unknown> | undefined;
        break;
      case "urlPart":
        part.url = p.content.urlPart.url;
        break;
      case "rawPart":
        part.raw = p.content.rawPart.data;
        break;
    }
  }
  if (p.mediaType) part.mediaType = p.mediaType;
  if (p.metadata && Object.keys(p.metadata).length > 0) {
    part.metadata = p.metadata as Record<string, string>;
  }
  return part;
}

/** Convert the SDK's flat Part to a proto Part (oneof content). */
function sdkPartToProto(p: Part): ProtoPart {
  let content: ProtoPart["content"] = undefined;
  if (p.text !== undefined) {
    content = { $case: "textPart" as const, textPart: { text: p.text } };
  } else if (p.data !== undefined) {
    content = { $case: "dataPart" as const, dataPart: { data: p.data } };
  } else if (p.url !== undefined) {
    content = { $case: "urlPart" as const, urlPart: { url: p.url, filename: "" } };
  } else if (p.raw !== undefined) {
    content = { $case: "rawPart" as const, rawPart: { data: Buffer.from(p.raw), filename: "" } };
  }
  return {
    content,
    mediaType: p.mediaType ?? "",
    metadata: (p.metadata ?? {}) as { [key: string]: string },
  };
}

export function protoMessageToSdk(m: ProtoMessage): Message {
  return {
    role: m.role === ProtoMessageRole.MESSAGE_ROLE_AGENT ? "agent" : "user",
    parts: m.parts.map(protoPartToSdk),
    messageId: m.messageId || undefined,
  };
}

function sdkMessageToProto(m: Message): ProtoMessage {
  return {
    role: m.role === "agent" ? ProtoMessageRole.MESSAGE_ROLE_AGENT : ProtoMessageRole.MESSAGE_ROLE_USER,
    parts: m.parts.map(sdkPartToProto),
    messageId: m.messageId ?? "",
    createdAt: undefined,
  };
}

export function protoArtifactToSdk(a: ProtoArtifact): Artifact {
  return {
    artifactId: a.artifactId || undefined,
    name: a.name || undefined,
    parts: a.parts.map(protoPartToSdk),
  };
}

function sdkArtifactToProto(a: Artifact): ProtoArtifact {
  return {
    artifactId: a.artifactId ?? "",
    name: a.name ?? "",
    parts: a.parts.map(sdkPartToProto),
  };
}

export function protoTaskToSdk(t: ProtoTask): Task {
  return {
    taskId: t.taskId,
    contextId: t.contextId || undefined,
    status: STATUS_PROTO_TO_SDK[t.status] ?? TaskStatus.SUBMITTED,
    messages: t.messages.map(protoMessageToSdk),
    artifacts: t.artifacts.map(protoArtifactToSdk),
    targetSkillId: t.targetSkillId || undefined,
    originatorPeerId: t.originatorPeerId || undefined,
  };
}

function sdkCardToProto(card: AgentCard): ProtoAgentCard {
  const skills: ProtoSkill[] = card.skills.map((s) => ({
    id: s.id,
    description: s.description,
    inputSchema: s.inputSchema ?? "",
    outputSchema: s.outputSchema ?? "",
  }));
  return {
    name: card.name,
    description: card.description ?? "",
    version: card.version ?? "1.0.0",
    protocolVersion: card.protocolVersion ?? "a2a/0.3",
    skills,
    p2pExtension: undefined,
  };
}

export function protoCardToSdk(card: ProtoAgentCard): AgentCard {
  const p2p = card.p2pExtension;
  return {
    name: card.name,
    description: card.description,
    version: card.version,
    protocolVersion: card.protocolVersion,
    skills: card.skills.map((s) => ({
      id: s.id,
      description: s.description,
      inputSchema: s.inputSchema || undefined,
      outputSchema: s.outputSchema || undefined,
    })),
    peerId: p2p?.peerId || undefined,
    supportedTransports: p2p?.supportedTransports ?? [],
    relayAddresses: p2p?.relayAddresses ?? [],
    didKey: p2p?.didKey || undefined,
    didWeb: p2p?.didWeb || undefined,
    didDns: p2p?.didDns || undefined,
    verifiableCredentials: p2p?.verifiableCredentials ?? [],
  };
}

// ── Promisified gRPC helper ──────────────────────────────────────────

function promisify<TReq, TRes>(
  method: (request: TReq, callback: (error: ServiceError | null, response: TRes) => void) => unknown,
  client: ProtoNodeServiceClient,
): (request: TReq) => Promise<TRes> {
  return (request: TReq) =>
    new Promise<TRes>((resolve, reject) => {
      method.call(client, request, (error: ServiceError | null, response: TRes) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
}

// ── GrpcClient ───────────────────────────────────────────────────────

export interface NodeInfo {
  peerId: string;
  listenAddresses: string[];
  version: string;
}

export interface PeerInfo {
  peerId: string;
  addresses: string[];
  connectionType: number;
}

export interface DiscoveredAgent {
  peerId: string;
  agentName: string;
  skills: Array<{ skillId: string; description: string }>;
}

export class GrpcClient {
  private _client: ProtoNodeServiceClient | null = null;
  private readonly _address: string;

  constructor(address: string) {
    this._address = address;
  }

  /** Connect to the daemon and validate the connection. */
  async connect(): Promise<void> {
    let target = this._address;
    if (target.startsWith("tcp://")) target = target.slice(6);

    this._client = new ProtoNodeServiceClient(
      target,
      credentials.createInsecure(),
    );

    try {
      await this.getNodeInfo();
    } catch (err) {
      this._client.close();
      this._client = null;
      throw new DaemonConnectionError(
        `Failed to connect to daemon at ${this._address}: ${(err as Error).message}`,
      );
    }
  }

  /** Close the gRPC channel. */
  close(): void {
    if (this._client) {
      this._client.close();
      this._client = null;
    }
  }

  private _ensure(): ProtoNodeServiceClient {
    if (!this._client) throw new DaemonConnectionError("gRPC client not connected");
    return this._client;
  }

  // ── Node Management ──────────────────────────────────────

  async getNodeInfo(): Promise<NodeInfo> {
    const client = this._ensure();
    const resp = await promisify<GetNodeInfoRequest, GetNodeInfoResponse>(
      client.getNodeInfo, client,
    )({});
    const info = resp.nodeInfo!;
    return {
      peerId: info.peerId,
      listenAddresses: info.listenAddresses,
      version: info.version,
    };
  }

  async setAgentCard(card: AgentCard): Promise<void> {
    const client = this._ensure();
    await promisify<SetAgentCardRequest, unknown>(
      client.setAgentCard, client,
    )({ card: sdkCardToProto(card) });
  }

  // ── Peer Management ──────────────────────────────────────

  async connectPeer(peerId: string, addresses?: string[]): Promise<PeerInfo> {
    const client = this._ensure();
    try {
      const resp = await promisify<ConnectPeerRequest, ConnectPeerResponse>(
        client.connectPeer, client,
      )({ peerId, addresses: addresses ?? [] });
      const info = resp.peerInfo!;
      return {
        peerId: info.peerId,
        addresses: info.addresses,
        connectionType: info.connectionType,
      };
    } catch (err) {
      const e = err as ServiceError;
      if (e.code === status.NOT_FOUND) throw new PeerNotFoundError(`Peer not found: ${peerId}`);
      throw err;
    }
  }

  async listPeers(): Promise<PeerInfo[]> {
    const client = this._ensure();
    const resp = await promisify<ListPeersRequest, ListPeersResponse>(
      client.listPeers, client,
    )({});
    return resp.peers.map((p) => ({
      peerId: p.peerId,
      addresses: p.addresses,
      connectionType: p.connectionType,
    }));
  }

  async getPeerCard(peerId: string): Promise<AgentCard> {
    const client = this._ensure();
    try {
      const resp = await promisify<GetPeerCardRequest, GetPeerCardResponse>(
        client.getPeerCard, client,
      )({ peerId });
      return protoCardToSdk(resp.card!);
    } catch (err) {
      const e = err as ServiceError;
      if (e.code === status.NOT_FOUND) throw new CardNotAvailableError(`No card for peer ${peerId}`);
      if (e.code === status.INVALID_ARGUMENT) throw new PeerNotFoundError(`Invalid peer_id: ${peerId}`);
      throw err;
    }
  }

  // ── Task Client Operations ───────────────────────────────

  async sendTask(
    message: Message,
    target: { peerId?: string; skill?: string; url?: string },
    metadata?: Record<string, string>,
  ): Promise<Task> {
    const client = this._ensure();

    const req: SendTaskRequest = {
      message: sdkMessageToProto(message),
      metadata: metadata ?? {},
      target: undefined,
      transportHint: "",
    };
    if (target.peerId) req.target = { $case: "peerId", peerId: target.peerId };
    else if (target.skill) req.target = { $case: "skillId", skillId: target.skill };
    else if (target.url) req.target = { $case: "url", url: target.url };

    try {
      const resp = await promisify<SendTaskRequest, SendTaskResponse>(
        client.sendTask, client,
      )(req);
      return protoTaskToSdk(resp.task!);
    } catch (err) {
      const e = err as ServiceError;
      if (e.code === status.UNAVAILABLE) throw new PeerNotFoundError(`Cannot reach target: ${e.details}`);
      if (e.code === status.NOT_FOUND) throw new SkillNotFoundError(`No agents for skill: ${e.details}`);
      throw err;
    }
  }

  async getTask(taskId: string): Promise<Task> {
    const client = this._ensure();
    try {
      const resp = await promisify<GetTaskRequest, { task?: ProtoTask }>(
        client.getTask, client,
      )({ taskId });
      return protoTaskToSdk(resp.task!);
    } catch (err) {
      const e = err as ServiceError;
      if (e.code === status.NOT_FOUND) throw new TaskNotFoundError(`Task ${taskId} not found`);
      throw err;
    }
  }

  async cancelTask(taskId: string): Promise<Task> {
    const client = this._ensure();
    try {
      const resp = await promisify<CancelTaskRequest, CancelTaskResponse>(
        client.cancelTask, client,
      )({ taskId });
      return protoTaskToSdk(resp.task!);
    } catch (err) {
      const e = err as ServiceError;
      if (e.code === status.NOT_FOUND) throw new TaskNotFoundError(`Task ${taskId} not found`);
      throw err;
    }
  }

  // ── Discovery ────────────────────────────────────────────

  async discover(
    skillId: string,
    options?: { tags?: Record<string, string>; limit?: number },
  ): Promise<DiscoveredAgent[]> {
    const client = this._ensure();
    try {
      const resp = await promisify<DiscoverRequest, DiscoverResponse>(
        client.discover, client,
      )({
        skillId,
        tags: options?.tags ?? {},
        limit: options?.limit ?? 0,
      });
      return resp.agents.map((a) => ({
        peerId: a.peerId,
        agentName: a.agentName,
        skills: a.skills.map((s) => ({
          skillId: s.skillId,
          description: s.description,
        })),
      }));
    } catch (err) {
      const e = err as ServiceError;
      if (e.code === status.UNAVAILABLE) throw new SkillNotFoundError(`Discovery unavailable: ${e.details}`);
      throw err;
    }
  }

  // ── Task Status Subscriptions (streaming) ────────────────

  subscribeTaskUpdates(taskId: string): ClientReadableStream<SubscribeTaskUpdatesResponse> {
    const client = this._ensure();
    return client.subscribeTaskUpdates({ taskId });
  }

  subscribeIncomingTasks(): ClientReadableStream<SubscribeIncomingTasksResponse> {
    const client = this._ensure();
    return client.subscribeIncomingTasks({});
  }

  // ── Task Server Operations ───────────────────────────────

  async updateTaskStatus(taskId: string, sdkStatus: string, message?: Message): Promise<void> {
    const client = this._ensure();
    const protoStatus = STATUS_SDK_TO_PROTO[sdkStatus] ?? ProtoTaskStatus.TASK_STATUS_UNSPECIFIED;
    await promisify<UpdateTaskStatusRequest, unknown>(
      client.updateTaskStatus, client,
    )({
      taskId,
      status: protoStatus,
      message: message ? sdkMessageToProto(message) : undefined,
    });
  }

  async completeTask(taskId: string, artifacts?: Artifact[], message?: Message): Promise<void> {
    const client = this._ensure();
    await promisify<CompleteTaskRequest, unknown>(
      client.completeTask, client,
    )({
      taskId,
      artifacts: (artifacts ?? []).map(sdkArtifactToProto),
      message: message ? sdkMessageToProto(message) : undefined,
    });
  }

  async failTask(taskId: string, errorMessage: string): Promise<void> {
    const client = this._ensure();
    await promisify<FailTaskRequest, unknown>(
      client.failTask, client,
    )({ taskId, errorMessage });
  }
}
