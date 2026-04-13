import { describe, test, expect, beforeEach } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Trace } from "../../src/trace"
import { tmpdir } from "../fixture/fixture"

beforeEach(() => {
  Trace._resetForTests()
})

describe("Trace.event", () => {
  test("appends one JSONL line per call with monotonic seq", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = "t-monotonic"
        Trace.event({ taskID, category: "task.start" })
        Trace.event({ taskID, category: "agent.start", agent: "decompose" })
        Trace.event({ taskID, category: "llm.step", agent: "decompose", round: 1 })
        Trace.event({ taskID, category: "task.finish" })

        await Trace.flush()
        const events = await Trace.read(taskID)

        expect(events.length).toBe(4)
        expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4])
        expect(events.map((e) => e.category)).toEqual([
          "task.start",
          "agent.start",
          "llm.step",
          "task.finish",
        ])
        expect(events[1].agent).toBe("decompose")
        expect(events[2].round).toBe(1)
      },
    })
  })

  test("broadcasts each event over Bus", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: string[] = []
        const unsub = Bus.subscribe(Trace.Event, (evt) => {
          received.push(evt.properties.category)
        })

        const taskID = "t-bus"
        Trace.event({ taskID, category: "task.start" })
        Trace.event({ taskID, category: "llm.step", agent: "planner" })
        await Trace.flush()
        // Bus publish is async — yield once so subscribers run.
        await new Promise((r) => setTimeout(r, 10))
        unsub()

        expect(received).toEqual(["task.start", "llm.step"])
      },
    })
  })

  test("listTasks returns newest task first", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Trace.event({ taskID: "t-1", category: "task.start" })
        await Trace.flush()
        await new Promise((r) => setTimeout(r, 20))
        Trace.event({ taskID: "t-2", category: "task.start" })
        await Trace.flush()

        const list = await Trace.listTasks()
        expect(list[0]).toBe("t-2")
        expect(list).toContain("t-1")
      },
    })
  })

  test("OPENCORVUS_TRACE_DIR env override is respected", async () => {
    await using tmp = await tmpdir()
    const overrideDir = path.join(tmp.path, "custom-trace")
    process.env.OPENCORVUS_TRACE_DIR = overrideDir
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          Trace.event({ taskID: "t-env", category: "task.start" })
          await Trace.flush()
          const file = path.join(overrideDir, "t-env.jsonl")
          const stat = await fs.stat(file).catch(() => null)
          expect(stat?.isFile()).toBe(true)
        },
      })
    } finally {
      delete process.env.OPENCORVUS_TRACE_DIR
    }
  })

  test("oversized payload is truncated, not dropped", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = "t-large"
        const huge = "x".repeat(2_000_000) // 2 MB > 1 MB cap
        Trace.event({ taskID, category: "llm.step", payload: { text: huge } })
        await Trace.flush()
        const events = await Trace.read(taskID)
        expect(events.length).toBe(1)
        const payload = events[0].payload as { _truncated?: boolean }
        expect(payload._truncated).toBe(true)
      },
    })
  })
})
