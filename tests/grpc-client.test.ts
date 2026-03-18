import { describe, it, expect } from "vitest";

// We test the exported converter functions directly.
// These are pure functions that do not need a gRPC connection.
import {
  STATUS_PROTO_TO_SDK,
  protoTaskToSdk,
  protoMessageToSdk,
  protoArtifactToSdk,
  protoCardToSdk,
} from "../src/grpc-client.js";
import { TaskStatus } from "../src/task.js";
import { TaskStatus as ProtoTaskStatus } from "../src/generated/agentanycast/v1/a2a_models.js";
import type {
  Task as ProtoTask,
  Message as ProtoMessage,
  Artifact as ProtoArtifact,
  Part as ProtoPart,
} from "../src/generated/agentanycast/v1/a2a_models.js";
import { MessageRole } from "../src/generated/agentanycast/v1/a2a_models.js";
import type { AgentCard as ProtoAgentCard } from "../src/generated/agentanycast/v1/agent_card.js";

// ── STATUS_PROTO_TO_SDK mapping ──────────────────────────────────────

describe("STATUS_PROTO_TO_SDK", () => {
  it("maps all proto statuses to SDK statuses", () => {
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_SUBMITTED]).toBe(TaskStatus.SUBMITTED);
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_WORKING]).toBe(TaskStatus.WORKING);
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_INPUT_REQUIRED]).toBe(TaskStatus.INPUT_REQUIRED);
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_COMPLETED]).toBe(TaskStatus.COMPLETED);
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_FAILED]).toBe(TaskStatus.FAILED);
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_CANCELED]).toBe(TaskStatus.CANCELED);
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_REJECTED]).toBe(TaskStatus.REJECTED);
  });

  it("returns undefined for UNSPECIFIED", () => {
    expect(STATUS_PROTO_TO_SDK[ProtoTaskStatus.TASK_STATUS_UNSPECIFIED]).toBeUndefined();
  });
});

// ── protoPartToSdk (exercised through protoMessageToSdk) ─────────────

describe("protoMessageToSdk", () => {
  it("converts a user text message", () => {
    const proto: ProtoMessage = {
      messageId: "msg-1",
      role: MessageRole.MESSAGE_ROLE_USER,
      parts: [
        {
          content: { $case: "textPart", textPart: { text: "hello" } },
          mediaType: "",
          metadata: {},
        },
      ],
      createdAt: undefined,
    };
    const sdk = protoMessageToSdk(proto);
    expect(sdk.role).toBe("user");
    expect(sdk.messageId).toBe("msg-1");
    expect(sdk.parts).toHaveLength(1);
    expect(sdk.parts[0].text).toBe("hello");
  });

  it("converts an agent message with data part", () => {
    const proto: ProtoMessage = {
      messageId: "",
      role: MessageRole.MESSAGE_ROLE_AGENT,
      parts: [
        {
          content: { $case: "dataPart", dataPart: { data: { key: "value" } } },
          mediaType: "application/json",
          metadata: { tag: "test" },
        },
      ],
      createdAt: undefined,
    };
    const sdk = protoMessageToSdk(proto);
    expect(sdk.role).toBe("agent");
    expect(sdk.messageId).toBeUndefined(); // empty string → undefined
    expect(sdk.parts[0].data).toEqual({ key: "value" });
    expect(sdk.parts[0].mediaType).toBe("application/json");
    expect(sdk.parts[0].metadata).toEqual({ tag: "test" });
  });

  it("converts a URL part", () => {
    const proto: ProtoMessage = {
      messageId: "",
      role: MessageRole.MESSAGE_ROLE_USER,
      parts: [
        {
          content: { $case: "urlPart", urlPart: { url: "https://example.com", filename: "doc.pdf" } },
          mediaType: "",
          metadata: {},
        },
      ],
      createdAt: undefined,
    };
    const sdk = protoMessageToSdk(proto);
    expect(sdk.parts[0].url).toBe("https://example.com");
  });

  it("converts a raw part", () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    const proto: ProtoMessage = {
      messageId: "",
      role: MessageRole.MESSAGE_ROLE_USER,
      parts: [
        {
          content: { $case: "rawPart", rawPart: { data: Buffer.from(raw), filename: "" } },
          mediaType: "application/octet-stream",
          metadata: {},
        },
      ],
      createdAt: undefined,
    };
    const sdk = protoMessageToSdk(proto);
    expect(sdk.parts[0].raw).toEqual(Buffer.from(raw));
    expect(sdk.parts[0].mediaType).toBe("application/octet-stream");
  });

  it("handles empty content (no content set)", () => {
    const proto: ProtoMessage = {
      messageId: "",
      role: MessageRole.MESSAGE_ROLE_USER,
      parts: [{ content: undefined, mediaType: "", metadata: {} }],
      createdAt: undefined,
    };
    const sdk = protoMessageToSdk(proto);
    expect(sdk.parts[0].text).toBeUndefined();
    expect(sdk.parts[0].data).toBeUndefined();
    expect(sdk.parts[0].url).toBeUndefined();
    expect(sdk.parts[0].raw).toBeUndefined();
  });
});

// ── protoArtifactToSdk ───────────────────────────────────────────────

