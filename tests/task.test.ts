import { describe, it, expect } from "vitest";
import { TaskHandle, TaskStatus, isTerminal, type Task } from "../src/task.js";
import { TaskFailedError, TaskCanceledError, TaskTimeoutError } from "../src/exceptions.js";

describe("isTerminal", () => {
  it("returns true for terminal statuses", () => {
    expect(isTerminal(TaskStatus.COMPLETED)).toBe(true);
    expect(isTerminal(TaskStatus.FAILED)).toBe(true);
    expect(isTerminal(TaskStatus.CANCELED)).toBe(true);
    expect(isTerminal(TaskStatus.REJECTED)).toBe(true);
  });

  it("returns false for non-terminal statuses", () => {
    expect(isTerminal(TaskStatus.SUBMITTED)).toBe(false);
    expect(isTerminal(TaskStatus.WORKING)).toBe(false);
    expect(isTerminal(TaskStatus.INPUT_REQUIRED)).toBe(false);
  });
});

describe("TaskHandle", () => {
  function makeTask(status = TaskStatus.SUBMITTED): Task {
    return {
      taskId: "test-123",
      status,
      messages: [],
      artifacts: [],
    };
  }

  it("resolves immediately when already completed", async () => {
    const handle = new TaskHandle(makeTask(TaskStatus.COMPLETED), async () => {});
    const task = await handle.wait(1000);
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("waits for completion", async () => {
    const handle = new TaskHandle(makeTask(), async () => {});
    setTimeout(() => handle._update(TaskStatus.COMPLETED), 10);
    const task = await handle.wait(1000);
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("throws TaskFailedError on failure", async () => {
    const handle = new TaskHandle(makeTask(), async () => {});
    setTimeout(() => handle._update(TaskStatus.FAILED), 10);
    await expect(handle.wait(1000)).rejects.toThrow(TaskFailedError);
  });

  it("throws TaskCanceledError on cancellation", async () => {
    const handle = new TaskHandle(makeTask(), async () => {});
    setTimeout(() => handle._update(TaskStatus.CANCELED), 10);
    await expect(handle.wait(1000)).rejects.toThrow(TaskCanceledError);
  });

  it("throws TaskTimeoutError on timeout", async () => {
    const handle = new TaskHandle(makeTask(), async () => {});
    await expect(handle.wait(50)).rejects.toThrow(TaskTimeoutError);
  });

  it("calls cancel function", async () => {
    let canceled = false;
    const handle = new TaskHandle(makeTask(), async () => {
      canceled = true;
    });
    await handle.cancel();
    expect(canceled).toBe(true);
  });

  it("updates artifacts", () => {
    const handle = new TaskHandle(makeTask(), async () => {});
    expect(handle.artifacts).toEqual([]);
    handle._update(TaskStatus.COMPLETED, [{ parts: [{ text: "result" }] }]);
    expect(handle.artifacts.length).toBe(1);
    expect(handle.artifacts[0].parts[0].text).toBe("result");
  });
});
