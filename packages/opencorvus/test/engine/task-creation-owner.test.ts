import { afterEach, describe, expect, test } from "bun:test"
import {
  resetTaskCreationOwnerLocksForTest,
  taskCreationOwnerKey,
  withTaskCreationOwnerLock,
} from "../../src/engine/task-creation-owner"
import type { CreateTaskInput } from "../../src/engine/model"
import type z from "zod"

type ParsedCreateTask = z.infer<typeof CreateTaskInput>

function parsed(input: Partial<ParsedCreateTask>): ParsedCreateTask {
  return {
    request: "request",
    queue: false,
    ...input,
  }
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("task creation owner serialization", () => {
  afterEach(() => {
    resetTaskCreationOwnerLocksForTest()
  })

  test("derives mission and parent-task owner keys from creation metadata", () => {
    expect(
      taskCreationOwnerKey(
        parsed({
          metadata: { mission: { id: "m1", session_id: "ses_m1" } },
        }),
      ),
    ).toBe("mission:ses_m1")
    expect(
      taskCreationOwnerKey(
        parsed({
          metadata: { parent_task_id: "tsk_parent" },
        }),
      ),
    ).toBe("task:tsk_parent")
    expect(taskCreationOwnerKey(parsed({ metadata: { actor: "panel_ui" } }))).toBeUndefined()
  })

  test("serializes concurrent creates for the same mission owner", async () => {
    const input = parsed({ metadata: { mission: { id: "m1", session_id: "ses_m1" } } })
    const events: string[] = []
    let releaseFirst!: () => void
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withTaskCreationOwnerLock(input, async () => {
      events.push("first:start")
      await firstPaused
      events.push("first:end")
      return "first"
    })
    const second = withTaskCreationOwnerLock(input, async () => {
      events.push("second:start")
      events.push("second:end")
      return "second"
    })

    await tick()
    expect(events).toEqual(["first:start"])
    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"])
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"])
  })

  test("does not serialize unrelated owners", async () => {
    const events: string[] = []
    await Promise.all([
      withTaskCreationOwnerLock(parsed({ metadata: { parent_task_id: "tsk_a" } }), async () => {
        events.push("a")
        return "a"
      }),
      withTaskCreationOwnerLock(parsed({ metadata: { parent_task_id: "tsk_b" } }), async () => {
        events.push("b")
        return "b"
      }),
    ])
    expect(events.sort()).toEqual(["a", "b"])
  })
})
