import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { createGoalWorkspace, cleanupGoalWorkspace } from "../../src/orchestrator/goal-runner"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Snapshot } from "../../src/snapshot"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator.goal workspace cleanup", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("cleans goal workspace directories without exposing them as sandboxes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const snapshot = await Snapshot.track()
        const directory = await createGoalWorkspace({
          task: { id: "task_goal_cleanup" } as any,
          goal: { id: "goal_goal_cleanup" } as any,
          snapshot,
        })

        expect(existsSync(directory)).toBe(true)
        expect(Project.get(Instance.project.id)?.sandboxes ?? []).not.toContain(directory)
        expect(await Project.sandboxes(Instance.project.id)).not.toContain(directory)

        await cleanupGoalWorkspace(directory)

        expect(existsSync(directory)).toBe(false)
        expect(Project.get(Instance.project.id)?.sandboxes ?? []).not.toContain(directory)
      },
    })
  })
})