describe("protoArtifactToSdk", () => {
  it("converts a basic artifact", () => {
    const proto: ProtoArtifact = {
      artifactId: "art-1",
      name: "result",
      parts: [
        {
          content: { $case: "textPart", textPart: { text: "output data" } },
          mediaType: "text/plain",
          metadata: {},
        },
      ],
    };
    const sdk = protoArtifactToSdk(proto);
    expect(sdk.artifactId).toBe("art-1");
    expect(sdk.name).toBe("result");
    expect(sdk.parts).toHaveLength(1);
    expect(sdk.parts[0].text).toBe("output data");
  });

  it("handles empty artifact ID/name", () => {
    const proto: ProtoArtifact = {
      artifactId: "",
      name: "",
      parts: [],
    };
    const sdk = protoArtifactToSdk(proto);
    expect(sdk.artifactId).toBeUndefined();
    expect(sdk.name).toBeUndefined();
  });
});

// ── protoTaskToSdk ───────────────────────────────────────────────────

describe("protoTaskToSdk", () => {
  it("converts a full proto task", () => {
    const proto: ProtoTask = {
      taskId: "task-123",
      contextId: "ctx-456",
      status: ProtoTaskStatus.TASK_STATUS_WORKING,
      messages: [
        {
          messageId: "m1",
          role: MessageRole.MESSAGE_ROLE_USER,
          parts: [
            { content: { $case: "textPart", textPart: { text: "do it" } }, mediaType: "", metadata: {} },
          ],
          createdAt: undefined,
        },
      ],
      artifacts: [],
      createdAt: undefined,
      updatedAt: undefined,
      targetSkillId: "translate",
      originatorPeerId: "12D3KooW...",
    };
    const sdk = protoTaskToSdk(proto);
    expect(sdk.taskId).toBe("task-123");
    expect(sdk.contextId).toBe("ctx-456");
    expect(sdk.status).toBe(TaskStatus.WORKING);
    expect(sdk.messages).toHaveLength(1);
    expect(sdk.messages[0].parts[0].text).toBe("do it");
    expect(sdk.targetSkillId).toBe("translate");
    expect(sdk.originatorPeerId).toBe("12D3KooW...");
  });

  it("defaults to SUBMITTED for unknown status", () => {
    const proto: ProtoTask = {
      taskId: "t1",
      contextId: "",
      status: ProtoTaskStatus.TASK_STATUS_UNSPECIFIED,
      messages: [],
      artifacts: [],
      createdAt: undefined,
      updatedAt: undefined,
      targetSkillId: "",
      originatorPeerId: "",
    };
    const sdk = protoTaskToSdk(proto);
    expect(sdk.status).toBe(TaskStatus.SUBMITTED);
  });

  it("converts all terminal statuses", () => {
    for (const [protoStatus, sdkStatus] of [
      [ProtoTaskStatus.TASK_STATUS_COMPLETED, TaskStatus.COMPLETED],
      [ProtoTaskStatus.TASK_STATUS_FAILED, TaskStatus.FAILED],
      [ProtoTaskStatus.TASK_STATUS_CANCELED, TaskStatus.CANCELED],
      [ProtoTaskStatus.TASK_STATUS_REJECTED, TaskStatus.REJECTED],
    ] as const) {
      const proto: ProtoTask = {
        taskId: "t",
        contextId: "",
        status: protoStatus,
        messages: [],
        artifacts: [],
        createdAt: undefined,
        updatedAt: undefined,
        targetSkillId: "",
        originatorPeerId: "",
      };
      expect(protoTaskToSdk(proto).status).toBe(sdkStatus);
    }
  });
});

// ── protoCardToSdk ───────────────────────────────────────────────────

describe("protoCardToSdk", () => {
  it("converts a card with P2P extension", () => {
    const proto: ProtoAgentCard = {
      name: "TestAgent",
      description: "A test agent",
      version: "2.0.0",
      protocolVersion: "a2a/0.3",
      skills: [
        { id: "translate", description: "Translates text", inputSchema: '{"type":"object"}', outputSchema: "" },
      ],
      p2pExtension: {
        peerId: "12D3KooWTest",
        supportedTransports: ["noise"],
        relayAddresses: ["/ip4/1.2.3.4/tcp/4001"],
        didKey: "did:key:z6MkTest",
      },
    };
    const sdk = protoCardToSdk(proto);
    expect(sdk.name).toBe("TestAgent");
    expect(sdk.description).toBe("A test agent");
    expect(sdk.version).toBe("2.0.0");
    expect(sdk.skills).toHaveLength(1);
    expect(sdk.skills[0].id).toBe("translate");
    expect(sdk.skills[0].inputSchema).toBe('{"type":"object"}');
    expect(sdk.skills[0].outputSchema).toBeUndefined(); // empty → undefined
    expect(sdk.peerId).toBe("12D3KooWTest");
    expect(sdk.supportedTransports).toEqual(["noise"]);
    expect(sdk.relayAddresses).toEqual(["/ip4/1.2.3.4/tcp/4001"]);
    expect(sdk.didKey).toBe("did:key:z6MkTest");
  });

  it("converts a card without P2P extension", () => {
    const proto: ProtoAgentCard = {
      name: "BasicAgent",
      description: "",
      version: "1.0.0",
      protocolVersion: "a2a/0.3",
      skills: [],
      p2pExtension: undefined,
    };
    const sdk = protoCardToSdk(proto);
    expect(sdk.peerId).toBeUndefined();
    expect(sdk.didKey).toBeUndefined();
    expect(sdk.supportedTransports).toEqual([]);
    expect(sdk.relayAddresses).toEqual([]);
  });
});
