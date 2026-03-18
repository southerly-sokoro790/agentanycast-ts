import { describe, it, expect } from "vitest";
import {
  AgentAnycastError,
  DaemonError,
  DaemonNotFoundError,
  DaemonStartError,
  DaemonConnectionError,
  PeerError,
  PeerNotFoundError,
  PeerDisconnectedError,
  PeerAuthenticationError,
  TaskError,
  TaskNotFoundError,
  TaskTimeoutError,
  TaskCanceledError,
  TaskFailedError,
  TaskRejectedError,
  CardNotAvailableError,
  RoutingError,
  SkillNotFoundError,
  BridgeError,
  BridgeConnectionError,
  BridgeTranslationError,
} from "../src/exceptions.js";

describe("Exception hierarchy", () => {
  const cases = [
    { Class: AgentAnycastError, name: "AgentAnycastError", parent: Error },
    { Class: DaemonError, name: "DaemonError", parent: AgentAnycastError },
    { Class: DaemonNotFoundError, name: "DaemonNotFoundError", parent: DaemonError },
    { Class: DaemonStartError, name: "DaemonStartError", parent: DaemonError },
    { Class: DaemonConnectionError, name: "DaemonConnectionError", parent: DaemonError },
    { Class: PeerError, name: "PeerError", parent: AgentAnycastError },
    { Class: PeerNotFoundError, name: "PeerNotFoundError", parent: PeerError },
    { Class: PeerDisconnectedError, name: "PeerDisconnectedError", parent: PeerError },
    { Class: PeerAuthenticationError, name: "PeerAuthenticationError", parent: PeerError },
    { Class: TaskError, name: "TaskError", parent: AgentAnycastError },
    { Class: TaskNotFoundError, name: "TaskNotFoundError", parent: TaskError },
    { Class: TaskTimeoutError, name: "TaskTimeoutError", parent: TaskError },
    { Class: TaskCanceledError, name: "TaskCanceledError", parent: TaskError },
    { Class: TaskFailedError, name: "TaskFailedError", parent: TaskError },
    { Class: TaskRejectedError, name: "TaskRejectedError", parent: TaskError },
    { Class: CardNotAvailableError, name: "CardNotAvailableError", parent: AgentAnycastError },
    { Class: RoutingError, name: "RoutingError", parent: AgentAnycastError },
    { Class: SkillNotFoundError, name: "SkillNotFoundError", parent: RoutingError },
    { Class: BridgeError, name: "BridgeError", parent: AgentAnycastError },
    { Class: BridgeConnectionError, name: "BridgeConnectionError", parent: BridgeError },
    { Class: BridgeTranslationError, name: "BridgeTranslationError", parent: BridgeError },
  ] as const;

  for (const { Class, name, parent } of cases) {
    it(`${name} has correct name and inherits from ${parent.name}`, () => {
      const err = Class === TaskFailedError
        ? new Class("test message", "detail")
        : new (Class as new (msg: string) => Error)("test message");
      expect(err.name).toBe(name);
      expect(err.message).toBe("test message");
      expect(err).toBeInstanceOf(parent);
      expect(err).toBeInstanceOf(AgentAnycastError);
      expect(err).toBeInstanceOf(Error);
    });
  }
});

describe("TaskFailedError", () => {
  it("stores errorDetail", () => {
    const err = new TaskFailedError("task failed", "connection reset");
    expect(err.errorDetail).toBe("connection reset");
    expect(err.message).toBe("task failed");
  });

  it("uses errorDetail as message when message is empty", () => {
    const err = new TaskFailedError("", "fallback detail");
    expect(err.message).toBe("fallback detail");
    expect(err.errorDetail).toBe("fallback detail");
  });

  it("defaults errorDetail to empty string", () => {
    const err = new TaskFailedError("just a message");
    expect(err.errorDetail).toBe("");
  });
});
