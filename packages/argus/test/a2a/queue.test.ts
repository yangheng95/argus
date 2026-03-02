import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { TaskQueue } from "../../src/a2a/queue"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("a2a.task_queue", () => {
  test("dequeueAny picks highest priority across sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionA = await Session.create({ title: "a2a-test-a" })
        const sessionB = await Session.create({ title: "a2a-test-b" })

        const low = TaskQueue.enqueue({
          sessionID: sessionA.id,
          prompt: "low task",
          priority: "low",
        })
        const critical = TaskQueue.enqueue({
          sessionID: sessionB.id,
          prompt: "critical task",
          priority: "critical",
        })

        const first = TaskQueue.dequeueAny()
        const second = TaskQueue.dequeueAny()

        expect(first?.id).toBe(critical.id)
        expect(second?.id).toBe(low.id)

        await Session.remove(sessionA.id)
        await Session.remove(sessionB.id)
      },
    })
  })

  test("dequeueAny returns null on empty queue", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = TaskQueue.dequeueAny()
        expect(result).toBeNull()
      },
    })
  })
})
