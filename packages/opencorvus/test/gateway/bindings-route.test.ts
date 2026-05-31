import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ChannelIngress } from "../../src/channel/ingress"
import { EngineService } from "@/task-api"
import { tmpdir } from "../fixture/fixture"
import * as TaskLoop from "../../src/orchestrator/loop"
import { mock, spyOn } from "bun:test"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("ChannelIngress.bindingsByTaskID (Gateway template §10)", () => {
  test("returns the rows bound to a task id (and only those rows)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const restore = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        try {
          const taskID = await EngineService.createTask({
            request: "Test bindings reverse lookup",
            kind: "workflow",
            queue: false,
            executor: "opencorvus",
            metadata: { source: "test" },
          })
          ChannelIngress.bindThread({
            platform: "slack",
            channel: "C-foo",
            thread: "T-1",
            taskID,
            payload: { from: "test" },
          })
          ChannelIngress.bindThread({
            platform: "telegram",
            channel: "@foo",
            thread: "T-2",
            taskID,
            payload: { from: "test" },
          })
          // Bind a second task so the lookup is visibly scoped.
          const otherTaskID = await EngineService.createTask({
            request: "other",
            kind: "workflow",
            queue: false,
            executor: "opencorvus",
            metadata: { source: "test" },
          })
          ChannelIngress.bindThread({
            platform: "discord",
            channel: "ch",
            thread: "T-other",
            taskID: otherTaskID,
            payload: {},
          })

          const rows = ChannelIngress.bindingsByTaskID(taskID)
          expect(rows.length).toBe(2)
          const platforms = rows.map((r) => r.platform).sort()
          expect(platforms).toEqual(["slack", "telegram"])
          for (const row of rows) {
            expect(row.task_id).toBe(taskID)
          }

          // Empty taskID never hits the DB and returns an empty array.
          expect(ChannelIngress.bindingsByTaskID("")).toEqual([])

          // Cleanup
          await EngineService.deleteTask(taskID).catch(() => undefined)
          await EngineService.deleteTask(otherTaskID).catch(() => undefined)
        } finally {
          restore.mockRestore()
        }
      },
    })
  })
})
