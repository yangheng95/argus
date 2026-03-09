import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { createSupervisor } from "../src/service"
import { createStore } from "../src/store"
import type { Worker } from "../src/worker"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), "supervisor-"))
  dirs.push(dir)
  return dir
}

describe("supervisor", () => {
  test("creates a goal with seeded phases", async () => {
    const dir = await sandbox()
    const store = createStore(dir)
    const worker: Worker = {
      run: async () => {
        throw new Error("worker should not run in create test")
      },
    }
    const supervisor = createSupervisor({ store, worker })
    const result = await supervisor.createGoal({
      title: "Ship feature",
      request: "Implement the feature",
      acceptance: "Tests pass",
    })

    expect(result.goal?.title).toBe("Ship feature")
    expect(result.phases.map((item) => item.kind)).toEqual(["plan", "execute", "verify"])
  })

  test("replays verification failures into another round", async () => {
    const dir = await sandbox()
    const store = createStore(dir)
    const calls: string[] = []
    const outputs = [
      "<phase_summary>Plan ready</phase_summary>",
      "<phase_summary>Implemented</phase_summary>",
      [
        "<goal_status>continue</goal_status>",
        "<summary>Missing one edge case</summary>",
        "<next_step>Add the missing edge case and rerun verification.</next_step>",
      ].join("\n"),
      "<phase_summary>Patched the edge case</phase_summary>",
      [
        "<goal_status>done</goal_status>",
        "<summary>Acceptance criteria now pass</summary>",
        "<next_step>None</next_step>",
      ].join("\n"),
    ]
    const worker: Worker = {
      run: async (input) => {
        calls.push(input.prompt)
        const text = outputs.shift()
        if (!text) throw new Error("Missing fake worker output")
        return {
          sessionId: input.sessionId ?? "ses_1",
          messageId: `msg_${calls.length}`,
          text,
        }
      },
    }
    const supervisor = createSupervisor({ store, worker })
    const created = await supervisor.createGoal({
      title: "Ship feature",
      request: "Implement the feature",
      acceptance: "Tests pass",
    })

    const result = await supervisor.runGoal(created.goal!.id)

    expect(result.goal?.status).toBe("completed")
    expect(result.goal?.round).toBe(1)
    expect(result.phases.length).toBe(5)
    expect(result.runs.length).toBe(5)
  })

  test("injects recorded preferences into phase prompts", async () => {
    const dir = await sandbox()
    const store = createStore(dir)
    const calls: string[] = []
    const outputs = [
      "<phase_summary>Plan ready</phase_summary>",
      "<phase_summary>Implemented</phase_summary>",
      [
        "<goal_status>done</goal_status>",
        "<summary>Acceptance criteria now pass</summary>",
        "<next_step>None</next_step>",
      ].join("\n"),
    ]
    const worker: Worker = {
      run: async (input) => {
        calls.push(input.prompt)
        const text = outputs.shift()
        if (!text) throw new Error("Missing fake worker output")
        return {
          sessionId: input.sessionId ?? "ses_2",
          messageId: `msg_${calls.length}`,
          text,
        }
      },
    }
    const supervisor = createSupervisor({ store, worker })
    await supervisor.addPreference({
      label: "naming",
      value: "Prefer single-word identifiers when reasonable.",
    })
    const created = await supervisor.createGoal({
      title: "Ship feature",
      request: "Implement the feature",
      acceptance: "Tests pass",
    })

    await supervisor.runGoal(created.goal!.id)

    expect(calls.every((item) => item.includes("naming: Prefer single-word identifiers when reasonable."))).toBe(true)
  })
})
